/**
 * TEMPORARY analysis — what SHAPE is each hand-rolled self-test, and will the canonical harness
 * change its behaviour?
 *
 * ⚠️ This runs BEFORE any edit, because the canonical `runCases` requires `fn() === true` STRICTLY
 * while some copies accept truthy. A case returning a count, a string or an array would pass under
 * the loose rule and FAIL under the strict one — so a blind swap turns a green self-test red, and
 * the tempting repair is to weaken the shared harness. Measure first.
 *
 * Deleted once run.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

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

console.log('=== each file: does it already use runSelfTest, and is its rule strict? ===\n');

for (const rel of FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) {
    console.log(`  MISSING   ${rel}`);
    continue;
  }
  const src = fs.readFileSync(p, 'utf8');

  const usesCanonical = /require\(['"][^'"]*validator-helpers['"]\)/.test(src);
  const importsRunSelfTest = /\brunSelfTest\b/.test(src) && usesCanonical;

  // Which rule does the file's own loop use?
  const strict = /===\s*true/.test(src);
  // Does it require the helper but hand-roll anyway?
  const requiresLib = usesCanonical;
  // Where is the self-test body?
  const selfTestFn = /function\s+selfTest\s*\(/.test(src);
  const casesArray = /\b(?:const|let)\s+cases\s*=\s*\[/.test(src);
  // The summary line it prints, so a swap can be checked to preserve it.
  const summary = (src.match(/\$\{[^}]*passed[^}]*\}/g) || []).slice(0, 2);
  // How many cases are declared? Count `['name'` style entries.
  const cases = (src.match(/^\s*\[\s*'/gm) || []).length;
  // Does any case return something that is NOT a boolean? Heuristic: `return <ident>;` inside cases.
  const nonBoolReturns = [...src.matchAll(/return\s+(?!true|false)(\w+[\w.()[\]]*)\s*;/g)]
    .map((m) => m[1])
    .filter((v) => !/^(0|1|null|undefined)$/.test(v))
    .slice(0, 4);

  console.log(`  ${rel}`);
  console.log(`      canonical import : ${requiresLib ? 'YES' : 'no'}${importsRunSelfTest ? ' (uses runSelfTest)' : requiresLib ? ' (imports lib but hand-rolls)' : ''}`);
  console.log(`      own rule         : ${strict ? "STRICT (=== true)" : 'LOOSE (truthy)  <-- swap may change results'}`);
  console.log(`      selfTest() fn    : ${selfTestFn ? 'yes' : 'NO'}   cases array: ${casesArray ? 'yes' : 'NO'}   ~${cases} case(s)`);
  if (summary.length) console.log(`      summary prints   : ${summary.join(' | ')}`);
  if (nonBoolReturns.length) console.log(`      non-bool returns : ${nonBoolReturns.join(', ')}  <-- CHECK THESE`);
  console.log('');
}

console.log('=== the two already-canonical files, for reference ===');
for (const rel of ['scripts/validate-envelope-callers.cjs', 'scripts/validate-readiness-verdict.cjs']) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  const m = src.match(/runSelfTest\([^)]*\)/);
  console.log(`  ${rel}\n      ${m ? m[0] : 'no call found'}`);
}
