#!/usr/bin/env node
/**
 * publish-free-release.cjs — publish the FREE edition build to the PUBLIC repo.
 *
 *   node scripts/publish-free-release.cjs --dry-run   # build + verify + zip; print the plan
 *   node scripts/publish-free-release.cjs             # ...and create the GitHub release
 *
 * ONE-WAY SYNC — primary repo → public publishing surface. Nothing flows back, and the
 * application SOURCE is never published: only the built artefact goes out as a release
 * (FREE-EDITION-PLAN.md §12 — the public repo is where distributions + docs live).
 *
 * Pipeline:
 *   1. Build the free edition WITH sourcemaps:  vite build --mode free --outDir dist-free --sourcemap
 *   2. Run the edition guards (tier coverage/freshness + premium-absent bundle assertion) —
 *      a release must never ship on a failed guard.
 *   3. Rebuild WITHOUT sourcemaps into `dist-free-release` and zip THAT (sourcemaps are a
 *      developer aid; the shipped artefact should not carry the module map). Write a .sha256
 *      beside the zip. Add the licence, the generated third-party notices and a short README
 *      to the packaged folder FIRST — see "Legal files" below.
 *   4. `gh release create v<version>-free` on FifeCIC/trading-command-suite-free with the zip
 *      and its checksum attached.
 *
 * LEGAL FILES — why step 3 adds three files
 * -----------------------------------------
 * MIT/ISC/BSD/Apache-2.0 all require their copyright + permission notice to accompany a binary
 * distribution, and this zip is a built bundle with every dependency inlined. Measured
 * 2026-09-25: the production tree is 143 packages, and the zip previously shipped NO licence
 * and NO notices. So step 3 writes:
 *   LICENSE.txt                — copied from the repo root; the publisher REFUSES to package
 *                                while it still contains unfilled [PLACEHOLDERS] (see
 *                                assertLicenceReady), because a half-filled EULA is worse than
 *                                none — it appears to grant terms nobody approved.
 *   THIRD-PARTY-NOTICES.txt    — GENERATED, never hand-kept, so it cannot drift from the tree.
 *   README.txt                 — what the bundle is and how to serve it.
 *
 * Version: taken from package.json. The free edition shares the app's version for now and
 * tags as `v<version>-free` so free and full releases never collide.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DRY_RUN = process.argv.includes('--dry-run');
const PUBLIC_REPO = 'FifeCIC/trading-command-suite-free';

const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const tag = `v${version}-free`;
const zipName = `trading-command-suite-free-v${version}.zip`;
const zipPath = path.join(ROOT, zipName);
const shaPath = `${zipPath}.sha256`;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`FAILED: ${cmd} ${args.join(' ')}\n${r.stdout || ''}${r.stderr || ''}`);
    process.exit(1);
  }
  return r.stdout || '';
}

// ── legal files ─────────────────────────────────────────────────────────────────────────────
const LICENCE_SRC = path.join(ROOT, 'LICENSE.txt');
// The readiness verdict lives in a pure module so it can be canaried without building a release.
const { checkLicence } = require('./lib/licence-readiness.cjs');

function readLicence() {
  if (!fs.existsSync(LICENCE_SRC)) {
    console.error('🛑 LICENSE.txt is missing from the repo root. A distribution must carry a licence.');
    process.exit(1);
  }
  return fs.readFileSync(LICENCE_SRC, 'utf8');
}

/**
 * Refuse to package a licence that is not finished.
 *
 * NOTE ON THE DRY RUN: it reports the block and CONTINUES, so `--dry-run` can still show what
 * would ship and where. A real release exits. That asymmetry is intentional, but it means the
 * dry run is NOT the gate — the gate is this function returning on the non-dry path.
 */
function assertLicenceReady() {
  const text = readLicence();
  const verdict = checkLicence(text);
  if (verdict.ok) return text;

  console.error(`🛑 LICENSE.txt is not ready to ship — ${verdict.reason}.`);
  console.error('   A half-filled licence appears to grant terms nobody approved. Fill it, have it');
  console.error('   reviewed, then remove the DRAFT banner and re-run.');
  console.error('   Review copy + clause reasoning: the FREE-EDITION-EULA document in the central docs store.');
  if (!DRY_RUN) process.exit(1);
  console.error('   (dry run — continuing so the rest of the plan can be inspected)');
  return text;
}

const RELEASE_README = `Trading Command Suite — Free Edition (v${version})
${'='.repeat(48)}

This is a BUILT WEB APPLICATION, not an executable. Serve the folder over HTTP with any
static file server; open index.html through that server rather than from the file system.

Licence       — LICENSE.txt. Read it: it sets out what you may and may not do with this
                software, and it is the terms you accept by using it. Note in particular that
                it is NOT a licence to redistribute, and that it is not financial advice.

Third parties — THIRD-PARTY-NOTICES.txt lists every bundled dependency with its licence and
                reproduces the licence texts. This build contains the dependencies of the
                application as published; the file is generated from the dependency tree.

Checksum      — the .sha256 file beside the zip. Verify before use:
                PowerShell:  Get-FileHash <zip> -Algorithm SHA256

Source        — this release is built from a private development repository. The source is not
                published. The application name and META.Stack are trade marks of the
                licensor; no trade mark rights are granted by the licence.

Trading risk  — this software can place orders with your broker at your instruction. You are
                responsible for every order and position. Market data may be delayed or wrong.
`;

// ── 1. build ────────────────────────────────────────────────────────────────────────────────
console.log(`[1/4] building free edition (v${version})...`);
run('node_modules\\.bin\\vite.cmd', ['build', '--mode', 'free', '--outDir', 'dist-free', '--sourcemap']);

// ── 2. guards — never publish on a failed guard ─────────────────────────────────────────────
console.log('[2/4] running edition guards...');
// --strict on both: a release must not ship an unreviewed free view (§13.2) or a premium-only
// view NAME (§9.14). Both are advisory in day-to-day use while the review is in flight.
run('node', ['scripts/validate-edition-tiers.cjs', '--strict']);
// --strict: the release gate. The remaining premium NAME references (§9.14 strip pass) are reported
// on a normal run; a release must not ship with them, so the gate refuses.
run('node', ['scripts/validate-free-bundle.cjs', 'dist-free', '--mode', 'free', '--strict']);

// ── 3. package (a map-free build; the guard above ran against the sourcemap build) ─────────
console.log('[3/4] packaging...');
const RELEASE_DIST = path.join(ROOT, 'dist-free-release');
fs.rmSync(RELEASE_DIST, { recursive: true, force: true });
run('node_modules\\.bin\\vite.cmd', ['build', '--mode', 'free', '--outDir', 'dist-free-release']);

// 3b. legal files — into the packaged folder BEFORE the zip is made, so the shipped artefact
// carries them. Nothing here is optional: the guards in step 2 check the CODE, and these check
// the OBLIGATIONS that come with shipping it.
const licenceText = assertLicenceReady();
fs.writeFileSync(path.join(RELEASE_DIST, 'LICENSE.txt'), licenceText, 'utf8');
run('node', [
  'scripts/generate-third-party-notices.cjs',
  '--out', path.join(RELEASE_DIST, 'THIRD-PARTY-NOTICES.txt'),
]);
fs.writeFileSync(path.join(RELEASE_DIST, 'README.txt'), RELEASE_README, 'utf8');
for (const f of ['LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'README.txt']) {
  const p = path.join(RELEASE_DIST, f);
  if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
    // Presence is a claim; size is the evidence that the copy actually carried content.
    console.error(`🛑 ${f} did not make it into the packaged folder. Refusing to zip.`);
    process.exit(1);
  }
}

fs.rmSync(zipPath, { force: true });
run('powershell.exe', [
  '-NoProfile',
  '-Command',
  `Compress-Archive -Path '${RELEASE_DIST}\\*' -DestinationPath '${zipPath}' -Force`,
]);
const sha = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
fs.writeFileSync(shaPath, `${sha}  ${zipName}\n`);
console.log(`      ${zipName} (${(fs.statSync(zipPath).size / 1024 / 1024).toFixed(1)} MB)`);
console.log(`      sha256 ${sha}`);

// ── 4. release ──────────────────────────────────────────────────────────────────────────────
const notes =
  `Free edition build (v${version}). Built from the private development repository — ` +
  `the source is not published. Checksum: see the attached .sha256 file.`;
if (DRY_RUN) {
  console.log('[4/4] DRY RUN — would run:');
  console.log(`      gh release create ${tag} --repo ${PUBLIC_REPO} --title "Free edition v${version}" --notes <notes> ${zipName} ${path.basename(shaPath)}`);
  console.log('done (dry run).');
  process.exit(0);
}
fs.rmSync(RELEASE_DIST, { recursive: true, force: true });
console.log('[4/4] creating GitHub release...');
run('gh', [
  'release', 'create', tag,
  '--repo', PUBLIC_REPO,
  '--title', `Free edition v${version}`,
  '--notes', notes,
  zipPath,
  shaPath,
]);
console.log(`released: https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`);
