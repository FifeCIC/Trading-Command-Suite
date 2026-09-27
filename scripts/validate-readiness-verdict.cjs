#!/usr/bin/env node
/**
 * validate-readiness-verdict.cjs — readiness must come from `tradeReadiness()`, not from
 * `preTradeReady` on its own.
 * ====================================================================================================
 * WHY THIS EXISTS (#935, 2026-09-27)
 * ----------------------------------
 * `SymbolPage` drew "✓ Trade Ready" from `preTradeReady` ALONE:
 *
 *     {primaryEnv.preTradeReady ? <span className="sym-ready">✓ Trade Ready</span> : …blockers}
 *
 * `preTradeReady` covers the PRE-TRADE GATE ONLY. The order path requires the gate AND zero
 * execution blockers AND a derivable direction (see `isRouteable()` in
 * nest/src/modules/signals/signal-envelope.service.ts). Reading one condition out of three let the
 * card claim a readiness the click path then refused — the badge said "Trade Ready" while the
 * order path held a `size-below-minimum` blocker.
 *
 * The backend half of the fix (annotating the drilldown with `executionBlockers`) is in
 * signal-envelope.service.ts. THIS is the class guard: a future page cannot re-introduce the
 * one-field claim without failing the build.
 *
 * WHAT IT CHECKS
 * --------------
 * Any non-comment line in `src/**\/*.{js,jsx,tsx}` that uses `preTradeReady` as a CONDITION —
 * immediately followed by `?`, `&&` or `||`. Reading the value as data is fine; branching on it
 * alone is the defect.
 *
 * Deliberately NARROW: only those three operators. A broad rule ("preTradeReady must appear
 * nowhere") would fire on legitimate payload plumbing and get allowlisted — and an allowlisted
 * guard is worse than none.
 *
 * `--self-test` proves both directions on fixtures, so the guard cannot become decoration unnoticed.
 */
const path = require('path');
const { loadTree, runSelfTest } = require('./lib/validator-helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** How an envelope may legitimately be branched on. Named once so the message and rule agree. */
const CANONICAL = 'tradeReadiness() (src/core/signal-utils.js)';

/**
 * Pure: map of relPath -> source text → array of error strings. Self-testable.
 *
 * ⚠️ Matches ONLY when `preTradeReady` is used as a branch condition. `envelope.preTradeReady`
 * passed as a prop, logged, or stored is not a readiness claim and must not fail here.
 */
function analyse(files) {
  const errors = [];
  for (const [rel, raw] of files) {
    if (/\.(test|spec)\.(js|jsx|tsx)$/.test(rel)) continue;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/preTradeReady/.test(line)) continue;
      if (/^\s*(\/\/|\*)/.test(line)) continue; // prose, not code
      // The defect shape: branching on the gate field alone.
      if (/preTradeReady\s*(\?|&&|\|\|)/.test(line)) {
        errors.push(
          `  ${rel}:${i + 1} asserts readiness from \`preTradeReady\` alone — that field covers the ` +
            `pre-trade gate only, while the order path also requires zero execution blockers. ` +
            `Use ${CANONICAL}, which checks both.`,
        );
      }
    }
  }
  return errors;
}

if (process.argv.includes('--self-test')) {
  runSelfTest([
    ['the #935 shape (preTradeReady as a ternary test) FAILS', () =>
      analyse(new Map([['p.jsx', "{e.preTradeReady ? <span>Trade Ready</span> : null}"]])).length === 1],
    ['preTradeReady && … FAILS', () =>
      analyse(new Map([['p.jsx', '{e.preTradeReady && <span>Ready</span>}']])).length === 1],
    ['preTradeReady || … FAILS', () =>
      analyse(new Map([['p.jsx', 'const label = e.preTradeReady || other;']])).length === 1],
    ['using tradeReadiness() passes', () =>
      analyse(new Map([['p.jsx', "{tradeReadiness(e).state === 'ready' ? <span>Ready</span> : null}"]])).length === 0],
    ['reading preTradeReady as DATA passes', () =>
      analyse(new Map([['p.jsx', '<Card preTradeReady={envelope.preTradeReady} />']])).length === 0],
    ['a comment mentioning the defect is ignored', () =>
      analyse(new Map([['p.jsx', '  // never write `preTradeReady ? "ready" : "blocked"` again']])).length === 0],
    ['a line without the field is ignored', () =>
      analyse(new Map([['p.jsx', '{readiness.state === "ready" ? <span>Ready</span> : null}']])).length === 0],
  ]);
}

const files = loadTree(SRC, /\.(js|jsx|tsx)$/, ROOT);
const errors = analyse(files);
if (errors.length > 0) {
  console.error('\n✖ READINESS ASSERTED FROM `preTradeReady` ALONE:');
  for (const e of errors) console.error(e);
  console.error(
    `\nA readiness badge must agree with the order path. Use ${CANONICAL} (#935).`,
  );
  process.exit(1);
}
console.log('[readiness-verdict] ✅ OK — readiness is not asserted from `preTradeReady` alone');
