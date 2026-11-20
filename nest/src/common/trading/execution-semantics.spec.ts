/**
 * execution-semantics.spec.ts — the version that decides whether two runs may be compared must itself
 * be checkable.
 *
 * ⚠️ THE FAILURE THIS PREVENTS IS SILENT IN BOTH DIRECTIONS. Bump the constant without an entry and
 * the comparison refuses every pair with no explanation; add an entry without bumping and the
 * comparison happily subtracts two runs computed by different rules. Neither throws.
 */
import {
  EXECUTION_SEMANTICS,
  SEMANTICS_LOG,
  sameSemantics,
  changesBetween,
} from './execution-semantics';

describe('EXECUTION_SEMANTICS', () => {
  it('the constant IS the last logged version', () => {
    expect(SEMANTICS_LOG.length).toBeGreaterThan(0);
    expect(SEMANTICS_LOG[SEMANTICS_LOG.length - 1].version).toBe(EXECUTION_SEMANTICS);
  });

  it('the log is contiguous from 1 and never repeats', () => {
    expect(SEMANTICS_LOG.map((c) => c.version)).toEqual(SEMANTICS_LOG.map((_, i) => i + 1));
  });

  it('every entry carries a real date, a reason and an issue', () => {
    for (const c of SEMANTICS_LOG) {
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.what.length).toBeGreaterThan(40);
      expect(Number.isInteger(c.issue)).toBe(true);
    }
  });

  it('▶ CANARY — two versions compare only when they are equal, and an unknown is refused', () => {
    expect(sameSemantics(1, 1)).toBe(true);
    expect(sameSemantics(1, 2)).toBe(false);
    // An absent version is NOT "the same": assuming equality is the guess that shows a delta.
    expect(sameSemantics(null, 1)).toBe(false);
    expect(sameSemantics(undefined, undefined)).toBe(false);
    expect(sameSemantics('2', 2)).toBe(true);
  });

  it('names the changes between two versions, in either direction', () => {
    expect(changesBetween(1, 1)).toEqual([]);
    // Version 2 (the session gate) must be named when a version-1 run is compared with today's, or the
    // refusal would say "the rules changed" without saying what changed.
    expect(changesBetween(1, 2).map((c) => c.version)).toEqual([2]);
    expect(changesBetween(2, 1).map((c) => c.version)).toEqual([2]);
  });
});
