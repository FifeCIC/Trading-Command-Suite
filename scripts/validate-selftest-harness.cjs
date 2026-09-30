#!/usr/bin/env node
/**
 * validate-selftest-harness.cjs — a new guard must not hand-roll the repo's own self-test harness.
 *
 * ── WHY THIS EXISTS (#1032) ──────────────────────────────────────────────────────────────────
 *
 * `scripts/lib/validator-helpers.cjs` has exported `runCases()` / `runSelfTest()` since 2026-09-23.
 * It was extracted for exactly this reason, and its own header records the occasion:
 *
 *     "Extracted 2026-09-23 when two guards duplicated three blocks — the duplication validator
 *      failed the build on them, and the repo's rule is EXTRACT, never bank."
 *
 * It was then re-written by hand several more times. Each copy looks harmless. Together they mean a
 * fix to the harness — a stricter rule, a clearer failure message, a new output shape — reaches
 * only the callers that happen to import it, and the copies drift. Measuring the drift is how this
 * guard's exact rule was chosen (below).
 *
 * ── WHAT IT FLAGS, AND WHY THE SIGNATURE IS NARROW ───────────────────────────────────────────
 *
 * ⚠️ #1032 stated "ten files hand-roll the harness". Reading each one, that count does not survive:
 *
 *   • 3 files were TRUE COPIES — `[name, fn]` tuples, a `try`, a `fn() === true` comparison, a
 *     PASS/FAIL line. All three now call `runCases`. (replay-exit-counterfactual,
 *     replay-exit-verdict, audit-symbol-protocol-authority)
 *   • 4 files iterate a cases array but are a DIFFERENT SHAPE — a data-driven table with per-case
 *     ARGUMENTS and a custom comparison (`[label, entries, shouldFail]`, `{models, live, expect}`).
 *     Rewriting those into `[name, () => …]` closures would shrink the shared code and make the
 *     cases less readable, which trades one defect for another. They are REPORTED, not failed.
 *   • 1 file is NOT a harness at all — `fix-local-time-defaults.cjs` declares `let failed = 0` to
 *     count failed DDL statements. It never iterates a cases array. It is exempt, with the reason.
 *
 * So the guard fires only on the shape that is unambiguously a copy: **a loop over a `cases` array
 * that both `try`s and throws-away-to-false, i.e. the `runCases` contract re-implemented.** That is
 * the "narrow beats broad" rule — a guard that fires on table-driven tests would be wrong, and a
 * wrong guard gets allowlisted, and an allowlisted guard is worse than none.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────
 *
 *   node scripts/validate-selftest-harness.cjs              # exit 1 on a NEW hand-rolled copy
 *   node scripts/validate-selftest-harness.cjs --report     # list every shape found, exit 0
 *   node scripts/validate-selftest-harness.cjs --self-test  # prove the rule can fire AND stay quiet
 *
 *   npm run validate:selftest-harness / report:selftest-harness / test:selftest-harness
 *
 * ⚠️ Not in `prebuild`: a gate that has run once is not yet a gate. Same convention as
 * `validate-architecture-docs.cjs`, `validate-decisions.cjs` and `validate-theories.cjs`.
 */

const fs = require('fs');
const path = require('path');
const { walkSourceFiles, stripComments, runCases } = require('./lib/validator-helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const TAG = 'selftest-harness';

/** Where the shape can appear. Both roots, because `nest/scripts/` holds build gates too. */
const SCAN_DIRS = [path.join(ROOT, 'scripts'), path.join(ROOT, 'nest/scripts')];

/**
 * The canonical harness itself, and the two files that legitimately CONTAIN the pattern because it is
 * their job to describe it. An exemption is a claim, so each carries its reason.
 */
const EXEMPT = new Map([
  ['lib/validator-helpers.cjs', 'THE harness — this is the one implementation everything else shares'],
  ['validate-selftest-harness.cjs', 'this guard — its fixture strings necessarily contain the shape'],
]);

/**
 * Files that iterate a `cases` array but are a DIFFERENT shape: the case carries arguments and the
 * comparison is bespoke. Reported, never failed. Each entry names what it actually is, because an
 * unexplained exemption is indistinguishable from a suppressed finding.
 */
const DIFFERENT_SHAPE = new Map([
  ['validate-theories.cjs', 'table-driven: cases are [label, entries, shouldFail] and the fn needs arguments'],
  ['validate-schema-safety.cjs', 'table-driven: cases are {label, models, live, expect} with a bespoke comparison'],
  ['directive-guard.cjs', 'table-driven: cases are {name, stats, expect} compared by classifyStarvation'],
]);

/**
 * Does this source contain a HAND-ROLLED COPY of the `runCases` contract?
 *
 * The signature is deliberately the full contract, not one symptom:
 *   - iterates a `cases` array with a destructured pair, AND
 *   - contains a `try`, AND
 *   - compares against `=== true` or assigns `ok = false` in a catch, AND
 *   - prints a PASS/FAIL verdict.
 *
 * Requiring all four is what keeps table-driven tests out. A guard that fires on those would be
 * widened on the next false positive, and a widened guard protects nothing.
 */
function findHandRolledLoops(src) {
  const code = stripComments(src);
  const hits = [];
  const lines = code.split(/\r?\n/);

  // A `for (const [a, b] of cases)` / `for (const [name, fn] of cases)` — the loop shape.
  for (let i = 0; i < lines.length; i++) {
    if (!/for\s*\(\s*const\s*\[[^\]]+\]\s+of\s+\w*(cases|CASES)\w*\s*\)/.test(lines[i])) continue;

    // Look in a window after the loop header for the rest of the contract.
    const window = lines.slice(i, i + 18).join('\n');
    const hasTry = /\btry\s*\{/.test(window);
    const hasStrict = /===\s*true/.test(window) || /ok\s*=\s*false/.test(window);
    const printsVerdict = /PASS|FAIL/.test(window) && /console\.log/.test(window);

    if (hasTry && hasStrict && printsVerdict) hits.push({ line: i + 1, shape: 'hand-rolled copy of runCases' });
    else hits.push({ line: i + 1, shape: 'loop over cases (bespoke comparison)' });
  }
  return hits;
}

function scan() {
  const found = [];
  for (const dir of SCAN_DIRS) {
    for (const file of walkSourceFiles(dir)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const key = [...EXEMPT.keys()].find((k) => rel.endsWith(k));
      const src = fs.readFileSync(file, 'utf8');
      const hits = findHandRolledLoops(src);

      // Does it already import the shared harness? That is what makes a copy inexcusable.
      const importsShared = /require\((['"])[^'"]*validator-helpers[^'"]*\1\)/.test(src);

      for (const h of hits) {
        const shapeKey = [...DIFFERENT_SHAPE.keys()].find((k) => rel.endsWith(k));
        found.push({
          rel,
          line: h.line,
          shape: h.shape,
          importsShared,
          exempt: key ? EXEMPT.get(key) : null,
          differentShape: shapeKey ? DIFFERENT_SHAPE.get(shapeKey) : null,
          // A violation is ONLY a true copy that did not import the shared harness.
          violation: !key && !shapeKey && h.shape === 'hand-rolled copy of runCases' && !importsShared,
        });
      }
    }
  }
  return found;
}

// ── self-test — both directions, on synthetic source ─────────────────────────────────────────

const FIXTURE_COPY = `
function selfTest() {
  const cases = [['a case', () => 1 === 1]];
  let failed = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try { ok = fn() === true; } catch { ok = false; }
    if (!ok) failed++;
    console.log(\`  \${ok ? 'PASS' : 'FAIL'}  \${name}\`);
  }
  return failed;
}`;

const FIXTURE_TABLE = `
function selfTest() {
  const cases = [{ label: 'x', models: new Map(), live: [], expect: 0 }];
  let failed = 0;
  for (const [name, fn] of cases) {
    const got = check(name);
    if (got !== 1) failed++;
  }
  return failed;
}`;

function selfTest() {
  return [
    ['a hand-rolled COPY of runCases is detected', () => findHandRolledLoops(FIXTURE_COPY).some((h) => h.shape === 'hand-rolled copy of runCases')],
    ['a TABLE-DRIVEN test is NOT called a copy', () => !findHandRolledLoops(FIXTURE_TABLE).some((h) => h.shape === 'hand-rolled copy of runCases')],
    ['a table-driven test IS still reported (not hidden)', () => findHandRolledLoops(FIXTURE_TABLE).length > 0],
    ['prose ABOUT the shape cannot trip the guard', () => findHandRolledLoops('// for (const [n, fn] of cases) { try { ok = fn() === true } console.log("PASS") }').length === 0],
    ['source with no loop yields nothing', () => findHandRolledLoops('const x = 1;').length === 0],
    // ⚠️ These two assert the COPY shape is absent, NOT that nothing is reported. The first version
    // asserted `.length === 0` and failed — correctly, because a loop that is not a copy is still
    // REPORTED (as a bespoke shape). The detector was right and the assertion was wrong.
    ['a loop with NO try is not the runCases contract', () => !findHandRolledLoops('for (const [n, fn] of cases) { console.log("PASS") }').some((h) => h.shape === 'hand-rolled copy of runCases')],
    ['a loop with NO strict comparison is not the contract', () => !findHandRolledLoops('for (const [n, fn] of cases) { try { fn() } catch {} console.log("PASS") }').some((h) => h.shape === 'hand-rolled copy of runCases')],
    ['the REAL tree has ZERO hand-rolled copies', () => {
      // Direction two, against the real tree rather than a fixture. This is the assertion that
      // caught two copies written the same day the issue was open — the guard's whole justification.
      const v = scan().filter((f) => f.violation);
      if (v.length) console.log(`\n      (violations found: ${v.map((f) => f.rel + ':' + f.line).join(', ')})\n`);
      return v.length === 0;
    }],
  ];
}

// ── entry ───────────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  if (process.argv.includes('--self-test')) process.exit(runCases(selfTest()) ? 1 : 0);
  const reportOnly = process.argv.includes('--report');

  const found = scan();
  const violations = found.filter((f) => f.violation);

  console.log(`\n[${TAG}] scanned ${SCAN_DIRS.map((d) => path.relative(ROOT, d)).join(' + ')}`);
  console.log(`[${TAG}] ${found.length} loop(s) over a cases array found\n`);

  for (const f of found) {
    const verdict = f.exempt ? 'EXEMPT' : f.differentShape ? 'DIFFERENT SHAPE' : f.violation ? '**VIOLATION**' : 'ok';
    console.log(`  ${verdict.padEnd(16)} ${f.rel}:${f.line}  — ${f.shape}`);
    if (f.exempt) console.log(`      exempt: ${f.exempt}`);
    if (f.differentShape) console.log(`      not a copy: ${f.differentShape}`);
  }

  if (violations.length > 0 && !reportOnly) {
    console.error(`\n[${TAG}] \u2716 ${violations.length} hand-rolled copy(ies) of the shared harness.`);
    console.error(`[${TAG}]   Fix by importing it, not by widening an allowance:`);
    console.error(`[${TAG}]     const { runCases } = require('<rel>/scripts/lib/validator-helpers.cjs');`);
    console.error(`[${TAG}]   Use runCases when the file owns its exit code; runSelfTest when it does not.\n`);
    process.exit(1);
  }

  console.log(
    violations.length === 0
      ? `\n[${TAG}] \u2714 OK — no file re-implements the harness; ${found.filter((f) => f.differentShape).length} table-driven shape(s) reported, not failed.\n`
      : `\n[${TAG}] ${violations.length} violation(s) reported (--report: exiting 0).\n`,
  );
  process.exit(0);
}

module.exports = { findHandRolledLoops, scan, EXEMPT, DIFFERENT_SHAPE };
