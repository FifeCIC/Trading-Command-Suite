#!/usr/bin/env node
/**
 * validate-free-bundle.cjs — post-build assertion for the editions (FREE-EDITION-PLAN.md §3).
 *
 *   node scripts/validate-free-bundle.cjs <dist-dir> --mode free   # premium page code must be ABSENT
 *   node scripts/validate-free-bundle.cjs <dist-dir> --mode full   # premium page code must be PRESENT
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
const META_FILE = path.join(ROOT, 'src', 'core', 'view-meta.js');

const distArg = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== 'free' && a !== 'full');
const modeArg =
  process.argv.find((a) => a.startsWith('--mode='))?.slice('--mode='.length) ??
  (process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'free');
const mode = modeArg === 'full' ? 'full' : 'free';
if (!distArg) {
  console.error('usage: node scripts/validate-free-bundle.cjs <dist-dir> --mode free|full');
  process.exit(2);
}
const DIST = path.resolve(ROOT, distArg);
const ASSETS = path.join(DIST, 'assets');

/** Evaluate the shipped ESM view-meta source. */
function loadViewMeta() {
  const src = fs
    .readFileSync(META_FILE, 'utf8')
    .replace(/^export\s+default\s+/gm, 'const __defaultExport = ')
    .replace(/^export\s+/gm, '');
  const factory = new Function(`${src}\nreturn { VIEW_META };`);
  const { VIEW_META } = factory();
  if (!VIEW_META || typeof VIEW_META !== 'object') throw new Error('VIEW_META not exposed');
  return VIEW_META;
}

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

for (const f of failures) console.error(`✗ ${f}`);
if (failures.length) {
  console.error(`\nvalidate-free-bundle (${mode}): ${failures.length} failure(s) across ${shipped.size} bundled modules.`);
  process.exit(1);
}
console.log(
  `validate-free-bundle (${mode}): OK — ${shipped.size} bundled modules; ` +
    `${freeFiles.size} free page file(s), ${premiumFiles.size} premium page file(s) ${mode === 'free' ? 'absent' : 'present'}.`,
);
