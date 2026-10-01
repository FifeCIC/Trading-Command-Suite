/**
 * TEMPORARY measurement — is the app CONSOLIDATING or ACCUMULATING PARALLEL PATHWAYS?
 *
 * The owner's question, verbatim: does agentic AI "create a clear set of functions for sharing
 * among the entire app, or does it write entire new files for such issues".
 *
 * That is not a matter of opinion, so it is measured. Three independent signals:
 *
 *  1. NEW-FILE RATE  — of the files each recent commit touched, how many were newly ADDED?
 *                      A codebase consolidating adds helpers and edits callers. One accumulating
 *                      pathways keeps adding files.
 *  2. DIRECTIVE SHAPE — a "one file per directive, each re-implementing the same helpers" pattern
 *                      is the exact failure the owner fears. Measured as: how many directive
 *                      implementations import a SHARED helper vs re-derive it.
 *  3. DUPLICATION     — the repo's own ratchet already counts it; this reads the specific pairs
 *                      involving the areas being changed, which a total hides.
 *
 * Deleted once run. This is a probe, not a deliverable.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// ── 1. New-file rate over the last N commits ─────────────────────────────────────────────────
const N = Number(process.argv[2] || 120);

/**
 * For each commit, count files ADDED vs MODIFIED vs DELETED.
 *
 * ⚠️ `--diff-filter` is the whole point: `--name-only` alone cannot tell a new file from an edit,
 * and that distinction IS the question. Counting them together would make the two hypotheses
 * indistinguishable — a measurement that cannot separate the answers is not a measurement.
 */
function commitFileStats(n) {
  const out = execFileSync(
    'git',
    ['log', `-${n}`, '--no-merges', '--pretty=format:__C__%h%x09%s', '--diff-filter=ADM', '--name-status'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const commits = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('__C__')) {
      const [hash, ...rest] = line.replace('__C__', '').split('\t');
      cur = { hash, subject: rest.join('\t'), added: [], modified: [], deleted: [] };
      commits.push(cur);
    } else if (cur && /^[AMD]\t/.test(line)) {
      const [st, ...p] = line.split('\t');
      // Renames show as two paths; only the status letter matters here.
      if (st === 'A') cur.added.push(p[0]);
      else if (st === 'M') cur.modified.push(p[0]);
      else if (st === 'D') cur.deleted.push(p[0]);
    }
  }
  return commits;
}

const commits = commitFileStats(N);
const totAdded = commits.reduce((s, c) => s + c.added.length, 0);
const totModified = commits.reduce((s, c) => s + c.modified.length, 0);
const totDeleted = commits.reduce((s, c) => s + c.deleted.length, 0);

// ⚠️ Source files only for the "is this app growing pathways" question — docs/tests/locks are a
// different matter and would dilute the signal. Stated, because a ratio whose denominator is
// quietly mixed is unreadable.
const isSrc = (p) => /\.(ts|tsx|js|jsx|cjs|mjs)$/.test(p) && !/\.(spec|test)\./.test(p);
const srcAdded = commits.flatMap((c) => c.added.filter(isSrc));
const srcModified = commits.flatMap((c) => c.modified.filter(isSrc));

console.log(`=== 1. NEW-FILE RATE over the last ${commits.length} non-merge commits ===\n`);
console.log(`  all files   : ${totAdded} added, ${totModified} modified, ${totDeleted} deleted`);
console.log(`  SOURCE only : ${srcAdded.length} added, ${srcModified.length} modified`);
const ratio = srcModified.length === 0 ? 0 : srcAdded.length / srcModified.length;
console.log(`  added : modified = 1 : ${(srcModified.length / Math.max(srcAdded.length, 1)).toFixed(2)}`);
console.log(`  (1 added source file per ${(srcModified.length / Math.max(srcAdded.length, 1)).toFixed(2)} modified)`);

// How concentrated are the new files? 3 new files in one commit is a module; 20 commits each adding
// one file is drip-accumulation.
const withAdds = commits.filter((c) => c.added.filter(isSrc).length > 0);
console.log(`  ${withAdds.length} of ${commits.length} commits added a source file`);
if (withAdds.length) {
  const biggest = [...withAdds].sort((a, b) => b.added.filter(isSrc).length - a.added.filter(isSrc).length).slice(0, 5);
  console.log('  largest single-commit additions (a module) vs drip:');
  for (const c of biggest) console.log(`    +${c.added.filter(isSrc).length}  ${c.hash} ${c.subject.slice(0, 68)}`);
}

// ── 2. Directive shape — the owner's specific fear, made countable ───────────────────────────
console.log('\n=== 2. DIRECTIVE SHAPE: shared helpers, or one self-contained file each? ===\n');

const dirRoot = path.join(ROOT, 'nest/src/modules/directives');
const implFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) implFiles.push(p);
  }
})(dirRoot);

/** Shared helper modules a directive implementation can import. */
const SHARED_HELPERS = [
  'shared', 'util', 'libraries', 'helpers', 'directive-inclusion', 'directive-base',
  'market-data', 'indicator', 'types',
];

let importingShared = 0;
const importers = [];
for (const f of implFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
  const hit = imports.filter((i) => SHARED_HELPERS.some((h) => i.includes(h)));
  if (hit.length) {
    importingShared++;
    importers.push({ f: path.relative(ROOT, f), hit });
  }
}

console.log(`  ${implFiles.length} directive-side .ts files (non-spec)`);
console.log(`  ${importingShared} of them import a SHARED helper module (${((importingShared / Math.max(implFiles.length, 1)) * 100).toFixed(0)}%)`);
console.log(`  ${implFiles.length - importingShared} import nothing shared`);

// ── 3. Duplication, by pair — a total hides which areas are affected ────────────────────────
console.log('\n=== 3. DUPLICATION: the pairs the ratchet already tracks ===\n');
try {
  const rep = execFileSync(process.execPath, ['scripts/validate-duplication.cjs', '--report'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pairLines = rep.split('\n').filter((l) => l.includes('<->'));
  console.log(`  ${pairLines.length} pair(s) reported`);
  pairLines.slice(0, 12).forEach((l) => console.log('   ', l.trim()));
  if (pairLines.length > 12) console.log(`    ... and ${pairLines.length - 12} more`);
} catch (e) {
  const text = (e.stdout || '') + (e.stderr || '');
  const pairLines = text.split('\n').filter((l) => l.includes('<->'));
  console.log(`  ${pairLines.length} pair(s) reported`);
  pairLines.slice(0, 12).forEach((l) => console.log('   ', l.trim()));
}

// ── 4. Where new source files landed — is a new file a new MODULE or a parallel copy? ───────
console.log('\n=== 4. WHERE the new source files landed (the 2026-09-30 session) ===\n');
const today = srcAdded.filter((p) => /scripts\//.test(p));
const todayModules = srcAdded.filter((p) => /nest\/src|src\//.test(p));
console.log(`  under scripts/ (tooling): ${today.length}`);
console.log(`  under src/ or nest/src/ (app): ${todayModules.length}`);
if (todayModules.length) todayModules.slice(0, 10).forEach((p) => console.log('    ', p));
