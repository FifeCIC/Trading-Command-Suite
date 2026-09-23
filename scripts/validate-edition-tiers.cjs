#!/usr/bin/env node
/**
 * validate-edition-tiers.cjs — the free/premium tier guard (FREE-EDITION-PLAN.md §3).
 *
 *   node scripts/validate-edition-tiers.cjs             # check (exit 1 on any failure)
 *   node scripts/validate-edition-tiers.cjs --self-test # prove the checks can FAIL
 *
 * WHAT IT CHECKS
 *   1. COVERAGE   — every VIEW_META entry carries `tier: 'free' | 'premium'`.
 *                   A new page cannot ship unclassified.
 *   2. VALIDITY   — tiers are only the two legal values.
 *   3. FRESHNESS  — `src/editions/free.manifest.js` matches the tier state
 *                   (delegates to the ONE generator — no second implementation here).
 *
 * The --self-test mode mutates the SOURCE TEXT IN MEMORY (never the file) to prove the
 * checks fail when they should: a guard that has never been observed to fail is a decoration.
 */
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const META_FILE = path.join(ROOT, 'src', 'core', 'view-meta.js');

/** Evaluate a view-meta source string and return its VIEW_META binding. */
function evalSource(src) {
  const body = src
    .replace(/^export\s+default\s+/gm, 'const __defaultExport = ')
    .replace(/^export\s+/gm, '');
  const factory = new Function(`${body}\nreturn { VIEW_META };`);
  const { VIEW_META } = factory();
  if (!VIEW_META || typeof VIEW_META !== 'object') {
    throw new Error('view-meta.js did not expose VIEW_META');
  }
  return VIEW_META;
}

/** Pure checks over a source string. Returns an array of problem strings. */
function checkSource(src) {
  const problems = [];
  const meta = evalSource(src);
  const entries = Object.entries(meta);
  if (entries.length === 0) problems.push('no VIEW_META entries found');
  let free = 0;
  for (const [key, entry] of entries) {
    const tier = entry.tier;
    if (tier === undefined) {
      problems.push(`MISSING TIER: '${key}' has no tier — classify it free or premium`);
    } else if (tier !== 'free' && tier !== 'premium') {
      problems.push(`INVALID TIER: '${key}' has tier ${JSON.stringify(tier)}`);
    } else if (tier === 'free') {
      free++;
    }
  }
  if (free === 0 && problems.length === 0) {
    problems.push('NO FREE VIEWS: the manifest would be empty — check the tier assignments');
  }
  return { problems, total: entries.length, free };
}

// ── self-test: prove the checks CAN fail (mutations in memory, file never touched) ──────────
if (process.argv.includes('--self-test')) {
  const original = fs.readFileSync(META_FILE, 'utf8');
  const results = [];

  // Direction 1: strip ONE tier line → coverage must fail.
  const stripped = original.replace(/\n {4}tier: '[^']*',/, '\n');
  const r1 = checkSource(stripped).problems.some((p) => p.startsWith('MISSING TIER'));
  results.push(['coverage check fails when a tier is removed', r1]);

  // Direction 2: corrupt a tier value → validity must fail.
  const corrupted = original.replace(/tier: 'premium',/, "tier: 'medium',");
  const r2 = checkSource(corrupted).problems.some((p) => p.startsWith('INVALID TIER'));
  results.push(['validity check fails on a bogus tier', r2]);

  // Direction 3: pristine source → checks must pass (proves the failures above were the edits,
  // not a check that always fails).
  const r3 = checkSource(original).problems.length === 0;
  results.push(['pristine source passes', r3]);

  let ok = true;
  for (const [label, passed] of results) {
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}`);
    if (!passed) ok = false;
  }
  if (!fs.readFileSync(META_FILE, 'utf8').includes('tier:')) {
    // If the file itself were unclassified, directions 1–3 above would be lying (nothing to strip).
    console.error('FAIL: the real view-meta.js has no tier fields at all — self-test invalid.');
    ok = false;
  }
  console.log(ok ? 'SELF-TEST PASS — the guard can detect missing and invalid tiers.' : 'SELF-TEST FAIL');
  process.exit(ok ? 0 : 1);
}

// ── the real check ─────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync(META_FILE, 'utf8');
const { problems, total, free } = checkSource(src);

for (const p of problems) console.error(`✗ ${p}`);
if (problems.length) {
  console.error(`\nvalidate-edition-tiers: ${problems.length} problem(s) across ${total} entries.`);
  process.exit(1);
}

// Freshness — delegate to the generators so there is ONE builder per artefact, not two.
// The MAP generator matters as much as the manifest: a stale filtered copy would ship premium ids,
// labels, source paths and API endpoints in the free bundle.
for (const gen of ['generate-free-manifest.cjs', 'generate-free-map.cjs']) {
  try {
    execFileSync(process.execPath, [path.join(__dirname, gen), '--check'], { stdio: 'inherit' });
  } catch {
    process.exit(1);
  }
}

console.log(`validate-edition-tiers: OK — ${total} entries classified (${free} free, ${total - free} premium).`);
