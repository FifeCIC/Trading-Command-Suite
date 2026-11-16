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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SOURCE-SHAPE SHARED BLOCKS — extracted 2026-09-30 (#1030).
//
// `validate-signal-classification.cjs` and `validate-single-bridge-position-io.cjs` are both
// "scan the source for a forbidden SHAPE" guards, and the second was written by copying the first.
// The duplication validator failed the build on **8 shared blocks**. Extraction removes the class;
// `--update-allowance` would have removed only the complaint, leaving two copies to drift — and the
// next shape guard would have copied whichever one it happened to open.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A spec deliberately asserts the WRONG shape, so a source-shape guard must not scan it. */
const SKIP_SPEC = /\.(spec|test)\.[cm]?[jt]sx?$/;

/** Source extensions a shape guard scans (TS/JS, CJS/MJS, plus the JSX/TSX variants). */
const SOURCE_EXT = /\.([cm]?[jt]sx?)$/;

/**
 * walkSourceFiles() — every SOURCE file under `dir`, excluding specs and build output.
 *
 * ⚠️ Distinct from `walkFiles()`, which takes an arbitrary filter and does NOT skip `node_modules`
 * or `dist`. A shape guard wants source, so the two must not be conflated.
 */
function walkSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, out);
    else if (SOURCE_EXT.test(entry.name) && !SKIP_SPEC.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * stripComments() — remove comments so this repo's own PROSE about a defect cannot fail its own
 * guard. Every instruction file here documents the bugs it forbids, sometimes quoting them verbatim.
 *
 * ⚠️ Deliberately crude: block comments, then any line whose first non-space character starts a
 * comment. An inline trailing comment SURVIVES, which risks a false positive — so each guard must
 * also exempt the line that demonstrates correct usage. Over-stripping would cause false negatives,
 * which is the safer direction for a gate.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
    })
    .join('\n');
}

/**
 * Blank out comments — and optionally string literals — while PRESERVING newlines and character
 * offsets, so a scanner can report an accurate line number after stripping.
 *
 * ⚠️ WHY THIS IS SHARED. `validate-css-parses.cjs` and `validate-chart-api.cjs` each hand-rolled this
 * loop, and `validate-duplication.cjs` failed the build on the pair. Extraction removes the class;
 * banking the pair would only have removed the complaint.
 *
 * ⚠️ WHY NOT THE `stripComments` ABOVE. That one is LINE-BASED and DELETES lines, so every line number
 * after the first removed line is wrong. It is right for "is this identifier mentioned anywhere", and
 * wrong for "report the line this hazard is on" — which is what both of these guards must do.
 *
 * @param {string} source
 * @param {{ blankStrings?: boolean }} [opts] - also blank string literals (for scanning for CALLS,
 *   where a quoted example must not count as code). Default false: the string is kept verbatim and
 *   only protects comment markers inside it, which is what a token scan needs.
 * @returns {string} same length and newline layout as the input
 */
function blankComments(source, opts = {}) {
  const blankStrings = opts.blankStrings === true;
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') {
        out += ' ';
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < source.length && !(source[j] === '*' && source[j + 1] === '/')) j++;
      const closed = j < source.length;
      const body = source.slice(i, closed ? j + 2 : source.length);
      out += body.replace(/[^\n]/g, ' ');
      i = closed ? j + 2 : source.length;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < source.length && source[j] !== quote) {
        if (source[j] === '\\') j++;
        j++;
      }
      const body = source.slice(i, Math.min(j + 1, source.length));
      out += blankStrings ? body.replace(/[^\n]/g, ' ') : body;
      i = j + 1;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

module.exports = { blankComments, walkFiles, loadTree, runCases, runSelfTest, walkSourceFiles, stripComments, SKIP_SPEC, SOURCE_EXT };
