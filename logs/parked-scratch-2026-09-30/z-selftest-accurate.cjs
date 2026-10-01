/**
 * TEMPORARY — accurate list for #1032. Deleted once run.
 *
 * ⚠️ The first version of this detector was WRONG and reported "canonical import: no" for files
 * that plainly DO import the shared lib. Its regex demanded the quote immediately after
 * `validator-helpers`, but the real path is `validator-helpers.cjs'` — `.cjs` sits in between.
 * It therefore under-reported, and a work list built from it would have re-refactored files that
 * were already correct. Fixed here, which is why the numbers below can be trusted.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Every file named in #1032, plus the two the issue calls canonical. */
const FILES = [
  'scripts/tools-index.cjs',
  'scripts/lib/mysql-cli.cjs',
  'scripts/replay-exit-counterfactual.cjs',
  'scripts/replay-exit-verdict.cjs',
  'scripts/validate-theories.cjs',
  'scripts/validate-notices.cjs',
  'nest/scripts/audit-symbol-protocol-authority.cjs',
  'nest/scripts/directive-guard.cjs',
  'nest/scripts/fix-local-time-defaults.cjs',
  'nest/scripts/validate-schema-safety.cjs',
  'scripts/validate-envelope-callers.cjs',
  'scripts/validate-readiness-verdict.cjs',
];

const rows = [];
for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    rows.push({ rel, verdict: 'MISSING' });
    continue;
  }
  const s = fs.readFileSync(p, 'utf8');

  const req = s.match(/require\((['"])([^'"]*validator-helpers[^'"]*)\1\)/);
  let names = [];
  if (req) {
    const esc = req[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const decl = s.match(new RegExp(`const\\s*\\{([^}]+)\\}\\s*=\\s*require\\((['"])${esc}\\2\\)`));
    if (decl) names = decl[1].split(',').map((x) => x.trim()).filter(Boolean);
  }

  const usesCanonical = names.includes('runSelfTest') || names.includes('runCases');
  const handRolls = /let\s+failed\s*=\s*0/.test(s);
  const hasFlag = /--self-test/.test(s);

  rows.push({
    rel,
    imports: req ? names.join(', ') || '(required, names not parsed)' : 'NONE',
    verdict: usesCanonical && !handRolls ? 'CANONICAL' : handRolls ? 'HAND-ROLLED' : 'OTHER',
    handRolls,
    hasFlag,
  });
}

console.log('=== ACCURATE (#1032) — who already uses the shared harness? ===\n');
for (const r of rows) {
  if (r.verdict === 'MISSING') { console.log(`  MISSING       ${r.rel}`); continue; }
  console.log(`  ${r.verdict.padEnd(13)} ${r.rel}`);
  console.log(`      imports: ${r.imports}`);
  console.log(`      loop   : ${r.handRolls ? 'hand-rolled (let failed = 0)' : 'none'}   --self-test: ${r.hasFlag ? 'yes' : 'NO'}`);
}

const canonical = rows.filter((r) => r.verdict === 'CANONICAL');
const hand = rows.filter((r) => r.verdict === 'HAND-ROLLED');
const other = rows.filter((r) => r.verdict === 'OTHER');

console.log('\n=== SUMMARY ===');
console.log(`  already canonical : ${canonical.length}`);
canonical.forEach((r) => console.log(`     ${r.rel}`));
console.log(`  HAND-ROLLED       : ${hand.length}`);
hand.forEach((r) => console.log(`     ${r.rel}`));
console.log(`  OTHER (no loop)   : ${other.length}`);
other.forEach((r) => console.log(`     ${r.rel}`));
