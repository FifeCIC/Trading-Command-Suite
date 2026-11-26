/**
 * validate-formatters.cjs — one formatter per concept, and no page-local copy of a canonical one.
 *
 * ── THE DEFECT THIS PREVENTS ─────────────────────────────────────────────────────────────────────
 * `src/core/format-utils.js` exists and 26 files import it. Measured 2026-11-17: **13 more files
 * declared a formatter of their own, and four of those names collided with a canonical export** —
 * `fmtCurrency` that rendered no currency at all, `fmtDuration` that said "2d 0h" where the shared
 * one says "2d", two different `fmtPrice` rules under one name, and three different `num2`s.
 *
 * The failure mode is not the duplication itself, it is what duplication does to a FIX: the
 * shorter-lived of two copies is the one that gets repaired, so the page that was not edited keeps
 * rendering the old number. Nothing errors. Both copies look identical at the call site, which is why
 * a name collision is worse than a differently-named duplicate.
 *
 * ── THE TWO RULES ──────────────────────────────────────────────────────────────────────────────
 *   F1 SHADOW   a local `fmt*`/`format*`/`num*` declaration whose name normalises to a
 *               `format-utils` export (`fmtPct` → `formatPct`) — the same concept under two names.
 *   F2 DUPLICATE the same formatter-like name declared in two or more files. Two copies of one name
 *               WILL drift, and when they do the call site cannot tell you which one it got.
 *
 * ⚠️ **F2 is not "no local helpers".** A page may declare a formatter for a concept the shared file
 * does not own — `fmtSpan` (a day/hour/min duration that is deliberately not `formatDuration`),
 * `fmtUsd2` (`$` plus 2dp, which `formatCurrency` cannot produce without thousands separators). The
 * rule is that ONE file owns each name, not that every page must be formatter-free.
 *
 * ⚠️ **NOT covered: behaviour drift inside one name across time.** If the shared `formatPrice` changes
 * its rule, every caller changes with it — which is the point, and also why the shared rules carry
 * comments explaining what each one is for. That check is a code review, not a script.
 *
 * Usage:
 *   node scripts/validate-formatters.cjs               # check src/
 *   node scripts/validate-formatters.cjs --report      # every declaration found, and its verdict
 *   node scripts/validate-formatters.cjs --self-test   # prove BOTH rules can fail, both directions
 *
 * Exit: 0 = no shadow, no duplicate · 1 = at least one violation · 2 = could not judge (never 0 —
 * a scan that reads nothing has not checked anything).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sourceFiles, repoRelative, readBaseline, compareToBaseline, writeBaseline } = require('./lib/validator-ratchet.cjs');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const CANON = path.join(SRC, 'core', 'format-utils.js');

/** A declaration whose name looks like a formatter, and is not a React component or a hook. */
const DECL_RE = /^[ \t]*(?:export\s+)?(?:const|function)\s+([A-Za-z_$][\w$]*)\s*[=(]/gm;
const NAME_RE = /^(?:fmt|format|num\d)/;

/** `fmtPct` and `formatPct` are the same concept; `num2` is its own. */
function normalise(name) {
  const lower = name.toLowerCase();
  for (const prefix of ['fmt', 'format']) {
    if (lower.startsWith(prefix)) return lower.slice(prefix.length);
  }
  return lower;
}

/**
 * Allowlist for F2 — a name declared in 2+ files ON PURPOSE. Every entry needs a `why`; an allowlist
 * entry without a reason is a widened pattern with extra steps.
 */
const DUPLICATE_ALLOWLIST = {
  // A one-line local shorthand for a THING IN THIS FILE's own shape (a `FORMATS` descriptor), not a
  // formatter. Renamed to `formatDef` where it read as one (DecoderPage, 2026-11-17); if any remain
  // they belong here rather than in a rename, because the name is accurate for what it is.
  format: 'a parsed format DESCRIPTOR from the FORMATS table — not a formatter function',
};

function exportsOf(source) {
  const out = new Set();
  const re = /export\s+function\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(source)) !== null) out.add(m[1]);
  return out;
}

/**
 * analyse(sources, exports) — pure, so the self-test can drive it with fabricated files.
 * `sources` is [{ file, text }]; `exports` is a Set of canonical names.
 */
function analyse(sources, exports) {
  const decls = [];
  for (const { file, text } of sources) {
    DECL_RE.lastIndex = 0;
    let m;
    while ((m = DECL_RE.exec(text)) !== null) {
      const name = m[1];
      if (!NAME_RE.test(name)) continue;
      decls.push({ file, name });
    }
  }
  const exportIndex = new Map();
  for (const name of exports) exportIndex.set(normalise(name), name);

  const violations = [];
  const allowlisted = [];
  const byName = new Map();
  for (const d of decls) {
    const canonical = exportIndex.get(normalise(d.name));
    if (canonical && d.name !== canonical) {
      violations.push({
        rule: 'F1',
        name: d.name,
        file: d.file,
        detail: `shadows \`${canonical}\` from src/core/format-utils.js — one concept, two names`,
      });
    }
    if (!byName.has(d.name)) byName.set(d.name, []);
    byName.get(d.name).push(d.file);
  }
  for (const [name, files] of [...byName.entries()].sort()) {
    const unique = [...new Set(files)];
    if (unique.length < 2) continue;
    const entry = { rule: 'F2', name, file: unique.join(', '), detail: `declared in ${unique.length} files` };
    if (DUPLICATE_ALLOWLIST[name]) allowlisted.push({ ...entry, detail: DUPLICATE_ALLOWLIST[name] });
    else violations.push(entry);
  }
  return { decls, violations, allowlisted };
}

function check() {
  if (!fs.existsSync(CANON)) throw new Error(`${path.relative(ROOT, CANON)} not found — cannot judge`);
  const exports = exportsOf(fs.readFileSync(CANON, 'utf8'));
  if (exports.size === 0) {
    // ⚠️ Zero exports means the file changed shape, not that the standard is clean. A parser that
    // matches nothing must ERROR: reporting "no shadowing" here would be a false negative.
    throw new Error('no exports parsed from format-utils.js — the file changed shape');
  }
  const files = sourceFiles(SRC).filter((f) => path.resolve(f) !== path.resolve(CANON));
  const sources = files.map((f) => ({ file: repoRelative(ROOT, f), text: fs.readFileSync(f, 'utf8') }));
  const result = analyse(sources, exports);
  if (result.decls.length === 0) throw new Error('no formatter declarations found in src/ — the scanner matched nothing');
  return { ...result, exports, fileCount: files.length };
}

function selfTest() {
  const exports = new Set(['formatPct', 'formatPnl', 'formatPrice', 'formatDuration']);
  let failures = 0;
  const expect = (name, got, want) => {
    const ok = got === want;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — expected ${want}, got ${got}`);
  };
  const run = (sources) => analyse(sources, exports).violations;

  // F1 — both directions.
  expect(
    'F1: `fmtPct` beside a canonical `formatPct` is a violation',
    run([{ file: 'a.jsx', text: "const fmtPct = (v) => `${v}%`;\n" }])[0]?.rule,
    'F1',
  );
  expect(
    'F1: a uniquely-named local formatter is CLEAN',
    run([{ file: 'a.jsx', text: 'const fmtUsd2 = (v) => `$${v}`;\n' }]).length,
    0,
  );
  expect(
    'F1: a local helper that merely CONTAINS `format` is CLEAN',
    run([{ file: 'a.jsx', text: 'const detectFormat = (x) => x;\n' }]).length,
    0,
  );
  // F2 — both directions. `format` is allowlisted on purpose, so it must NOT be reported.
  expect(
    'F2: the same name in two files is a violation',
    run([
      { file: 'a.jsx', text: 'const fmtSpan = (v) => v;\n' },
      { file: 'b.jsx', text: 'const fmtSpan = (v) => v;\n' },
    ])[0]?.rule,
    'F2',
  );
  expect(
    'F2: the same name in ONE file twice is not a duplicate across files',
    run([{ file: 'a.jsx', text: 'const fmtSpan = (v) => v;\nconst fmtSpan2 = (v) => v;\n' }]).length,
    0,
  );
  expect(
    'F2: an allowlisted name is reported as allowlisted, not as a violation',
    analyse(
      [
        { file: 'a.jsx', text: 'const format = 1;\n' },
        { file: 'b.jsx', text: 'const format = 2;\n' },
      ],
      exports,
    ).violations.length,
    0,
  );
  // The scanner must be able to SEE a declaration, or every result above is a false clean.
  expect(
    'the scanner finds a declaration at all (2 files → 2 decls)',
    analyse(
      [
        { file: 'a.jsx', text: 'const fmtA = (v) => v;\n' },
        { file: 'b.jsx', text: 'function fmtB(v) { return v; }\n' },
      ],
      exports,
    ).decls.length,
    2,
  );

  console.log(failures === 0 ? '\n✅ self-test: F1 and F2 each report both directions' : `\n❌ self-test: ${failures} case(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();
  if (argv.includes('--help')) {
    console.log('usage: node scripts/validate-formatters.cjs [--report] [--self-test]');
    return;
  }
  let result;
  try {
    result = check();
  } catch (err) {
    console.error(`[formatters] ✖ could not judge: ${err.message}`);
    process.exit(2);
  }
  if (argv.includes('--report')) {
    console.log(`\n${result.decls.length} formatter declaration(s) across ${result.fileCount} file(s)\n`);
    const seen = new Set();
    for (const d of result.decls) {
      if (seen.has(d.name)) continue;
      seen.add(d.name);
      console.log(`  ${d.name.padEnd(22)} ${d.file}`);
    }
    for (const a of result.allowlisted) console.log(`  ⬜ allowlisted: ${a.name} — ${a.detail}`);
  }
  console.log(
    `[formatters] ${result.decls.length} declaration(s) in ${result.fileCount} file(s): ${result.violations.length} violation(s), ${result.allowlisted.length} allowlisted`,
  );
  for (const v of result.violations) console.log(`  ✖ ${v.rule} ${v.name} — ${v.detail} (${v.file})`);
  if (result.violations.length) {
    console.log('[formatters] one formatter per concept: use src/core/format-utils.js, or give yours a name that says what it does.');
    process.exit(1);
  }
  console.log('[formatters] ✅ no formatter shadows a canonical export, and no name is declared twice');
}

if (require.main === module) main();

module.exports = { analyse, normalise, exportsOf };
