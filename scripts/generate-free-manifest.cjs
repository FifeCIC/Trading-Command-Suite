#!/usr/bin/env node
/**
 * generate-free-manifest.cjs — derives the free-edition manifest from the tier state.
 *
 *   node scripts/generate-free-manifest.cjs          # write src/editions/free.manifest.js
 *   node scripts/generate-free-manifest.cjs --check  # exit 1 if the committed file is stale
 *
 * WHY GENERATED, NOT HAND-WRITTEN
 * -------------------------------
 * A hand-kept manifest is a second list, and this repo has measured where second lists go
 * (944 of 1,621 duplicated windows sat in ONE doc pair). The tier lives in exactly one place —
 * `tier:` on each entry in `src/core/view-meta.js` (FREE-EDITION-PLAN.md §3) — and everything
 * else derives from it. Change a tier there, re-run this script, done.
 *
 * The free manifest is an ALLOW-LIST: only `tier: 'free'` views appear in `freeViews`.
 * Everything else is premium by default, so a new page cannot leak into the free edition
 * by being forgotten — it simply is not in the list until someone says it is.
 */
const path = require('node:path');
const fs = require('node:fs');
const { ROOT, loadViewMeta } = require('./lib/view-meta-loader.cjs');

const OUT_FILE = path.join(ROOT, 'src', 'editions', 'free.manifest.js');

function build() {
  const meta = loadViewMeta();
  const free = [];
  const premium = [];
  for (const [key, entry] of Object.entries(meta)) {
    const tier = entry.tier;
    if (tier !== 'free' && tier !== 'premium') {
      throw new Error(`entry '${key}' has invalid tier: ${JSON.stringify(tier)}`);
    }
    (tier === 'free' ? free : premium).push(key);
  }
  free.sort();
  premium.sort();

  const body = `/**
 * FREE EDITION MANIFEST — GENERATED FILE, DO NOT EDIT.
 *
 * Source of truth: the \`tier\` field on each entry in \`src/core/view-meta.js\`.
 * Regenerate with: node scripts/generate-free-manifest.cjs
 * Check freshness:  node scripts/generate-free-manifest.cjs --check
 * Plan: Trading-Command-Suite-Documentation/commercial/FREE-EDITION-PLAN.md (§3)
 *
 * ${free.length} free · ${premium.length} premium · ${free.length + premium.length} total
 */
export const FREE_MANIFEST = {
  generatedFrom: 'src/core/view-meta.js',
  freeViews: [
${free.map((k) => `    '${k}',`).join('\n')}
  ],
  // ⚠️ The premium PATH LIST is deliberately NOT emitted here (2026-09-23). This file is imported
  // by src/core/edition-nav.js, which the free bundle contains — so a premium route list here means
  // the free build ships the map of the app. Measured before the change: all 95 premium paths were
  // present as string literals in dist-free/assets/index-*.js. Only the COUNT stays; anything that
  // genuinely needs the premium list derives it from view-meta.js, which never ships.
  premiumCount: ${premium.length},
};

/** True when a view-meta key ships in the free edition. */
export function isFreeView(pathOrKey) {
  return FREE_MANIFEST.freeViews.includes(pathOrKey);
}
`;
  return { body, freeCount: free.length, premiumCount: premium.length };
}

const { body, freeCount, premiumCount } = build();

if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
  if (current !== body) {
    console.error('STALE: src/editions/free.manifest.js does not match the view-meta tier state.');
    console.error('Run: node scripts/generate-free-manifest.cjs');
    process.exit(1);
  }
  console.log(`free manifest is fresh (${freeCount} free / ${premiumCount} premium).`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, body);
console.log(`wrote ${path.relative(ROOT, OUT_FILE)}`);
console.log(`free views    : ${freeCount}`);
console.log(`premium views : ${premiumCount}`);
