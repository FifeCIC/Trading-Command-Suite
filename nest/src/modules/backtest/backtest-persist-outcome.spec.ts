import { persistOutcome } from './backtest.service';

/**
 * persistOutcome() — #1210: a computed run that stored nothing must say so.
 *
 * ⚠️ WHY THIS SPEC EXISTS. The defect it guards was invisible for exactly one reason: nothing
 * compared "I computed trades" against "a row exists". A 150-day run returned 200 with full stats,
 * wrote no `backtestrun` row, and logged neither the success line nor the catch — so a caller could
 * not tell it apart from a stored run. The cause is still not isolated (#1210); this pins the
 * REPORTING so the next occurrence is visible in one place.
 *
 * CANARY (2026-11-06, both directions — restore and re-run before trusting):
 *   • `shouldWarn: !persisted` (drop the trades guard) → 'a run with NO trades does not warn' fails
 *   • `persisted: true` unconditionally              → 'a missing run is not persisted' fails
 */

describe('persistOutcome — did this run actually get stored?', () => {
  it('a stored run reports persisted and no reason', () => {
    const o = persistOutcome('run-123', 9, null);
    expect(o.persisted).toBe(true);
    expect(o.persistedReason).toBeNull();
    expect(o.shouldWarn).toBe(false);
    expect(o.message).toBeNull();
  });

  it('a missing run with trades is NOT persisted and WARNS with the count', () => {
    const o = persistOutcome(null, 9, null);
    expect(o.persisted).toBe(false);
    expect(o.shouldWarn).toBe(true);
    expect(o.message).toContain('9 trade(s)');
    expect(o.message).toContain('not in backtestrun');
  });

  it('the reason travels into the message when one was reported', () => {
    const o = persistOutcome(null, 4, 'no symbol row for NOPE');
    expect(o.persistedReason).toBe('no symbol row for NOPE');
    expect(o.message).toContain('no symbol row for NOPE');
  });

  it('an unreported reason says so rather than inventing one', () => {
    const o = persistOutcome(null, 1, null);
    expect(o.persistedReason).toBe('not reported');
  });

  it('a run with NO trades does not warn — an empty run is not data loss', () => {
    const o = persistOutcome(null, 0, null);
    expect(o.persisted).toBe(false);
    expect(o.shouldWarn).toBe(false);
  });
});
