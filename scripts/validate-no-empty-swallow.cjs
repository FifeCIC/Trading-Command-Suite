#!/usr/bin/env node
/**
 * validate-no-empty-swallow.cjs — INV-NO-EMPTY-SWALLOW (build-time, ratcheted)
 * ============================================================================
 * Fails when a NEW `.catch(() => <empty-shaped default>)` appears in the frontend.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE DEFECT THIS PREVENTS (measured 2026-11-06, #782)
 * ─────────────────────────────────────────────────────────────────────────
 * `apiGet` throws a rich error — status, message, everything a UI needs to say
 * "I could not ask". This pattern throws all of it away and returns the exact
 * shape a *successful* answer has when it is empty:
 *
 *     queryFn: () => apiGet('/api/scoring/runs').catch(() => ({ runs: [] }))
 *
 * Three separate failures follow, and only the first is obvious:
 *
 *   1. the page renders **"No active protocols."** / "0 entries" — a confident
 *      factual claim about the registry, when the truth is "I could not ask";
 *   2. react-query records a **SUCCESS**, so `isError`, `error` and the retry
 *      policy never engage — the outage is invisible to the framework too;
 *   3. because the value is indistinguishable from a real empty result, anything
 *      derived from it is silently destroyed. In #782 the empty list **pruned the
 *      user's stored protocol selection**: one transient 502 during an API
 *      restart, and the ladder came back with nothing ticked.
 *
 * ⚠️ `.catch(() => null)` is NOT this pattern and is deliberately allowed.
 * `null` is the absence of an answer and every caller can tell it from `[]`.
 * The defect is specifically a *success-shaped empty*, not any error handling.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A RATCHET AND NOT A ZERO-TOLERANCE GATE
 * ─────────────────────────────────────────────────────────────────────────
 * Measured 2026-11-06 at creation: **19 live sites across 15 files** (the guard itself found **55** —
 * it sees the multi-line and `.then().catch()` spellings a one-line grep misses).
 *
 * Failing the build until all of them were gone would have been red from the same hour it was
 * written, and a gate that is red for reasons unrelated to your change gets allowlisted or bypassed —
 * worse than no gate. So it recorded the sites that existed and enforced:
 *
 *   - a file may only go DOWN;
 *   - a file NOT listed fails (that is a new swallow);
 *   - a file that went down is REPORTED so `--write` can bank the progress.
 *
 * ⚠️ THE RATCHET HAS SINCE REACHED ZERO (2026-11-06, same day): 55 → 37 → 0. The baseline is now an
 * empty `files: {}`, which makes this a **zero-tolerance** gate in practice — any new swallow fails
 * immediately. Keep it that way: do not re-add an entry to silence a build, fix the site.
 *
 * Same mechanism as `validate-duplication.cjs` and `validate-settings-access.cjs`
 * — one ratchet pattern in this repo, not three.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ WHAT THIS CANNOT SEE (stated, so a green run is not over-read)
 * ─────────────────────────────────────────────────────────────────────────
 * It matches the literal shapes below. It does NOT match a swallow hidden behind
 * a variable, a helper, a `.then()` chain, or an `async`/`await` + `try/catch`
 * that returns an empty default. It is a tripwire for the pattern people
 * actually write, not a proof that error handling is correct.
 *
 *   node scripts/validate-no-empty-swallow.cjs              # gate
 *   node scripts/validate-no-empty-swallow.cjs --report     # counts, always exit 0
 *   node scripts/validate-no-empty-swallow.cjs --write      # bank a REDUCTION only
 *   node scripts/validate-no-empty-swallow.cjs --init       # create the baseline (once, no baseline yet)
 *   node scripts/validate-no-empty-swallow.cjs --self-test  # prove it can fail
 *
 * ── DECISION (2026-11-06, primary) ──
 * WHAT:      `.catch(() => <empty-shaped default>)` is FORBIDDEN on a frontend queryFn and enforced by
 *            this gate. `.catch(() => null)` stays ALLOWED. A page that needs a fallback must say
 *            "unknown" using `src/core/api/feed-state.js`, never "none".
 * WHY:       55 live sites, each one a page stating a fact it never read — "Open Positions 0",
 *            "nothing at risk", "No active alerts", "0 entries". Worse than a blank: a small number
 *            is believed. In #782 the empty list PRUNED the user's stored protocol selection.
 * INSTEAD OF: Repairing the sites one at a time and reporting the total (what #782 originally asked
 *            for). Fixing instances without a guard is how the 18th site became the 55th.
 * REVERSE BY: Deleting the baseline entry AND removing this gate from `nest/package.json` `prebuild`.
 *            Do not reverse it by adding a file to `files` — that silences the gate for that file.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 151
 * GUARD:     this script's own --self-test, plus src/core/api/feed-state.test.js
 *
 * @created 2026-11-06 — #782, third acceptance criterion
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_ROOT = path.join(ROOT, 'src');
const BASELINE = path.join(__dirname, 'no-empty-swallow-baseline.json');

/**
 * Blanks out comments AND string literals while PRESERVING line numbers.
 *
 * ⚠️ Without the comment handling the guard fires on its own documentation — every fixed site
 * carries a comment explaining the pattern it must not reintroduce, and a naive matcher reads
 * "`.catch(() => [])`" inside that prose as a live offence. That was the first thing the canary
 * caught.
 *
 * ⚠️ Without the STRING handling it fires on the docs-as-data files: `architecture-reference.js`,
 * `qa-checklist.js` and `architecture-framework.data.js` all quote request shapes in template
 * literals, and the first real scan reported **59 sites** where the truth was far fewer. A guard
 * that reports quotes as code is the false-positive kind that gets allowlisted.
 *
 * The trade: code inside a `${…}` interpolation is also blanked, so a swallow hidden there is
 * missed. That direction is deliberate — this is a tripwire for the pattern people write at the
 * top level of a `queryFn`, not an interpreter.
 */
function stripComments(src) {
  let out = '';
  let i = 0;
  let mode = 'code'; // code | line | block | single | double | template
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && n === '*') { mode = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { mode = 'single'; out += c; i++; continue; }
      if (c === '"') { mode = 'double'; out += c; i++; continue; }
      if (c === '`') { mode = 'template'; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }
    if (mode === 'block') {
      // ⚠️ `'  '`, NOT `'\n'`. The first version emitted a newline for the two-character `*/`,
      // which inserted a line that does not exist and made every reported line number after a block
      // comment wrong. Caught by spot-checking a reported site and finding ordinary code there.
      if (c === '*' && n === '/') { mode = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    // inside a string literal: emit blanks so quoted request shapes are not read as code
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((mode === 'single' && c === "'") || (mode === 'double' && c === '"') || (mode === 'template' && c === '`')) {
      mode = 'code'; out += c; i++; continue;
    }
    out += c === '\n' ? '\n' : ' '; i++;
  }
  return out;
}

/**
 * The four shapes that produce a success-looking empty value.
 * `({ key: [] })`, `[]`, `{}`, and the `function () { return [] }` spelling.
 */
const PATTERNS = [
  { name: 'object-with-empty-array', re: /\.catch\s*\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\(\s*\{\s*\w*\s*:\s*\[\s*\]\s*,?\s*\}\s*\)/g },
  { name: 'bare-empty-array', re: /\.catch\s*\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\[\s*\]/g },
  { name: 'bare-empty-object', re: /\.catch\s*\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\(\s*\{\s*\}\s*\)/g },
  { name: 'function-returning-empty-array', re: /\.catch\s*\(\s*function\s*\([^)]*\)\s*\{\s*return\s*\[\s*\]\s*;?\s*\}\s*\)/g },
];

/** Line number of a character index — 1-based. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

/**
 * Does this file CALL feedState/feedUnavailable without importing it?
 *
 * ⚠️ RUN THE TEST ON THE STRIPPED SOURCE, NOT THE RAW SOURCE — and this is the whole point of the
 * function existing separately. Written the obvious way (`/feedState\s*\(/.test(source)`), it fired
 * on `src/core/architecture-reference.js`, which **names the helper in a documentation string** to
 * explain the #782 rule. That file imports nothing and calls nothing; it was flagged for prose, and
 * the shared build went red for a correct file with a message telling a reader to add an import to
 * a docs module. Measured 2026-11-07, and it blocked every agent's `prebuild`.
 *
 * The same reasoning the file's own `stripComments` docblock gives for the swallow patterns applies
 * here and was simply not applied: a guard that reads quotes as code is the false-positive kind that
 * gets allowlisted.
 *
 * ⚠️ The `feed-state.js` IMPORT CHECK stays on the RAW source deliberately — an import path lives
 * inside a string literal, so the stripped source has had it blanked along with everything else.
 *
 * The trade, stated plainly: a call written inside a `${…}` interpolation is blanked and missed.
 * That direction is accepted — but it is the direction a `--self-test` case now covers so the choice
 * is recorded rather than discovered.
 */
function needsImport(source, rel) {
  // ⚠️ The module that DEFINES the helper obviously mentions it — exclude it, or the check reports
  // itself and every run is red for a correct file.
  if (rel.endsWith('core/api/feed-state.js')) return false;
  if (!/feedUnavailable\s*\(|feedState\s*\(/.test(stripComments(source))) return false;
  return !source.includes('feed-state.js');
}

function findInText(text) {
  const clean = stripComments(text);
  const hits = [];
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean)) !== null) {
      hits.push({ name, line: lineOf(clean, m.index), match: m[0].replace(/\s+/g, ' ') });
    }
  }
  return hits;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full, out); continue; }
    if (!/\.(js|jsx)$/.test(entry.name)) continue;
    if (/\.test\.js$/.test(entry.name)) continue; // tests assert about the pattern
    out.push(full);
  }
  return out;
}

function scan() {
  const files = {};
  const details = [];
  const missingImports = [];
  for (const file of walk(SCAN_ROOT)) {
    const source = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const hits = findInText(source);
    if (hits.length) {
      files[rel] = hits.length;
      for (const h of hits) details.push({ file: rel, ...h });
    }
    // ⚠️ USING THE HELPER WITHOUT IMPORTING IT IS A RUNTIME CRASH THE BUILD DOES NOT CATCH.
    // Measured 2026-11-06: a `.Replace(...)` in an edit script silently did nothing because the
    // import line had a different shape (`apiGet, apiPost, apiDelete`), the script still printed
    // success, `vite build` passed, and the page died with
    // `ReferenceError: feedUnavailable is not defined` — found only by opening it in a browser.
    // This scan makes that class of mistake a build failure instead of a page that will not load.
    if (needsImport(source, rel)) missingImports.push(rel);
  }
  return { files, details, missingImports };
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return { files: {} };
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
}

function selfTest() {
  const cases = [
    // [label, source, expected count]
    ['object-with-empty-array (the #782 shape)', "x = apiGet('/a').catch(() => ({ runs: [] }));", 1],
    ['bare-empty-array', "x = apiGet('/a').catch(() => []);", 1],
    ['bare-empty-object', "x = apiGet('/a').catch(() => ({}));", 1],
    ['function spelling', "x = apiGet('/a').catch(function () { return []; });", 1],
    ['named param', "x = apiGet('/a').catch(err => ({ protocols: [] }));", 1],
    // ⚠️ The three that MUST NOT fire — each is a false positive that would make the guard
    // unusable, and each was observed while writing this file.
    ['null is honest, not a swallow', "x = apiGet('/a').catch(() => null);", 0],
    ['the pattern named in a line comment', "// never write .catch(() => [])\nx = 1;", 0],
    ['the pattern named in a block comment', "/* never write .catch(() => ({ runs: [] })) */\nx = 1;", 0],
    ['a non-empty fallback is a real decision', "x = apiGet('/a').catch(() => ({ runs: [DEFAULT_RUN] }));", 0],
    ['a URL in a string is not a comment', "u = 'http://x/y'; x = apiGet('/a').catch(() => null);", 0],
    ['the pattern quoted in a template literal is documentation', "const s = `apiGet('/a').catch(() => ({ runs: [] }))`;", 0],
  ];
  let failures = 0;
  for (const [label, src, expected] of cases) {
    const got = findInText(src).length;
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✔' : '✖'} ${label} — expected ${expected}, got ${got}`);
  }

  // ⚠️ Cardinality canary: two offenders on separate lines must report two lines, not one.
  const two = findInText("a = f().catch(() => []);\nb = f().catch(() => ({}));");
  const lines = new Set(two.map(h => h.line));
  const cardOk = lines.size === 2;
  if (!cardOk) failures++;
  console.log(`  ${cardOk ? '✔' : '✖'} two offenders report two distinct line numbers — got ${[...lines]}`);

  // Ratchet canary: the comparison itself must fail on a new site and pass within baseline.
  // ⚠️ Corrected while writing this: the FIRST version asserted `compare({a:1}, {})` is a violation,
  // which is backwards — a file that vanishes from the scan is an IMPROVEMENT, not a regression.
  // The real new-file case is a file the baseline has never seen.
  const cmp1 = compare({ 'a.jsx': 1 }, { 'a.jsx': 2 });        // increase        → violation
  const cmp2 = compare({ 'a.jsx': 1 }, { 'a.jsx': 1 });        // equal           → pass
  const cmp3 = compare({}, { 'new.jsx': 1 });                  // never listed    → violation
  const cmp4 = compare({ 'a.jsx': 2 }, { 'a.jsx': 1 });        // improvement     → pass
  const ratchetOk = cmp1.length === 1 && cmp2.length === 0 && cmp3.length === 1 && cmp4.length === 0;
  if (!ratchetOk) failures++;
  console.log(`  ${ratchetOk ? '✔' : '✖'} ratchet — increase fails, equal passes, new file fails, reduction passes`);

  // ⚠️ Line numbers must survive the transform. A block comment must not shift any line after it,
  // because the reported line is the thing a reader jumps to — a wrong number sends them elsewhere
  // and reads as a false positive.
  const shifted = findInText("a = 1;\n/* one line */\nb = f().catch(() => []);\nc = f().catch(() => ({}));");
  const shiftOk = shifted.length === 2 && shifted.map(h => h.line).join(',') === '3,4';
  if (!shiftOk) failures++;
  console.log(`  ${shiftOk ? '✔' : '✖'} line numbers survive a block comment — got ${shifted.map(h => h.line).join(',')} (expected 3,4)`);

  // ⚠️ THE IMPORT CHECK HAD NO SELF-TEST — which is exactly why it could flag a docs file and turn
  // the shared build red on 2026-11-07. Both directions, because the check has two ways to be wrong:
  // missing a real crash, and reporting a correct file.
  const importCases = [
    // [label, source, rel, expected]
    ['a real call with no import is a render crash', "const s = feedState(q);", 'src/pages/A.jsx', true],
    ['feedUnavailable likewise', "feedUnavailable(e, 'x');", 'src/pages/A.jsx', true],
    // ⚠️ THE FALSE POSITIVE THAT ACTUALLY HAPPENED — a docs-as-data module naming the helper.
    ['the helper named in a single-quoted doc string', "const row = 'a page must use feedState() not []';", 'src/core/architecture-reference.js', false],
    ['the helper named in a template literal', 'const row = `a page must use feedState() not []`;', 'src/core/architecture-reference.js', false],
    ['the helper named in a comment', '// use feedState() here\nconst x = 1;', 'src/pages/A.jsx', false],
    ['an import satisfies the check', "import { feedState } from '../core/api/feed-state.js';\nfeedState(q);", 'src/pages/A.jsx', false],
    ['the definition module is never flagged', 'export function feedState(q) {}', 'src/core/api/feed-state.js', false],
  ];
  for (const [label, src, rel, expected] of importCases) {
    const got = needsImport(src, rel);
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✔' : '✖'} import — ${label} — expected ${expected}, got ${got}`);
  }

  console.log(failures === 0 ? '\n✅ self-test passed' : `\n❌ ${failures} self-test case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

/** Violations = files over baseline, plus files absent from the baseline. */
function compare(baselineFiles, actualFiles) {
  const out = [];
  for (const [file, count] of Object.entries(actualFiles)) {
    const allowed = baselineFiles[file] ?? 0;
    if (count > allowed) out.push({ file, count, allowed });
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) return selfTest();

  const { files, details, missingImports } = scan();
  const baseline = loadBaseline();
  const actualTotal = Object.values(files).reduce((a, b) => a + b, 0);
  const baselineTotal = Object.values(baseline.files ?? {}).reduce((a, b) => a + b, 0);

  // A consumer that calls the helper without importing it crashes at render, and no build catches it.
  if (missingImports.length) {
    console.error('❌ INV-NO-EMPTY-SWALLOW — these files call feedState/feedUnavailable without importing it:\n');
    for (const f of missingImports) console.error(`   ${f}  — missing \`import { feedUnavailable } from '<...>/core/api/feed-state.js'>\``);
    console.error('\n   This is a ReferenceError at render, not a build error: it is only visible by');
    console.error('   loading the page. Measured 2026-11-06 in T212PortfolioPage.jsx.');
    process.exit(1);
  }

  if (args.includes('--report')) {
    console.log(`Empty-swallow sites: ${actualTotal} across ${Object.keys(files).length} files (baseline ${baselineTotal})`);
    for (const d of details) console.log(`  ${d.file}:${d.line}  ${d.name}`);
    process.exit(0);
  }

  if (args.includes('--write') || args.includes('--init')) {
    const init = args.includes('--init');
    // ⚠️ `--init` and `--write` are deliberately separate acts. `--write` may only BANK a reduction
    // and refuses an increase; `--init` records the tree as it stands, once, and refuses to run when a
    // baseline already exists. Collapsing them would make "record today's sites" and "I fixed some"
    // the same command, and the first use of a ratchet is exactly when it could hide a regression.
    if (init && Object.keys(baseline.files ?? {}).length) {
      console.error('❌ REFUSING --init: a baseline already exists. Use --write to bank a reduction.');
      process.exit(1);
    }
    const violations = init ? [] : compare(baseline.files ?? {}, files);
    if (violations.length) {
      console.error('❌ REFUSING to bank: the run has MORE sites than the baseline. Fix them, do not record them.');
      for (const v of violations) console.error(`   ${v.file}: ${v.count} (baseline allowed ${v.allowed})`);
      process.exit(1);
    }
    const next = {
      _comment: 'Ratchet for INV-NO-EMPTY-SWALLOW. A file may only go DOWN; a file not listed fails the build. `.catch(() => null)` is deliberately allowed — null is distinguishable from an empty result. Regenerate with `node scripts/validate-no-empty-swallow.cjs --write`, which refuses to record an increase.',
      _measured: new Date().toISOString().slice(0, 10),
      _method: 'literal `.catch(<callback>)` returning [] , {} , ({ key: [] }) or function(){return []}; comments and string literals stripped first',
      totals: { sites: actualTotal, files: Object.keys(files).length },
      files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n');
    console.log(`✅ ${init ? 'Initialised' : 'Banked'} ${actualTotal} sites across ${Object.keys(files).length} files (was ${baselineTotal})`);
    process.exit(0);
  }

  const violations = compare(baseline.files ?? {}, files);
  if (violations.length) {
    console.error('❌ INV-NO-EMPTY-SWALLOW — a failed request is being turned into a success-shaped empty value:\n');
    for (const v of violations) {
      console.error(`   ${v.file}: ${v.count} site(s), baseline allows ${v.allowed}`);
      for (const d of details.filter(x => x.file === v.file)) console.error(`      L${d.line}  ${d.match}`);
    }
    console.error('\n   Let the error through so react-query can set `isError`, then render a branch that');
    console.error('   names the failed request and offers a retry. See #782 and src/core/useProtocolData.js.');
    console.error('   `.catch(() => null)` is fine where a caller treats null as "no answer".');
    process.exit(1);
  }

  const improved = Object.entries(baseline.files ?? {})
    .filter(([file, allowed]) => (files[file] ?? 0) < allowed)
    .map(([file]) => file);
  console.log(`✅ INV-NO-EMPTY-SWALLOW — ${actualTotal} site(s) across ${Object.keys(files).length} file(s); none new`);
  if (improved.length) {
    console.log(`   📉 ${improved.length} file(s) improved — bank it: node scripts/validate-no-empty-swallow.cjs --write`);
    for (const f of improved) console.log(`      ${f}: ${baseline.files[f]} → ${files[f] ?? 0}`);
  }
}

main();
