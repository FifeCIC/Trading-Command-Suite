#!/usr/bin/env node
/**
 * List every protocol group whose `directiveIds` array is EMPTY.
 *
 * WHY THIS EXISTS
 * ---------------
 * Removing a directive from a group can leave the group with zero directives. That is
 * not automatically wrong — an empty group is scored as inactive — but it changes the
 * protocol's shape and, for a RISK group, means the protocol no longer has a risk gate
 * contributing anything. That must be a conscious outcome, not a surprise, so this
 * script makes empty groups visible.
 *
 * Rerun after any seed-data edit that removes a directive.
 *
 * USAGE
 *   node scripts/list-empty-groups.cjs
 */

const fs = require('node:fs');
const path = require('node:path');

const SEED = path.join(__dirname, '..', 'src', 'modules', 'scoring', 'protocols-seed-data.ts');
const lines = fs.readFileSync(SEED, 'utf8').split(/\r?\n/);

let slug = null;
let gid = null;
let gate = null;
let found = 0;

for (const line of lines) {
  const pm = line.match(/^ {2}"([^"]+)":\s*\{/);
  if (pm) { slug = pm[1]; gid = null; gate = null; continue; }

  const gm = line.match(/^ {8}"id":\s*"([^"]+)"/);
  if (gm) { gid = gm[1]; gate = null; continue; }

  const rm = line.match(/^ {8}"isRiskGate":\s*(true|false)/);
  if (rm) { gate = rm[1] === 'true'; continue; }

  // An empty array on one line, or an opening bracket immediately closed.
  if (/^ {8}"directiveIds":\s*\[\s*\]/.test(line) || /^ {8}"directiveIds":\s*\[\s*$/.test(line)) {
    // Distinguish "[]" (definitely empty) from "[" that is followed by entries.
    const inlineEmpty = /\[\s*\]/.test(line);
    if (inlineEmpty) {
      found++;
      const tag = gate === true ? '  <-- RISK GATE now has NO directives' : '';
      console.log(`  ${String(slug).padEnd(26)} group=${String(gid).padEnd(12)} isRiskGate=${gate}${tag}`);
    }
  }
}

console.log('');
console.log(`Empty groups: ${found}`);
if (found > 0) {
  console.log('');
  console.log('An empty group is scored as INACTIVE (weight contributes nothing).');
  console.log('For isRiskGate=true that means the protocol has no risk gate input, so the');
  console.log('risk multiplier stays at its default. Verify each is intended.');
}
console.log('');
