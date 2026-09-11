#!/usr/bin/env node
/**
 * Remove `session-open-effect` from RISK-GATE groups in the protocol seed data.
 * ===========================================================================
 *
 * THE DEFECT BEING FIXED
 * ----------------------
 * `protocol-gating.service.ts:689` computes `inSignal = !isGateGroup && ...`, and
 * lines 749 / 763 gate BOTH the capacity denominator and the bullish/bearish
 * accumulation on `!isGateGroup`. A directive inside an `isRiskGate: true` group
 * therefore contributes NOTHING — its computed directional reading is discarded.
 *
 * `session-open-effect` returns bullish/bearish (pre-open trend analysis,
 * `maxScore: 60`, `directionBias: 'neutral'`). It was placed in the `risk` group of
 * 14 protocols. In 10 of those it ALSO sits in `technical` with a lower sortOrder,
 * so the duplicate guard silently saved it; in 4 (`spy-day-v1`, `qqq-day-v1`,
 * `mtf-conservative-v1`, `mt5-technical-core-v1` — plus `forex-session-v1` where the
 * technical copy exists) the risk placement was the ONLY thing that mattered and the
 * signal was lost entirely.
 *
 * WHY THIS IS THE RIGHT FIX
 * -------------------------
 * Removing it from the risk group fixes BOTH symptoms at once:
 *   - the 10 double-counted protocols lose their redundant entry (no more warning)
 *   - the protocols that relied on it are fixed by the scoring-group copy, and any
 *     protocol left with no copy simply stops claiming 60 points of capacity it
 *     could never earn — which is the #761 denominator principle.
 *
 * HOW IT EDITS
 * ------------
 * Targeted, line-based surgery on the seed file using the exact 10-space-indented
 * `"session-open-effect"` entries that the analyst script
 * (`find-risk-group-directives.cjs`) reported as being inside a risk group. Comma
 * handling is derived from the surrounding lines rather than assumed, because the
 * three shapes present are:
 *
 *   A  first entry, trailing comma, followed by another entry
 *        prev: "directiveIds": [
 *        this:   "session-open-effect",
 *        next:   "liquidity-check"
 *      -> delete this line AND the trailing comma on the next line
 *
 *   B  not-first entry, trailing comma, followed by another
 *        prev:   "liquidity-check",
 *        this:   "session-open-effect",
 *        next:   "rollover-risk"
 *      -> delete this line only
 *
 *   C  last entry, no trailing comma
 *        prev:   "liquidity-check",
 *        this:   "session-open-effect"
 *        next: ]
 *      -> delete this line AND the trailing comma on the PREVIOUS line
 *
 * The script refuses to run if any target line does not match one of those shapes,
 * so a formatting change cannot silently produce an invalid array.
 *
 * ⚠️ This edits the SOURCE OF TRUTH (`protocols-seed-data.ts`). Editing the database
 * directly would be undone by the next `seedProtocolsToDatabase()`, and all affected
 * protocols are seed-backed. The DB is updated by re-seeding afterwards.
 *
 * USAGE
 *   node scripts/remove-risk-group-directive.cjs session-open-effect --dry-run
 *   node scripts/remove-risk-group-directive.cjs session-open-effect --apply
 */

const fs = require('node:fs');
const path = require('node:path');

const TARGET = process.argv[2] || 'session-open-effect';
const APPLY = process.argv.includes('--apply');
const SEED = path.join(__dirname, '..', 'src', 'modules', 'scoring', 'protocols-seed-data.ts');

const original = fs.readFileSync(SEED, 'utf8');
const lines = original.split(/\r?\n/);

// ── Locate the risk-group occurrences (same walk as the analyst script) ────────
const targets = [];
let slug = null;
let groupId = null;
let isRiskGate = null;
let inIds = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const pm = line.match(/^ {2}"([^"]+)":\s*\{/);
  if (pm) { slug = pm[1]; groupId = null; isRiskGate = null; inIds = false; continue; }
  const gm = line.match(/^ {8}"id":\s*"([^"]+)"/);
  if (gm) { groupId = gm[1]; isRiskGate = null; continue; }
  const rm = line.match(/^ {8}"isRiskGate":\s*(true|false)/);
  if (rm) { isRiskGate = rm[1] === 'true'; continue; }
  if (/^ {8}"directiveIds":\s*\[/.test(line)) {
    inIds = true;
    if (/\]/.test(line)) inIds = false;
    continue;
  }
  if (inIds && /^ {8}\]/.test(line)) { inIds = false; continue; }
  if (inIds && line.includes(`"${TARGET}"`) && isRiskGate === true) {
    targets.push({ idx: i, slug, groupId, text: line });
  }
}

console.log('');
console.log(`Target: "${TARGET}"  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
console.log(`Risk-group occurrences found: ${targets.length}`);
console.log('');

if (targets.length === 0) {
  console.log('Nothing to do — already clean.');
  process.exit(0);
}

// ── Classify each shape and work out the edit ─────────────────────────────────
const deletions = new Set();      // line indices to delete
const commaRemovals = new Set();  // line indices whose trailing comma must go
const plans = [];

for (const t of targets) {
  const i = t.idx;
  const prev = lines[i - 1];
  const thisLine = lines[i];
  const next = lines[i + 1];

  const hasComma = /,\s*$/.test(thisLine);
  const prevIsArrayOpen = /"directiveIds":\s*\[\s*$/.test(prev);
  const nextIsArrayClose = /^\s*\]/.test(next);

  let shape;
  if (hasComma && prevIsArrayOpen) {
    shape = 'A (first entry, comma, followed by another)';
    deletions.add(i);
    commaRemovals.add(i + 1);          // next line no longer needs its comma
  } else if (hasComma && !nextIsArrayClose) {
    shape = 'B (mid-list, comma, followed by another)';
    deletions.add(i);
  } else if (!hasComma && nextIsArrayClose) {
    shape = 'C (last entry, no comma)';
    deletions.add(i);
    commaRemovals.add(i - 1);          // previous line was last-position, drop comma
  } else {
    console.error(`  ✖ L${i + 1}: unrecognised shape — refusing to edit.`);
    console.error(`      prev: [${prev}]`);
    console.error(`      this: [${thisLine}]`);
    console.error(`      next: [${next}]`);
    process.exit(1);
  }

  plans.push({ line: i + 1, slug: t.slug, groupId: t.groupId, shape });
}

console.log('Planned edits:');
for (const p of plans) {
  console.log(`  L${String(p.line).padEnd(5)} ${String(p.slug).padEnd(24)} risk   ${p.shape}`);
}

// Guard: a line must never be both deleted and comma-edited (would mean overlapping
// edits, i.e. two adjacent removals where the comma logic would double-apply).
const overlap = [...commaRemovals].filter((i) => deletions.has(i));
if (overlap.length) {
  console.error('');
  console.error(`  ✖ Overlapping edits at line(s) ${overlap.map((i) => i + 1).join(', ')} — adjacent removals.`);
  console.error('    Handle these manually; comma logic cannot be applied twice safely.');
  process.exit(1);
}

console.log('');
console.log(`  deletions: ${deletions.size}   comma adjustments: ${commaRemovals.size}`);

if (!APPLY) {
  console.log('');
  console.log('  DRY RUN — no file written. Re-run with --apply to commit.');
  process.exit(0);
}

// ── Apply ─────────────────────────────────────────────────────────────────────
const out = [];
for (let i = 0; i < lines.length; i++) {
  if (deletions.has(i)) continue;
  let line = lines[i];
  if (commaRemovals.has(i)) {
    line = line.replace(/,(\s*)$/, '$1');
  }
  out.push(line);
}

let result = out.join('\n');

// ── Verify before writing ─────────────────────────────────────────────────────
//
// ⚠️ THE FIRST VERSION OF THIS SCRIPT WROTE A SYNTAX ERROR.
// ---------------------------------------------------------
// Shape A (a first entry with a trailing comma) removed the comma from the NEXT line,
// on the assumption the removed entry was followed by another. In `forex-session-v1`
// the risk array was:
//
//     "directiveIds": [
//       "session-open-effect",    <- removed (shape A)
//       "liquidity-check"         <- comma stripped, but this is now the FIRST entry
//     ]                                 and needs its comma back for the next element
//
// producing `"liquidity-check" "spy-qqq-relative-strength"` — two adjacent string
// literals, which TypeScript reports as `L1621: ',' expected`. The script had
// reported success. Comma bookkeeping by shape is evidently not reliable enough on
// hand-formatted data, so the script now PARSES the candidate output with the real
// TypeScript compiler and refuses to write anything that does not parse.
//
// This is the general lesson: a generator that edits syntax must verify syntax.
let parsed;
try {
  const ts = require('typescript');
  const sf = ts.createSourceFile(SEED, result, ts.ScriptTarget.ESNext, true);
  const diags = sf.parseDiagnostics || [];
  if (diags.length > 0) {
    console.error('');
    console.error('  ✖ ABORTING — the edited output does not parse:');
    for (const d of diags.slice(0, 10)) {
      const p = sf.getLineAndCharacterOfPosition(d.start);
      console.error(`      L${p.line + 1}:${p.character + 1}  ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
    console.error('  File left UNCHANGED.');
    process.exit(1);
  }
  parsed = true;
} catch (err) {
  console.error('');
  console.error(`  ✖ ABORTING — could not run the parse check: ${err.message}`);
  console.error('  File left UNCHANGED (refusing to write unverified syntax).');
  process.exit(1);
}

// 1. Every directiveIds array must still be non-empty and syntactically sane.
const openCount = (result.match(/"directiveIds":\s*\[/g) || []).length;
const emptyArrays = (result.match(/"directiveIds":\s*\[\s*\]/g) || []).length;
if (emptyArrays > 0) {
  // Empty risk groups are legitimate (an all-zero group is scored as inactive), but
  // flag it so it is a conscious outcome rather than a surprise.
  console.log('');
  console.log(`  ⚠️  ${emptyArrays} directiveIds array(s) are now EMPTY of ${openCount} total.`);
  console.log('      An empty group is scored as inactive — verify this is intended.');
  console.log('      Run: node scripts/list-empty-groups.cjs');
}

// 2. No double commas, no trailing comma before a closing bracket.
if (/,\s*,/.test(result)) {
  console.error('  ✖ Result contains a double comma — aborting, file untouched.');
  process.exit(1);
}
if (/,\s*\n\s*\]/.test(result)) {
  console.error('  ✖ Result contains a trailing comma before a closing bracket — aborting.');
  process.exit(1);
}

fs.writeFileSync(SEED, result, 'utf8');
console.log('');
console.log(`  ✅ Written. ${deletions.size} line(s) removed from ${path.relative(process.cwd(), SEED)}`);
console.log('  Next: node scripts/find-risk-group-directives.cjs ' + TARGET + '   (verify)');
console.log('');
