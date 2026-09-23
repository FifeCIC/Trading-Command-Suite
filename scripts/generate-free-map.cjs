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
  // Top-level declarations close with `};` at column 0. Entries inside are indented, so this is
  // unambiguous for these object literals.
  const end = src.indexOf('\n};', start);
  if (end < 0) throw new Error(`end of declaration not found for: ${marker}`);
  return { head: src.slice(start, end + 3), tail: src.slice(end + 3) };
}

/** Evaluate a plain object-literal declaration (no imports, no calls) and return its value. */
function evaluate(head, binding) {
  const src = head.replace(/^export\s+/, '');
  return new Function(`${src}\nreturn ${binding};`)();
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
