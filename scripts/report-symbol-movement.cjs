/**
 * report-symbol-movement.cjs — HOW MUCH does each symbol actually MOVE in a short window?
 *
 * WHY THIS EXISTS (2026-11-06, owner request)
 * -------------------------------------------
 * The owner's words: *"I need to better understand each symbol's movement in terms of points within
 * a short period … it's what makes it likely I would make stop losses get triggered prematurely as I
 * would likely set them within a normal price flux rather than trade change."*
 *
 * That is a MEASUREMENT question and the data is already stored: `marketbar` holds every 1m/5m/15m/1h
 * bar the app has fetched. This turns them into the two numbers a stop and a target must be compared
 * against:
 *
 *   • RANGE per bar   — the distance price travels INSIDE one bar. A stop closer than this is inside
 *                       noise and will be hit by flux alone, without any real move against you.
 *   • MOVE per bar    — |close − previous close|. The typical step, i.e. what a target has to clear.
 *
 * Reported as median and p90 in POINTS and %, because a percentage target on a small instrument and
 * a points stop on a big one are the same number wearing different clothes.
 *
 * ⚠️ p90, NOT mean. A mean over a fat-tailed distribution is the story of the outliers; the reader
 * needs the distance that 9-in-10 bars stay under.
 *
 * Usage:
 *   node scripts/report-symbol-movement.cjs                    # 7 days, 5m/15m/1h, all MT5 symbols
 *   node scripts/report-symbol-movement.cjs --days 3 --tf 5m
 *   node scripts/report-symbol-movement.cjs --symbol GER40 --tf 1m
 *   node scripts/report-symbol-movement.cjs --self-test        # prove the statistics can be wrong
 */
'use strict';
const path = require('path');
const { PrismaClient } = require(path.join(__dirname, '..', 'nest', 'node_modules', '@prisma', 'client'));

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : process.argv[i + 1];
};
const has = (name) => process.argv.includes(`--${name}`);

/** Median of a numeric array (0 for empty — callers print '—' on n=0). */
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/** Nearest-rank p90 — no interpolation, so the number is always an observed bar. */
function p90(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

/** Turn chronological bars into { ranges, moves } in price units and %. */
function summarise(bars) {
  const ranges = []; const rangesPct = []; const moves = []; const movesPct = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.close > 0) {
      ranges.push(b.high - b.low);
      rangesPct.push(((b.high - b.low) / b.close) * 100);
    }
    if (i > 0 && bars[i - 1].close > 0) {
      const mv = Math.abs(b.close - bars[i - 1].close);
      moves.push(mv);
      movesPct.push((mv / bars[i - 1].close) * 100);
    }
  }
  return { ranges, rangesPct, moves, movesPct };
}

function selfTest() {
  let pass = 0; let fail = 0;
  const t = (name, cond) => { if (cond) { pass++; } else { fail++; console.log(`  ✖ ${name}`); } };
  t('median odd', median([3, 1, 2]) === 2);
  t('median even averages', median([1, 2, 3, 4]) === 2.5);
  t('median empty is null', median([]) === null);
  t('p90 of 10 picks 9th', p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) === 9);
  t('p90 of 1 is that value', p90([7]) === 7);
  // A flat bar has ZERO range: a stop must never be judged against it as if it were movement.
  const flat = summarise([{ high: 5, low: 5, close: 5 }, { high: 5, low: 5, close: 5 }]);
  t('flat bars give zero range', flat.ranges.every((r) => r === 0));
  t('flat bars give zero move', flat.moves.every((m) => m === 0));
  // The first bar has no predecessor, so there is exactly one fewer move than bars.
  t('moves are one fewer than bars', flat.moves.length === flat.ranges.length - 1);
  // A doubling must appear as 100% in the percentage series, not as price units.
  const gapped = summarise([{ high: 10, low: 10, close: 10 }, { high: 20, low: 20, close: 20 }]);
  t('move % is relative to the PREVIOUS close', Math.abs(gapped.movesPct[0] - 100) < 1e-9);
  console.log(`\n[self-test] ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

(async () => {
  if (has('self-test')) return selfTest();

  const days = Number(arg('days', 7));
  const tfs = String(arg('tf', '5m,15m,1h')).split(',').map((s) => s.trim()).filter(Boolean);
  const only = arg('symbol', null);
  const prisma = new PrismaClient();

  const symbols = await prisma.$queryRawUnsafe(
    `SELECT id, ticker FROM symbol WHERE active = 1 ${only ? '' : ''} ORDER BY ticker`);
  const wanted = only ? new Set([only.toUpperCase()]) : null;

  const rows = [];
  for (const sym of symbols) {
    if (wanted && !wanted.has(sym.ticker)) continue;
    for (const tf of tfs) {
      const bars = await prisma.$queryRawUnsafe(
        `SELECT timestamp, open, high, low, close FROM marketbar
         WHERE symbolId = ? AND timeframe = ? AND timestamp >= NOW() - INTERVAL ${days} DAY
         ORDER BY timestamp`,
        sym.id, tf);
      if (bars.length < 30) continue;
      const s = summarise(bars.map((b) => ({
        high: Number(b.high), low: Number(b.low), close: Number(b.close),
      })));
      const last = Number(bars[bars.length - 1].close);
      rows.push({
        symbol: sym.ticker, tf, n: bars.length, last,
        rangeMed: median(s.ranges), rangeP90: p90(s.ranges),
        rangePctMed: median(s.rangesPct), rangePctP90: p90(s.rangesPct),
        movePctMed: median(s.movesPct), movePctP90: p90(s.movesPct),
      });
    }
  }

  const f = (v, d = 2) => (v === null ? '—' : v.toFixed(d));
  console.log(`\nPer-bar movement, last ${days} day(s) — range = high−low WITHIN one bar; move = |close − prev close|\n`);
  console.log('symbol   tf    bars  last        range med    range p90     range% med  range% p90  move% med');
  console.log('---------------------------------------------------------------------------------------------');
  for (const r of rows) {
    console.log(
      `${r.symbol.padEnd(8)} ${r.tf.padEnd(5)} ${String(r.n).padStart(5)} ${f(r.last, 2).padStart(11)} ` +
      `${f(r.rangeMed, 2).padStart(12)} ${f(r.rangeP90, 2).padStart(12)} ${f(r.rangePctMed, 3).padStart(12)} ` +
      `${f(r.rangePctP90, 3).padStart(11)} ${f(r.movePctMed, 3).padStart(11)}`);
  }
  console.log(`\n⚠️ A stop INSIDE "range p90" is inside normal flux: it can be hit by a single quiet bar`);
  console.log(`   with no move against you. A target must clear "move% med" to be reachable at all.`);
  await prisma.$disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });
