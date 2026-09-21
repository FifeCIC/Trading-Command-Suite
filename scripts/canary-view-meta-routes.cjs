#!/usr/bin/env node
/**
 * canary-view-meta-routes.cjs — prove `verify-view-meta-routes.cjs` can actually fail.
 *
 * A guard that has never been observed to fail is not a guard, it is a decoration. This script
 * breaks `src/core/view-meta.js` in two specific ways, runs the verifier, and REQUIRES the
 * verifier to report failure each time. It then restores the file and verifies the restore is
 * byte-identical (sha256) to what it read.
 *
 *   node scripts/canary-view-meta-routes.cjs
 *
 * Exit 0 = every breakage was caught AND the file was restored exactly.
 * Exit 1 = a breakage went undetected (the guard is blind), OR the restore did not match.
 *
 * ⚠️ DIRECTION 2 IS HERE BECAUSE THE FIRST VERSION OF THIS CANARY WAS WRONG.
 * The original Direction 2 removed the `+ '/'` from the matcher and asserted that
 * `/research/symbols-browser` would then collide with `/research/symbol`. It did not — the run
 * reported MISSED. Weakening the matcher changed nothing, because the longest-key-first SORT
 * already puts the 25-char `symbols-browser` key ahead of the 16-char `symbol` key. The original
 * comment in view-meta.js credited the wrong mechanism. Direction 2 now tests what the `+ '/'`
 * actually does, and Direction 3 tests the sort.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const TARGET = path.join(ROOT, 'src', 'core', 'view-meta.js');
const VERIFIER = path.join(ROOT, 'scripts', 'verify-view-meta-routes.cjs');

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const original = fs.readFileSync(TARGET, 'utf8');
const originalSha = sha(original);

function runVerifier() {
  try {
    const out = execFileSync(process.execPath, [VERIFIER], { encoding: 'utf8' });
    return { passed: true, out };
  } catch (e) {
    return { passed: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const BREAKAGES = [
  {
    // Proves the verifier reads the REAL map — i.e. `/research/symbol/XAUUSD` resolves because
    // this key exists, not because an unregistered path happens to fall through to something.
    name: "Direction 1 — rename the '/research/symbol' key",
    apply: (s) => s.replace("'/research/symbol': {", "'/research/symbol-RENAMED': {"),
    expectLine: /FAIL.*\/research\/symbol\/XAUUSD/,
  },
  {
    // What `+ '/'` actually protects: a string prefix that is not a child route.
    name: "Direction 2 — weaken matcher: startsWith(route + '/') -> startsWith(route)",
    apply: (s) => s.replace("pathname.startsWith(route + '/')", 'pathname.startsWith(route)'),
    expectLine: /FAIL.*\/research\/symbolfoo/,
  },
  {
    // The sort is the most-specific-first tie-breaker, and it only matters when one key is a
    // prefix of another. The real map currently has NO such nested pair, so this direction
    // synthesises one (`/research`) — that is the enabling condition, not a second bug.
    // Without the sort, `/research/symbol/XAUUSD` matches the shorter `/research` key first.
    name: 'Direction 3 — remove the sort, with a nested key present',
    apply: (s) =>
      s
        .replace(
          'const VIEW_META = {',
          "const VIEW_META = {\n  '/research': { label: 'TMP', file: 'x', css: 'x', api: [] },",
        )
        .replace('Object.keys(VIEW_META).sort((a, b) => b.length - a.length)', 'Object.keys(VIEW_META)'),
    expectLine: /FAIL.*\/research\/symbol\/XAUUSD/,
  },
];

let problems = 0;

for (const b of BREAKAGES) {
  const broken = b.apply(original);

  // A canary that cannot make its edit must refuse to report, not report a false result.
  if (broken === original) {
    console.log(`  CANARY INVALID  ${b.name}`);
    console.log('                  the edit did not land — result is meaningless, not a pass.');
    problems++;
    continue;
  }

  fs.writeFileSync(TARGET, broken);
  const result = runVerifier();
  fs.writeFileSync(TARGET, original); // restore immediately, per breakage

  if (result.passed) {
    console.log(`  MISSED          ${b.name}`);
    console.log('                  verifier still reported success on broken code.');
    problems++;
  } else if (!b.expectLine.test(result.out)) {
    console.log(`  WEAK            ${b.name}`);
    console.log('                  verifier failed, but not on the expected route:');
    console.log(
      result.out
        .split('\n')
        .filter((l) => l.includes('FAIL'))
        .map((l) => `                    ${l.trim()}`)
        .join('\n'),
    );
    problems++;
  } else {
    console.log(`  caught          ${b.name}`);
  }
}

// Restore must be exact — a canary that leaves the tree modified is worse than none.
const restored = fs.readFileSync(TARGET, 'utf8');
if (sha(restored) !== originalSha) {
  console.error(`\nRESTORE FAILED — ${TARGET} does not match its original bytes.`);
  process.exit(1);
}

// The verifier must also PASS on the restored (correct) file — both directions, not just one.
const final = runVerifier();
if (!final.passed) {
  console.error('\nRestore is byte-identical but the verifier now fails on it. Investigate.');
  process.exit(1);
}

console.log(`\nRestore verified (sha256 ${originalSha.slice(0, 16)}…). Verifier passes on restored file.`);

if (problems) {
  console.error(`\n${problems} canary problem(s) — the verifier is not trustworthy as written.`);
  process.exit(1);
}
console.log('All directions caught. The verifier is a guard, not a decoration.');
