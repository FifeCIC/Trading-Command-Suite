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
 * Run `cases` ([name, fn] tuples), print one line each plus an `n/m passed` summary, and RETURN the
 * number that failed. Does NOT exit.
 *
 * ⚠️ THE NON-EXITING HALF, EXTRACTED 2026-09-29. `runSelfTest` ends the process, which is wrong for a
 * LIBRARY (`scripts/lib/mysql-cli.cjs` must let its caller choose the exit code) and wrong for a tool
 * whose exit code depends on more than the self-test. Those callers had each hand-rolled this loop —
 * measured: **TEN files**, in two slightly different output formats — and the duplication validator
 * failed the build on the first NEW pair. Extraction removes the CLASS; banking the pair would have
 * removed only the complaint.
 *
 * ⚠️ A case passes only if its fn returns **exactly `true`** — not merely truthy. A case that THROWS
 * is a FAILURE, never a skip: a canary that cannot establish its condition must not report success.
 * (This is the stricter of the two rules the hand-rolled copies used, adopted deliberately so that a
 * case returning an array, a string or a count cannot read as a pass.)
 */
function runCases(cases) {
  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = fn() === true;
    } catch {
      ok = false;
    }
    if (!ok) failed++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log(`\n  ${cases.length - failed}/${cases.length} passed${failed ? '  — SELF-TEST FAILED' : ''}\n`);
  return failed;
}

/**
 * The standard self-test harness: run `cases`, then EXIT — 1 if any case failed, else 0.
 * A thin wrapper over `runCases()`, so a fix to the harness cannot miss one caller.
 */
function runSelfTest(cases) {
  process.exit(runCases(cases) ? 1 : 0);
}

module.exports = { walkFiles, loadTree, runCases, runSelfTest };
