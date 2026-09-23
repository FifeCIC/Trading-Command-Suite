/**
 * validator-helpers.cjs — shared building blocks for the repo's `validate-*.cjs` guards.
 * ======================================================================================
 * Extracted 2026-09-23 when `nest/scripts/validate-manual-trade-gate.cjs` and
 * `scripts/validate-envelope-callers.cjs` duplicated three blocks — the duplication validator
 * failed the build on them, and the repo's rule is EXTRACT, never bank (banking hides the
 * instance; extraction removes the class).
 *
 * Deliberately tiny: walking, loading, and the standard both-directions self-test harness —
 * the shape every guard in this repo grew independently. Anything guard-specific stays in
 * the guard.
 */
const fs = require('fs');
const path = require('path');

/**
 * Walk `dir` recursively, collecting file paths whose NAME matches `filter` (a RegExp).
 * `filter` defaults to any `.js`/`.cjs` file.
 */
function walkFiles(dir, filter = /\.(js|cjs)$/, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, filter, out);
    else if (filter.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Load a directory tree into Map<key, source>. Keys are paths relative to `keyRoot` with
 * forward slashes — pass `keyRoot` = the repo root to print `src/...` style paths, or the
 * scan root itself to print module-relative paths.
 */
function loadTree(scanRoot, filter, keyRoot = scanRoot) {
  const files = new Map();
  for (const full of walkFiles(scanRoot, filter)) {
    files.set(path.relative(keyRoot, full).split(path.sep).join('/'), fs.readFileSync(full, 'utf8'));
  }
  return files;
}

/**
 * The standard self-test harness: run `cases` ([name, fn] tuples), print PASS/FAIL, and exit.
 * A case passes only if its fn returns truthy — a case that THROWS is a failure, never a skip
 * (a canary that cannot establish its condition must not report success).
 */
function runSelfTest(cases) {
  let fail = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn(); } catch { ok = false; }
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
    if (!ok) fail++;
  }
  if (fail) {
    console.log(`\nSELFTEST FAILED — ${fail} case(s)`);
    process.exit(1);
  }
  console.log('\nSELFTEST PASSED — both directions proven on fixtures');
  process.exit(0);
}

module.exports = { walkFiles, loadTree, runSelfTest };
