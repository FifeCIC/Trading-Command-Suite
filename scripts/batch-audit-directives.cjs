/**
 * Batch Directive Auditor — applies category, minScore, directionBias.
 * Run: node scripts/batch-audit-directives.cjs
 */
const fs = require('fs');
const path = require('path');
const DIR = 'nest/src/modules/directives/implementations';

const AUDIT = [
  ['candle-pressure.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['cci.directive.ts', 100, 100, 'oscillator', 'bearish', '2.0.0', '2.0.1'],
  ['chaikin-money-flow.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['confluence-reversal.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['crypto-weekend-effect.directive.ts', 50, 50, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['gap-scanner.directive.ts', 100, 90, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['gold-macro-correlation.directive.ts', 135, 135, 'structural', 'neutral', '2.0.0', '2.0.1'],
  ['gold-round-numbers.directive.ts', 100, 90, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['gold-session-profile.directive.ts', 100, 95, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['hammer-pattern.directive.ts', 100, 90, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['hurst-memory.directive.ts', 100, 95, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['insider-activity.directive.ts', 85, 85, 'structural', 'neutral', '1.2.0', '1.2.1'],
  ['institutional-footprint.directive.ts', 100, 85, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['liquidity-check.directive.ts', 80, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['liquidity-sweep.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['ma-crossover.directive.ts', 100, 90, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['macd-divergence.directive.ts', 115, 105, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['market-entropy.directive.ts', 100, 90, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['market-memory-zones.directive.ts', 100, 85, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['market-regime.directive.ts', 100, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['market-structure-bos.directive.ts', 100, 75, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['micro-sr-levels.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['monday-effect.directive.ts', 10, 8, 'pattern', 'bearish', '1.0.0', '1.1.0'],
  ['mt5-dark-cloud-piercing.directive.ts', 100, 100, 'pattern', 'bearish', '1.0.0', '1.1.0'],
  ['mt5-engulfing-cci.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['mt5-engulfing.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['mt5-hammer.directive.ts', 100, 100, 'pattern', 'bullish', '1.0.0', '1.1.0'],
  ['mt5-harami.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['mt5-star-doji.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['mtf-confluence.directive.ts', 115, 115, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['multi-timeframe-trend.directive.ts', 120, 120, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['obv-divergence.directive.ts', 120, 120, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['obv.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['pattern-density-sr.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['position-size-confidence.directive.ts', 100, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['position-size-kelly.directive.ts', 100, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['price-above-sma.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['price-time-gap.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['range-contraction.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['rollover-risk.directive.ts', 100, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['rsi-divergence.directive.ts', 110, 110, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['rsi-oversold.directive.ts', 130, 140, 'oscillator', 'bullish', '2.0.0', '2.0.1'],
  ['session-open-effect.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
  ['session-timing-filter.directive.ts', 100, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['sigma-score.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['social-buzz.directive.ts', 100, 100, 'structural', 'neutral', '1.0.0', '1.1.0'],
  ['speed-momentum.directive.ts', 120, 120, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['three-soldiers-pattern.directive.ts', 100, 100, 'pattern', 'bullish', '1.0.0', '1.1.0'],
  ['volatility-envelope.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['volume-boundary.directive.ts', 100, 100, 'ratio', 'neutral', '1.0.0', '1.1.0'],
  ['volume-confirmation.directive.ts', 100, 100, 'ratio', 'neutral', '1.0.0', '1.1.0'],
  ['vwap-confluence.directive.ts', 100, 100, 'oscillator', 'neutral', '1.0.0', '1.1.0'],
  ['zigzag-swing-detector.directive.ts', 100, 100, 'pattern', 'neutral', '1.0.0', '1.1.0'],
];

function patchFile(filename, oldMax, newMax, category, bias, oldVer, newVer) {
  const fp = path.join(DIR, filename);
  let c = fs.readFileSync(fp, 'utf8');
  let ch = 0;
  if (oldMax !== newMax && c.includes(`readonly maxScore = ${oldMax};`)) {
    c = c.replace(`readonly maxScore = ${oldMax};`, `readonly maxScore = ${newMax};`); ch++;
  }
  if (c.includes(`readonly version = '${oldVer}';`)) {
    c = c.replace(`readonly version = '${oldVer}';`, `readonly version = '${newVer}';`); ch++;
  }
  if (!c.includes('readonly category')) {
    c = c.replace(/(readonly name = '[^']+';)/, `$1\n  readonly category = '${category}' as const;`); ch++;
  }
  if (!c.includes('readonly minScore')) {
    c = c.replace(/readonly maxScore = \d+;/, `$&\n  readonly minScore = 1;`); ch++;
  }
  if (!c.includes('readonly directionBias')) {
    c = c.replace(/(readonly readiness = '[^']+' as const;)/, `$1\n  readonly directionBias = '${bias}' as const;`); ch++;
  }
  if (ch > 0) { fs.writeFileSync(fp, c); console.log(`  ✅ ${filename}`); }
  else console.log(`  ⚠️ ${filename}: already done`);
}

console.log(`\n🔧 ${AUDIT.length} directives...\n`);
for (const a of AUDIT) { try { patchFile(...a); } catch(e) { console.log(`  ❌ ${a[0]}: ${e.message}`); } }
console.log(`\n✅ Done.`);
