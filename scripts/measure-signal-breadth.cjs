/**
 * measure-signal-breadth.cjs — is a protocol's score the SUM OF CO-OCCURRING EVIDENCE, or one directive?
 *
 * ── THE QUESTION THIS ANSWERS, AND WHY IT MATTERS (evidence for #1358) ────────────────────────
 * `signalPct` is `composite ÷ maxPossible` and every gate in the pipeline reads it as *strength*. The
 * numerator is the score of the directives that FIRED; the denominator is the sum of EVERY directive's
 * maximum, most of which are neutral on a given tick. So the fraction is closer to *how many directives
 * happened to switch on* than to *how strong the setup is* — a breadth counter wearing a strength label.
 *
 * Measured 2026-11-26 over 800 stored scores: **53% of readings fired exactly one directive**, median
 * `signalPct` **7.2%**. That is the explanation for a +430% mover producing a 17% win rate: the gate is
 * selecting agreement, not conviction.
 *
 * ⚠️ READ-ONLY. This script changes nothing and decides nothing. Re-scoring is a MATHS change and needs a
 * copied configuration compared against the incumbent (`maths-change-requires-ab`); measuring it first is
 * the whole point of #1358.
 *
 * ⚠️ `score.strategyId` HOLDS A **PROTOCOL SLUG**, NOT A `scoring_strategy` ID. Verified 2026-11-27: the
 * distinct values are `forex-session-v1-long`, `momentum-stock-v1`, … while `scoring_strategy.id` is a
 * UUID. Joining the two returns **no rows and no error** — the exact trap `db-schema.cjs` warns about,
 * hit while writing this script. There is no join to make; `strategyId` is the protocol.
 *
 * ⚠️ THE BREAKDOWN SHAPE IS THE CONTRACT. Per group in `breakdown.breakouts`, each directive carries
 * `maxScore` and `inSignal`. `rawMax` on the breakdown is the denominator the app uses; when it is absent
 * the sum of every `maxScore` is reported INSTEAD and the row is counted as `denominatorFromSum`, because
 * a median computed from two different denominators is not one number.
 *
 * Usage:
 *   node scripts/measure-signal-breadth.cjs                     # every protocol with data
 *   node scripts/measure-signal-breadth.cjs --protocol movers-v1-long
 *   node scripts/measure-signal-breadth.cjs --days 30 --json
 *   node scripts/measure-signal-breadth.cjs --self-test
 *
 * Exit: 0 = measured · 2 = could not judge (no database, no rows). Never 0 on an empty read.
 */
'use strict';

const { query, connect } = require('./lib/mysql-cli.cjs');

/** Minimal TSV reader for the mysql CLI's tab-separated output. */
function parseTsv(out) {
  const lines = String(out ?? '').split(/\r?\n/).filter((l) => l.length);
  if (lines.length < 2) return [];
  const header = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i];
    });
    return row;
  });
}

/** Sorted-copy quantile. `p` in [0,1]; returns null on an empty list rather than NaN. */
function quantile(values, p) {
  const s = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return null;
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))));
  return s[idx];
}

/**
 * readBreakdown(breakdownJson) — one stored score reduced to what the breadth question needs.
 *
 * PURE, so `--self-test` can drive it with fabricated breakdowns in both directions.
 * Returns null when the payload cannot be read — never zeros, because "unreadable" and "nothing fired"
 * are different facts and the second is the one this script is measuring.
 */
function readBreakdown(breakdownJson) {
  let b;
  try {
    b = typeof breakdownJson === 'string' ? JSON.parse(breakdownJson) : breakdownJson;
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object') return null;
  const groups = b.breakouts;
  if (!groups || typeof groups !== 'object') return null;

  let total = 0;
  let fired = 0;
  let firedMax = 0;
  let allMax = 0;
  for (const list of Object.values(groups)) {
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      if (!d || typeof d !== 'object') continue;
      total += 1;
      const max = Number(d.maxScore ?? 0) || 0;
      allMax += max;
      if (d.inSignal) {
        fired += 1;
        firedMax += max;
      }
    }
  }
  if (!total) return null;

  const rawMax = Number(b.rawMax);
  const denominator = Number.isFinite(rawMax) && rawMax > 0 ? rawMax : allMax;
  return {
    total,
    fired,
    allMax,
    firedMax,
    denominator,
    denominatorFromSum: !(Number.isFinite(rawMax) && rawMax > 0),
    firedShare: allMax > 0 ? firedMax / allMax : null,
  };
}

/**
 * summarise(rows) — the distribution, PURE. `rows` are `readBreakdown()` results plus `value`.
 *
 * ⚠️ The two populations are reported SEPARATELY on purpose: `pct` (score ÷ denominator) is what the
 * gate acts on, and `firedShare` (the fired directives' share of all possible) is the mechanism behind it.
 * Dividing one by the other produces a number nobody asked for.
 */
function summarise(rows) {
  const usable = rows.filter((r) => r && Number.isFinite(r.value) && r.denominator > 0);
  if (!usable.length) return { n: 0 };

  const firedCounts = {};
  for (const r of usable) firedCounts[r.fired] = (firedCounts[r.fired] ?? 0) + 1;

  const pct = usable.map((r) => (r.value / r.denominator) * 100);
  const shares = usable.filter((r) => r.firedShare != null).map((r) => r.firedShare * 100);
  const directives = usable.map((r) => r.total);

  const exactlyOne = (firedCounts[1] ?? 0) / usable.length;
  return {
    n: usable.length,
    directivesMedian: quantile(directives, 0.5),
    firedCounts,
    exactlyOne,
    pctMedian: quantile(pct, 0.5),
    pctP95: quantile(pct, 0.95),
    shareMedian: quantile(shares, 0.5),
    denominatorFromSum: usable.filter((r) => r.denominatorFromSum).length,
  };
}

function pctStr(v) {
  return v == null ? '—' : `${v.toFixed(1)}%`;
}

function selfTest() {
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  const bd = (firedFlags, maxScore = 10, rawMax) =>
    JSON.stringify({
      ...(rawMax === undefined ? {} : { rawMax }),
      breakouts: {
        trend: firedFlags.map((inSignal, i) => ({ directiveId: `d${i}`, maxScore, inSignal })),
      },
    });

  const one = readBreakdown(bd([true, false, false, false], 10, 40));
  expect('one directive firing out of four is read as fired:1', one.fired, 1);
  expect('…with every directive counted in the denominator base', one.total, 4);
  expect('…and the fired share is 1/4', one.firedShare, 0.25);
  expect('an explicit rawMax is the denominator the app uses', one.denominator, 40);
  expect('…and is NOT flagged as a fallback', one.denominatorFromSum, false);

  const noRaw = readBreakdown(bd([true, false], 7));
  expect('a missing rawMax falls back to the sum of maxScore', noRaw.denominator, 14);
  expect('▶ CANARY — the fallback is FLAGGED, so it cannot pass as the app’s own denominator', noRaw.denominatorFromSum, true);

  expect('unparseable JSON is null, never zeros', readBreakdown('{not json'), null);
  expect('a payload with no breakouts is null', readBreakdown('{"rawMax":100}'), null);
  expect('an empty breakouts object is null', readBreakdown('{"breakouts":{}}'), null);

  const s = summarise([
    { ...one, value: 10 },
    { ...one, value: 30 },
    { ...readBreakdown(bd([true, true, true, true], 10, 40)), value: 40 },
  ]);
  expect('three readings are summarised', s.n, 3);
  // 10/40 = 25%, 30/40 = 75%, 40/40 = 100% → the middle reading is 75%, not the mean of the three.
  expect('the median percentage is the MIDDLE READING', Math.round(s.pctMedian), 75);
  expect('a breadth counter is visible: 2 of 3 fired exactly one directive', Number(s.exactlyOne.toFixed(2)), 0.67);
  // ⚠️ `quantile` returns a REAL reading (lower-middle), never an average — [1,2,3,4] → 2, not 2.5.
  expect('the median of an even-length set is a real reading, not an average', quantile([1, 2, 3, 4], 0.5), 2);
  expect('an empty set yields null, not NaN', quantile([], 0.5), null);
  expect('empty input summarises to n:0', summarise([]).n, 0);

  console.log('');
  console.log(failures === 0 ? '✅ self-test: the breadth maths reads both directions, and null is not zero' : `❌ self-test: ${failures} case(s) wrong`);
  return failures === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  const KNOWN = new Set(['--protocol', '--days', '--json', '--self-test', '--help']);
  const unknown = argv.filter((a) => a.startsWith('--') && !KNOWN.has(a));
  if (unknown.length) {
    console.error(`[breadth] ✖ unknown flag(s): ${unknown.join(', ')}`);
    return 2;
  }
  if (argv.includes('--help')) {
    console.log('usage: node scripts/measure-signal-breadth.cjs [--protocol <slug>] [--days <n>] [--json] [--self-test]');
    return 0;
  }
  const arg = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i === -1 ? dflt : argv[i + 1];
  };
  const days = Math.max(1, Math.min(365, Number(arg('--days', 30)) || 30));
  const protocol = arg('--protocol', null);

  let conn;
  try {
    conn = connect();
  } catch (err) {
    console.error(`[breadth] ✖ could not judge: ${err.message}`);
    return 2;
  }

  const where = protocol ? `AND strategyId = '${String(protocol).replace(/[^A-Za-z0-9_-]/g, '')}'` : '';
  const sql =
    `SELECT strategyId AS protocol, value, breakdown FROM score ` +
    `WHERE value > 0 AND timestamp > (UTC_TIMESTAMP() - INTERVAL ${days} DAY) ${where} ` +
    `ORDER BY timestamp DESC LIMIT 20000`;

  let rows;
  try {
    rows = parseTsv(await query(sql, conn));
  } catch (err) {
    console.error(`[breadth] ✖ could not judge: ${err.message}`);
    return 2;
  }
  if (!rows.length) {
    console.error(`[breadth] ✖ no scored rows in the last ${days} day(s)${protocol ? ` for ${protocol}` : ''} — a read that finds nothing has measured nothing`);
    return 2;
  }

  const byProtocol = new Map();
  for (const r of rows) {
    const read = readBreakdown(r.breakdown);
    if (!read) continue;
    const key = r.protocol || '(unnamed)';
    if (!byProtocol.has(key)) byProtocol.set(key, []);
    byProtocol.get(key).push({ ...read, value: Number(r.value) });
  }

  const out = [...byProtocol.entries()]
    .map(([slug, list]) => ({ protocol: slug, ...summarise(list) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);

  if (argv.includes('--json')) {
    console.log(JSON.stringify({ days, protocols: out }, null, 2));
    return 0;
  }

  console.log(`\nSignal breadth — last ${days} day(s), ${rows.length} stored score(s)\n`);
  console.log('| protocol | readings | directives (med) | fired 1 | fired 2 | fired 3+ | signalPct med | p95 | fired share med |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const r of out) {
    const threeUp = Object.entries(r.firedCounts)
      .filter(([k]) => Number(k) >= 3)
      .reduce((a, [, v]) => a + v, 0);
    console.log(
      `| \`${r.protocol}\` | ${r.n} | ${r.directivesMedian ?? '—'} | ${pctStr(r.exactlyOne * 100)} | ` +
        `${pctStr(((r.firedCounts[2] ?? 0) / r.n) * 100)} | ${pctStr((threeUp / r.n) * 100)} | ` +
        `${pctStr(r.pctMedian)} | ${pctStr(r.pctP95)} | ${pctStr(r.shareMedian)} |`,
    );
  }
  const total = out.reduce((a, r) => a + r.n, 0);
  const onePct = out.reduce((a, r) => a + r.exactlyOne * r.n, 0) / total;
  console.log('');
  console.log(`⚠️ A reading is ONE stored score. "fired 1" means exactly one directive had \`inSignal\`, so`);
  console.log(`   signalPct was that directive's score over the maximum of ALL of them.`);
  console.log(`   Across ${total} readings, ${(onePct * 100).toFixed(1)}% fired exactly one directive.`);
  const fellBack = out.reduce((a, r) => a + r.denominatorFromSum, 0);
  if (fellBack) {
    console.log(`   ⚠️ ${fellBack} reading(s) had no breakdown \`rawMax\`; their percentage uses the SUM of`);
    console.log(`   maxScore instead. Those rows are not comparable with rows that carry the app's own denominator.`);
  }
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error(`[breadth] ✖ could not judge: ${err.message}`);
      process.exit(2);
    });
}

module.exports = { readBreakdown, summarise, quantile, parseTsv };
