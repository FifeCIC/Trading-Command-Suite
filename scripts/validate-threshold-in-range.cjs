#!/usr/bin/env node
/**
 * validate-threshold-in-range.cjs — INV-THRESHOLD-IN-RANGE (#1275).
 *
 * ── WHAT THIS CHECKS ──
 * Every active bot's `minComposite` must sit INSIDE its protocol's measured band:
 *
 *     floorPct  <  minComposite  <=  ceilingPct
 *
 * Below or equal to the floor and the bot trades the protocol's "nothing is happening" score on
 * every bar. Above the ceiling and the bot can never fire. Both ends are MEASURED from
 * `score_snapshot`, never typed — the floor is the modal `signalPct`, the ceiling its maximum.
 *
 * ── WHY THIS EXISTS, MEASURED 2026-11-14 ──
 * `assertCeilingAllowsActivation()` refused a bar ABOVE the ceiling and NOTHING checked a bar
 * BELOW the floor, so a bot could be comfortably under the ceiling and still be trading noise.
 * Six of 64 active bots were: Probe RSI Oversold Bot at bar 0 against a floor of 57.14,
 * Gold Short M15 Bot 10 vs 25.05, EURUSD MTF Weighted 9 vs 23.53, Earnings Momentum NVDA 10 vs
 * 12.20, US SPY Speed 9 vs 11.51, Gold Position 4H 8 vs 9.89.
 *
 * The mechanism behind "the threshold cliff" on forex the same day: an entry bar of 8.0 gave 803
 * trades and −£1,002 while 8.4 gave 159 and +£66. 8.4 IS the floor — the difference was entirely
 * whether the no-signal mode was admitted.
 *
 * ── WHY IT REPORTS BY DEFAULT AND DOES NOT FAIL A BUILD ──
 * A below-floor bar is a LIVE TRADING CONFIGURATION. Refusing the build over one would either block
 * unrelated work or force a bot to stop — both are decisions for the owner, not a script. So the
 * default exit code is 0 with a loud report; `--strict` exits 1 for a deliberate gate.
 *
 * ⚠️ AND IT REFUSES TO PASS SILENTLY WHEN IT CANNOT JUDGE. No DATABASE_URL, an unreachable
 * database, or a protocol with too few readings is reported as `cannot judge` and counted
 * separately — never folded into the pass total. A check that inspects nothing and reports OK is
 * worse than no check.
 *
 * USAGE
 *   node scripts/validate-threshold-in-range.cjs               # report, exit 0
 *   node scripts/validate-threshold-in-range.cjs --strict      # exit 1 if any bot is out of range
 *   node scripts/validate-threshold-in-range.cjs --json
 *   node scripts/validate-threshold-in-range.cjs --self-test   # canary, both directions, no DB
 */

'use strict';

const fs = require('fs');
const path = require('path');

const MIN_SAMPLES = 100;
const MIN_SHARE_PCT = 10;
const WINDOW_DAYS = 7;

/**
 * evaluateBand() — the decision, as a PURE function so the self-test can canary it without a DB.
 *
 * `floorPct === null` means NOT MEASURED, which is a different answer from `0`. A caller must not
 * treat it as safe.
 */
function evaluateBand({ thresholdPct, floorPct, ceilingPct }) {
  // ⚠️ `null` MUST BE CHECKED BEFORE `Number()`. `Number(null)` is **0**, and 0 is finite — so an
  // unset bar became "0", which is at or below every floor, and the guard reported a MISSING value
  // as a defect. Caught by this file's own self-test on the first run (2026-11-14). The same lesson
  // as "a pid of 0 is a value, not an absence": a comparison must reject the absence first.
  if (thresholdPct == null || thresholdPct === '') return 'cannot-judge';
  const bar = Number(thresholdPct);
  if (!Number.isFinite(bar)) return 'cannot-judge';
  if (floorPct == null && ceilingPct == null) return 'cannot-judge';
  // `<=` on the floor: the floor value IS the no-signal score, so a bar equal to it admits it.
  if (floorPct != null && bar <= Number(floorPct)) return 'below-floor';
  if (ceilingPct != null && bar > Number(ceilingPct)) return 'above-ceiling';
  return 'in-range';
}

/** modeFloor() — the modal value and its share, from (value, count) pairs. Pure. */
function modeFloor(pairs) {
  const rows = pairs.filter((p) => Number.isFinite(Number(p.value)) && Number(p.n) > 0);
  if (rows.length === 0) return { floorPct: null, sharePct: null, samples: 0, distinct: 0, verdict: 'no-readings' };
  let total = 0;
  let mode = null;
  let modeN = 0;
  for (const p of rows) {
    const n = Number(p.n);
    total += n;
    if (n > modeN) { mode = Number(p.value); modeN = n; }
  }
  const sharePct = (100 * modeN) / total;
  if (total < MIN_SAMPLES) return { floorPct: null, sharePct, samples: total, distinct: rows.length, verdict: 'too-few-samples' };
  if (sharePct < MIN_SHARE_PCT) return { floorPct: null, sharePct, samples: total, distinct: rows.length, verdict: 'no-dominant-value' };
  return { floorPct: Math.round(mode * 100) / 100, sharePct, samples: total, distinct: rows.length, verdict: 'measured' };
}

function selfTest() {
  const cases = [];
  const t = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    cases.push({ name, ok, got, want });
  };

  // ── evaluateBand: every outcome, both directions ────────────────────────────────────────────
  t('in range', evaluateBand({ thresholdPct: 12, floorPct: 8.4, ceilingPct: 19.6 }), 'in-range');
  t('EQUAL to the floor is BELOW (the floor IS the no-signal score)',
    evaluateBand({ thresholdPct: 8.4, floorPct: 8.4, ceilingPct: 19.6 }), 'below-floor');
  t('just above the floor is in range',
    evaluateBand({ thresholdPct: 8.41, floorPct: 8.4, ceilingPct: 19.6 }), 'in-range');
  t('below the floor', evaluateBand({ thresholdPct: 9, floorPct: 25.05, ceilingPct: 60 }), 'below-floor');
  t('above the ceiling', evaluateBand({ thresholdPct: 70, floorPct: 8.4, ceilingPct: 19.6 }), 'above-ceiling');
  t('equal to the ceiling is IN range (a bar you can exactly reach can fire)',
    evaluateBand({ thresholdPct: 19.6, floorPct: 8.4, ceilingPct: 19.6 }), 'in-range');
  t('no floor measured and no ceiling -> cannot judge, never "in range"',
    evaluateBand({ thresholdPct: 10, floorPct: null, ceilingPct: null }), 'cannot-judge');
  t('floor measured, ceiling missing -> floor still applies',
    evaluateBand({ thresholdPct: 5, floorPct: 8.4, ceilingPct: null }), 'below-floor');
  t('unreadable bar -> cannot judge', evaluateBand({ thresholdPct: null, floorPct: 8.4, ceilingPct: 19.6 }), 'cannot-judge');

  // ── modeFloor: the share/sample gates ──────────────────────────────────────────────────────
  t('a dominant mode is measured', modeFloor([{ value: 8.4, n: 800 }, { value: 12, n: 200 }]),
    { floorPct: 8.4, sharePct: 80, samples: 1000, distinct: 2, verdict: 'measured' });
  t('too few samples -> null, not 0', modeFloor([{ value: 8.4, n: 99 }]),
    { floorPct: null, sharePct: 100, samples: 99, distinct: 1, verdict: 'too-few-samples' });
  t('no dominant value -> null, because a 2%-share mode is a coincidence',
    modeFloor([{ value: 8.4, n: 10 }, { value: 9, n: 10 }, { value: 10, n: 10 }, { value: 11, n: 10 },
      { value: 12, n: 10 }, { value: 13, n: 10 }, { value: 14, n: 10 }, { value: 15, n: 10 },
      { value: 16, n: 10 }, { value: 17, n: 10 }, { value: 18, n: 10 }, { value: 19, n: 10 }]),
    { floorPct: null, sharePct: 100 / 12, samples: 120, distinct: 12, verdict: 'no-dominant-value' });
  t('empty input -> no-readings', modeFloor([]),
    { floorPct: null, sharePct: null, samples: 0, distinct: 0, verdict: 'no-readings' });

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) {
    console.log(`  ${c.ok ? '✔' : '✖'} ${c.name}`);
    if (!c.ok) console.log(`      got ${JSON.stringify(c.got)}  want ${JSON.stringify(c.want)}`);
  }
  console.log(`\n  ${cases.length - failed.length}/${cases.length} passed`);
  return failed.length === 0;
}

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', 'nest', '.env');
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL\s*=\s*(.*)$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* handled by the caller */ }
  return null;
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const ok = selfTest();
    process.exit(ok ? 0 : 1);
  }

  const strict = process.argv.includes('--strict');
  const asJson = process.argv.includes('--json');

  const url = loadDatabaseUrl();
  if (!url) {
    // Cannot judge. Loud, and never a silent pass — but not a build failure either.
    console.error('[threshold-range] ⚠️ CANNOT JUDGE — no DATABASE_URL in the environment or nest/.env.');
    console.error('[threshold-range]    The band is measured from score_snapshot; without a database there is nothing to measure.');
    console.error('[threshold-range]    This is reported as UNVERIFIED, not as a pass.');
    process.exit(strict ? 1 : 0);
  }

  let PrismaClient;
  try {
    ({ PrismaClient } = require(path.join(__dirname, '..', 'nest', 'node_modules', '@prisma', 'client')));
  } catch (err) {
    console.error(`[threshold-range] ⚠️ CANNOT JUDGE — Prisma client not available: ${err.message}`);
    process.exit(strict ? 1 : 0);
  }

  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient();
  try {
    const values = await prisma.$queryRawUnsafe(`
      SELECT ss.protocolId AS protocolId, ss.signalPct AS signalPct, COUNT(ss.id) AS n
      FROM score_snapshot ss
      WHERE ss.signalPct IS NOT NULL
        AND ss.snappedAt >= '2026-09-11'
        AND ss.snappedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${WINDOW_DAYS} DAY)
      GROUP BY ss.protocolId, ss.signalPct`);

    const byProtocol = new Map();
    for (const v of values) {
      const key = String(v.protocolId);
      if (!byProtocol.has(key)) byProtocol.set(key, []);
      byProtocol.get(key).push({ value: v.signalPct, n: v.n });
    }

    const bots = await prisma.$queryRawUnsafe(`
      SELECT name, protocolId, minComposite, active FROM trading_strategy`);

    const results = [];
    for (const b of bots) {
      const band = byProtocol.has(String(b.protocolId))
        ? modeFloor(byProtocol.get(String(b.protocolId)))
        : { floorPct: null, sharePct: null, samples: 0, distinct: 0, verdict: 'no-readings' };
      const ceilingRow = byProtocol.has(String(b.protocolId))
        ? Math.max(...byProtocol.get(String(b.protocolId)).map((p) => Number(p.value)))
        : null;
      const verdict = evaluateBand({
        thresholdPct: b.minComposite,
        floorPct: band.floorPct,
        ceilingPct: ceilingRow,
      });
      results.push({
        bot: b.name,
        protocol: b.protocolId,
        active: Number(b.active) === 1,
        thresholdPct: Number(b.minComposite),
        floorPct: band.floorPct,
        floorSharePct: band.sharePct == null ? null : Math.round(band.sharePct * 10) / 10,
        samples: band.samples,
        distinctValues: band.distinct,
        ceilingPct: ceilingRow == null ? null : Math.round(ceilingRow * 100) / 100,
        verdict,
      });
    }

    const active = results.filter((r) => r.active);
    const outOfRange = active.filter((r) => r.verdict === 'below-floor' || r.verdict === 'above-ceiling');
    const cannotJudge = active.filter((r) => r.verdict === 'cannot-judge');

    if (asJson) {
      console.log(JSON.stringify({ windowDays: WINDOW_DAYS, results, summary: {
        active: active.length, outOfRange: outOfRange.length, cannotJudge: cannotJudge.length,
      } }, null, 2));
      process.exit(strict && outOfRange.length > 0 ? 1 : 0);
    }

    console.log(`\n[threshold-range] INV-THRESHOLD-IN-RANGE — floor < minComposite <= ceiling`);
    console.log(`[threshold-range] window ${WINDOW_DAYS}d · scale epoch 2026-09-11 · ${active.length} active bot(s)\n`);
    for (const r of outOfRange) {
      const why = r.verdict === 'below-floor'
        ? `AT OR BELOW THE FLOOR ${r.floorPct}% — trades the no-signal state (floor is ${r.floorSharePct}% of ${r.samples} readings)`
        : `ABOVE THE CEILING ${r.ceilingPct}% — can never fire`;
      console.log(`  🛑 ${r.bot}`);
      console.log(`     ${r.protocol} · bar ${r.thresholdPct}% · ${why}`);
    }
    if (outOfRange.length === 0) console.log('  ✅ every judged active bot is inside its band');

    // ⚠️ Reported SEPARATELY and never added to the pass count. A protocol with no readings is not
    // a protocol that passed.
    if (cannotJudge.length > 0) {
      console.log(`\n  ⚠️ ${cannotJudge.length} active bot(s) CANNOT BE JUDGED — no usable readings for their protocol:`);
      for (const r of cannotJudge) {
        console.log(`     ${r.bot} (${r.protocol}) — ${r.samples} reading(s)`);
      }
    }
    console.log(`\n[threshold-range] ${outOfRange.length} out of range · ${cannotJudge.length} cannot judge · ${active.length - outOfRange.length - cannotJudge.length} in range`);
    if (outOfRange.length > 0 && !strict) {
      console.log('[threshold-range] ℹ️ REPORT ONLY — a below-floor bar is a live trading configuration.');
      console.log('[threshold-range]    Run with --strict to make this exit 1.');
    }
    process.exit(strict && outOfRange.length > 0 ? 1 : 0);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`[threshold-range] ⚠️ CANNOT JUDGE — ${err && err.message ? err.message : err}`);
  process.exit(process.argv.includes('--strict') ? 1 : 0);
});
