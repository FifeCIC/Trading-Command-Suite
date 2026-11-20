/**
 * exit-equivalence.spec.ts — the backtest and the live path must be comparable, and honestly so.
 *
 * ⚠️ THE CASES THAT MATTER ARE THE NON-EQUAL ONES. `TRAIL` and `EOD` are where a careless mapping
 * invents a live event that never happened.
 */
import { ENGINE_EXIT_REASONS, engineExitEquivalence, engineExitCloseReason } from './exit-equivalence';
import { CLOSE_REASONS } from '../close-reason';

describe('engine exit → live close reason', () => {
  it('▶ CANARY — every engine exit reason has a row, so a sixth one cannot appear unmapped', () => {
    for (const reason of ENGINE_EXIT_REASONS) {
      expect(engineExitEquivalence(reason)).not.toBeNull();
    }
    // A value the engine does not emit is NOT mapped — no guessed fallback.
    expect(engineExitEquivalence('PARTIAL')).toBeNull();
    expect(engineExitEquivalence('')).toBeNull();
  });

  it('TP and SL are the same events as resting broker orders filling', () => {
    expect(engineExitEquivalence('TP')).toMatchObject({ closeReason: CLOSE_REASONS.BROKER_TP, equivalent: 'exact' });
    expect(engineExitEquivalence('SL')).toMatchObject({ closeReason: CLOSE_REASONS.BROKER_SL, equivalent: 'exact' });
  });

  it('TIME is the same mechanism as the live time stop', () => {
    expect(engineExitEquivalence('TIME')).toMatchObject({
      closeReason: CLOSE_REASONS.SYSTEM_TIME_STOP, equivalent: 'exact',
    });
  });

  it('▶ CANARY — TRAIL is QUALIFIED, because live records the trail and moves nothing', () => {
    const e = engineExitEquivalence('TRAIL')!;
    expect(e.equivalent).toBe('qualified');
    expect(e.note).toContain('#936');
    // It still maps — a tightened stop fills — but the distinction is not silently dropped.
    expect(e.closeReason).toBe(CLOSE_REASONS.BROKER_SL);
  });

  it('▶ CANARY — EOD has NO live counterpart, and says so rather than borrowing one', () => {
    const e = engineExitEquivalence('EOD')!;
    expect(e.closeReason).toBeNull();
    expect(e.equivalent).toBe('none');
    expect(engineExitCloseReason('EOD')).toBeNull();
  });

  it('an unmapped reason and EOD are distinguishable — both are null from different causes', () => {
    expect(engineExitEquivalence('NOPE')).toBeNull();          // a defect: no row at all
    expect(engineExitEquivalence('EOD')).not.toBeNull();        // a correct absence: a row with no value
  });

  it('every mapped value is a real member of the canonical vocabulary', () => {
    const canonical = new Set(Object.values(CLOSE_REASONS));
    for (const reason of ENGINE_EXIT_REASONS) {
      const e = engineExitEquivalence(reason)!;
      if (e.closeReason) expect(canonical.has(e.closeReason)).toBe(true);
    }
  });
});
