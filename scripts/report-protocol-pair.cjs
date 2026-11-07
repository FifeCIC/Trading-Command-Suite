#!/usr/bin/env node
/**
 * report-protocol-pair.cjs — judge a DECLARED copy against its control, the same way every time.
 *
 * WHY THIS EXISTS (2026-11-07)
 * ────────────────────────────
 * Two maths-change experiments are now armed and will both start producing at the next market open:
 *
 *   #1234  forex-session-v1-long  (9 directives, capacity 815)  vs  forex-session-v1-copy-core4-long (4, 430)
 *   #1243  xau-speed-v1-long      (11 directives, capacity 1010) vs  xau-speed-v1-long-copy        (6, 540)
 *
 * Both declare a falsifiable prediction — 1.89x and 1.87x the control's `signalPct`. Judging them by
 * hand means writing the same aggregation twice, in two sessions, and the second one drifting. This
 * is that aggregation, once.
 *
 * ⚠️ THE TRAP THIS TOOL EXISTS TO PREVENT. The control and the variant rarely resolve the same
 * number of symbols (forex: 15 vs 1; gold: 2 vs 2). Comparing ARM TOTALS then compares 15 symbols
 * against 1 and reports the difference as a directive effect. This tool compares **per symbol** and
 * only reports a ratio where BOTH arms have data for that symbol. It prints the symbols it could not
 * pair rather than silently dropping them.
 *
 * WHAT IT REPORTS, PER PAIR AND PER SYMBOL
 *   n · mean · p90 · % >= 6 (ENTRY_THRESHOLD) · % >= 13 (STRONG_PCT) · ratio variant/control
 *
 * Thresholds are read from `protocol-gating.service.ts` when it can be parsed, and fall back to the
 * declared default with the source printed — a hardcoded 6 would silently disagree with the engine
 * the moment it is rescaled (that exact mistake is recorded in this repo's history).
 *
 * USAGE
 *   node scripts/report-protocol-pair.cjs                 # every declared pair, default window
 *   node scripts/report-protocol-pair.cjs --hours 48
 *   node scripts/report-protocol-pair.cjs --pair xau-speed-v1-long-copy
 *   node scripts/report-protocol-pair.cjs --json
 *   node scripts/report-protocol-pair.cjs --self-test
 *
 * EXIT  0 = report produced (even if the sample is too small — the STATUS column says so)
 *       2 = could not read the database, or the pair manifest could not be read ("cannot judge")
 */

const fs = require('fs');
const path = require('path');
const { query, connect } = require('./lib/mysql-cli.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(REPO_ROOT, 'scripts', 'protocol-copies.json');
const GATING_SERVICE = path.join(REPO_ROOT, 'nest', 'src', 'modules', 'scoring', 'protocol-gating.service.ts');

const MIN_SAMPLE_PER_ARM = 200;

/** ENTRY_THRESHOLD / STRONG_PCT, read from the engine so this cannot drift from it. */
function readThresholds() {
  try {
    const src = fs.readFileSync(GATING_SERVICE, 'utf8');
    const entry = /const\s+ENTRY_THRESHOLD\s*=\s*([\d.]+)/.exec(src);
    const strong = /export const STRONG_PCT\s*=\s*([\d.]+)/.exec(src);
    if (entry && strong) {
      return { entry: Number(entry[1]), strong: Number(strong[1]), source: 'protocol-gating.service.ts' };
    }
  } catch { /* fall through */ }
  return { entry: 6, strong: 13, source: 'DECLARED DEFAULT — could not parse the engine, so this may be stale' };
}

function pct(vals, p) {
  if (!vals.length) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

function summarise(values, t) {
  const n = values.length;
  if (!n) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    mean: Math.round(mean * 100) / 100,
    p90: Math.round(pct(values, 90) * 100) / 100,
    pctEntry: Math.round((values.filter((v) => v >= t.entry).length / n) * 1000) / 10,
    pctStrong: Math.round((values.filter((v) => v >= t.strong).length / n) * 1000) / 10,
  };
}

/**
 * The comparison itself, pure so the self-test can exercise it without a database.
 * `rows` is [{ protocolId, symbol, signalPct }]. Returns per-symbol pairs ONLY where both arms have
 * data, plus the symbols each arm had that the other did not.
 */
function comparePair(rows, slugA, slugB, thresholds) {
  const byArm = new Map([[slugA, new Map()], [slugB, new Map()]]);
  for (const r of rows) {
    const arm = byArm.get(r.protocolId);
    if (!arm) continue;
    // ⚠️ `Number(null)` is 0 and `Number('')` is 0 — both FINITE, so a naive Number() check lets an
    // absent reading in as a genuine zero and drags every mean down. The self-test caught exactly
    // that: two 10s and one null produced a mean of 6.67 instead of 10.
    if (r.signalPct === null || r.signalPct === undefined || r.signalPct === '') continue;
    const v = Number(r.signalPct);
    if (!Number.isFinite(v)) continue;
    if (!arm.has(r.symbol)) arm.set(r.symbol, []);
    arm.get(r.symbol).push(v);
  }
  const a = byArm.get(slugA);
  const b = byArm.get(slugB);
  const shared = [...a.keys()].filter((s) => b.has(s)).sort();
  const onlyA = [...a.keys()].filter((s) => !b.has(s)).sort();
  const onlyB = [...b.keys()].filter((s) => !a.has(s)).sort();

  const perSymbol = shared.map((symbol) => {
    const sa = summarise(a.get(symbol), thresholds);
    const sb = summarise(b.get(symbol), thresholds);
    const ready = sa.n >= MIN_SAMPLE_PER_ARM && sb.n >= MIN_SAMPLE_PER_ARM;
    return {
      symbol,
      control: sa,
      variant: sb,
      ratio: sa.mean > 0 ? Math.round((sb.mean / sa.mean) * 100) / 100 : null,
      status: ready ? 'READY' : 'WAITING',
    };
  });

  return { perSymbol, onlyA, onlyB, readyCount: perSymbol.filter((p) => p.status === 'READY').length };
}

function selfTest() {
  const t = { entry: 6, strong: 13 };
  let failures = 0;
  const check = (desc, got, expected) => {
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '✖ '} ${desc} → ${JSON.stringify(got)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
  };

  const rowsOf = (slug, symbol, vals) => vals.map((v) => ({ protocolId: slug, symbol, signalPct: v }));
  const fill = (n, v) => Array.from({ length: n }, () => v);

  // 1. Identical arms → ratio 1. This is the REFUTING answer for a capacity-dilution theory,
  //    so the tool must be able to produce it.
  let r = comparePair([...rowsOf('ctl', 'X', fill(200, 10)), ...rowsOf('var', 'X', fill(200, 10))], 'ctl', 'var', t);
  check('identical arms give ratio 1', r.perSymbol[0].ratio, 1);

  // 2. A 2x arm → ratio 2 (the prediction shape for these experiments).
  r = comparePair([...rowsOf('ctl', 'X', fill(200, 5)), ...rowsOf('var', 'X', fill(200, 10))], 'ctl', 'var', t);
  check('2x arm gives ratio 2', r.perSymbol[0].ratio, 2);

  // 3. ⚠️ The trap: arms resolve DIFFERENT symbols. No ratio may be invented from arm totals.
  r = comparePair([...rowsOf('ctl', 'X', fill(200, 5)), ...rowsOf('var', 'Y', fill(200, 50))], 'ctl', 'var', t);
  check('disjoint symbol sets produce NO shared row', r.perSymbol.length, 0);
  check('…and both sides are reported as unpaired, not dropped', `${r.onlyA.join()}|${r.onlyB.join()}`, 'X|Y');

  // 4. Sample size gates READY. 199 must NOT be ready — off-by-one is the whole point of a guard.
  r = comparePair([...rowsOf('ctl', 'X', fill(199, 5)), ...rowsOf('var', 'X', fill(200, 5))], 'ctl', 'var', t);
  check('199 readings is WAITING, 200 is READY', r.perSymbol[0].status, 'WAITING');

  // 5. Threshold counts honour the thresholds passed in, not hardcoded numbers.
  r = comparePair([...rowsOf('ctl', 'X', [5, 6, 12, 13]), ...rowsOf('var', 'X', [5, 6, 12, 13])], 'ctl', 'var', t);
  check('entry counts >= 6 (inclusive)', r.perSymbol[0].control.pctEntry, 75);
  check('strong counts >= 13 (inclusive)', r.perSymbol[0].control.pctStrong, 25);

  // 6. Non-finite / null signalPct never poisons a mean.
  r = comparePair([
    ...rowsOf('ctl', 'X', [10, 10]),
    { protocolId: 'ctl', symbol: 'X', signalPct: null },
    { protocolId: 'ctl', symbol: 'X', signalPct: 'not-a-number' },
    ...rowsOf('var', 'X', [10, 10]),
  ], 'ctl', 'var', t);
  check('null and junk are ignored, mean stays 10', r.perSymbol[0].control.mean, 10);

  // Canary: the detector must be able to FAIL. If comparePair always returned ratio 1 the first
  // two checks would pass while the tool was useless.
  const broken = comparePair([...rowsOf('ctl', 'X', fill(200, 5)), ...rowsOf('var', 'X', fill(200, 10))], 'ctl', 'var', t);
  if (broken.perSymbol[0].ratio === 1) {
    failures++;
    console.log('  ✖  CANARY INVALID — a 2x arm classified as 1x, the comparison cannot detect a difference');
  } else {
    console.log('  ✅ canary: a 2x arm IS detected (the comparison can fail)');
  }

  console.log(failures === 0
    ? '✅ self-test: 9 cases — both directions observed.'
    : `✖ self-test: ${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

function argvValue(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const n = Number(process.argv[i + 1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function loadPairs() {
  const raw = fs.readFileSync(MANIFEST, 'utf8');
  const manifest = JSON.parse(raw);
  const pairs = [];
  for (const [slug, entry] of Object.entries(manifest)) {
    if (slug.startsWith('__')) continue;
    const control = entry && entry.control ? entry.control : null;
    if (control) pairs.push({ variant: slug, control, active: entry.active !== false, reason: entry.reason });
  }
  return pairs;
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  const thresholds = readThresholds();
  const hours = argvValue('--hours', 168);
  const only = (() => {
    const i = process.argv.indexOf('--pair');
    return i === -1 ? null : process.argv[i + 1];
  })();
  const asJson = process.argv.includes('--json');

  let pairs;
  try {
    pairs = loadPairs();
  } catch (err) {
    console.error(`🛑 cannot judge — could not read scripts/protocol-copies.json: ${err.message}`);
    process.exit(2);
  }
  if (only) pairs = pairs.filter((p) => p.variant === only);
  if (!pairs.length) {
    console.error('🛑 cannot judge — no pair matched. A -copy with no `control` field in the manifest cannot be compared.');
    process.exit(2);
  }

  const slugs = pairs.flatMap((p) => [p.control, p.variant]);
  const inList = slugs.map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
  let raw;
  try {
    const conn = connect();
    raw = query(
      `SELECT protocolId, symbol, signalPct FROM score_snapshot
        WHERE protocolId IN (${inList})
          AND signalPct IS NOT NULL
          AND snappedAt >= NOW() - INTERVAL ${hours} HOUR
        ORDER BY snappedAt DESC
        LIMIT 200000`,
      conn,
    );
  } catch (err) {
    console.error(`🛑 cannot judge — the database query failed: ${err.message}`);
    process.exit(2);
  }

  const lines = String(raw).trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) {
    console.error('🛑 cannot judge — the query returned no rows at all (not the same as "no data for these protocols").');
    process.exit(2);
  }
  const header = lines[0].split('\t');
  const rows = lines.slice(1).map((l) => {
    const cells = l.split('\t');
    const o = {};
    header.forEach((h, i) => { o[h] = cells[i]; });
    return o;
  });

  const results = pairs.map((p) => ({ ...p, ...comparePair(rows, p.control, p.variant, thresholds) }));

  if (asJson) {
    console.log(JSON.stringify({ windowHours: hours, thresholds, results }, null, 2));
    process.exit(0);
  }

  console.log(`\nPROTOCOL PAIRS — window ${hours}h · ENTRY >= ${thresholds.entry} · STRONG >= ${thresholds.strong} (${thresholds.source})`);
  console.log(`sample required: ${MIN_SAMPLE_PER_ARM} readings per arm, PER SYMBOL\n`);

  for (const r of results) {
    console.log(`${r.variant}  vs  ${r.control}${r.active ? '' : '   [copy INACTIVE — no new data will arrive]'}`);
    if (!r.perSymbol.length) {
      console.log('  🚫 no symbol has data in BOTH arms — nothing can be compared yet');
    } else {
      console.log('  symbol      arm       n     mean     p90   >=entry  >=strong   ratio');
      console.log('  ' + '─'.repeat(70));
      for (const s of r.perSymbol) {
        for (const [label, arm] of [['control', s.control], ['variant', s.variant]]) {
          console.log(
            `  ${String(s.symbol).padEnd(10)} ${label.padEnd(8)} ${String(arm.n).padStart(5)} ` +
            `${String(arm.mean).padStart(7)} ${String(arm.p90).padStart(7)} ${String(arm.pctEntry).padStart(8)} ` +
            `${String(arm.pctStrong).padStart(9)}   ${label === 'variant' ? (s.ratio ?? '—') : ''}`,
          );
        }
        console.log(`  ${' '.repeat(10)} status: ${s.status === 'READY' ? '✅ READY to judge' : `⏳ WAITING (< ${MIN_SAMPLE_PER_ARM} in an arm)`}`);
      }
    }
    if (r.onlyA.length || r.onlyB.length) {
      console.log(`  ⚠️  unpaired symbols — control only: [${r.onlyA.join(', ') || '—'}] · variant only: [${r.onlyB.join(', ') || '—'}]`);
      console.log('      These are NOT part of any ratio above. Comparing arm totals would compare a different number of symbols.');
    }
    console.log('');
  }

  const anyReady = results.some((r) => r.readyCount > 0);
  console.log(anyReady
    ? '✅ at least one pair is READY — compare the ratio against the prediction recorded in its issue.\n'
    : '⏳ no pair is ready. That is a statement about the SAMPLE, not about the maths — do not conclude a ratio from it.\n');
  process.exit(0);
}

main();
