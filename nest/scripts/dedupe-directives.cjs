#!/usr/bin/env node
/**
 * dedupe-directives.cjs — one-off cleanup for issue #641.
 *
 * Removes dead duplicate directive classes/files so that each directive `id`
 * is defined by exactly ONE class (the registered one). Enumerated by the
 * MODE 6 check in directive-guard.cjs.
 *
 * Two categories:
 *   1. Dead classes in placeholder-directives.stub.ts whose `id` is also
 *      defined by a standalone *.directive.ts that the module actually
 *      registers (the standalone copy is the live one).
 *   2. Dead standalone *.directive.ts files whose `id` is also defined by
 *      the registered copy (mt5-indicators.directives.ts, or the stub for
 *      analyst-adjustments).
 *
 * Usage:  node nest/scripts/dedupe-directives.cjs
 */

const fs = require('fs');
const path = require('path');

const IMPL = path.resolve('C:/wamp64/www/trading-command-suite/nest/src/modules/directives/implementations');
const STUB = path.join(IMPL, 'placeholder-directives.stub.ts');

// 1) Dead classes inside the stub file (registered copy lives in a standalone file).
const DEAD_STUB_CLASSES = [
  'StochasticDirective',
  'CciDirective',
  'MfiDirective',
  'AdxDirective',
  'RsiOverboughtDirective',
  'MomentumContinuationComboDirective',
  'MaCrossoverDirective',
  'BollingerBandSqueezeDirective',
  'ObvDirective',
  'VolumeSurgeDirective',
  'VolumeRhythmDirective',
  'DojiPatternDirective',
  'HammerPatternDirective',
  'EngulfingPatternDirective',
  'ThreeSoldiersPatternDirective',
  'CadUsdOilCorrelationDirective',
  'MondayEffectDirective',
  'CryptoFearGreedDirective',
  'BtcHalvingCycleDirective',
  'CryptoWeekendEffectDirective',
  'EarningsProximityDirective',
  'ConfluenceReversalComboDirective',
  'PriceActionDirective',
  'SupportResistanceLevelsDirective',
  'OverheadSupplyPressureDirective',
  'PanicExhaustionAbsorptionDirective',
  'BollingerBandsDirective',
  'VwapDirective',
];

// 2) Dead standalone files (registered copy lives in mt5-indicators.directives.ts,
//    except analyst-adjustments whose registered copy lives in the stub).
const DEAD_FILES = [
  'analyst-adjustments.directive.ts',
  'williams-r.directive.ts',
  'awesome-oscillator.directive.ts',
  'force-index.directive.ts',
  'chaikin-mf.directive.ts',
  'donchian-breakout.directive.ts',
  'keltner-channel.directive.ts',
  'supertrend.directive.ts',
  'parabolic-sar.directive.ts',
  'atr-trailing-stop.directive.ts',
  'momentum-roc.directive.ts',
  'demarker.directive.ts',
  'accumulation-dist.directive.ts',
  'ease-of-movement.directive.ts',
];

/**
 * Remove a single `@Injectable() export class <name> implements IDirective { ... }`
 * block, matching the closing brace with string/template/comment awareness.
 */
function removeClass(src, className) {
  const re = new RegExp(`@Injectable\\(\\)[\\s\\r\\n]*export class ${className}\\b[^\\{]*\\{`);
  const m = re.exec(src);
  if (!m) return { src, removed: false };

  const start = m.index;
  let i = m.index + m[0].length - 1; // index of the opening '{'
  let depth = 0;

  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];

    // line comment
    if (c === '/' && n === '/') {
      i += 2;
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // block comment
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // single/double-quoted string
    if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      i++;
      continue;
    }
    // template literal (handles ${...} interpolation with brace tracking)
    if (c === '`') {
      i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let inner = 1;
          while (i < src.length && inner > 0) {
            const ch = src[i];
            if (ch === "'" || ch === '"') {
              const q = ch;
              i++;
              while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
              i++;
              continue;
            }
            if (ch === '`') {
              i++;
              while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; i++; }
              i++;
              continue;
            }
            if (ch === '{') inner++;
            else if (ch === '}') inner--;
            i++;
          }
          continue;
        }
        i++;
      }
      i++; // past closing backtick
      continue;
    }
    // braces
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    }
    i++;
  }

  return { src: src.slice(0, start) + src.slice(i), removed: true };
}

// ── 1. Remove dead stub classes ──────────────────────────────────────────
let stubSrc = fs.readFileSync(STUB, 'utf8');
let removed = 0;
for (const cls of DEAD_STUB_CLASSES) {
  const r = removeClass(stubSrc, cls);
  if (r.removed) {
    stubSrc = r.src;
    removed++;
    console.log(`  removed stub class ${cls}`);
  } else {
    console.error(`  !! NOT FOUND in stub: ${cls}`);
  }
}
// tidy up: collapse runs of 3+ blank lines
stubSrc = stubSrc.replace(/\n{3,}/g, '\n\n');
fs.writeFileSync(STUB, stubSrc);
console.log(`Removed ${removed}/${DEAD_STUB_CLASSES.length} dead classes from placeholder-directives.stub.ts\n`);

// ── 2. Delete dead standalone files ──────────────────────────────────────
let deleted = 0;
for (const f of DEAD_FILES) {
  const p = path.join(IMPL, f);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    deleted++;
    console.log(`  deleted ${f}`);
  } else {
    console.error(`  !! MISSING file: ${f}`);
  }
}
console.log(`Deleted ${deleted}/${DEAD_FILES.length} dead standalone files.`);
