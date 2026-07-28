#!/usr/bin/env node
/**
 * add-minbars.js — Batch-adds minBars declarations to all directive
 * implementation files based on their existing bar requirement constants.
 *
 * Usage: node scripts/add-minbars.js
 *
 * Reads each .directive.ts file in nest/src/modules/directives/implementations/,
 * detects existing MIN_BARS or inline bar checks, and adds a readonly minBars
 * property to the class if one doesn't already exist.
 */

const fs = require('fs');
const path = require('path');

const IMPL_DIR = path.resolve(__dirname, '..', 'nest/src/modules/directives/implementations');

// Known bar requirement map extracted from the audit
const KNOWN_BARS = {
  'accumulation-dist': 22,
  'accumulation-distribution': 14,
  'adx': 19,
  'atr-dip': 34,
  'atr-trailing-stop': 18,
  'awesome-oscillator': 36,
  'bears-power': 16,
  'bollinger-bands': 22,
  'bollinger-percent-b': 22,
  'bollinger-band-squeeze': 72,
  'budget-gate': 20,
  'bulls-power': 16,
  'candle-pressure': 10,
  'cci': 23,
  'chaikin-mf': 24,
  'chaikin-money-flow': 22,
  'chandelier-exit': 26,
  'confluence-reversal-combo': 38,
  'demarker': 16,
  'dilution-impact': 1,
  'doji-pattern': 6,
  'donchian-breakout': 22,
  'donchian-channel': 22,
  'earnings-momentum': 1,
  'earnings-proximity': 1,
  'ease-of-movement': 16,
  'ema-structure': 51,
  'engulfing-pattern': 5,
  'fair-value-gap': 7,
  'falling-risk-pyramid': 30,
  'fibonacci-levels': 12,
  'force-index': 16,
  'gap-scanner': 2,
  'hammer-pattern': 6,
  'hurst-memory': 50,
  'insider-activity': 1,
  'institutional-footprint': 17,
  'keltner-channel': 24,
  'liquidity-check': 20,
  'liquidity-sweep': 15,
  'ma-crossover': 35,
  'macd-crossover': 36,
  'macd-divergence': 52,
  'market-entropy': 30,
  'market-memory-zones': 30,
  'market-regime': 20,
  'market-structure-bos': 30,
  'mfi': 17,
  'micro-sr-levels': 5,
  'momentum-continuation-combo': 40,
  'momentum-exhaustion': 19,
  'mt5-dark-cloud-piercing': 41,
  'mt5-engulfing': 14,
  'mt5-engulfing-cci': 41,
  'mt5-hammer': 14,
  'mt5-harami': 14,
  'mt5-star-doji': 14,
  'mtf-confluence-conservative': 200,
  'mtf-confluence-weighted': 200,
  'multi-timeframe-trend': 20,
  'obv': 12,
  'obv-divergence': 20,
  'overhead-supply-pressure': 56,
  'panic-exhaustion-absorption': 19,
  'parabolic-sar': 12,
  'pattern-density-sr': 40,
  'position-size-confidence': 5,
  'price-above-sma': 52,
  'price-action': 200,
  'price-time-gap': 32,
  'range-contraction': 30,
  'regime-shift-exit': 40,
  'rsi-divergence': 31,
  'rsi-overbought': 16,
  'rsi-oversold': 16,
  'session-open-effect': 30,
  'session-timing-filter': 1,
  'sigma-score': 20,
  'social-buzz': 1,
  'speed-momentum': 10,
  'stochastic': 19,
  'supertrend': 14,
  'support-resistance-levels': 35,
  'target-achieved': 24,
  'three-soldiers-pattern': 6,
  'time-stop': 5,
  'turnaround-tuesday': 2,
  'volatility-envelope': 20,
  'volume-boundary': 20,
  'volume-confirmation': 21,
  'volume-rhythm': 10,
  'volume-surge': 22,
  // Calendar / seasonal — need 1 bar for timestamp
  'analyst-adjustments': 1,
  'election-cycle': 1,
  'friday-drift': 5,
  'fx-timing': 1,
  'january-effect': 1,
  'monday-effect': 2,
  'october-relief': 1,
  'santa-claus-rally': 1,
  'sell-in-may': 1,
  'september-slump': 1,
  'triple-witching': 1,
  // Macro / external data — need minimal bars
  'btc-halving-cycle': 365,
  'cad-usd-oil-correlation': 20,
  'crypto-fear-greed': 1,
  'crypto-weekend-effect': 2,
  'dxy-regime': 20,
  'gold-macro-correlation': 20,
  'news-sentiment-positive': 1,
  'opex-gamma': 20,
  'position-size-kelly': 20,
  'rollover-risk': 20,
  'vix-regime': 20,
  // Momentum / trend
  'momentum-roc': 16,
  'williams-percent-r': 16,
  'williams-r': 16,
  // VWAP / structural
  'vwap-confluence-simple': 5,
  'vwap': 5,
  'wick-filter': 10,
  'zigzag-swing-detector': 5,
};

function extractDirectiveId(content) {
  const m = content.match(/readonly\s+id\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function hasMinBars(content) {
  return /minBars/.test(content);
}

function addMinBars(content, directiveId, barCount) {
  if (hasMinBars(content)) {
    return { content, changed: false, reason: 'already has minBars' };
  }

  // Determine timeframe — most directives use daily bars from input.bars
  // Multi-timeframe directives are handled specially
  let minBarsLine;
  if (['mtf-confluence-conservative', 'mtf-confluence-weighted'].includes(directiveId)) {
    minBarsLine = `  readonly minBars = { '1d': ${barCount}, '1h': 50, '15m': 30 };`;
  } else if (directiveId === 'micro-sr-levels') {
    minBarsLine = `  readonly minBars = { '1d': 2, '1h': 10, '15m': 10, '5m': 5 };`;
  } else if (directiveId === 'multi-timeframe-trend') {
    minBarsLine = `  readonly minBars = { '1d': 20, '1h': 20, '15m': 20 };`;
  } else if (directiveId === 'gap-scanner') {
    minBarsLine = `  readonly minBars = { '1d': ${barCount} };`;
  } else {
    // Default: daily bars
    minBarsLine = `  readonly minBars = { '1d': ${barCount} };`;
  }

  // Insert after maxScore or version line, or after id
  const insertTargets = [
    /readonly\s+maxScore\s*=\s*\d+;/,
    /readonly\s+version\s*=\s*['"][^'"]+['"];/,
    /readonly\s+id\s*=\s*['"][^'"]+['"];/,
  ];

  for (const target of insertTargets) {
    const match = content.match(target);
    if (match) {
      const idx = match.index + match[0].length;
      const newContent = content.slice(0, idx) + '\n' + minBarsLine + content.slice(idx);
      return { content: newContent, changed: true, reason: `inserted after ${match[0]}` };
    }
  }

  return { content, changed: false, reason: 'no insertion point found' };
}

// Main
const files = fs.readdirSync(IMPL_DIR).filter(f => f.endsWith('.directive.ts') && !f.includes('.spec.'));
let updated = 0;
let skipped = 0;
const notFound = [];

for (const file of files) {
  const filePath = path.join(IMPL_DIR, file);
  let content = fs.readFileSync(filePath, 'utf8');
  const id = extractDirectiveId(content);

  if (!id) {
    console.log(`SKIP ${file}: could not extract directive id`);
    skipped++;
    continue;
  }

  const barCount = KNOWN_BARS[id];
  if (barCount === undefined) {
    notFound.push(id);
    skipped++;
    continue;
  }

  const result = addMinBars(content, id, barCount);
  if (result.changed) {
    fs.writeFileSync(filePath, result.content, 'utf8');
    console.log(`✓ ${id}: minBars = ${barCount} bars (${file})`);
    updated++;
  } else {
    console.log(`- ${id}: ${result.reason} (${file})`);
    skipped++;
  }
}

console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
if (notFound.length) {
  console.log(`\n⚠ ${notFound.length} directives not in KNOWN_BARS map:`);
  notFound.forEach(id => console.log(`  - ${id}`));
}
