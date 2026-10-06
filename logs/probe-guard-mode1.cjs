/**
 * Scratch probe (logs/, NOT scripts/ — a file in scripts/ stales docs/TOOLS-INDEX.md).
 *
 * QUESTION: `directive-guard.cjs` runtime MODE 1 did NOT flag `atr-trailing-stop`, even though the
 * live system shows it neutral in 200 of 200 guardian evaluations. Why not?
 *
 * It feeds every directive the same two synthetic inputs and flags an identical non-zero
 * score+reason. This runs `atr-trailing-stop` against those EXACT inputs so the answer is measured
 * rather than reasoned.
 */
const path = require('path');

const DIST = 'c:/wamp64/www/trading-command-suite/nest/dist/src/modules/directives/implementations';

/** Copied verbatim from directive-guard.cjs `makeInput` (L207) — same shape, same 120 bars. */
function makeInput(daysAgo, trend) {
  const bars = [];
  for (let i = 0; i < 120; i++) {
    const t = new Date(Date.now() - daysAgo * 86400000 - (45 - i) * 3600000);
    const open = 100 + i * trend + (daysAgo === 0 ? 0 : 15);
    const close = open + trend + Math.sin(i + daysAgo);
    bars.push({
      timestamp: t,
      open,
      high: close + 1 + (daysAgo ? 3 : 0.2),
      low: open - 1 - (daysAgo ? 3 : 0.2),
      close,
      volume: 1000 + (daysAgo ? i * 500 : i * 5),
    });
  }
  return { symbol: 'GUARD', bars, dayBars: bars, hourBars: bars, min15Bars: bars };
}

const mod = require(path.join(DIST, 'mt5-indicators.directives.js'));

for (const name of ['ATRTrailingStopDirective', 'SuperTrendDirective', 'ChandelierExitDirective']) {
  const Klass = mod[name];
  if (!Klass) {
    console.log(`${name}: NOT EXPORTED`);
    continue;
  }
  const inst = new Klass();
  const A = inst.calculate(makeInput(0, 0.1));
  const B = inst.calculate(makeInput(3, -0.6));

  console.log(`\n=== ${inst.id} (${name}) ===`);
  console.log(`  inputA: score=${A.score} class=${A.signalClass}`);
  console.log(`          reason=${String(A.reason).slice(0, 110)}`);
  console.log(`  inputB: score=${B.score} class=${B.signalClass}`);
  console.log(`          reason=${String(B.reason).slice(0, 110)}`);
  const flagged = A.score !== undefined && A.score !== 0 && A.score === B.score && A.reason === B.reason;
  console.log(`  guard MODE 1 would flag: ${flagged ? 'YES' : 'NO'}`);
}

// What the pipeline actually feeds it: 30 bars from the position's own bridge (5m).
const shortish = (() => {
  const src = makeInput(0, 0.1).bars;
  return { symbol: 'GUARD', bars: src.slice(-30) };
})();
const inst = new mod.ATRTrailingStopDirective();
const C = inst.calculate(shortish);
console.log(`\n=== atr-trailing-stop with the GUARDIAN's window (30 bars) ===`);
console.log(`  score=${C.score} class=${C.signalClass}`);
console.log(`  reason=${String(C.reason).slice(0, 140)}`);
