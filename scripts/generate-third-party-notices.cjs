#!/usr/bin/env node
/**
 * generate-third-party-notices.cjs — produce THIRD-PARTY-NOTICES.txt for a distribution.
 *
 *   node scripts/generate-third-party-notices.cjs                 # write ./THIRD-PARTY-NOTICES.txt
 *   node scripts/generate-third-party-notices.cjs --out <path>    # write elsewhere (the publisher does this)
 *   node scripts/generate-third-party-notices.cjs --stdout        # print, write nothing
 *   node scripts/generate-third-party-notices.cjs --check         # exit 1 if the file on disk is stale
 *   node scripts/generate-third-party-notices.cjs --strict        # also exit 1 on an undeclared licence
 *
 * WHY THIS EXISTS
 * ---------------
 * MIT, ISC, BSD and Apache-2.0 all require their copyright + permission notice to accompany a
 * binary distribution. The free edition ships as a zip containing BUILT code, in which every
 * bundled dependency is inlined — so the notice obligation applies to the whole bundled tree,
 * not to `package.json`'s 12 declared dependencies.
 *
 * Measured 2026-09-25: the production tree is 143 packages (97 MIT, 33 ISC, 6 BSD-3-Clause,
 * 3 Apache-2.0, 1 MPL-2.0-or-Apache-2.0, 1 0BSD, 1 Unlicense, 1 undeclared). 142 ship a licence
 * file; `fancy-canvas` declares its licence in package.json only.
 *
 * ⚠️ SCOPE — this is the PRODUCTION dependency tree (`npm ls --omit=dev`), which is a SUPERSET of
 * what rollup actually inlines. Over-attributing is not a compliance failure; under-attributing
 * is. So the tree is used rather than a guess at the module graph.
 *
 * ⚠️ It is deliberately NOT derived from `--parseable`'s stdout being trusted: the paths are
 * re-validated by reading each `package.json`. A package whose package.json cannot be read is
 * reported, never silently skipped — a notices file that omits a component is worse than none.
 *
 * Output is DETERMINISTIC (no timestamp) so `--check` can compare byte-for-byte and so a diff
 * shows exactly which dependency changed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const outIdx = argv.indexOf('--out');
const OUT = outIdx !== -1 ? path.resolve(argv[outIdx + 1]) : path.join(ROOT, 'THIRD-PARTY-NOTICES.txt');
const STRICT = has('--strict');
const CHECK = has('--check');

// Licences where reproducing the full text is the customary requirement. Anything declared but
// not reproducible is still listed (name + declared licence) so the omission is visible.
const LICENCE_FILE_RE = /^(LICEN[CS]E|COPYING|NOTICE)/i;

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    // A verifier that cannot read its input must FAIL, never pass with an empty set.
    console.error(`FAILED to enumerate dependencies: ${cmd} ${args.join(' ')}`);
    console.error(r.stdout || '');
    console.error(r.stderr || '');
    process.exit(2);
  }
  return r.stdout || '';
}

/** Normalise the several shapes a licence declaration takes in the wild. */
function normaliseLicence(pkg) {
  const l = pkg.license ?? pkg.licences ?? pkg.licenses;
  if (typeof l === 'string') return l.trim() || null;
  if (l && typeof l === 'object' && typeof l.type === 'string') return l.type.trim() || null;
  if (Array.isArray(l)) {
    const types = l.map((x) => (typeof x === 'string' ? x : x && x.type)).filter(Boolean);
    if (types.length) return types.join(' OR ');
  }
  return null;
}

function firstLicenceFile(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  // Prefer the canonical name order so the output does not depend on directory iteration order.
  const files = entries.filter((e) => e.isFile() && LICENCE_FILE_RE.test(e.name)).map((e) => e.name);
  for (const want of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'LICENCE', 'COPYING', 'NOTICE']) {
    const hit = files.find((f) => f.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  return files.sort()[0] ?? null;
}

// ── collect ─────────────────────────────────────────────────────────────────────────────────
// `--all` walks the whole tree; `--omit=dev` excludes devDependencies. The last entry is the root
// project itself, which is not a third party and is dropped.
const parseable = run('npm', ['ls', '--omit=dev', '--all', '--parseable']);
const dirs = [...new Set(parseable.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))]
  .filter((p) => p.includes('node_modules') && path.resolve(p) !== path.resolve(ROOT));

const packages = [];
const unreadable = [];
for (const dir of dirs) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    unreadable.push(dir);
    continue;
  }
  if (!pkg.name || !pkg.version) {
    unreadable.push(`${dir} (missing name/version)`);
    continue;
  }
  const licenceFile = firstLicenceFile(dir);
  let text = null;
  if (licenceFile) {
    text = fs.readFileSync(path.join(dir, licenceFile), 'utf8').replace(/\r\n/g, '\n').trimEnd();
  }
  const author =
    typeof pkg.author === 'string' ? pkg.author : (pkg.author && pkg.author.name) || null;
  packages.push({
    name: pkg.name,
    version: pkg.version,
    licence: normaliseLicence(pkg),
    author,
    licenceFile,
    text,
  });
}

if (unreadable.length) {
  console.error(`⚠️  ${unreadable.length} package(s) could not be read — reporting is incomplete:`);
  for (const u of unreadable) console.error(`     ${u}`);
  if (STRICT) process.exit(1);
}

// Dedupe by name@version (the tree can contain the same version in more than one node_modules),
// then sort by name so the file is stable and diffable.
const unique = [...new Map(packages.map((p) => [`${p.name}@${p.version}`, p])).values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);

const undeclared = unique.filter((p) => !p.licence);
const tally = unique.reduce((acc, p) => {
  const k = p.licence || 'undeclared';
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
const tallyLine = Object.entries(tally)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .map(([k, n]) => `${k} (${n})`)
  .join(', ');

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const rule = '='.repeat(80);

const lines = [];
lines.push('THIRD-PARTY NOTICES');
lines.push(rule);
lines.push('');
lines.push('Trading Command Suite is distributed with the third-party software listed below.');
lines.push(`This edition bundles ${unique.length} third-party packages.`);
lines.push('');
lines.push('Each component remains the property of its respective copyright holders and is used');
lines.push('under the licence stated. The licence text is reproduced in full where the package');
lines.push('ships one; a component whose licence text is not included is identified by its');
lines.push('declared licence so the reference can be located upstream.');
lines.push('');
lines.push(`  Application version: ${version}`);
lines.push(`  Licence summary:     ${tallyLine}`);
lines.push('');
lines.push('This file is GENERATED by scripts/generate-third-party-notices.cjs — do not edit it by');
lines.push('hand. Regenerate with:  node scripts/generate-third-party-notices.cjs');
lines.push('');
lines.push('');

if (undeclared.length) {
  lines.push('⚠️ COMPONENTS WITH NO DECLARED LICENCE');
  lines.push(rule);
  lines.push('');
  lines.push('These packages declare no licence in their package.json and ship no licence file.');
  lines.push('No permission is granted by them, and their inclusion should be reviewed before');
  lines.push('distribution. Reported rather than omitted so the gap is visible.');
  lines.push('');
  for (const p of undeclared) lines.push(`  - ${p.name} ${p.version}`);
  lines.push('');
  lines.push('');
}

unique.forEach((p, i) => {
  // The index sits at COLUMN 0 on purpose: licence prose frequently contains numbered lists
  // ("1. Redistribution...") and those lines are indented 5 spaces, so an unindented numbered
  // header is the one shape a diff can match without false positives.
  lines.push(`${i + 1}. ${p.name} ${p.version}`);
  lines.push(rule);
  lines.push(`     Licence:    ${p.licence || 'NOT DECLARED — see the warning above'}`);
  if (p.author) lines.push(`     Copyright:  ${p.author}`);
  lines.push(`     Source:     ${p.licenceFile ? `included in ${p.name} (${p.licenceFile})` : 'licence declared in package.json only'}`);
  lines.push('');
  if (p.text) {
    for (const line of p.text.split('\n')) lines.push(`     ${line}`.trimEnd());
  } else {
    lines.push(`     No licence file is distributed with this package. Its declared licence is`);
    lines.push(`     "${p.licence || 'none'}". The full text is available from the package's own`);
    lines.push(`     distribution and from its package manifest.`);
  }
  lines.push('');
  lines.push('');
});

const output = `${lines.join('\n').trimEnd()}\n`;

// ── emit / verify ───────────────────────────────────────────────────────────────────────────
if (has('--stdout')) {
  process.stdout.write(output);
  process.exit(undeclared.length && STRICT ? 1 : 0);
}

if (CHECK) {
  const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (existing === null) {
    console.error(`STALE: ${path.relative(ROOT, OUT)} does not exist. Run the generator.`);
    process.exit(1);
  }
  if (existing !== output) {
    console.error(`STALE: ${path.relative(ROOT, OUT)} does not match the installed dependency tree.`);
    // Name the change, so a reader does not have to diff by eye.
    const a = new Set(existing.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.trim()));
    const b = new Set(output.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.trim()));
    for (const l of b) if (!a.has(l)) console.error(`  + ${l}`);
    for (const l of a) if (!b.has(l)) console.error(`  - ${l}`);
    console.error('  Run: node scripts/generate-third-party-notices.cjs');
    process.exit(1);
  }
  console.log(`OK: ${path.relative(ROOT, OUT)} matches the installed dependency tree (${unique.length} packages).`);
  process.exit(undeclared.length && STRICT ? 1 : 0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, output, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(`  packages:   ${unique.length}`);
console.log(`  licences:   ${tallyLine}`);
if (undeclared.length) console.log(`  ⚠️ undeclared: ${undeclared.map((p) => p.name).join(', ')}`);
process.exit(undeclared.length && STRICT ? 1 : 0);
