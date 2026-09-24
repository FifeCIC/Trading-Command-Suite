#!/usr/bin/env node
/**
 * validate-free-bundle.cjs — post-build assertion for the editions (FREE-EDITION-PLAN.md §3).
 *
 *   node scripts/validate-free-bundle.cjs <dist-dir> --mode free   # premium page code must be ABSENT
 *   node scripts/validate-free-bundle.cjs <dist-dir> --mode full   # premium page code must be PRESENT
 *
 *   Add --strict to make the remaining premium NAME references a hard failure. The release
 *   publisher uses it; a plain run reports them instead (see the note at the name check).
 *
 * The build must have been produced with `--sourcemap`. This reads every `.map` under
 * `<dist-dir>/assets`, unions its `sources`, and compares the REAL module list against the
 * tier state in `src/core/view-meta.js`. It asserts on code that shipped — not on intent.
 *
 * Both directions exist on purpose: `--mode full` is the canary that proves this checker
 * SEES premium modules when they are present, so a green `--mode free` run cannot be a blind
 * pass. (Guard rule: a guard never observed to fail is a decoration.)
 *
 * Shared files (one page file backing several view ids — e.g. Mt5TradingPage for mt5-trading
 * and mt5-demo-trading) count as free when ANY referencing view is free.
 */
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
// The tier truth is read through ONE loader, shared with the generators — see
// scripts/lib/view-meta-loader.cjs (the duplication gate flagged four copies of this trick).
const { loadViewMeta } = require('./lib/view-meta-loader.cjs');

const distArg = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== 'free' && a !== 'full');
const modeArg =
  process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ??
  (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'free');
const mode = modeArg === 'full' ? 'full' : 'free';
const STRICT = process.argv.includes('--strict');
if (!distArg) {
  console.error('usage: node scripts/validate-free-bundle.cjs <dist-dir> --mode free|full');
  process.exit(2);
}
const DIST = path.resolve(ROOT, distArg);
const ASSETS = path.join(DIST, 'assets');

function bundleModules() {
  if (!fs.existsSync(ASSETS)) {
    console.error(`✗ ${path.relative(ROOT, ASSETS)} not found — build with --sourcemap first.`);
    process.exit(2);
  }
  const maps = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.map'));
  if (maps.length === 0) {
    console.error(`✗ no .map files in ${path.relative(ROOT, ASSETS)} — build with --sourcemap first.`);
    process.exit(2);
  }
  const sources = new Set();
  for (const f of maps) {
    const j = JSON.parse(fs.readFileSync(path.join(ASSETS, f), 'utf8'));
    for (const s of j.sources || []) sources.add(String(s).replace(/\\/g, '/'));
  }
  return sources;
}

const meta = loadViewMeta();
const freeFiles = new Set();
const premiumFiles = new Set();
for (const entry of Object.values(meta)) {
  if (!entry.file || !entry.file.startsWith('src/pages/')) continue;
  if (entry.tier === 'free') freeFiles.add(entry.file);
  else premiumFiles.add(entry.file);
}
for (const f of freeFiles) premiumFiles.delete(f); // shared file → ships, counts as free

const shipped = bundleModules();
const has = (f) => [...shipped].some((s) => s.endsWith(`/${f}`) || s === f);

const failures = [];
if (mode === 'free') {
  for (const f of premiumFiles) {
    if (has(f)) failures.push(`PREMIUM SHIPPED: ${f}`);
  }
  for (const f of freeFiles) {
    if (!has(f)) failures.push(`FREE MISSING: ${f} — a free view would render nothing`);
  }
} else {
  for (const f of premiumFiles) {
    if (!has(f)) failures.push(`PREMIUM MISSING from full build: ${f}`);
  }
  for (const f of freeFiles) {
    if (!has(f)) failures.push(`FREE MISSING from full build: ${f}`);
  }
}

// ── The MAP must not ship (2026-09-23) ───────────────────────────────────────────────────────
//
// Page code being absent is NOT enough. These modules ENUMERATE the app, so any one of them that
// reaches the bundle publishes the map: nav-tree (every premium id + human label), view-meta (every
// premium label + its SOURCE FILE PATH + its API endpoints), view-explanations (prose describing the
// scoring method). The free build swaps each for a generated filtered copy
// (scripts/generate-free-map.cjs).
//
// Asserted against the bundle's REAL module list, not "the alias exists": an alias that misses one
// importer fails silently, which is exactly how this defect appeared the first time. Measured before
// the fix: all 95 premium paths were present as string literals in dist-free/assets/index-*.js.
const MAP_MODULES = [
  { full: 'src/core/nav-tree.js', free: 'src/editions/nav-tree.free.js' },
  { full: 'src/core/view-meta.js', free: 'src/editions/view-meta.free.js' },
  { full: 'src/core/view-explanations.js', free: 'src/editions/view-explanations.free.js' },
  // Added 2026-09-24 (strip pass) — registries keyed by view id, which leak premium page titles.
  { full: 'src/components/ScreenOptions.jsx', free: 'src/editions/screen-options.free.jsx' },
  { full: 'src/pages/plugin-tab-skeletons.js', free: 'src/editions/plugin-tab-skeletons.free.js' },
];
for (const { full, free } of MAP_MODULES) {
  if (mode === 'free') {
    if (has(full)) {
      failures.push(`MAP SHIPPED: ${full} reached the free bundle — the app map is published (swap it for ${free})`);
    }
    if (!has(free)) {
      failures.push(`MAP FILTER MISSING: ${free} is not in the free bundle — the alias did not match, so the unfiltered module is probably in there via another specifier`);
    }
  } else if (!has(full)) {
    failures.push(`MAP MISSING from full build: ${full}`);
  }
}

// Premium view KEYS as shipped string literals — catches the class for any file, not just the one
// that leaked (a generated manifest carried the full premium path list into the free bundle).
const appJs = fs
  .readdirSync(ASSETS)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.map'))
  .map((f) => fs.readFileSync(path.join(ASSETS, f), 'utf8'))
  .join('\n');
const premiumKeys = Object.entries(meta)
  .filter(([, e]) => e.tier !== 'free')
  .map(([k]) => k);
const leakedKeys = premiumKeys.filter((k) => appJs.includes(JSON.stringify(k)) || appJs.includes(`'${k}'`));
if (mode === 'free' && leakedKeys.length) {
  failures.push(
    `PREMIUM PATHS SHIPPED: ${leakedKeys.length} premium route(s) appear as string literals in the free bundle, e.g. ${leakedKeys.slice(0, 3).join(', ')}`,
  );
}
if (mode === 'full' && leakedKeys.length !== premiumKeys.length) {
  // Canary direction: if the checker cannot see them when they ARE present, a green free run means
  // nothing. (Guard rule: a guard never observed to fail is a decoration.)
  failures.push(
    `CHECKER BLIND: found only ${leakedKeys.length}/${premiumKeys.length} premium paths in the FULL build — this check could not detect a free-bundle leak`,
  );
}

// ── REGISTRY DETECTOR: a module that enumerates the app ─────────────────────────────────────
//
// Premium route PATHS are the hard evidence, but a registry keyed by VIEW ID (ScreenOptions) leaks
// the same map in prose — measured 2026-09-23: 26 premium-only labels in the free bundle, none of
// them a path.
//
// TWO narrowings, both learned by over-firing first (a guard that over-fires gets allowlisted, and
// an allowlisted guard is worse than none):
//
//   1. MULTI-WORD labels only. A single common English word is not a map: 'Signals', 'Strategies',
//      'Timeline', 'Architecture', 'CFD' appear innocently in free pages, notice text and the
//      education glossary. A two-word product name ('Symbols Ladder', 'Decision Trail') is a name.
//   2. The SHIPPED app JS only — not sourcemap `sourcesContent`. Comments are stripped by the
//      minifier, so a comment mentioning a premium view does not leak; counting them flagged
//      src/core/signal-utils.js for a doc block that never ships.
const freeLabels = new Set(
  Object.values(meta)
    .filter((e) => e.tier === 'free')
    .map((e) => e.label),
);
const premiumNameLabels = [
  ...new Set(
    Object.values(meta)
      .filter((e) => e.tier !== 'free')
      .map((e) => e.label),
  ),
].filter((l) => !freeLabels.has(l) && l.trim().includes(' '));

const leakedLabels = premiumNameLabels.filter((l) => appJs.includes(l));
// HARD failure only under --strict (the release gate); a plain run REPORTS it. This is deliberate:
// the remaining names are single references inside free pages and two view-option registries that
// get their free variants in the §9.14 strip pass, so failing every run would train the reader to
// ignore a red guard. Nothing is hidden — the line below names the count, and the publisher
// (scripts/publish-free-release.cjs) runs --strict, so it can never ship.
if (mode === 'free' && leakedLabels.length) {
  const msg =
    `${leakedLabels.length} premium-only view name(s) still reachable in the free bundle ` +
    `(e.g. ${leakedLabels.slice(0, 3).join(', ')}) — §9.14 strip pass`;
  if (STRICT) failures.push(`PREMIUM NAMES SHIPPED: ${msg}`);
  else console.warn(`⚠ ${msg}`);
}
if (mode === 'full' && leakedLabels.length === 0) {
  failures.push(
    'CHECKER BLIND: no premium-only view name found in the FULL build — this check could not detect one in the free bundle either',
  );
}

for (const f of failures) console.error(`✗ ${f}`);
if (failures.length) {
  console.error(`\nvalidate-free-bundle (${mode}): ${failures.length} failure(s) across ${shipped.size} bundled modules.`);
  process.exit(1);
}
console.log(
  `validate-free-bundle (${mode}): OK — ${shipped.size} bundled modules; ` +
    `${freeFiles.size} free page file(s), ${premiumFiles.size} premium page file(s) ${mode === 'free' ? 'absent' : 'present'}; ` +
    `${MAP_MODULES.length} map module(s) ${mode === 'free' ? 'filtered' : 'present'}, ` +
    `${leakedKeys.length}/${premiumKeys.length} premium path(s) visible ${mode === 'free' ? '(expected 0)' : '(expected all)'}, ` +
    `${leakedLabels.length} premium name(s) ${mode === 'free' ? `reachable${STRICT ? '' : ' (reported, not enforced)'}` : 'visible'}.`,
);
