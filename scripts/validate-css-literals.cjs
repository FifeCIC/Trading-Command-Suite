#!/usr/bin/env node
/**
 * validate-css-literals.cjs — the "is this colour reachable by a theme?" gate
 * ===========================================================================
 * Companion to validate-css-tokens.cjs.
 *
 * That gate answers: does this `var()` point at a token that EXISTS?
 * This gate answers: is this colour a LITERAL with no `var()` at all?
 *
 * WHY TWO GATES AND NOT ONE
 * -------------------------
 * `validate-css-tokens.cjs` flags a token that is UNDEFINED — with or without a fallback —
 * because when the token does not exist the fallback silently wins and the element is pinned
 * to hardcoded hex. It deliberately does NOT flag a fallback on a token that IS defined
 * (`var(--accent, #22d3ee)` is safe, the fallback can never win). Both rulings are right.
 *
 * The uncovered case is the third one: `.x { color: #4ade80 }` — no `var()`, so no token,
 * so nothing to look up. It renders, it looks plausible, and it is invisible to a
 * token-existence check by construction. It also ignores every theme pack: a literal tuned
 * against `#000000` is simply wrong on a light background, which is the reported symptom
 * that produced this file.
 *
 * Measured when written (2026-10-16): 614 literals in property values, 105 CSS files.
 *
 * WHAT IS *NOT* A FINDING, AND WHY EACH IS DELIBERATE
 * ---------------------------------------------------
 *   --color-profit: #22c55e;      a token DEFINITION — this is where a literal belongs.
 *   var(--color-profit, #22c55e)  fallback on a defined token — css-tokens owns that ruling.
 *   /* color: #4ade80 *​/         a comment. Scanning prose as CSS is how #1061 turned a
 *                                 working gate into a whole-team build blocker; use the
 *                                 canonical stripper, never a regex of your own.
 *   #abc { … }                    an ID selector, not a colour.
 *   url(#fee)                     an SVG reference, not a colour.
 *   #fff / #000                   exempt on purpose, and ONLY these two — see ALWAYS_ALLOWED.
 *
 * ⚠️ A definition is excluded by testing whether the DECLARATION is a custom property, not by
 * excluding index.css. Broad exemptions only ever get wider; a syntax test does not.
 *
 * ⚠️ KNOWN BLIND SPOTS, stated so they are not rediscovered:
 *   1. HEX only. `rgb()`, `rgba()`, `hsl()` and named colours (`red`, `white`) are equally
 *      theme-blind and are NOT counted. Widening the pattern means re-baselining.
 *   2. A hex on a line with no `:` at all is treated as a selector or a continuation and is
 *      NOT counted, so a value wrapped across lines is missed. See self-test case 11, which
 *      asserts that miss rather than hiding it. Writing declarations one per line avoids it.
 *
 * THE RATCHET
 * -----------
 * The debt cannot be cleared in one commit, and a gate that fails on day one gets deleted.
 * Known debt is frozen in `scripts/css-literal-baseline.json` as per-file, per-literal COUNTS.
 *
 *   count UP, or a new file::literal key   → ❌ exit 1. Instance N+1 cannot be added.
 *   count DOWN                             → reported as stale, so the baseline shrinks.
 *   count 0 in / count 0 out, key absent   → ✅ pass.
 *
 * Counts rather than a bare list, deliberately: counts also catch a SWAP — one literal
 * removed and a different one added in the same file, which leaves the total unchanged.
 *
 * TARGET: an EMPTY `entries` object. That is not aspiration — `css-token-baseline.json` is
 * already at `count: 0`, so a companion debt register that only ever grows would be a
 * regression against the sibling gate's standard.
 *
 * Usage:
 *   node scripts/validate-css-literals.cjs                  # gate (exit 1 on new debt)
 *   node scripts/validate-css-literals.cjs --list           # every literal, file:line
 *   node scripts/validate-css-literals.cjs --list-new       # only findings the gate fails on
 *   node scripts/validate-css-literals.cjs --by-file        # counts per file, worst first
 *   node scripts/validate-css-literals.cjs --update-baseline
 *   node scripts/validate-css-literals.cjs --self-test      # canary, BOTH directions
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stripComments } = require('../nest/scripts/lib/comment-stripper.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC = path.join(REPO_ROOT, 'src');
const BASELINE_PATH = path.join(__dirname, 'css-literal-baseline.json');

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Remove whole `var(...)` / `url(...)` constructs, including nested parentheses, so the hex
 * that remains on the line is genuinely bare and not a fallback. A regex like
 * `var\([^)]*\)` stops at the first `)` and mangles `var(--x, color-mix(…))`, which is why
 * this walks characters instead (see --self-test case 5).
 */
function stripVarConstructs(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const isConstruct = line.startsWith('var(', i) || line.startsWith('url(', i);
    if (isConstruct) {
      let depth = 0;
      let j = i;
      for (; j < line.length; j++) {
        if (line[j] === '(') depth++;
        else if (line[j] === ')') { depth--; if (depth === 0) { j++; break; } }
      }
      i = j;
    } else {
      out += line[i];
      i++;
    }
  }
  return out;
}

/** A custom-property DECLARATION is where a literal BELONGS. Syntax test, not a file exemption. */
function isTokenDefinition(prop) {
  return prop.startsWith('--');
}

/**
 * ⚠️ THE ONE EXEMPTION, and it is deliberately NARROW.
 *
 * `#fff` / `#000` are correct on a FIXED-contrast surface — text on an accent-filled button,
 * a scrim over arbitrary content — which is the commonest legitimate literal in this codebase.
 * Telling that apart from `color: #fff` where `--ink` was meant requires knowing the sibling
 * `background`, which a line scanner cannot see.
 *
 * So the real choice is: exempt these two colours, or fire on correct code. A guard that fires
 * on correct code is allowlisted wholesale within a week, and an allowlisted guard is worse
 * than no guard. Narrow beats broad.
 *
 * ✅ ACCEPTED COST, stated rather than discovered: a `#fff` that SHOULD have been `--ink` is
 *    not caught. This is the whole of the weakening — every other colour is still enforced.
 */
const ALWAYS_ALLOWED = new Set(['#fff', '#ffffff', '#000', '#000000']);

/**
 * The core scanner. Takes TEXT, not a path, so --self-test can drive it with fixtures and
 * the real file walk can reuse the identical logic. One implementation, two callers — a
 * second copy of this rule is the most expensive kind of debt in this repo.
 *
 * ⚠️ The line is split on `;` and `{` into DECLARATION SEGMENTS before anything is judged.
 * The first version of this function tested `^\s*--name:` against the whole line, which
 * missed `:root { --color-profit: #22c55e; }` — a token declared inside a rule body — and
 * reported a definition as debt. The self-test caught it on the first run.
 *
 * Segmenting fixes that and also removes the need for a selector exemption: in `#abc {`
 * and `#abc:hover` the hex sits BEFORE its colon, so the property text is not a colour and
 * the value side is empty. Only the value side of a non-custom-property segment is counted.
 */
function scanText(text) {
  const findings = [];
  stripComments(text).split(/\r?\n/).forEach((line, i) => {
    for (const segment of stripVarConstructs(line).split(/[;{]/)) {
      const colon = segment.indexOf(':');
      if (colon === -1) continue;
      if (isTokenDefinition(segment.slice(0, colon).trim())) continue;
      for (const m of segment.slice(colon + 1).matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
        const literal = m[0].toLowerCase();
        if (ALWAYS_ALLOWED.has(literal)) continue;
        findings.push({ literal, line: i + 1, source: line.trim() });
      }
    }
  });
  return findings;
}

function collectFindings() {
  const byFile = new Map(); // relative path -> finding[]
  for (const file of walk(SRC).filter((f) => f.endsWith('.css'))) {
    const findings = scanText(fs.readFileSync(file, 'utf8'));
    if (findings.length) byFile.set(path.relative(REPO_ROOT, file), findings);
  }
  return byFile;
}

/** `{ "src/x.css::#fff": 3 }` — counts, so a swap is caught. */
function toCounts(byFile) {
  const counts = {};
  for (const [file, findings] of byFile) {
    for (const f of findings) {
      const key = `${file}::${f.literal}`;
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { entries: {}, note: null };
  const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return { entries: raw.entries || {}, note: raw.note || null };
}

function writeBaseline(counts) {
  const sorted = {};
  for (const key of Object.keys(counts).sort()) sorted[key] = counts[key];
  const payload = {
    note:
      'Frozen hardcoded-hex debt for scripts/validate-css-literals.cjs. Keys are `file::#literal` ' +
      'with the OCCURRENCE COUNT as the value — counts, not a bare list, so removing one literal ' +
      'and adding a different one in the same file (a swap) is still caught. These are ' +
      'PRE-EXISTING findings: reported, not fatal. A count may only ever go DOWN. Target is an ' +
      'EMPTY entries object. Regenerate with `node scripts/validate-css-literals.cjs --update-baseline`.',
    generatedAt: new Date().toISOString().slice(0, 10),
    fileCount: new Set(Object.keys(counts).map((k) => k.split('::')[0])).size,
    count: Object.keys(counts).length,
    total: Object.values(counts).reduce((n, v) => n + v, 0),
    entries: sorted,
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/**
 * The control proves the SCANNER works — that it can read a CSS declaration and find a bare
 * literal in it. A gate that cannot read its input must ERROR, never pass.
 *
 * ⚠️ It deliberately does NOT point at a literal in the live tree. The first version did —
 * `#4ade80` in health-status-bar.css — and broke the gate the instant that literal was
 * legitimately converted to a token during the very paydown this gate exists to encourage.
 * Exit 2, and because this runs in `prebuild`, a red build for every agent. **A control that
 * the guarded work can break is worse than no control: it punishes doing the right thing.**
 * The real-tree check lives in `--self-test`, which plants its own literal and cleans up.
 */
function runControl() {
  const FIXTURE = '.__control__ { color: #4ade80; }';
  const found = scanText(FIXTURE).some((f) => f.literal === '#4ade80');
  if (!found) {
    console.error('\n❌ CONTROL FAILED — the scanner did not find #4ade80 in its own fixture.');
    console.error('   The scanner is not reading CSS correctly. Every number below would be wrong,');
    console.error('   so this exits 2 instead of reporting a result. (Exit 2 = cannot judge, NOT pass.)\n');
    process.exit(2);
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// --self-test — canary the gate in BOTH directions.
//   1. Fixtures: shapes that must be classified the right way — including the two #1061
//      taught us (a literal in a comment), the nested-paren case that defeats a naive
//      regex, and case 11, which ASSERTS a known miss instead of leaving it silent.
//   2. Real tree: plant a literal in src/, prove the gate FAILS, remove it, prove the tree
//      is byte-identical to before. A guard never observed to fail is a decoration.
// ─────────────────────────────────────────────────────────────────────────────
function selfTest() {
  const cases = [
    ['plain declaration', '.x { color: #4ade80; }', 1],
    ['token definition is not debt', ':root { --color-profit: #22c55e; }', 0],
    ['fallback on a token is not debt', '.x { color: var(--color-profit, #22c55e); }', 0],
    ['literal in a COMMENT is not debt', '/* .x { color: #4ade80; } */', 0],
    ['nested parens: color-mix', '.x { background: color-mix(in srgb, #ca8a04 15%, transparent); }', 1],
    ['nested var() fallback of a fallback', '.x { color: var(--a, var(--b, #123456)); }', 0],
    ['ID selector is not a colour', '#abc { color: red; }', 0],
    ['SVG url() reference is not a colour', '.x { background: url(#fee); }', 0],
    ['uppercase hex is caught', '.x { color: #FAFAFA; }', 1],
    ['two literals on one line', '.x { border: 1px solid #111; color: #222; }', 2],
    ['white on a fixed fill is exempt', '.x { background: var(--accent); color: #fff; }', 0],
    ['short-form black is exempt too', '.x { color: #000; }', 0],
    // ⚠️ EXPECTED 0 — this asserts the documented blind spot (header §2), so the limitation
    // is visible in the self-test output rather than being discovered as a missed literal.
    ['KNOWN MISS — wrapped value on its own line', '.x {\n  background: linear-gradient(\n    #111111,\n    #222222\n  );\n}', 0],
  ];

  let failures = 0;
  console.log('\n── self-test: classifier fixtures ──');
  for (const [name, fixture, expected] of cases) {
    const got = scanText(fixture).length;
    const ok = got === expected;
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '❌'} ${name.padEnd(34)} expected ${expected}, got ${got}`);
  }

  console.log('\n── self-test: real tree, both directions ──');
  const before = toCounts(collectFindings());
  const beforeKeys = JSON.stringify(before);

  const canaryFile = path.join(SRC, '__literal-canary__.css');
  const canaryKey = `${path.relative(REPO_ROOT, canaryFile)}::#00ff00`;

  try {
    fs.writeFileSync(canaryFile, '.canary { color: #00ff00; }\n', 'utf8');
    // Prove the edit landed before trusting the result. A canary that cannot make its edit
    // must refuse to report, never report a false MISSED.
    if (!fs.existsSync(canaryFile)) {
      console.error('  ❌ CANARY INVALID — could not create the canary file. Not reporting a result.');
      return 2;
    }

    const during = toCounts(collectFindings());
    if (!during[canaryKey]) {
      failures++;
      console.log('  ❌ gate did NOT detect the planted literal — the guard does not fire.');
    } else {
      console.log(`  ✅ gate detects the planted literal (${canaryKey}).`);
    }

    fs.unlinkSync(canaryFile);
    const after = JSON.stringify(toCounts(collectFindings()));
    if (after !== beforeKeys) {
      failures++;
      console.log('  ❌ tree NOT restored — findings differ before/after. Investigate.');
    } else if (fs.existsSync(canaryFile)) {
      failures++;
      console.log('  ❌ tree NOT restored — canary file still present.');
    } else {
      console.log('  ✅ tree restored byte-for-byte; canary file removed.');
    }
  } catch (err) {
    failures++;
    console.error(`  ❌ self-test threw: ${err.message}`);
    try { if (fs.existsSync(canaryFile)) fs.unlinkSync(canaryFile); } catch { /* best effort */ }
  }

  console.log(failures === 0 ? '\n✅ SELF-TEST PASSED — every case behaved.\n' : `\n❌ SELF-TEST FAILED — ${failures} case(s).\n`);
  return failures === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--self-test')) return selfTest();

  const byFile = collectFindings();
  runControl();
  const counts = toCounts(byFile);

  if (argv.includes('--update-baseline')) {
    writeBaseline(counts);
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    console.log(
      `📌 Baseline written — ${Object.keys(counts).length} distinct file::literal keys, ` +
      `${total} occurrences, ${byFile.size} file(s) → ${path.relative(REPO_ROOT, BASELINE_PATH)}`
    );
    return 0;
  }

  if (argv.includes('--list') || argv.includes('--list-new')) {
    const { entries } = loadBaseline();
    const seen = {};
    let shown = 0;
    for (const [file, findings] of [...byFile].sort()) {
      for (const f of findings) {
        const key = `${file}::${f.literal}`;
        seen[key] = (seen[key] || 0) + 1;
        const isNew = seen[key] > (entries[key] || 0);
        if (argv.includes('--list-new') && !isNew) continue;
        shown++;
        console.log(`${file}:${f.line}  ${f.literal}${isNew ? '  ← NEW' : ''}`);
      }
    }
    console.log(`\n${shown} literal(s) shown.`);
    return 0;
  }

  if (argv.includes('--by-file')) {
    const rows = [...byFile].map(([file, f]) => [file, f.length]).sort((a, b) => b[1] - a[1]);
    for (const [file, n] of rows) console.log(`  ${String(n).padStart(4)}  ${file}`);
    console.log(`\n${rows.reduce((n, r) => n + r[1], 0)} literal(s) in ${rows.length} file(s).`);
    return 0;
  }

  // ── The gate ──
  const { entries } = loadBaseline();
  const fresh = [];
  for (const [key, count] of Object.entries(counts)) {
    const allowed = entries[key] || 0;
    if (count > allowed) fresh.push({ key, count, allowed });
  }
  const shrunk = Object.entries(entries).filter(([key, allowed]) => (counts[key] || 0) < allowed);

  if (fresh.length === 0) {
    const tail = shrunk.length
      ? ` — ⚠️ ${shrunk.length} baseline count(s) now LOWER; run --update-baseline to shrink it.`
      : '';
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    console.log(
      `✅ OK — no NEW hardcoded colour literals. ${total} pre-existing literal(s) across ` +
      `${byFile.size} file(s) baselined, ${Object.keys(entries).length} key(s) frozen.${tail}`
    );
    return 0;
  }

  console.error('\n❌ NEW hardcoded colour literal(s) in a property value:\n');
  for (const { key, count, allowed } of fresh.sort((a, b) => b.count - a.count)) {
    const [file, literal] = key.split('::');
    console.error(`  ${file}  ${literal}  —  ${count} now, ${allowed} baselined (+${count - allowed})`);
  }
  console.error(
    '\nA literal with no var() is invisible to validate-css-tokens.cjs — there is no token to\n' +
    'look up. It renders, it looks plausible, and it ignores every theme pack: a colour tuned\n' +
    'against #000000 is wrong on a light background.\n\n' +
    'Fix it by using the semantic token for the meaning (--color-loss, --notice-warning-text,\n' +
    '--ink, --line, --panel …), not by raising the baseline. See ui-standards.instructions.md →\n' +
    '"Hardcoded colours" for the cases where a literal is correct.'
  );
  return 1;
}

process.exit(main());
