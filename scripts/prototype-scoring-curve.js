/**
 * Prototype: Scoring Curve Formula
 * =================================
 * Score = Weight × (1 − value/scaleMax)^steepness   ← LONG/BULLISH
 * Score = Weight × (value/scaleMax)^steepness        ← SHORT/BEARISH
 *
 * Variables the user adjusts:
 *   weight     — max score (e.g. 140)
 *   scaleMax   — indicator ceiling (RSI=80, VI=1.5, CCI=100)
 *   steepness  — curve shape (1.0=linear, 2.0=quadratic, 3.0=exponential)
 *   direction  — auto-derived from directionBias
 *
 * Run: node scripts/prototype-scoring-curve.js
 */

// ── The curve function ──────────────────────────────────────
function curveScore(value, scaleMax, weight, steepness, direction) {
  const t = Math.max(0, Math.min(1, value / scaleMax));
  const multiplier = direction === 'bullish' ? Math.pow(1 - t, steepness) : Math.pow(t, steepness);
  return Math.round(weight * multiplier);
}

// ── User's bracket table for RSI (bullish/long) ─────────────
const userBrackets = [
  [0, 10, 140], [11, 20, 100], [21, 30, 90],
  [31, 40, 70], [41, 50, 50], [51, 60, 30],
  [61, 70, 10], [71, 74, 5], [75, 80, 1],
];

// ── Compare: curve vs user brackets ─────────────────────────
const WEIGHT = 140;
const SCALE_MAX = 80;
const DIRECTIONS = ['bullish', 'bearish'];
const STEEPNESS_VALUES = [1.0, 1.5, 2.0, 2.5, 3.0];

console.log(`\nWeight=${WEIGHT}  ScaleMax=${SCALE_MAX}  (RSI example)\n`);
console.log('─── BULLISH (scores high when RSI is LOW) ───');
console.log('RSI    bracket   s=1.0    s=1.5    s=2.0    s=2.5    s=3.0');
console.log('───    ───────   ────     ────     ────     ────     ────');

for (let rsi = 0; rsi <= 80; rsi += 5) {
  const bracket = userBrackets.find(([lo, hi]) => rsi >= lo && rsi <= hi)?.[2] ?? '—';
  const scores = STEEPNESS_VALUES.map(s => curveScore(rsi, SCALE_MAX, WEIGHT, s, 'bullish'));
  process.stdout.write(`${String(rsi).padEnd(6)}  ${String(bracket).padEnd(8)} `);
  scores.forEach(sc => process.stdout.write(`${String(sc).padEnd(8)} `));
  console.log();
}

console.log('\n─── BEARISH (scores high when RSI is HIGH) ───');
console.log('RSI    s=1.0    s=1.5    s=2.0    s=2.5    s=3.0');
console.log('───    ────     ────     ────     ────     ────');

for (let rsi = 0; rsi <= 80; rsi += 5) {
  const scores = STEEPNESS_VALUES.map(s => curveScore(rsi, SCALE_MAX, WEIGHT, s, 'bearish'));
  process.stdout.write(`${String(rsi).padEnd(6)} `);
  scores.forEach(sc => process.stdout.write(`${String(sc).padEnd(8)} `));
  console.log();
}

// ── Micro-change demonstration ──────────────────────────────
console.log('\n─── Micro-changes at RSI 70→71→72 (bullish, s=2.0) ───');
for (let rsi = 70; rsi <= 72; rsi += 0.1) {
  const sc = curveScore(rsi, SCALE_MAX, WEIGHT, 2.0, 'bullish');
  console.log(`  RSI ${rsi.toFixed(1)} → score ${sc}`);
}

// ── Volatility Index example ────────────────────────────────
console.log('\n─── Volatility Index (scale=0.5→1.5, weight=100, bearish, s=2.0) ───');
const VI_WEIGHT = 100;
const VI_SCALE = 1.5;
for (let vi = 0.5; vi <= 1.5; vi += 0.001) {
  if (Math.round(vi * 1000) % 100 === 0) { // every 0.1 step
    const sc = curveScore(vi, VI_SCALE, VI_WEIGHT, 2.0, 'bearish');
    console.log(`  VI ${vi.toFixed(1)} → score ${sc}`);
  }
}

// ── Best-fit steepness ──────────────────────────────────────
console.log('\n─── Best-fit analysis (minimizing squared error vs user brackets) ───');
for (const s of [1.0, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.5, 3.0]) {
  let error = 0;
  for (const [lo, hi, target] of userBrackets) {
    const mid = (lo + hi) / 2;
    const predicted = curveScore(mid, SCALE_MAX, WEIGHT, s, 'bullish');
    error += Math.pow(predicted - target, 2);
  }
  console.log(`  s=${s.toFixed(1)}  error=${Math.round(error).toLocaleString()}`);
}
