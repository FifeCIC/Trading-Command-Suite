/**
 * score-history.tier.spec.ts — #1029's acceptance table, PINNED.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS, GIVEN A BUILD GATE ALREADY COVERS THE CLASS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `nest/scripts/validate-signal-classification.cjs` forbids the SHAPE (a prefix test on a signal)
 * anywhere in the tree. That is not the same claim as "the mapping is CORRECT", and #1029's
 * acceptance asked for both:
 *
 *   > *"A row with `latestSignal = 'STRONG_BUY'` classifies as `entry`; `'STRONG_SELL'` as
 *   > `defensive`; `'HOLD'` as `watch`. A test asserts the table above, so a reintroduced prefix test
 *   > fails."*
 *
 * A gate that forbids a shape can be satisfied by a different wrong shape — e.g. `classifySignal`
 * being called but the ternary branches written the wrong way round. This file pins the BEHAVIOUR, so
 * that swap fails too.
 *
 * ⚠️ CANARY: replace `analysisTier`'s body with the shipped prefix test
 * (`signal.startsWith('BUY') ? 'entry' : signal.startsWith('SELL') ? 'defensive' : 'watch'`) and the
 * two `STRONG_*` rows fail — which is precisely the defect (#1029), and the reason the build gate was
 * added alongside this test rather than instead of it.
 */
import { analysisTier } from './score-history.service';

describe('analysisTier — the display tier for a signal class (#1029)', () => {
  /** The table from the issue, verbatim. */
  const TABLE: Array<[string, 'entry' | 'defensive' | 'watch']> = [
    ['BUY', 'entry'],
    ['STRONG_BUY', 'entry'],
    ['SELL', 'defensive'],
    ['STRONG_SELL', 'defensive'],
    ['HOLD', 'watch'],
  ];

  it.each(TABLE)('%s -> %s', (signal, tier) => {
    expect(analysisTier(signal)).toBe(tier);
  });

  it('holds the FULL table — the two STRONG rows are the whole point', () => {
    // ⚠️ Asserts COVERAGE, not just correctness: the defect was never that the five rows were wrong,
    // it was that two of them were UNREACHABLE by prefix. A table that quietly loses the STRONG rows
    // would pass the cases above while covering nothing.
    expect(TABLE.map(([s]) => s)).toEqual(['BUY', 'STRONG_BUY', 'SELL', 'STRONG_SELL', 'HOLD']);
    expect(analysisTier('STRONG_BUY')).toBe('entry');
    expect(analysisTier('STRONG_SELL')).toBe('defensive');
  });

  it('a STRONG class is NOT demoted to watch — the exact shipped symptom', () => {
    // The two highest-conviction values the system can produce must never read as "no view".
    expect(analysisTier('STRONG_BUY')).not.toBe('watch');
    expect(analysisTier('STRONG_SELL')).not.toBe('watch');
  });

  it('degrades an unrecognised class to watch, never into a direction', () => {
    // ⚠️ `STRONG_SEL` is the TRUNCATED #1028 value. It is not a class, so it must degrade rather
    // than be guessed — but the point is that it is now STORED correctly and this is only a fallback.
    ['', null, undefined, 'STRONG_SEL', 'WHATEVER', 'HOLDING'].forEach((v) => {
      expect(analysisTier(v)).toBe('watch');
    });
  });

  it('accepts the direction words the codebase also uses', () => {
    // `signal-direction.ts` accepts LONG/SHORT/NEUTRAL because both vocabularies are in use.
    expect(analysisTier('LONG')).toBe('entry');
    expect(analysisTier('SHORT')).toBe('defensive');
    expect(analysisTier('NEUTRAL')).toBe('watch');
  });

  it('is case-insensitive, so a lowercased store cannot silently degrade', () => {
    expect(analysisTier('strong_sell')).toBe('defensive');
    expect(analysisTier('buy')).toBe('entry');
  });
});
