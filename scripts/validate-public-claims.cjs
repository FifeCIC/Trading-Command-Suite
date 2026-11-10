#!/usr/bin/env node
/**
 * validate-public-claims.cjs — the public pages must state facts the repository can prove.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────
 * Owner, 2026-11-09: *"apply alpha to github pages and wiki … we need to cleanup better as the app's
 * file management has been unprofessional."*
 *
 * Two claims on the public surfaces were already wrong, and both were wrong in a way nothing could
 * catch, because a public page is the one surface no other validator reads:
 *
 *   1. **The screenshot count.** Four pages said **18** screens; the showcase said **17 captures**.
 *      Measured: `site/showcase/assets/` holds 18 PNGs, one of which is `logo.png` — the brand mark,
 *      used as favicon and in the header. So there are **17 screens**, and "18" counted the logo.
 *   2. **The release stage.** The word "alpha" appeared on five pages, typed by hand, with nothing
 *      connecting it to `package.json.releaseStage` — the field `bump-version.cjs` now checks before
 *      allowing 1.0.0. So the public claim and the version gate were two statements of one fact.
 *
 * ⚠️ `validate-text-encoding` now covers `site/` and `wiki/` (added the same day), so a corrupted
 * character there fails the build. This file covers the other half: a fact that is simply out of date.
 *
 * ── WHAT IT CHECKS ──────────────────────────────────────────────────────────────
 *   C1  any "<N> screens|captures|captioned" on a public page equals the real screenshot count
 *   C2  the stage word used on a public page is the declared `releaseStage`
 *   C3  a public page does not claim a version that differs from `package.json`
 *
 * ⚠️ ABSENT IS NOT WRONG. A page that never mentions a count or a stage is fine — the rule fires on a
 * claim, not on silence. A guard that demands prose gets its prose written by whoever wants green.
 *
 * Usage:
 *   node scripts/validate-public-claims.cjs             # build gate
 *   node scripts/validate-public-claims.cjs --self-test # prove C1-C3 can fail
 *   node scripts/validate-public-claims.cjs --report    # what it reads, and the true values
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const WIKI = path.join(ROOT, 'wiki');
const ASSETS = path.join(SITE, 'showcase', 'assets');

/** The brand mark lives among the screenshots and is not one. Named, not pattern-matched. */
const NOT_A_SCREENSHOT = new Set(['logo.png']);

/** Words a release stage may be declared as, so a typo cannot pass as a stage. */
const KNOWN_STAGES = ['alpha', 'beta', 'rc', 'stable'];

const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** Every public page: hand-authored HTML under site/, and every wiki source markdown. */
function publicPages(root = ROOT) {
  const out = [];
  const walk = (dir, exts) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, exts);
      else if (exts.test(e.name)) {
        out.push({
          file: path.relative(root, full).replace(/\\/g, '/'),
          text: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  walk(path.join(root, 'site'), /\.html$/i);
  walk(path.join(root, 'wiki'), /\.md$/i);
  return out;
}

/** The real number of screenshots: every PNG in the showcase assets except the brand mark. */
function screenshotCount(assetsDir = ASSETS) {
  let names;
  try {
    names = fs.readdirSync(assetsDir);
  } catch {
    return null;
  }
  return names.filter((n) => /\.png$/i.test(n) && !NOT_A_SCREENSHOT.has(n.toLowerCase())).length;
}

const COUNT_CLAIM = /\b(\d+)\s+(?:captioned\s+)?(?:screens|captures|screenshots)\b/gi;
const STAGE_CLAIM = /\b(alpha|beta|rc|stable)\b/gi;
const VERSION_CLAIM = /\bv(\d+\.\d+\.\d+)\b/g;

/** C1 — pure. */
function checkCounts(pages, actual) {
  const errors = [];
  if (actual == null) {
    errors.push('site/showcase/assets was not readable — a count check over nothing proves nothing.');
    return errors;
  }
  for (const { file, text } of pages) {
    for (const m of text.matchAll(COUNT_CLAIM)) {
      const n = Number(m[1]);
      if (n === actual) continue;
      errors.push(
        `${file}: claims ${n} ${/captures/.test(m[0]) ? 'captures' : 'screens'}, but ` +
          `site/showcase/assets holds ${actual} screenshot(s) after excluding the brand mark ` +
          `(${[...NOT_A_SCREENSHOT].join(', ')}). Fix the page, or the assets — not this number.`,
      );
    }
  }
  return errors;
}

/** C2 — pure. `declared` is `package.json`'s `releaseStage`. */
function checkStages(pages, declared) {
  const errors = [];
  const want = String(declared || '').trim().toLowerCase();
  if (!KNOWN_STAGES.includes(want)) {
    errors.push(
      `package.json releaseStage is ${JSON.stringify(declared)} — not one of ${KNOWN_STAGES.join(' / ')}. ` +
        'The public pages are required to match it, so it has to be a real stage.',
    );
    return errors;
  }
  for (const { file, text } of pages) {
    const found = new Set([...text.matchAll(STAGE_CLAIM)].map((m) => m[1].toLowerCase()));
    for (const stage of found) {
      if (stage === want) continue;
      errors.push(
        `${file}: says "${stage}" but the declared release stage is "${want}" ` +
          '(package.json releaseStage). A public page claiming a stage the version gate does not ' +
          'know about is the drift this check exists for.',
      );
    }
  }
  return errors;
}

/** C3 — pure. A page may print a version; if it does, it must be the real one. */
function checkVersions(pages, version) {
  const errors = [];
  if (!version) {
    errors.push('package.json has no usable version — a version check over nothing proves nothing.');
    return errors;
  }
  for (const { file, text } of pages) {
    for (const m of text.matchAll(VERSION_CLAIM)) {
      if (m[1] === version) continue;
      errors.push(
        `${file}: prints v${m[1]} but the application version is ${version}. ` +
          'A hand-typed version is why the footer reads it from package.json instead.',
      );
    }
  }
  return errors;
}

function readManifests(root = ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return { version: pkg.version, releaseStage: pkg.releaseStage };
}

function selfTest() {
  const count = screenshotCount();
  const cases = [
    // ── C1, both directions — and the REAL defect of 2026-11-09 is the failing case.
    ['C1: a count that matches the assets', () => checkCounts([{ file: 'site/x.html', text: `All ${count} screens` }], count), false],
    ['C1: 18 screens when 17 exist (the real defect — the logo was counted)', () => checkCounts([{ file: 'site/x.html', text: 'All 18 screens' }], 17), true],
    ['C1: "17 captures" is the same claim', () => checkCounts([{ file: 'site/x.html', text: '17 captures from the build' }], 17), false],
    ['C1: a page with no count is not a violation', () => checkCounts([{ file: 'site/x.html', text: 'Screenshots of the app' }], 17), false],
    ['C1: an unreadable asset dir is an ERROR, not a pass', () => checkCounts([{ file: 'site/x.html', text: 'All 17 screens' }], null), true],
    // ── C2, both directions
    ['C2: alpha on the page, alpha declared', () => checkStages([{ file: 'wiki/X.md', text: 'This is alpha software' }], 'alpha'), false],
    ['C2: beta on the page, alpha declared', () => checkStages([{ file: 'wiki/X.md', text: 'This is beta software' }], 'alpha'), true],
    ['C2: no stage claimed is not a violation', () => checkStages([{ file: 'wiki/X.md', text: 'Screenshots of the app' }], 'alpha'), false],
    ['C2: an unknown declared stage is an error', () => checkStages([{ file: 'wiki/X.md', text: 'nothing' }], 'gamma'), true],
    // ── C3, both directions
    ['C3: the real version', () => checkVersions([{ file: 'wiki/X.md', text: 'v0.158.0 · © 2026' }], '0.158.0'), false],
    ['C3: a stale version', () => checkVersions([{ file: 'wiki/X.md', text: 'v0.1.0 · © 2026' }], '0.158.0'), true],
    ['C3: no version printed is not a violation', () => checkVersions([{ file: 'wiki/X.md', text: '© 2026' }], '0.158.0'), false],
  ];

  let bad = 0;
  for (const [label, run, shouldFail] of cases) {
    const errs = run();
    if ((errs.length > 0) !== shouldFail) {
      console.log(`  ✗ SELF-TEST INVALID: "${label}" — expected ${shouldFail ? 'a violation' : 'none'}, got ${errs[0] || 'none'}`);
      bad++;
    }
  }
  if (bad) {
    console.log(`\n  ✗ ${bad} self-test case(s) misbehaved — the rules are not doing what this file claims.`);
    return 1;
  }
  console.log(`  ✅ self-test: ${cases.length} cases — C1, C2 and C3 were each observed to fail AND to pass, and a page that simply makes no claim was observed NOT to fire.`);
  return 0;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) process.exit(selfTest());

  const pages = publicPages();
  if (!pages.length) {
    console.error('\n  ✖ public-claims: no public pages found — site/ and wiki/ are both empty or unreadable.');
    console.error('      Reporting OK here would be a false pass, so this exits 2.\n');
    process.exit(2);
  }

  let manifest;
  try {
    manifest = readManifests();
  } catch (e) {
    console.error(`\n  ✖ public-claims: cannot read package.json — ${e.message}\n`);
    process.exit(2);
  }

  const actual = screenshotCount();

  if (args.includes('--report')) {
    console.log(`\n  true values: ${actual} screenshot(s) · version ${manifest.version} · stage ${manifest.releaseStage}`);
    console.log(`\n  ${pages.length} public page(s):\n`);
    for (const p of pages) console.log(`    ${p.file}`);
    console.log('');
    return;
  }

  const errors = [
    ...checkCounts(pages, actual),
    ...checkStages(pages, manifest.releaseStage),
    ...checkVersions(pages, manifest.version),
  ];

  if (errors.length) {
    console.error(`\n  ✖ public-claims: ${errors.length} violation(s) across ${pages.length} public page(s)\n`);
    for (const e of errors) console.error(`      ${e}\n`);
    process.exit(1);
  }

  console.log(
    `  [public-claims] ✅ OK — ${pages.length} public page(s) agree with the repository: ` +
      `${actual} screenshot(s), release stage "${manifest.releaseStage}", version ${manifest.version}.`,
  );
}

main();
