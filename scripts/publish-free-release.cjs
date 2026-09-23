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
 *      beside the zip.
 *   4. `gh release create v<version>-free` on FifeCIC/trading-command-suite-free with the zip
 *      and its checksum attached.
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

// ── 1. build ────────────────────────────────────────────────────────────────────────────────
console.log(`[1/4] building free edition (v${version})...`);
run('node_modules\\.bin\\vite.cmd', ['build', '--mode', 'free', '--outDir', 'dist-free', '--sourcemap']);

// ── 2. guards — never publish on a failed guard ─────────────────────────────────────────────
console.log('[2/4] running edition guards...');
run('node', ['scripts/validate-edition-tiers.cjs']);
// --strict: the release gate. The remaining premium NAME references (§9.14 strip pass) are reported
// on a normal run; a release must not ship with them, so the gate refuses.
run('node', ['scripts/validate-free-bundle.cjs', 'dist-free', '--mode', 'free', '--strict']);

// ── 3. package (a map-free build; the guard above ran against the sourcemap build) ─────────
console.log('[3/4] packaging...');
const RELEASE_DIST = path.join(ROOT, 'dist-free-release');
fs.rmSync(RELEASE_DIST, { recursive: true, force: true });
run('node_modules\\.bin\\vite.cmd', ['build', '--mode', 'free', '--outDir', 'dist-free-release']);
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
