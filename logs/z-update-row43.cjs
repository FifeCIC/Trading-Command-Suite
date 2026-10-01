/**
 * Update SETTLED-DECISIONS row 43 to record #1014 as completed, without re-typing the row's
 * 2,000-character reasoning cell by hand (a hand-typed 2 KB cell is a copy error waiting to happen).
 * Only the STATUS cell — the last column — is replaced.
 */
const fs = require('fs');
const FILE = 'docs/SETTLED-DECISIONS.md';
const raw = fs.readFileSync(FILE, 'utf8');
const lines = raw.split(/\r?\n/);
const idx = lines.findIndex((l) => l.startsWith('| 43 |'));
if (idx === -1) { console.error('row 43 not found — refusing to guess'); process.exit(1); }

const row = lines[idx];
const START = '🟡 **PARTLY GUARDED — corrected DOWN from my original UNGUARDED claim';
const at = row.indexOf(START);
if (at === -1) { console.error('status cell start marker not found — refusing to guess'); process.exit(1); }
if (row.indexOf(START, at + 1) !== -1) { console.error('start marker is not unique'); process.exit(1); }

const NEW_STATUS = [
  '🟡 **PARTLY GUARDED — and the half this row called UNGUARDED is now DETECTED (#1014 completed 2026-10-01, primary).**',
  'The split is implemented (`splitPnlByVolume` in `nest/src/modules/providers/pnl-split.ts`, called from',
  '`position-sync.service.ts`), so N rows sharing one position **SUM** to it instead of each claiming it.',
  'Arithmetic canaried by `pnl-split.spec.ts` (18 cases on the incident\'s own numbers); the reconciler path by',
  '4 cases in `position-sync.service.spec.ts`.',
  '⚠️ **The "not verifiable yet" premise is RETIRED, and how it was wrong is the carry:** it argued no multi-row',
  'position exists — true of the END-TO-END path, false of the ARITHMETIC, which is a pure function over deal',
  'rows. Live 2026-10-01: 473 rows, 231 positions, **0 multi-row positions** — so the live path stays',
  '**UNEXERCISED**, stated rather than implied.',
  '⚠️ **The overstatement direction now has a DETECTOR:** `nest/scripts/audit-trade-pnl-attribution.cjs` flags N',
  'rows carrying the SAME non-zero pnl — the whole-net-booking signature, since a correct volume split yields',
  'differing proportions. Self-test **11/11**; canary **VALID in both directions** with a hash-verified restore.',
  '⚠️ **Its limit, asserted in its own self-test:** four EQUAL fills split correctly also produce equal pnl and',
  'are flagged, so a finding means *"look at this position"*, never *"proven"*.',
  '⚠️ **History repair added and verified live:** the adapter now carries `orderId` and the reconciler resolves',
  'an order ticket → its position, so rows written BEFORE the fix are repairable — measured against the real',
  'bridges, **16/16 legacy tickets resolve**. ⚠️ A count by ticket is worthless for those rows (four orders →',
  'four different tickets → each counts 1 → sole-owner → the whole net four times, the overstatement restored',
  'through the side door), so resolving from an order id **forces** the volume split.',
  '`validate-pnl-integrity.cjs` remains the symptom guard, unchanged.',
  '⚠️ **Still unguarded, said plainly:** nothing fails the build if the split CALL is deleted from the',
  'reconciler — the audit detects the RESULT, not the absence.',
  '⚠️ **A detector gap, measured:** `detect-circular-work.cjs` returned *"No topic reached the 3-touch',
  'threshold"* while row 23 already contained the answer |',
].join(' ');

// ⚠️ SPLICED BY INDEX, NOT `split('|')`. This row contains a stray pipe inside one of its long
// cells, so splitting yields 7 parts instead of 6 and a "last cell" rebuild would silently shift the
// boundary. The first run of this script refused for exactly that reason — correct behaviour, and the
// reason the fallback is an index splice rather than a looser count check.
// The status cell runs from the marker to the row's final ` |`.
if (!row.trimEnd().endsWith('|')) { console.error('row does not end with |'); process.exit(1); }
const prefix = row.slice(0, at);
const rebuilt = prefix + NEW_STATUS.replace(/ \|$/, '').replace(/\s+$/, '') + ' |';

if (!rebuilt.startsWith('| 43 |')) { console.error('rebuild lost the row id'); process.exit(1); }
lines[idx] = rebuilt;
fs.writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log(`row 43 updated — ${row.length} -> ${rebuilt.length} chars`);
