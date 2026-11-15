#!/usr/bin/env node
/**
 * validate-css-imports.cjs — a stylesheet nothing loads is a page that renders unstyled
 * =======================================================================================
 * THE DEFECT THIS CLOSES, measured 2026-11-14. `Mt5StatusPage.jsx` applies **34** `mt5-*` class
 * names. They were defined only in `src/pages/mt5-status.css` — which **nothing imported**: no JS
 * import, no CSS `@import`. The page is a REGISTERED view (`view-routes.jsx` → `'mt5-status'`), so it
 * is reachable by URL, and it rendered with no styling at all. Verified by measurement, not inference:
 * `.mt5-status-hero` was **absent from `dist/assets/index-*.css`** while the page was routable.
 *
 * ⚠️ WHY NO EXISTING CHECK CAUGHT IT. `audit-code-health.cjs` asks "is this FILE named anywhere?" — and
 * `mt5-status.css` was named nowhere, so it appeared in no list that a reader was looking at. The
 * question that matters for a stylesheet is different: *does anything LOAD it?* A file can be
 * unreferenced and harmless (an unused script) or unreferenced and a live defect (a stylesheet whose
 * classes are in the DOM), and only the second is a broken page.
 *
 * ⚠️ AND IT MUST FOLLOW `@import`. Two of this repo's stylesheets are reached ONLY through
 * `src/index.css` → `@import './pages/inline-fixes.css'`. A check that looked only at JS imports
 * reported `inline-fixes.css` as dead — which was MY error while investigating this, and it nearly
 * caused a live stylesheet to be deleted. The fix was a live page; the causality matters.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 * A `src/**\/*.css` file is REACHABLE when:
 *   • a `.js/.jsx/.ts/.tsx` file imports it by name, OR
 *   • a REACHABLE `.css` file `@import`s it (transitively — the chain is the point).
 * Otherwise it is unreachable, and the build fails naming it.
 *
 *   node scripts/validate-css-imports.cjs              # --check (the prebuild form)
 *   node scripts/validate-css-imports.cjs --self-test  # prove every direction
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const JS_EXT = /\.(js|jsx|ts|tsx)$/;
const ENTRY = path.join(SRC, 'main.jsx');

/**
 * Stylesheets that are legitimately unloaded. ⚠️ AN ENTRY NEEDS A NAMED REASON — an allowlist without
 * one is a widened pattern with extra steps, and a guard that over-fires gets allowlisted and then
 * covers nothing.
 */
const ALLOW = new Map([]);

function listFiles(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') listFiles(p, ext, out);
    } else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * RESOLVED paths, not basenames.
 *
 * ⚠️ Two stylesheets in different folders can share a name, and an `@import` is relative to the
 * IMPORTING file's directory — so flattening to a basename would both collide files and mis-resolve
 * the chain. The first cut of this script did exactly that, and its own self-test caught it.
 */
function cssSpecifiersInJs(text, fromFile) {
  const out = new Set();
  const add = (spec) => out.add(path.resolve(path.dirname(fromFile), spec));
  for (const m of text.matchAll(/from\s+['"]([^'"]+\.css)['"]/g)) add(m[1]);
  for (const m of text.matchAll(/^\s*import\s+['"]([^'"]+\.css)['"]/gm)) add(m[1]);
  return out;
}

/** Specifiers a CSS file `@import`s, resolved against that file's own directory. */
function cssSpecifiersInCss(text, fromFile) {
  const out = new Set();
  for (const m of text.matchAll(/@import\s+(?:url\()?['"]([^'"]+\.css)['"]/g)) {
    out.add(path.resolve(path.dirname(fromFile), m[1]));
  }
  return out;
}

/**
 * Which stylesheets actually load. Returns { reachable: Set<resolvedPath>, byJs: Set<resolvedPath> }.
 */
function reachableCss({ cssFiles, jsFiles, read }) {
  const known = new Set(cssFiles);

  const byJs = new Set();
  for (const f of jsFiles) {
    for (const target of cssSpecifiersInJs(read(f), f)) if (known.has(target)) byJs.add(target);
  }

  // Fixpoint: a stylesheet @imported by a REACHABLE stylesheet is reachable. An @import inside an
  // unreachable sheet proves nothing — the chain has to start somewhere that loads.
  const reachable = new Set(byJs);
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of [...reachable]) {
      for (const dep of cssSpecifiersInCss(read(file), file)) {
        if (known.has(dep) && !reachable.has(dep)) {
          reachable.add(dep);
          changed = true;
        }
      }
    }
  }
  return { reachable, byJs };
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────

function selfTest() {
  const cases = [];
  const check = (name, ok, detail) => cases.push({ name, ok: !!ok, detail });

  // Keys are paths RELATIVE to a fake root, resolved through `path` so the harness matches what the
  // real run does on Windows (`/x/a.css` alone is drive-relative and would not compare equal to a
  // resolved path — the first cut of this test failed for exactly that reason).
  const ROOT_FAKE = path.resolve('/x');
  const build = (jsTexts, cssTexts) => {
    const rel = (p) => path.relative(ROOT_FAKE, p).split(path.sep).join('/');
    const jsFiles = Object.keys(jsTexts).map((n) => path.join(ROOT_FAKE, n));
    const cssFiles = Object.keys(cssTexts).map((n) => path.join(ROOT_FAKE, n));
    const read = (p) => jsTexts[rel(p)] ?? cssTexts[rel(p)] ?? '';
    const r = reachableCss({ cssFiles, jsFiles, read });
    return {
      reachable: new Set([...r.reachable].map(rel)),
      byJs: new Set([...r.byJs].map(rel)),
      cssFiles,
    };
  };

  // 1 — imported by JS: reachable.
  let r = build({ 'a.jsx': "import './direct.css';" }, { 'direct.css': '' });
  check('a stylesheet imported by a JS file is reachable', r.reachable.has('direct.css'), [...r.reachable].join(','));
  check('…and it is attributed to JS, not to an @import', r.byJs.has('direct.css'));

  // 2 — reached ONLY through a CSS @import chain (the `inline-fixes.css` case).
  r = build(
    { 'a.jsx': "import './index.css';" },
    { 'index.css': "@import './pages/util.css';", 'pages/util.css': '' },
  );
  check('a stylesheet reached only through @import IS reachable', r.reachable.has('pages/util.css'), [...r.reachable].join(','));

  // 3 — the chain must be REACHABLE, not merely present: an @import from a dead sheet does not count.
  r = build(
    { 'a.jsx': "import './index.css';" },
    { 'index.css': '', 'dead.css': "@import './orphan.css';", 'orphan.css': '' },
  );
  check('@import from an UNREACHABLE sheet does not make its target reachable', !r.reachable.has('orphan.css'), [...r.reachable].join(','));

  // 4 — the defect itself: nothing loads it.
  r = build({ 'a.jsx': "import './index.css';" }, { 'index.css': '', 'nobody.css': '.x{color:red}' });
  check('a stylesheet nothing loads is reported', !r.reachable.has('nobody.css'));

  // 5 — nested chain three deep, the shape `index.css → a.css → b.css` takes.
  r = build(
    { 'a.jsx': "import './one.css';" },
    { 'one.css': "@import './two.css';", 'two.css': "@import './three.css';", 'three.css': '' },
  );
  check('a three-deep @import chain is fully reachable', ['two.css', 'three.css'].every((n) => r.reachable.has(n)), [...r.reachable].join(','));

  // 6 — a named import binding (`import s from './x.css'`) counts, not just a bare side-effect import.
  r = build({ 'a.jsx': "import styles from './bound.css';" }, { 'bound.css': '' });
  check('a default-import binding counts as loading the sheet', r.reachable.has('bound.css'));

  const failed = cases.filter((c) => !c.ok);
  for (const c of cases) console.log(`  ${c.ok ? '✅' : '✖ '} ${c.name}${c.ok ? '' : `  <-- ${c.detail}`}`);
  if (failed.length > 0) {
    console.error(`\n[css-imports] ✖ SELF-TEST FAILED — ${failed.length} of ${cases.length}`);
    process.exit(1);
  }
  console.log(`\n[css-imports] ✅ self-test: ${cases.length} cases — JS imports, @import chains, dead-chain exclusion, and the unreachable case.`);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

if (!fs.existsSync(ENTRY)) {
  // ⚠️ An empty scan must ERROR, never pass: "found no stylesheets" and "found no problems" are
  // different answers, and this repo treats collapsing them as the expensive defect.
  console.error(`[css-imports] ✖ cannot judge — entry not found at ${ENTRY}`);
  process.exit(2);
}

const cssFiles = listFiles(SRC, /\.css$/);
const jsFiles = listFiles(SRC, JS_EXT);
const read = (p) => fs.readFileSync(p, 'utf8');
const { reachable } = reachableCss({ cssFiles, jsFiles, read });

const unreachable = cssFiles
  .filter((f) => !reachable.has(f))
  .filter((f) => !ALLOW.has(path.basename(f)))
  .map((f) => path.relative(SRC, f).split(path.sep).join('/'));

if (unreachable.length > 0) {
  console.error(
    `\n[css-imports] ✖ ${unreachable.length} stylesheet(s) are loaded by nothing:\n` +
      unreachable.map((n) => `    ${n}`).join('\n') +
      '\n\n  A stylesheet with no loader is either dead, or a page rendering UNSTYLED — the second is' +
      '\n  invisible in the source and absent from the bundle. Measured 2026-11-14: `mt5-status.css`' +
      '\n  defined 34 classes that a registered page applied, and nothing imported it.' +
      '\n\n  Fix: import it from the page that uses it, or delete it. To keep it deliberately,' +
      '\n  add an ALLOW entry WITH A REASON in scripts/validate-css-imports.cjs.',
  );
  process.exit(1);
}

console.log(
  `[css-imports] ✅ OK — ${cssFiles.length} stylesheet(s), all loaded` +
    (ALLOW.size ? ` (${ALLOW.size} deliberately unloaded, each with a reason)` : ''),
);
