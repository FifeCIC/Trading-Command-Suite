/**
 * TEMPORARY canary — proves validate-architecture-docs.cjs fails when it should, then restores.
 * Deleted once run. Kept in Node because the PowerShell equivalent mangled the multi-line script.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REF = path.join(ROOT, 'src/core/architecture-reference.js');
const FW = path.join(ROOT, 'src/pages/architecture-framework.data.js');
const GUARD = path.join(ROOT, 'scripts/validate-architecture-docs.cjs');

const sha = (p) => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function run() {
  try {
    const out = execFileSync(process.execPath, [GUARD], { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

const results = [];

function canary(label, file, marker) {
  const before = sha(file);
  const src = fs.readFileSync(file, 'utf8');
  const patched = src.replace(
    /(export const ARCHITECTURE_INDEX = \[)/,
    `$1\n  { name: '${marker}', status: 'todo' },`,
  );
  if (patched === src) {
    results.push({ label, verdict: 'CANARY INVALID — the edit did not land', ok: false });
    return;
  }
  fs.writeFileSync(file, patched);

  const r = run();

  // ⚠️ Restore FIRST, then verify. The first version of this read the "restored" hash BEFORE
  // writing the original back, so it hashed the PATCHED file and reported a correct canary as a
  // failure. A canary harness that misreports is worse than no canary: the obvious repair is to
  // "fix" a guard that was working.
  fs.writeFileSync(file, src);
  const after = sha(file);

  const fired = r.code === 1 && r.out.includes(marker);
  const restoredClean = after === before;
  results.push({
    label,
    verdict: !fired
      ? `**GUARD DID NOT FIRE** (exit ${r.code})`
      : !restoredClean
        ? `**RESTORE FAILED** — ${file} is not byte-for-byte identical to the baseline`
        : `fired correctly, named ${marker}, restored byte-for-byte`,
    ok: fired && restoredClean,
    exit: r.code,
  });
}

canary('A: section added to the REFERENCE only', REF, 'ZZ-CANARY-REF-ONLY');
canary('B: section added to the PAGE only', FW, 'ZZ-CANARY-PAGE-ONLY');

const green = run();
results.push({
  label: 'C: green baseline returns after both restores',
  verdict: green.code === 0 ? 'exit 0, both invariants hold' : `**NOT GREEN** (exit ${green.code})`,
  ok: green.code === 0,
});

console.log('=== CANARY: every direction must be observed, and the tree restored byte-for-byte ===\n');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : '**FAIL**'}  ${r.label}\n          ${r.verdict}`);
const bad = results.filter((r) => !r.ok).length;
console.log(`\n  ${bad === 0 ? 'CANARY VALID — the guard fires in both directions and the tree is clean' : `CANARY INVALID — ${bad} problem(s)`}`);
// ⚠️ The first version of this file printed `sha(REF) !== null`, which is true for ANY non-null
// hash — a check that cannot fail, reporting reassurance it had not earned.
const clean = (p) => !fs.readFileSync(p, 'utf8').includes('ZZ-CANARY');
console.log(`  no canary text in the reference: ${clean(REF)}`);
console.log(`  no canary text in the page     : ${clean(FW)}`);
process.exit(bad === 0 && clean(REF) && clean(FW) ? 0 : 1);
