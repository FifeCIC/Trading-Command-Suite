#!/usr/bin/env node
/**
 * Find `session-open-effect` occurrences that sit inside a RISK-GATE group.
 * ========================================================================
 *
 * WHY THIS IS A BUG, NOT A TIDINESS ISSUE
 * ---------------------------------------
 * `protocol-gating.service.ts` excludes risk-gate groups from the signal entirely:
 *
 *   const inSignal = !isGateGroup && directional && directionAllowed;   // L689
 *   if (!isGateGroup) { capacityMax += maxScore; }                      // L749
 *   if (!isGateGroup && result.signalClass === 'bullish') { ... }        // L763
 *
 * So a directive placed in an `isRiskGate: true` group contributes NOTHING — no
 * score, no capacity, no direction. Its computed bullish/bearish reading is thrown
 * away.
 *
 * `session-open-effect` is a DIRECTIONAL PREDICTOR (it returns bullish/bearish from
 * pre-open trend analysis, `directionBias: 'neutral'`, `maxScore: 60`). Placing it
 * in a risk group means those protocols compute a directional reading and then
 * discard it. That is not a risk gate — it is a lost signal.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Parses the seed file's group blocks (which are hand-formatted, not JSON-strict),
 * finds every `directiveIds` array containing the target directive, determines
 * whether that array's enclosing group has `"isRiskGate": true`, and reports:
 *
 *   - RISK-GATE occurrences  -> the defect (directive is inert there)
 *   - TECHNICAL occurrences  -> correct placement
 *   - per-protocol counts    -> to detect DOUBLE-COUNTING (same directive in >1 group)
 *
 * Read-only. Prints a report; makes NO changes. Run before and after an edit to
 * confirm the change did exactly what was intended.
 *
 * USAGE
 *   node scripts/find-risk-group-directives.cjs session-open-effect
 */

const fs = require('node:fs');
const path = require('node:path');

const TARGET = process.argv[2] || 'session-open-effect';
const SEED = path.join(__dirname, '..', 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

const lines = fs.readFileSync(SEED, 'utf8').split(/\r?\n/);

/** Walk the file, tracking the current protocol slug and group, so each directive
 *  occurrence can be attributed to (protocol, group, isRiskGate) without needing a
 *  strict parser. The seed file is generated but stable and indentation-regular. */
const occurrences = [];
let slug = null;
let groupId = null;
let groupIsRiskGate = null;
let inDirectiveIds = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Protocol key: `  "slug": {` at exactly 2-space indent
  const protoMatch = line.match(/^ {2}"([^"]+)":\s*\{/);
  if (protoMatch) {
    slug = protoMatch[1];
    groupId = null;
    groupIsRiskGate = null;
    inDirectiveIds = false;
    continue;
  }

  // Group id: `        "id": "technical",` at 8-space indent
  const gidMatch = line.match(/^ {8}"id":\s*"([^"]+)"/);
  if (gidMatch) {
    groupId = gidMatch[1];
    groupIsRiskGate = null;
    continue;
  }

  // Group risk-gate flag: `        "isRiskGate": true,`
  const gateMatch = line.match(/^ {8}"isRiskGate":\s*(true|false)/);
  if (gateMatch) {
    groupIsRiskGate = gateMatch[1] === 'true';
    continue;
  }

  // Enter a directiveIds array
  if (/^ {8}"directiveIds":\s*\[/.test(line)) {
    inDirectiveIds = true;
    if (/\]/.test(line)) inDirectiveIds = false; // single-line empty array
    continue;
  }

  // Leave a directiveIds array
  if (inDirectiveIds && /^ {8}\]/.test(line)) {
    inDirectiveIds = false;
    continue;
  }

  if (inDirectiveIds && line.includes(`"${TARGET}"`)) {
    occurrences.push({
      line: i + 1,
      slug,
      groupId,
      isRiskGate: groupIsRiskGate,
    });
  }
}

// ── Report ────────────────────────────────────────────────────────────────────
console.log('');
console.log(`Directive: ${TARGET}`);
console.log(`Occurrences in seed: ${occurrences.length}`);
console.log('');

const risk = occurrences.filter((o) => o.isRiskGate === true);
const tech = occurrences.filter((o) => o.isRiskGate === false);
const unknown = occurrences.filter((o) => o.isRiskGate === null);

console.log(`  ✅ in a scoring group (isRiskGate: false) : ${tech.length}`);
console.log(`  ❌ in a RISK group   (isRiskGate: true)  : ${risk.length}   <-- inert, contributes nothing`);
if (unknown.length) console.log(`  ⚠️  unattributed                            : ${unknown.length}`);

if (risk.length) {
  console.log('');
  console.log('  RISK-GROUP OCCURRENCES (the defect):');
  for (const o of risk) {
    console.log(`    L${String(o.line).padEnd(5)} ${String(o.slug).padEnd(24)} group="${o.groupId}"`);
  }
}

// Per-protocol totals — more than one group means double-counting
const bySlug = new Map();
for (const o of occurrences) {
  if (!bySlug.has(o.slug)) bySlug.set(o.slug, []);
  bySlug.get(o.slug).push(o);
}

const multi = [...bySlug.entries()].filter(([, v]) => v.length > 1);
if (multi.length) {
  console.log('');
  console.log(`  DOUBLE-COUNTED (appears in more than one group): ${multi.length} protocol(s)`);
  for (const [s, v] of multi) {
    const groups = v.map((o) => `${o.groupId}${o.isRiskGate ? '(RISK)' : ''}`).join(' + ');
    console.log(`    ${String(s).padEnd(24)} ${v.length}× → ${groups}`);
  }
  console.log('');
  console.log('  NOTE: the scorer de-duplicates by first group in sortOrder, so a duplicate');
  console.log('  is currently HARMLESS but generates a warning on every boot and makes the');
  console.log('  config look broken. Removing the redundant entry is still correct.');
}

console.log('');
