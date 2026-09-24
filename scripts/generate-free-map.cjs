#!/usr/bin/env node
/**
 * generate-free-map.cjs — the free edition must not ship the MAP of the app.
 *
 *   node scripts/generate-free-map.cjs          # write src/editions/*.free.js
 *   node scripts/generate-free-map.cjs --check  # exit 1 if any generated file is stale
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 1b removed premium PAGE CODE from the free bundle. It did not remove the *map*, and the map
 * is what tells a reader what the app is and how it is built. Measured 2026-09-23 against the free
 * build (`node scripts/validate-free-bundle.cjs` — see the report at the bottom of this file):
 *
 *   src/core/nav-tree.js            the whole nav tree — every premium id + human label
 *   src/core/view-meta.js           every premium label + its SOURCE FILE PATH + its API endpoints
 *   src/core/view-explanations.js   prose describing the scoring method ("Composite % = percentage
 *                                   of max possible score", "protocol's directional bias", ...)
 *   src/editions/free.manifest.js   `premiumViews: [...95 paths...]`
 *
 * All four were in the free bundle's module list, and the shipped JS contained the premium paths as
 * string literals. FREE-EDITION-PLAN.md §11.1 says never-free views ship "no pages, no data, no code";
 * this script is the "no data" half.
 *
 * HOW IT WORKS — generated, never hand-kept
 * -----------------------------------------
 * The tier in `src/core/view-meta.js` is the single source of truth (as for the manifest and the
 * route registry). For each map module the script:
 *   1. evaluates the real declaration and reads its data,
 *   2. keeps only entries the free edition is allowed to know about,
 *   3. emits a file containing the filtered data plus the ORIGINAL TAIL VERBATIM, so the accessor
 *      functions live in exactly one place and cannot drift.
 * `--check` re-generates and compares, so an edit to a source tail that was not regenerated fails
 * the build instead of shipping stale logic.
 *
 * A miss is NOT silent: `scripts/validate-free-bundle.cjs` fails if any unfiltered map module
 * reaches the bundle's source list, or if a premium path appears in the shipped JS.
 */
const path = require('node:path');
const fs = require('node:fs');
const { ROOT, loadViewMeta } = require('./lib/view-meta-loader.cjs');

const CHECK = process.argv.includes('--check');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Split a module into the declaration we filter and the verbatim tail that follows it. */
function splitDeclaration(src, marker) {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`declaration not found in source: ${marker}`);
  // Top-level declarations close with `};` at column 0 — but NOT always with the semicolon:
  // plugin-tab-skeletons.js ends its object literal with a bare `}`. Requiring `\n};` threw
  // "end of declaration not found" on a file that was perfectly well-formed.
  const re = /^\};?[ \t]*\r?$/gm;
  re.lastIndex = start;
  const m = re.exec(src);
  if (!m) throw new Error(`end of declaration not found for: ${marker}`);
  return { head: src.slice(start, m.index + m[0].length), tail: src.slice(m.index + m[0].length) };
}

/** Evaluate a plain object-literal declaration (no imports, no calls) and return its value. */
function evaluate(head, binding) {
  const src = head.replace(/^export\s+/, '');
  return new Function(`${src}\nreturn ${binding};`)();
}

/**
 * Evaluate a declaration whose VALUES reference module-scope helpers.
 *
 * `OPTIONS_REGISTRY` is not pure data: one entry builds its options with
 * `SB_OPTIONAL_COLUMNS.map(...)`. Evaluating the block alone threw ReferenceError, so the helpers are
 * supplied from the module that defines them. Add to `ctx` as needed rather than inlining a copy of
 * the referenced list — a copy would be the duplication this repo keeps banning.
 */
function evaluateWith(head, binding, ctx) {
  const src = head.replace(/^export\s+/, '');
  const names = Object.keys(ctx);
  const factory = new Function(...names, `${src}\nreturn ${binding};`);
  return factory(...names.map((n) => ctx[n]));
}

/** Evaluate `src/core/view-meta.js` and return the real VIEW_META binding. */
// (loadViewMeta comes from scripts/lib/view-meta-loader.cjs — one implementation for every script
// that needs the tier truth, rather than a fourth copy of the strip-exports trick.)

/** Deterministic JS literal. Bare keys stay bare; others are quoted. */
function literal(value, indent = 0) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((v) => padIn + literal(v, indent + 1)).join(',\n')},\n${pad}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const body = keys
      .map((k) => {
        const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
        return `${padIn}${key}: ${literal(value[k], indent + 1)}`;
      })
      .join(',\n');
    return `{\n${body},\n${pad}}`;
  }
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

const HEADER = (what, source, counts) => `/**
 * ${what} — GENERATED FILE, DO NOT EDIT.
 *
 * Filtered copy of \`${source}\` for the free edition.
 * Regenerate with: node scripts/generate-free-map.cjs
 * Check freshness:  node scripts/generate-free-map.cjs --check
 *
 * ${counts}
 * Plan: Trading-Command-Suite-Documentation/commercial/FREE-EDITION-PLAN.md (§3, §11.1)
 */
`;

// ── nav-tree ─────────────────────────────────────────────────────────────────────────────────
const navSrc = read('src/core/nav-tree.js');
const navSplit = splitDeclaration(navSrc, 'export const NAV_TREE = {');
const navTree = evaluate(navSplit.head, 'NAV_TREE');

function filterNavTree(tree, freePaths) {
  const out = {};
  for (const [areaId, area] of Object.entries(tree)) {
    const kept = (area.views || []).filter(
      (v) => v.kind === 'section-header' || freePaths.has(`/${areaId}/${v.id}`),
    );
    // Same rule as src/core/edition-nav.js filterViews(): a section header survives only if a real
    // view follows it; an area survives only if it still has one. Kept identical so the runtime
    // filter (which still runs) is an idempotent no-op on the filtered tree.
    const cleaned = kept.filter(
      (v, i) => v.kind !== 'section-header' || kept.slice(i + 1).some((x) => x.kind !== 'section-header'),
    );
    if (cleaned.some((v) => v.kind !== 'section-header')) out[areaId] = { ...area, views: cleaned };
  }
  return out;
}

// ── view-meta ────────────────────────────────────────────────────────────────────────────────
const metaSrc = read('src/core/view-meta.js');
// NOTE: the declaration is `const VIEW_META = {` (exported via `export default` at the end), so the
// marker has no `export` keyword. `splitDeclaration` returns the tail verbatim, which holds the
// accessor functions (getViewMetaKey / getViewMeta / formatViewMeta) and the default export.
const metaSplit = splitDeclaration(metaSrc, 'const VIEW_META = {');

// ── the two VIEW-ID REGISTRIES (added 2026-09-24, strip pass) ────────────────────────────────
// A registry keyed by view id leaks the map in PROSE even when no route string ships: it carries the
// premium view's own TITLE. Measured before this: ScreenOptions carried 4 premium-only names and
// plugin-tab-skeletons 2. Both are a pure data declaration followed by code, so the same
// split + verbatim-tail rule applies. ScreenOptions is a component file, hence .jsx on its copy.
// (The declaration splits sit below, beside the import context that feeds the evaluation.)
/**
 * Build a context of every LOCAL binding a module imports, by evaluating each imported module.
 *
 * The registry-style files build their entries from the app's own column/option modules
 * (`SB_OPTIONAL_COLUMNS.map(...)`, `SCR_OPTIONAL_COLUMNS.map(...)`, ...), so evaluating the block
 * alone throws ReferenceError. Supplying them by hand was whack-a-mole — the second identifier
 * appeared only after the first was fixed — so this resolves the whole import list instead. A module
 * that cannot be evaluated (JSX, browser-only code) is REPORTED, not silently skipped: a missing
 * binding should fail as a name, not as a mystery.
 */
function buildImportContext(relPath) {
  const ctx = {};
  const skipped = [];
  const re = /^import\s*\{([^}]+)\}\s*from\s*'([^']+)'/gm;
  for (const m of read(relPath).matchAll(re)) {
    const names = m[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/).pop())
      .filter(Boolean);
    const spec = m[2];
    if (!spec.startsWith('.') || /\.(css|json)$/.test(spec)) continue;
    const target = path.posix.normalize(path.posix.join(path.dirname(relPath), spec));
    const resolved = fs.existsSync(path.join(ROOT, `${target}.js`)) ? `${target}.js` : target;
    try {
      const body = read(resolved)
        .replace(/^export\s+default\s+/gm, 'const __defaultExport = ')
        .replace(/^export\s+/gm, '');
      Object.assign(ctx, new Function(`${body}\nreturn { ${names.join(', ')} };`)());
    } catch {
      skipped.push(resolved);
    }
  }
  return { ctx, skipped };
}
const soSrc = read('src/components/ScreenOptions.jsx');
const soSplit = splitDeclaration(soSrc, 'const OPTIONS_REGISTRY = {');
const soImports = buildImportContext('src/components/ScreenOptions.jsx');
if (soImports.skipped.length) {
  console.warn(`  note: could not evaluate (any binding it defines will be missing): ${soImports.skipped.join(', ')}`);
}
const optionsRegistry = evaluateWith(soSplit.head, 'OPTIONS_REGISTRY', soImports.ctx);

const ptSrc = read('src/pages/plugin-tab-skeletons.js');
const ptSplit = splitDeclaration(ptSrc, 'export const PLUGIN_TAB_SKELETONS = {');
const pluginTabs = evaluate(ptSplit.head, 'PLUGIN_TAB_SKELETONS');

// ── view-explanations ────────────────────────────────────────────────────────────────────────
const expSrc = read('src/core/view-explanations.js');
const expSplit = splitDeclaration(expSrc, 'export const VIEW_EXPLANATIONS = {');
const explanations = evaluate(expSplit.head, 'VIEW_EXPLANATIONS');

// ── build ────────────────────────────────────────────────────────────────────────────────────
const meta = loadViewMeta();
const freePaths = new Set(
  Object.entries(meta).filter(([, e]) => e.tier === 'free').map(([k]) => k),
);
const premiumPaths = Object.entries(meta).filter(([, e]) => e.tier === 'premium').map(([k]) => k);

// Explanation keys are bare view ids (no area prefix), so they are matched by path TAIL. A key with
// no free path behind it is premium and is dropped — reported below rather than dropped silently.
const freeIdTails = new Set([...freePaths].map((p) => p.slice(p.lastIndexOf('/') + 1)));

const freeNavTree = filterNavTree(navTree, freePaths);
const freeMeta = Object.fromEntries(Object.entries(meta).filter(([, e]) => e.tier === 'free'));
const freeExplanations = Object.fromEntries(
  Object.entries(explanations).filter(([id]) => freeIdTails.has(id)),
);

// The registries are keyed by view id, so they filter by id — with a deliberately ASYMMETRIC rule,
// because the two registries are not the same shape:
//   ScreenOptions     — an OPTIONS registry: a key that belongs to a premium view is dead in the free
//                       build (that view cannot render), but an unknown key may be a shared key a
//                       FREE view uses. So drop ONLY premium-view keys.
//   plugin-tab-skeletons — a skeleton per plugin TAB, and a tab only ever renders for its own view,
//                       so keep only keys that are free-view ids (78 -> 16 measured).
// Getting this backwards would either leak names or break a free page, so the asymmetry is stated.
const premiumIdTails = new Set(premiumPaths.map((p) => p.slice(p.lastIndexOf('/') + 1)));
const premiumOnlyIdTails = new Set([...premiumIdTails].filter((id) => !freeIdTails.has(id)));

const freeOptionsRegistry = Object.fromEntries(
  Object.entries(optionsRegistry).filter(([id]) => !premiumOnlyIdTails.has(id)),
);
const freePluginTabs = Object.fromEntries(
  Object.entries(pluginTabs).filter(([id]) => freeIdTails.has(id)),
);

const navViewCount = Object.values(freeNavTree).reduce((n, a) => n + a.views.length, 0);
const fullNavViewCount = Object.values(navTree).reduce((n, a) => n + a.views.length, 0);

const outputs = [
  {
    file: 'src/editions/nav-tree.free.js',
    body:
      HEADER(
        'Free-edition navigation tree',
        'src/core/nav-tree.js',
        `${Object.keys(freeNavTree).length} of ${Object.keys(navTree).length} areas · ` +
          `${navViewCount} of ${fullNavViewCount} nav entries (premium ids AND labels removed)`,
      ) +
      `\nexport const NAV_TREE = ${literal(freeNavTree)};\n${navSplit.tail}`,
  },
  {
    file: 'src/editions/view-meta.free.js',
    body:
      HEADER(
        'Free-edition view metadata',
        'src/core/view-meta.js',
        `${Object.keys(freeMeta).length} of ${Object.keys(meta).length} entries — premium entries carry ` +
          `labels, source file paths and API endpoints, so leaving them in published the map`,
      ) +
      `\nexport const VIEW_META = ${literal(freeMeta)};\n${metaSplit.tail}`,
  },
  {
    file: 'src/editions/view-explanations.free.js',
    body:
      HEADER(
        'Free-edition view explanations',
        'src/core/view-explanations.js',
        `${Object.keys(freeExplanations).length} of ${Object.keys(explanations).length} entries — the ` +
          `removed ones describe the scoring method in prose`,
      ) +
      `\nexport const VIEW_EXPLANATIONS = ${literal(freeExplanations)};\n${expSplit.tail}`,
  },
  {
    file: 'src/editions/screen-options.free.jsx',
    body:
      HEADER(
        'Free-edition view options registry',
        'src/components/ScreenOptions.jsx',
        `${Object.keys(freeOptionsRegistry).length} of ${Object.keys(optionsRegistry).length} keys — ` +
          `premium-view keys dropped (their titles named premium pages), shared keys kept`,
      ) +
      `\nconst OPTIONS_REGISTRY = ${literal(freeOptionsRegistry)};\n${soSplit.tail}`,
  },
  {
    file: 'src/editions/plugin-tab-skeletons.free.js',
    body:
      HEADER(
        'Free-edition plugin tab skeletons',
        'src/pages/plugin-tab-skeletons.js',
        `${Object.keys(freePluginTabs).length} of ${Object.keys(pluginTabs).length} tabs — a tab only ` +
          `renders for its own view, so non-free tabs are dropped`,
      ) +
      `\nexport const PLUGIN_TAB_SKELETONS = ${literal(freePluginTabs)};\n${ptSplit.tail}`,
  },
];

// ── report ───────────────────────────────────────────────────────────────────────────────────
const droppedNavEntries = [];
for (const [areaId, area] of Object.entries(navTree)) {
  for (const v of area.views || []) {
    if (v.kind === 'section-header') continue;
    if (!freePaths.has(`/${areaId}/${v.id}`)) droppedNavEntries.push(`/${areaId}/${v.id}`);
  }
}
const freePathsWithNoNavLeaf = [...freePaths].filter(
  (p) => !Object.entries(freeNavTree).some(([a, area]) => area.views.some((v) => `/${a}/${v.id}` === p)),
);

console.log('free-edition map filter');
console.log(`  view-meta        : ${Object.keys(freeMeta).length} free / ${Object.keys(meta).length} total`);
console.log(`  premium removed  : ${premiumPaths.length} paths (count only — the list must not ship)`);
console.log(`  nav tree         : ${Object.keys(freeNavTree).length}/${Object.keys(navTree).length} areas, ` +
  `${navViewCount}/${fullNavViewCount} entries; ${droppedNavEntries.length} premium entries removed`);
console.log(`  explanations     : ${Object.keys(freeExplanations).length}/${Object.keys(explanations).length} kept`);
console.log(`  free paths that are not nav leaves (expected: detail/root routes, not a gap): ` +
  `${freePathsWithNoNavLeaf.length ? freePathsWithNoNavLeaf.join(' ') : 'none'}`);

// ── write or check ───────────────────────────────────────────────────────────────────────────
let stale = 0;
for (const { file, body } of outputs) {
  const abs = path.join(ROOT, file);
  if (CHECK) {
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
    if (current !== body) {
      console.error(`STALE: ${file} does not match the tier state / source tail.`);
      stale += 1;
    } else {
      console.log(`  fresh            : ${file}`);
    }
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
    console.log(`  wrote            : ${file}`);
  }
}
if (CHECK && stale) {
  console.error(`\n${stale} generated file(s) stale. Run: node scripts/generate-free-map.cjs`);
  process.exit(1);
}
