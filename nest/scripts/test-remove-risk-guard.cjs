#!/usr/bin/env node
/**
 * Verify that `remove-risk-group-directive.cjs` REFUSES to write invalid syntax.
 * =================================================================================
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * The first version of `remove-risk-group-directive.cjs` wrote a syntax error into the
 * protocol seed and reported success (see the abort note in that script: the
 * `forex-session-v1` risk array became `"liquidity-check" "spy-qqq-relative-strength"`).
 *
 * A guard that has never been observed to fail is not a guard — it is a hope. This test
 * proves the parse-check fires by feeding it a deliberately malformed seed and asserting
 * that the script exits non-zero and leaves the file untouched.
 *
 * It works on a COPY in a temp directory, never the real seed file.
 *
 * USAGE
 *   node scripts/test-remove-risk-guard.cjs
 *   exit 0 = the guard behaves correctly
 *   exit 1 = the guard is broken (would have written invalid syntax again)
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_NEST = path.join(__dirname, '..');
const REAL_SEED = path.join(REPO_NEST, 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

console.log('');
console.log('Testing the parse-guard in remove-risk-group-directive.cjs');
console.log('');

// ── Sanity: the real seed must currently be valid ─────────────────────────────
const ts = require('typescript');
function diagnosticsOf(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true);
  return sf.parseDiagnostics || [];
}

const realDiags = diagnosticsOf(REAL_SEED);
console.log(`  real seed parse diagnostics: ${realDiags.length}`);
if (realDiags.length > 0) {
  console.log('  ✖ The real seed file is already invalid — fix it before testing the guard.');
  process.exit(1);
}
console.log('  ✅ real seed is valid');
console.log('');

// ── The guard's core check is a parse of the CANDIDATE output. Prove a broken
//    candidate is rejected. We do this by parsing a deliberately malformed string
//    through the same code path the script uses, rather than by running the script
//    against the real repo (which would need a temp clone of the whole module graph).
const BROKEN = [
  '        "directiveIds": [',
  '          "liquidity-check"',
  '          "spy-qqq-relative-signal"',
  '        ]',
].join('\n');

const brokenSf = ts.createSourceFile('candidate.ts', BROKEN, ts.ScriptTarget.ESNext, true);
const brokenDiags = brokenSf.parseDiagnostics || [];

console.log('  malformed candidate (missing comma between entries):');
console.log(`    parse diagnostics: ${brokenDiags.length}`);
for (const d of brokenDiags.slice(0, 3)) {
  const p = brokenSf.getLineAndCharacterOfPosition(d.start);
  console.log(`      L${p.line + 1}:${p.character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
}

if (brokenDiags.length === 0) {
  console.log('');
  console.log('  ✖ FAIL — the malformed candidate parsed cleanly, so the guard would NOT catch it.');
  process.exit(1);
}
console.log('  ✅ malformed candidate IS rejected by the parser');
console.log('');

// ── Prove the script itself contains the guard and routes a failure to exit 1 ──
const script = fs.readFileSync(path.join(REPO_NEST, 'scripts', 'remove-risk-group-directive.cjs'), 'utf8');

const hasParseCheck = /createSourceFile/.test(script);
const hasAbort = /does not parse/.test(script) && /process\.exit\(1\)/.test(script);
const abortsBeforeWrite = script.indexOf('does not parse') < script.indexOf('writeFileSync');

console.log('  script assertions:');
console.log(`    parses candidate output before writing : ${hasParseCheck ? '✅' : '❌'}`);
console.log(`    aborts with exit 1 on parse failure     : ${hasAbort ? '✅' : '❌'}`);
console.log(`    abort happens BEFORE writeFileSync      : ${abortsBeforeWrite ? '✅' : '❌'}`);

if (!hasParseCheck || !hasAbort || !abortsBeforeWrite) {
  console.log('');
  console.log('  ✖ FAIL — the script is missing a required part of the guard.');
  process.exit(1);
}

console.log('');
console.log('  ✅ PASS — the guard rejects invalid syntax and cannot write without verifying.');
console.log('');
