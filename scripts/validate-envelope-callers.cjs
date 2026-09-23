#!/usr/bin/env node
/**
 * validate-envelope-callers.cjs — every `/api/signals/envelope/:symbol` caller must pass a protocol.
 * ====================================================================================================
 * WHY THIS EXISTS (#925, 2026-09-23)
 * ----------------------------------
 * The endpoint REFUSES to run unscoped — `400 TCS-SYS-002, "Scoring requires a protocol —
 * unscoped default scoring was removed"`. Three pages (SymbolPage, AutomationDashboardPage,
 * ScoringActivityLogsPage) called it with no query string and rendered the refusal as
 * "no data" for an unknown period, because the failure and an empty result looked the same.
 *
 * The pages are fixed (via `useSymbolEnvelope`, which resolves the protocol first). This guard is
 * the CLASS fix the issue asks for: a new caller cannot ship without a protocol.
 *
 * WHAT IT CHECKS
 * --------------
 * Any line in `src/**\/*.{js,jsx}` that builds a `…/signals/envelope/${…}` URL must also name
 * `protocol` ON THE SAME LINE — either `?protocol=${…}` or a variable like `protocolId`.
 * The protocol-first hook is not special-cased; it passes because it genuinely resolves one.
 *
 * `--self-test` proves both directions on fixtures (unscoped fails; scoped passes; a non-envelope
 * line is ignored), so the guard cannot become decoration unnoticed.
 */
const fs = require('fs');
const path = require('path');
// Shared walk/load/self-test blocks — extracted 2026-09-23 (the duplication validator failed on
// three blocks this guard shared with nest/scripts/validate-manual-trade-gate.cjs).
const { loadTree, runSelfTest } = require('./lib/validator-helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/** Pure: map of relPath -> source text → array of error strings. Self-testable. */
function analyse(files) {
  const errors = [];
  for (const [rel, raw] of files) {
    if (/\.(test|spec)\.(js|jsx)$/.test(rel)) continue;
    const lines = raw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/signals\/envelope\/\$\{/.test(line)) continue;
      if (/^\s*(\/\/|\*)/.test(line)) continue; // prose, not a call
      if (!/protocol/i.test(line)) {
        errors.push(
          `  ${rel}:${i + 1} calls /api/signals/envelope/ without a protocol — ` +
            'the endpoint refuses unscoped (400 TCS-SYS-002); resolve one first (see ' +
            'src/core/hooks/useSymbolEnvelope.js)',
        );
      }
    }
  }
  return errors;
}

if (process.argv.includes('--self-test')) {
  runSelfTest([
    ['an unscoped envelope call FAILS', () =>
      analyse(new Map([['p.jsx', 'apiGet(`/api/signals/envelope/${symbol}`)']])).length === 1],
    ['a protocol-scoped call passes', () =>
      analyse(new Map([['p.jsx', 'apiGet(`/api/signals/envelope/${symbol}?protocol=${protocolId}`)']])).length === 0],
    ['a comment mentioning the endpoint is ignored', () =>
      analyse(new Map([['p.jsx', '  // see /api/signals/envelope/${symbol} for details']])).length === 0],
    ['an unrelated URL is ignored', () =>
      analyse(new Map([['p.jsx', 'apiGet(`/api/signals/best`)']])).length === 0],
  ]);
}

const files = loadTree(SRC, /\.(js|jsx)$/, ROOT);
const errors = analyse(files);
if (errors.length > 0) {
  console.error('\n✖ ENVELOPE CALLER(S) WITHOUT A PROTOCOL:');
  for (const e of errors) console.error(e);
  console.error('\nPass a resolved protocol — the endpoint refuses unscoped by design (#925).');
  process.exit(1);
}
console.log('[envelope-callers] ✅ OK — every /api/signals/envelope caller passes a protocol');
