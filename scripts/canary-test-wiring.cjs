/**
 * canary-test-wiring.cjs — proves the test-wiring guard FAILS on the real tree.
 *
 * ⚠️ The self-test proves the MATCHER. It cannot prove the guard reads this repository, because the
 * self-test injects its own files. This narrows the real `prebuild` glob, asserts the edit landed,
 * requires exit 1, then restores and requires exit 0 — the same shape as every other canary here.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const GATE = path.join(ROOT, 'scripts', 'validate-test-wiring.cjs');
const original = fs.readFileSync(PKG, 'utf8');

function runGate() {
  try {
    execFileSync(process.execPath, [GATE], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    return e.status ?? 2;
  }
}

const results = [];
const check = (name, got, want) => {
  const ok = got === want;
  results.push(ok);
  console.log(`  ${ok ? '✅' : '✖'} ${name} — expected ${want}, got ${got}`);
};

console.log('canary: validate-test-wiring.cjs');
check('the real tree is clean before anything is touched', runGate(), 0);

// Narrow every src-wide glob to src/core only. Assert the edit landed before interpreting anything.
const narrowed = original.split('node --test \\"src/**/*.test.js\\"').join('node --test \\"src/core/**/*.test.js\\"');
if (narrowed === original) {
  console.log('  ✖ CANARY INVALID — the glob was not found in package.json, so nothing was narrowed');
  process.exit(2);
}
fs.writeFileSync(PKG, narrowed, 'utf8');
if (fs.readFileSync(PKG, 'utf8') === original) {
  console.log('  ✖ CANARY INVALID — the narrowed package.json did not land');
  process.exit(2);
}
check('narrowing the glob to src/core makes the other folders ORPHANS', runGate(), 1);

fs.writeFileSync(PKG, original, 'utf8');
if (fs.readFileSync(PKG, 'utf8') !== original) {
  console.log('  ✖ CANARY INVALID — package.json was not restored byte-for-byte');
  process.exit(2);
}
check('restored, the tree is clean again', runGate(), 0);

const failures = results.filter((r) => !r).length;
console.log('');
console.log(failures === 0 ? '✅ canary: the guard reads this tree, fails on a narrowed glob, and restores' : `✖ canary: ${failures} case(s) wrong`);
process.exit(failures === 0 ? 0 : 1);
