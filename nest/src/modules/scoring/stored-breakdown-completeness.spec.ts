/**
 * stored-breakdown-completeness.spec.ts — closes a bug class that has now bitten TWICE.
 *
 * ⚠️ THE TRAP. `storeSnapshot()` writes `score.breakdown` as a field-by-field OBJECT LITERAL; it does
 * not spread `breakdownData`. So a diagnostic added to the `breakdownData` type is:
 *   • accepted by TypeScript,
 *   • computed in `scoreWithGating()`,
 *   • returned to every caller in `meta`, so every live check passes —
 *   • and SILENTLY DROPPED on the way to the database.
 *
 * Measured instances:
 *   2026-10-19 — `directionalEvidence`, computed since #758 and thrown away on write.
 *   2026-10-21 — `earnableSignalMax` and `thresholdBasis`, absent from every stored row for eight
 *                 hours while `GET /api/scoring/gated/...` returned both correctly. Only decoding a
 *                 stored row revealed it. Both were fixed by adding them to the literal.
 *
 * A warning comment did not prevent the second occurrence, so this is a check instead: every key on
 * the `breakdownData` type must appear in the persisted literal, or be listed as a deliberate skip
 * WITH a reason. Adding a field and forgetting the literal now fails the suite.
 *
 * ⚠️ A verifier that cannot read its input must ERROR, never pass — a parse that yields zero keys
 * throws rather than comparing two empty sets and reporting success.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = join(__dirname, 'protocol-gating.service.ts');

/** Fields on `breakdownData` deliberately NOT written to `score.breakdown`, and why. */
const INTENTIONAL_SKIPS: Record<string, string> = {
  compositePct: 'derived from rawComposite / rawMax on read; a stored copy is a second truth that can disagree',
};

function extractTypeKeys(src: string): string[] {
  const start = src.indexOf('    breakdownData: {');
  if (start < 0) throw new Error('cannot locate the `breakdownData:` type block — the source shape changed');
  const end = src.indexOf('    },', start);
  if (end < 0) throw new Error('cannot find the end of the `breakdownData:` type block');
  const block = src.slice(start, end);
  const keys = [...block.matchAll(/^\s{6}([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error('parsed ZERO fields from `breakdownData` — refusing to check an empty set');
  return [...new Set(keys)].sort();
}

function extractPersistedKeys(src: string): string[] {
  const start = src.indexOf('            breakdown: {');
  if (start < 0) throw new Error('cannot locate the persisted `breakdown:` literal — the source shape changed');
  const end = src.indexOf('            },', start);
  if (end < 0) throw new Error('cannot find the end of the persisted `breakdown:` literal');
  const block = src.slice(start, end);
  const keys = [...block.matchAll(/^\s{14}([a-zA-Z][a-zA-Z0-9]*):/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error('parsed ZERO fields from the persisted `breakdown:` literal — refusing to check an empty set');
  return [...new Set(keys)].sort();
}

describe('stored breakdown completeness', () => {
  const src = readFileSync(SOURCE, 'utf8');
  const typeKeys = extractTypeKeys(src);
  const persisted = new Set(extractPersistedKeys(src));

  it('parses both blocks (a parse failure must not read as a pass)', () => {
    expect(typeKeys.length).toBeGreaterThan(10);
    expect(persisted.size).toBeGreaterThan(10);
    // The two fields this guard was written for must be among them.
    expect(typeKeys).toEqual(expect.arrayContaining(['earnableSignalMax', 'thresholdBasis']));
    expect(persisted.has('earnableSignalMax')).toBe(true);
    expect(persisted.has('thresholdBasis')).toBe(true);
  });

  it('persists every field the scorer computed, or skips it deliberately', () => {
    const dropped = typeKeys.filter((k) => !persisted.has(k) && !(k in INTENTIONAL_SKIPS));
    // The message names the field(s) so the fix is obvious: add them to the `breakdown:` literal.
    expect(dropped).toEqual([]);
  });

  it('every intentional skip carries a reason (a bare skip is a silent drop with extra steps)', () => {
    for (const [field, reason] of Object.entries(INTENTIONAL_SKIPS)) {
      expect(typeKeys).toContain(field); // a skip for a field that no longer exists is stale
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it('does not persist a field that is not on the type (a typo writes null forever)', () => {
    const extra = [...persisted].filter((k) => !typeKeys.includes(k));
    // `rawComposite`, `rawMax`, `rarityPct`, `source` and `timestamp` are DERIVED at write time and
    // legitimately not inputs — they are allowed to exist only in the literal.
    const derived = ['rawComposite', 'rawMax', 'rarityPct', 'source', 'timestamp'];
    expect(extra.filter((k) => !derived.includes(k))).toEqual([]);
  });
});
