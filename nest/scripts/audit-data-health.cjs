#!/usr/bin/env node
/**
 * audit-data-health.cjs — the guard for the class that cost 5 days of trading and 16,673
 * unusable measurement rows.
 * =====================================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * The project owner asked (2026-09-15): *"Clearly we need to question why any column in any
 * table is currently empty after all this time."*
 *
 * The answer is that **a missing value and a not-yet-populated value look identical in a
 * database.** The row count grows, the insert succeeds, nothing errors, and the dashboard
 * shows a healthy table. Every instance below produced *plausible numbers with no error* —
 * this repo's documented signature of its worst bugs:
 *
 *   #733  `MarketBar.timeframe` holds `15m`, outcomes written as `M15`. Equality filter
 *         never matched -> 35,472 of 40,120 rows matured to NULL FOREVER.
 *   #821  `directiveoutcome.strategyId` never set -> 16,673/16,673 NULL, so NO per-protocol
 *         statistic was ever computable. `edge-statistics.service.ts` groups by that column.
 *   P&L   82 unrecoverable rows made the win rate read 8.77% instead of the true 31.3%.
 *
 * And the SAME shape produced the outage:
 *
 *   2026-09-10 -> 09-15  ADR-011 changed the percentage DENOMINATOR from the observed
 *         directional sum (~130) to the configured capacity (~725-815), ~6.3x larger.
 *         Every trade threshold stayed on the old scale, so `ENTRY_THRESHOLD = 40`
 *         classified every tick as HOLD and NO TRADE EXECUTED FOR FIVE DAYS.
 *
 * **Three code comments carried that diagnosis. Nobody could SEE the numbers.** Row counts
 * and dashboards all looked fine.
 *
 * Only an explicit expectation can tell "absent" from "not yet filled". This script is that
 * expectation, written down and executed.
 *
 * USAGE (from nest/):
 *     npm run audit:data-health
 *     node scripts/audit-data-health.cjs
 *
 * EXIT CODE: 1 if any check fails, 0 otherwise.
 *
 * ⚠️ NOT IN `prebuild` — DELIBERATELY.
 * This reads the LIVE DATABASE. Putting it in `prebuild` would make every build fail on a
 * cold or absent database, which is a different (and worse) problem than the one being
 * solved. The static source-level guard for #821's class lives in the test suite; this is
 * the STATE check, and state checks are run on demand — same reasoning as `db:check`.
 */

const path = require('path');

const NEST_ROOT = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(NEST_ROOT, '.env') });

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const N = (v) => (typeof v === 'bigint' ? Number(v) : v);

/**
 * FAIL is decided on the MOST RECENT rows, using a zero-NULL invariant.
 *
 * ⚠️ WHY A ZERO INVARIANT AND NOT A PERCENTAGE OR A TIME WINDOW
 * A writer that is correctly wired produces **zero** NULLs. So the honest check is "are any
 * of the newest rows unset?" — not "what fraction of the last N hours is unset?".
 *
 * Both alternatives are worse, and both were tried on 2026-09-15:
 *
 *   - **All-time percentage**: fails forever on known-unrecoverable history. #821 left
 *     16,815 permanently-NULL rows (attribution cannot be reconstructed — a directive
 *     participates in many protocols, so any backfill would silently mislabel). A guard that
 *     always fails is a guard people learn to ignore.
 *   - **Fixed time window (24h)**: spans a deployment, so it reports the *transition* as a
 *     failure. Measured here: 16% for 24h and 45% for 4h, when the true post-fix rate was
 *     **100%** over 346 rows. It reads as "the fix did not work" when it worked perfectly.
 *
 * The newest-rows invariant has neither problem: it is independent of when the fix shipped
 * and of how much history is broken. It asks only "is the writer correct right now?".
 *
 * History is still reported (24h and all-time) so the gap stays VISIBLE without being
 * mistaken for an active defect.
 */
const RECENT_SAMPLE_ROWS = 200;

const failures = [];
const warnings = [];

/**
 * Columns that MUST be populated, with the reason. An empty reason is a bug in this file.
 *
 * ⚠️ Adding a column here to silence a failure is the ONE thing you must not do. If a
 * column is legitimately nullable, say WHY in `allowNull` — a green audit that hides a
 * dead column is worse than no audit (this is how #733 and #821 survived).
 */
const MUST_POPULATE = [
  { table: 'directiveoutcome', column: 'strategyId', reason: '#821 — protocol attribution. NULL here disables every per-protocol statistic.' },
  { table: 'directiveoutcome', column: 'directiveId', reason: 'Without it an outcome cannot be attributed to any directive.' },
  { table: 'directiveoutcome', column: 'symbol', reason: 'Outcome cannot be joined to price data.' },
  { table: 'directiveoutcome', column: 'timeframe', reason: '#733 — MT5-style labels (M15) broke bar lookups and rows never matured.' },
  { table: 'score', column: 'strategyId', reason: 'Protocol slug — the key every per-protocol query groups by.' },
  { table: 'score', column: 'breakdown', reason: 'The whole reading lives here; a NULL row is unattributable and unreplayable.' },
  { table: 'trade', column: 'symbol', reason: 'A trade with no symbol cannot be reconciled.' },
];

/**
 * Columns where NULL is LEGITIMATE, each with its reason. Recorded so the distinction is
 * explicit rather than assumed — that assumption is the defect this script addresses.
 */
const ALLOW_NULL = [
  { table: 'directiveoutcome', column: 'priceT24h', reason: 'Only filled once 24h has elapsed since predictedAt.' },
  { table: 'directiveoutcome', column: 'priceT4h', reason: 'Only filled once 4h has elapsed.' },
  { table: 'directiveoutcome', column: 'directionCorrect', reason: 'Only resolved once T+1h is known.' },
  { table: 'directiveoutcome', column: 'outcomeComputedAt', reason: 'NULL means still maturing, by design.' },
  // NOTE: `trade.side` is NOT in MUST_POPULATE. 21 Trading212 share holdings carry NULL
  // side and are genuinely not MT5 positions — see #811 (investments vs positions).
];

async function checkMustPopulate() {
  console.log('\n[1/4] must-populate columns');
  console.log(`      FAIL = any NULL among the ${RECENT_SAMPLE_ROWS} newest rows (a correct writer emits none).`);
  console.log('      24h and all-time rates are CONTEXT, not verdicts — they span deployments.');
  console.log('      ' + 'table.column'.padEnd(40) + 'allNull%'.padStart(9) + '24hNull%'.padStart(9) + 'newestNull'.padStart(11) + '  verdict');
  console.log('      ' + '-'.repeat(92));

  for (const { table, column, reason } of MUST_POPULATE) {
    let total, nulls, nulls24 = 0, total24 = 0, recentNull = null, recentN = 0, tsCol = null;
    try {
      const t = await prisma.$queryRawUnsafe(`SELECT COUNT(*) n FROM \`${table}\``);
      total = N(t[0].n);
      if (total === 0) {
        console.log('      ' + `${table}.${column}`.padEnd(40) + String(total).padStart(9) + '        -          -   (empty table)');
        continue;
      }
      const r = await prisma.$queryRawUnsafe(`SELECT SUM(\`${column}\` IS NULL) n FROM \`${table}\``);
      nulls = N(r[0].n ?? 0);

      // Find the table's own ordering column rather than assuming one.
      const cols = (await prisma.$queryRawUnsafe(`SHOW COLUMNS FROM \`${table}\``)).map((c) => c.Field);
      tsCol = ['createdAt', 'timestamp', 'predictedAt'].find((c) => cols.includes(c));
      const pk = cols.includes('id') ? 'id' : null;

      if (tsCol) {
        const r24 = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*) n, SUM(\`${column}\` IS NULL) nul FROM \`${table}\`
           WHERE \`${tsCol}\` >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`);
        total24 = N(r24[0].n);
        nulls24 = N(r24[0].nul ?? 0);
      }

      // THE INVARIANT: the newest rows must be clean. Ordered by time when available,
      // otherwise by insertion order.
      const orderBy = tsCol ? `\`${tsCol}\` DESC` : pk ? `\`${pk}\` DESC` : null;
      if (orderBy) {
        const rr = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*) n, SUM(\`${column}\` IS NULL) nul FROM (
             SELECT \`${column}\` FROM \`${table}\` ORDER BY ${orderBy} LIMIT ${RECENT_SAMPLE_ROWS}
           ) t`);
        recentN = N(rr[0].n);
        recentNull = N(rr[0].nul ?? 0);
      }
    } catch (e) {
      failures.push(`${table}.${column}: could not read — ${e.message.split('\n')[0]}`);
      continue;
    }

    const allPct = (100 * nulls) / total;
    const pct24 = total24 === 0 ? null : (100 * nulls24) / total24;
    const bad = recentNull != null && recentNull > 0;

    const verdict = bad
      ? `FAIL — ${recentNull}/${recentN} newest are NULL`
      : allPct >= 50 ? 'ok — historical gap only' : 'ok';

    console.log('      ' + `${table}.${column}`.padEnd(40) + allPct.toFixed(1).padStart(9) +
      (pct24 == null ? '        -' : pct24.toFixed(1).padStart(9)) +
      (recentNull == null ? '          -' : `${recentNull}/${recentN}`.padStart(11)) +
      '  ' + verdict);

    if (bad) {
      failures.push(
        `${table}.${column}: ${recentNull} of the ${recentN} newest rows are NULL.\n` +
        `        Why it must be populated: ${reason}\n` +
        `        ⚠️ CHECK THE WRITER BEFORE ASSUMING THE DATA IS MISSING — #733 and #821 were\n` +
        `        both a silently omitted field in a create/insert call, not absent data.`,
      );
    } else if (allPct >= 50) {
      warnings.push(
        `${table}.${column} is ${allPct.toFixed(1)}% NULL all-time but CLEAN on its newest ` +
        `${recentN} rows — a known historical gap (e.g. #821's 16,815 rows before the fix), ` +
        `not an active defect.`,
      );
    }
  }
}

/**
 * A column that USED to populate and now does not is a REGRESSION, and a raw NULL count
 * cannot see it. Newest non-null per column makes the difference visible.
 */
async function checkStaleness(windowHours = 48) {
  console.log(`\n[2/4] freshness — newest non-null, must be within ${windowHours}h for live tables`);
  for (const { table, column } of [
    { table: 'directiveoutcome', column: 'createdAt' },
    { table: 'score', column: 'timestamp' },
  ]) {
    try {
      const r = await prisma.$queryRawUnsafe(`SELECT MAX(\`${column}\`) newest FROM \`${table}\``);
      const newest = r[0].newest;
      const ageH = newest ? (Date.now() - new Date(newest).getTime()) / 3_600_000 : Infinity;
      const stale = ageH > windowHours;
      console.log('      ' + `${table}.${column}`.padEnd(42) + String(newest).padEnd(28) + (stale ? 'STALE  <-- WARN' : 'fresh'));
      if (stale) {
        warnings.push(`${table}.${column} newest is ${Number.isFinite(ageH) ? ageH.toFixed(1) + 'h' : 'never'} old. A writing pipeline may have stopped — a stale writer looks identical to a healthy table.`);
      }
    } catch { /* table absent in this environment */ }
  }
}

/**
 * classifyReachability() — the PURE core of the outage guard, so `--self-test` can canary it.
 *
 * Given the two measured ceilings for one bot's protocol — the SCORE window (breakdown-derived
 * percentage) and the SIGNAL PATH (`score_snapshot.signalPct`, the number the bot's own gate
 * compares) — decide whether the bot has cleared its bar in the window.
 *
 * ⚠️ WHY TWO SOURCES, and why the snapshot can only VETO a failure (measured 2026-10-08, #999):
 * `score` ROTATES. Measured: for `xau-speed-m15` the table held ~2 days while this check asked
 * for 7 — max 77 raw = 8.46% — so the audit reported `Gold Day-Trade M15` (bar 10%) as
 * "CANNOT FIRE". The signal path told a different, checkable story: `score_snapshot` max
 * `signalPct` 15.16% in the same 7 days, and `decision_log` shows the bot QUALIFYING every
 * tick 2026-10-07 12:40→13:59 at compositePct 11-14 — blocked by the DAILY-LOSS guard, a
 * correct gate, not a bar problem. A ceiling read from a rotating table understates by
 * construction; the snapshot is the value the gate actually compares.
 *
 * The snapshot does NOT pass a bot on its own word: a bot below BOTH sources is still the
 * true condition this check exists to surface. When ONLY the snapshot clears, the finding is
 * a WARNING (the score window understates), never silent and never a failure —
 * "cannot judge" stays distinct from "cannot fire".
 *
 * @returns 'cleared' | 'cleared-by-snapshot' | 'below' | 'no-data'
 */
function classifyReachability(scorePct, snapPct, bar) {
  const s = scorePct == null ? null : Number(scorePct);
  const p = snapPct == null ? null : Number(snapPct);
  const b = Number(bar);
  if (s == null && p == null) return 'no-data';
  const best = Math.max(Number.isFinite(s) ? s : -Infinity, Number.isFinite(p) ? p : -Infinity);
  if (!Number.isFinite(best)) return 'no-data';
  if (best >= b) return (Number.isFinite(s) && s >= b) ? 'cleared' : 'cleared-by-snapshot';
  return 'below';
}

/**
 * THE OUTAGE GUARD.
 *
 * An active bot whose bar exceeds the highest score its protocol has produced cannot fire.
 * That is exactly the 2026-09-10 -> 09-15 condition, and it was invisible.
 *
 * ⚠️ CORRECTED 2026-10-07 (#999) — the ceiling is a WINDOW observation, and the numerator is
 * MARKET-CONDITIONAL: a directive emits a direction only in some states. Measured: gold 1h
 * produced 8 raw points all week, then 80-138 within an hour when RSI went oversold — and it
 * QUEUED signals the same day. So a below-bar bot has "not cleared in the window", NOT
 * "cannot trade". And it is NOT the 2026-09-10->15 condition: that outage was the denominator
 * SCALE change, which is fixed and verified (#761 — do not "fix" style-thresholds.ts).
 *
 * ⚠️ CORRECTED AGAIN 2026-10-08 (#999) — "the window" was a lie for any protocol whose
 * `score` rows had rotated away, and that produced a FALSE "CANNOT FIRE" on
 * `Gold Day-Trade M15` (see classifyReachability above for the full measurement). The check
 * now reads TWO sources, names the coverage it actually read, and a score-below /
 * signal-path-cleared bot is a WARNING, not a failure.
 *
 * ⚠️ `no-data` is reported as a WARNING, never a failure. "Unmeasured" and "structurally
 * blocked" are different problems with different fixes; conflating them either panics over
 * a quiet protocol or ignores a dead one.
 */
async function checkThresholdReachability(windowDays = 7) {
  console.log(`\n[3/4] threshold reachability — active bots whose bar exceeds their achieved ceiling`);
  let rows;
  let coverage = null;
  let snapBySlug = new Map();
  try {
    rows = await prisma.$queryRawUnsafe(`
      SELECT ts.name, ts.symbol, ts.protocolId, ts.minComposite,
             MAX(s.breakdown->>'$.rawComposite' / NULLIF(s.breakdown->>'$.configuredSignalMax', 0) * 100) AS achieved,
             COUNT(s.id) AS samples
      FROM trading_strategy ts
      LEFT JOIN score s
        ON s.strategyId COLLATE utf8mb4_unicode_ci = ts.protocolId COLLATE utf8mb4_unicode_ci
       AND s.timestamp >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
      WHERE ts.active = 1
      GROUP BY ts.id, ts.name, ts.symbol, ts.protocolId, ts.minComposite
      ORDER BY ts.minComposite ASC`);

    // Name the coverage actually read (#999 part 2 — "7 days" from a rotating table is a claim).
    const cov = await prisma.$queryRawUnsafe(`SELECT MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM score`);
    coverage = cov && cov[0] ? cov[0] : null;

    // The signal path's own percentage — what the bot gate compares. Can veto, never pass.
    const snaps = await prisma.$queryRawUnsafe(`
      SELECT ts.protocolId AS slug, MAX(ss.signalPct) AS snapPct, MAX(ss.composite) AS snapRaw
      FROM trading_strategy ts
      JOIN score_snapshot ss
        ON ss.protocolId COLLATE utf8mb4_unicode_ci = ts.protocolId COLLATE utf8mb4_unicode_ci
       AND ss.snappedAt >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
      WHERE ts.active = 1
      GROUP BY ts.protocolId`);
    snapBySlug = new Map(snaps.map((x) => [String(x.slug), x]));
  } catch (e) {
    warnings.push(`threshold reachability could not run: ${e.message.split('\n')[0]}`);
    return;
  }

  const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + 'Z' : '—');
  if (coverage && coverage.oldest) {
    console.log(`      score table actually covers ${fmt(coverage.oldest)} → ${fmt(coverage.newest)} (asked for ${windowDays}d — the table ROTATES)`);
  }

  const below = [];
  const vetoed = [];
  const noData = [];
  for (const r of rows) {
    const snap = snapBySlug.get(String(r.protocolId)) || null;
    const state = classifyReachability(r.achieved, snap ? snap.snapPct : null, r.minComposite);
    const measured =
      `bar=${r.minComposite}%  score=${r.achieved == null ? '—' : Number(r.achieved).toFixed(1) + '%'}` +
      `  signalPath=${snap && snap.snapPct != null ? Number(snap.snapPct).toFixed(1) + '%' : '—'}`;
    if (state === 'below') below.push({ ...r, measured });
    else if (state === 'cleared-by-snapshot') vetoed.push({ ...r, measured });
    else if (state === 'no-data') noData.push(r);
  }

  console.log('      active bots: ' + rows.length + '   clearing: ' + (rows.length - below.length - noData.length) +
              '   below in window: ' + below.length + '   no data: ' + noData.length);

  for (const r of below) {
    console.log(`      below        ${String(r.name).padEnd(34)} ${r.measured}`);
  }
  for (const r of vetoed) {
    console.log(`      below score window, CLEARED by signal path  ${String(r.name).padEnd(34)} ${r.measured}`);
  }
  if (below.length) {
    failures.push(
      `${below.length} active bot(s) have a bar ABOVE the highest score their protocol produced in the window (all sources that measured them agree).\n` +
      `        NOT PROOF THEY CAN NEVER TRADE: the numerator is market-conditional (a directive\n` +
      `        emits a direction only in some states — gold produced ~8 raw all week, then 80-138\n` +
      `        within an hour of RSI going oversold, and QUEUED signals the same day).\n` +
      `        This is a bar exceeding the OBSERVED ceiling — review the protocol + bar (#999).\n` +
      `        It is NOT the 2026-09-10 -> 09-15 condition: that scale defect is fixed and\n` +
      `        verified (#761). Do not "fix" style-thresholds.ts.`,
    );
  }
  if (vetoed.length) {
    warnings.push(
      `${vetoed.length} bot(s) sit below the RETAINED score window but CLEARED in the pipeline's own signal path:\n` +
      vetoed.map((r) => `          ${String(r.name).padEnd(34)} ${r.measured}`).join('\n') +
      `\n        The score table ROTATES — the window understates, and the signal path is the\n` +
      `        number the bot gate compares. This is NOT a failure and NOT a bar defect; it is\n` +
      `        evidence the score window must never be read as "7 days" (measured 2026-10-08 on\n` +
      `        Gold Day-Trade M15: score 8.5% vs signalPct 15.2%; its signal exceeded the 10%\n` +
      `        bar on 2026-10-07 12:40-13:59 and the dispatch was refused by the account-wide\n` +
      `        daily-loss cap — a correct guard, not a bar problem). (#999)`,
    );
  }
  for (const r of noData) {
    console.log(`      no data      ${String(r.name).padEnd(34)} bar=${r.minComposite}%  (no scores in ${windowDays}d, neither source)`);
  }
  if (noData.length) {
    warnings.push(
      `${noData.length} active bot(s) have produced no scores in ${windowDays} days — UNMEASURED, not blocked.\n` +
      `        Check the protocol resolves (a slug-or-UUID mismatch produces exactly this, #801).`,
    );
  }
}

/**
 * Protocol references must use the SLUG, never the UUID.
 *
 * ⚠️ #801 — WHY THIS IS A SILENT DEFECT AND NOT A COSMETIC ONE
 * `score.strategyId` and `strategy_protocol.protocolId` both hold the SLUG. A
 * `trading_strategy` row referencing the UUID does NOT fail — **it just never matches**.
 *
 * Measured 2026-09-15: 4 of 26 bots carried a UUID. All 4 resolved to real protocols, so
 * nothing errored, but any join of `score.strategyId = trading_strategy.protocolId` returned
 * NOTHING for them. The thresholds endpoint reported CAC/DAX/FTSE as `no-data` when
 * `dax-speed-v1` had produced **170 scores** — a false negative that reads as "a quiet
 * protocol" rather than "a broken key". After normalising, 13 bots with data became **16**.
 *
 * That is the same class as #733 and #821: a plausible-looking result with no error.
 */
async function checkProtocolRefs() {
  console.log('\n[4/4] protocol references — must be SLUGS, never UUIDs (#801)');
  let protos, rows;
  try {
    protos = await prisma.$queryRawUnsafe(`SELECT id, slug FROM protocol`);
    rows = await prisma.$queryRawUnsafe(`
      SELECT 'trading_strategy' AS src, name AS label, protocolId FROM trading_strategy
      UNION ALL
      SELECT 'strategy_protocol' AS src, CONCAT('strategy ', strategyId) AS label, protocolId FROM strategy_protocol`);
  } catch (e) {
    warnings.push(`protocol reference check could not run: ${e.message.split('\n')[0]}`);
    return;
  }

  const slugSet = new Set(protos.map((x) => x.slug));
  const slugById = new Map(protos.map((x) => [x.id, x.slug]));

  const useUuid = rows.filter((r) => !slugSet.has(r.protocolId) && slugById.has(r.protocolId));
  const unresolvable = rows.filter((r) => !slugSet.has(r.protocolId) && !slugById.has(r.protocolId));

  console.log(`      references: ${rows.length}   by slug: ${rows.length - useUuid.length - unresolvable.length}   by UUID: ${useUuid.length}   unresolvable: ${unresolvable.length}`);

  for (const r of useUuid) {
    console.log(`      UUID  ${r.src}.${String(r.label).padEnd(34)} ${r.protocolId} -> ${slugById.get(r.protocolId)}`);
  }
  for (const r of unresolvable) {
    console.log(`      DEAD  ${r.src}.${String(r.label).padEnd(34)} ${r.protocolId}`);
  }

  if (useUuid.length) {
    failures.push(
      `${useUuid.length} reference(s) use a protocol UUID where every other table uses the SLUG.\n` +
      `        These RESOLVE but never JOIN — per-bot statistics silently return nothing for them\n` +
      `        (#801: 3 bots appeared as "no data" while holding 380 scores between them).\n` +
      `        Fix: UPDATE ... SET protocolId = '<slug>'.`,
    );
  }
  if (unresolvable.length) {
    failures.push(
      `${unresolvable.length} reference(s) resolve to NO protocol by slug or UUID.\n` +
      `        These can never score, queue or trade.`,
    );
  }
}

// ── Daily-bar duplicates (#880) ──────────────────────────────────────────────
//
// ⚠️ READ THIS BEFORE WRITING ANY DAY-OF-WEEK FILTER OVER `marketbar` `1d`.
//
// MEASURED 2026-10-01 — daily bars are stamped at the session's **START**, not its close, so a
// normal week is labelled **Sun, Mon, Tue, Wed, Thu** and NOT Mon–Fri:
//
//     EURUSD 1d (mt5)          gap to previous bar
//     2026-09-30 21:00 Wed          24h
//     2026-09-29 21:00 Tue          24h
//     2026-09-28 21:00 Mon          24h
//     2026-09-27 21:00 Sun          72h   <-- the weekend gap is BEFORE the Sunday bar
//     2026-09-24 21:00 Thu          24h
//
// The 72-hour weekend gap falls between **Thu 21:00 and Sun 21:00**, which is only consistent with
// session-START stamping: FX opens Sun 21:00 UTC and the fifth session runs Thu 21:00 → Fri 21:00.
// So Sun–Thu is **CORRECT, not a bug** — #880 left this explicitly undecided, and this settles it.
//
// ⚠️ THE TRAP THIS CREATES: `DAYOFWEEK(timestamp) = 6` (Friday) matches essentially nothing —
// measured 283 bars against ~2,400 for every other day — because **there is no Friday bar in this
// convention**. The Friday session is the one stamped `Thursday 21:00`. A weekday filter written
// against the Mon–Fri assumption silently matches nothing and reads as "no data", not as "wrong
// filter". (This blocked the first `friday-drift` test. That directive is now RETIRED — #879 — with
// the finding that no Friday session effect exists.)
//
// What REMAINS a real defect is the stray Friday bars: they are **byte-identical** to the preceding
// Thursday bar (same open, close AND volume), so they are duplicate writes, not a mislabelled
// session. That is what this check finds.

/**
 * classifyDailyBarDuplicates() — PURE, so `--self-test` can canary it in both directions.
 *
 * `rows` must be ordered by (symbolId, provider, timestamp ASC). A pair is a duplicate only when ALL
 * of open/high/low/close/volume are equal — comparing `close` alone would flag a flat-but-real
 * session, and a false positive here gets the check ignored.
 */
function classifyDailyBarDuplicates(rows) {
  const out = [];
  const prev = new Map();
  for (const r of rows) {
    const key = `${r.symbolId}|${r.provider}`;
    const p = prev.get(key);
    if (p) {
      const same =
        Number(p.open) === Number(r.open) &&
        Number(p.high) === Number(r.high) &&
        Number(p.low) === Number(r.low) &&
        Number(p.close) === Number(r.close) &&
        Number(p.volume) === Number(r.volume);
      if (same) {
        out.push({
          symbolId: r.symbolId,
          provider: r.provider,
          timestamp: r.timestamp,
          priorTimestamp: p.timestamp,
          ticker: r.ticker ?? null,
        });
      }
    }
    prev.set(key, r);
  }
  return out;
}

async function checkDailyBarDuplicates() {
  console.log('\n[5] Daily-bar duplicates (marketbar 1d) — #880');
  const rows = await prisma.$queryRawUnsafe(
    `SELECT b.symbolId, b.provider, b.timestamp, b.open, b.high, b.low, b.close, b.volume, s.ticker
       FROM marketbar b JOIN symbol s ON s.id = b.symbolId
      WHERE b.timeframe = '1d'
      ORDER BY b.symbolId, b.provider, b.timestamp ASC`,
  );
  const dupes = classifyDailyBarDuplicates(rows);
  if (dupes.length === 0) {
    console.log('      ✅ no consecutive identical OHLCV bars');
    return;
  }
  // Reported, NOT deleted: removing market rows is a data decision, and a re-import can recreate
  // them. The check's job is to stop this being invisible.
  const sample = dupes.slice(0, 3).map((d) => `${d.ticker}@${d.provider} ${new Date(d.timestamp).toISOString()}`);
  warnings.push(
    `${dupes.length} daily bar(s) are byte-identical to the bar before them (same open/high/low/close/volume)` +
      ` — e.g. ${sample.join(', ')}. These are stray duplicate writes, not sessions: the Sun–Thu labelling is` +
      ' correct (session-START stamps) and a DAYOFWEEK=Friday filter matches nothing by design. Do not delete' +
      ' the rows to silence this — fix the import.',
  );
}

/** `--self-test` — canary the pure classifiers in BOTH directions. No database needed. */
function selfTest() {
  const bar = (t, o, h, l, c, v, provider = 'mt5', symbolId = 's1') => ({
    symbolId, provider, timestamp: t, open: o, high: h, low: l, close: c, volume: v,
  });
  let failed = 0;
  const check = (name, got, expect) => {
    const ok = got === expect;
    if (!ok) failed++;
    console.log(`[self-test] ${ok ? 'PASS' : 'FAIL'}  ${name}` + (ok ? '' : ` (expected ${expect}; got ${got})`));
  };

  // MUST fire: the real #880 shape — a Friday bar identical to the Thursday bar before it.
  check(
    'the real #880 duplicate IS found',
    classifyDailyBarDuplicates([
      bar('2026-09-10T21:00:00Z', 1.16114, 1.165, 1.158, 1.15983, 195012),
      bar('2026-09-11T21:00:00Z', 1.16114, 1.165, 1.158, 1.15983, 195012),
    ]).length,
    1,
  );
  check(
    'same close but different volume is NOT a duplicate',
    classifyDailyBarDuplicates([
      bar('2026-09-10T21:00:00Z', 1.16, 1.165, 1.158, 1.15983, 195012),
      bar('2026-09-11T21:00:00Z', 1.16, 1.165, 1.158, 1.15983, 111111),
    ]).length,
    0,
  );
  check(
    'a single bar is not a duplicate',
    classifyDailyBarDuplicates([bar('2026-09-10T21:00:00Z', 1, 2, 0.5, 1.5, 10)]).length,
    0,
  );
  check(
    'identical bars for DIFFERENT symbols are not duplicates of each other',
    classifyDailyBarDuplicates([
      bar('2026-09-10T21:00:00Z', 1, 2, 0.5, 1.5, 10, 'mt5', 's1'),
      bar('2026-09-10T21:00:00Z', 1, 2, 0.5, 1.5, 10, 'mt5', 's2'),
    ]).length,
    0,
  );
  check(
    'identical bars from DIFFERENT providers are not duplicates of each other',
    classifyDailyBarDuplicates([
      bar('2026-09-10T21:00:00Z', 1, 2, 0.5, 1.5, 10, 'mt5', 's1'),
      bar('2026-09-10T21:00:00Z', 1, 2, 0.5, 1.5, 10, 'yahoo', 's1'),
    ]).length,
    0,
  );
  check(
    'a run of three identical bars yields TWO findings',
    classifyDailyBarDuplicates([
      bar('2026-09-09T21:00:00Z', 1, 2, 0.5, 1.5, 10),
      bar('2026-09-10T21:00:00Z', 1, 2, 0.5, 1.5, 10),
      bar('2026-09-11T21:00:00Z', 1, 2, 0.5, 1.5, 10),
    ]).length,
    2,
  );
  check('no bars is not a failure', classifyDailyBarDuplicates([]).length, 0);

  // ── classifyReachability (#999, added 2026-10-08) ─────────────────────────
  // MUST fire, positive direction: the snapshot vetoes a score-window 'below'.
  check('score 8.5 vs bar 10, signal path 15.16 -> CLEARED by signal path (the real m15 shape)',
    classifyReachability(8.5, 15.16, 10), 'cleared-by-snapshot');
  check('score silent, signal path 12 vs bar 10 -> CLEARED by signal path',
    classifyReachability(null, 12, 10), 'cleared-by-snapshot');
  check('score 12 vs bar 10 -> cleared on the score alone',
    classifyReachability(12, null, 10), 'cleared');
  check('both sources at/above the bar -> cleared, score first',
    classifyReachability(12, 15, 10), 'cleared');
  // MUST fire, negative direction: both sources under the bar is STILL 'below' —
  // the snapshot can never manufacture a pass.
  check('score 8.5 AND signal path 9.9 vs bar 10 -> below (veto is not a pass)',
    classifyReachability(8.5, 9.9, 10), 'below');
  check('score 9.9 alone vs bar 10 -> below (one silent source cannot clear it)',
    classifyReachability(9.9, null, 10), 'below');
  check('signal path 3 alone vs bar 10 -> below',
    classifyReachability(null, 3, 10), 'below');
  check('neither source measured -> no-data, not a failure',
    classifyReachability(null, null, 10), 'no-data');
  check('boundary: exactly at the bar counts as cleared',
    classifyReachability(10, null, 10), 'cleared');

  console.log(`[self-test] classifiers (daily-bar duplicates + reachability): ${failed === 0 ? 'all canaries passed' : `${failed} FAILED`}.`);
  process.exit(failed === 0 ? 0 : 1);
}

(async () => {
  if (process.argv.includes('--self-test')) selfTest();

  console.log('='.repeat(72));
  console.log('  DATA HEALTH AUDIT');
  console.log('  Guards the silent-failure class: #733, #821, #801, and the 2026-09-15 outage.');
  console.log('='.repeat(72));

  try {
    await checkMustPopulate();
    await checkStaleness();
    await checkThresholdReachability();
    await checkProtocolRefs();
    await checkDailyBarDuplicates();
  } catch (e) {
    console.error('\nFATAL: ' + e.message);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log('\n' + '='.repeat(72));
  if (warnings.length) {
    console.log(`  WARNINGS (${warnings.length}) — investigate, do not assume broken:`);
    for (const w of warnings) console.log('   ⚠️  ' + w);
  }
  if (failures.length) {
    console.log(`\n  ❌ FAILURES (${failures.length}):`);
    for (const f of failures) console.log('   ✗  ' + f);
    console.log('\n  A failure here is a SILENT defect made visible. Do not allow-list a column to');
    console.log('  make this pass — that is how the last two survived for weeks.');
    console.log('='.repeat(72));
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log('  ✅ OK — every must-populate column is populated and no active bot is');
  console.log('     structurally unable to fire.');
  console.log('='.repeat(72));
  await prisma.$disconnect();
  process.exit(0);
})();
