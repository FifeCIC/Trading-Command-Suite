/**
 * stop-fill-gap.spec.ts — a fill assumption must be MEASURED, and "not recorded" must never read as
 * "no gap".
 */
import { summariseFillGap } from './stop-fill-gap';

describe('summariseFillGap — how optimistic is a fill at the stop level?', () => {
  it('▶ CANARY — a long is measured against the bar LOW and a short against the HIGH', () => {
    const s = summariseFillGap([
      // Long: stop 100, low 98 → 2% overshoot.
      { exitReason: 'SL', direction: 'LONG', exitPrice: 100, exitBarLow: 98, exitBarHigh: 110 },
      // Short: stop 100, high 103 → 3% overshoot.
      { exitReason: 'SL', direction: 'SHORT', exitPrice: 100, exitBarLow: 95, exitBarHigh: 103 },
    ]);
    expect(s.measured).toBe(2);
    expect(s.beyond).toBe(2);
    expect(s.worstPct).toBe(3);
    expect(s.note).toContain('2 of 2');
  });

  it('▶ CANARY — a bar that never passed the stop is measured and NOT counted as beyond', () => {
    const s = summariseFillGap([
      { exitReason: 'SL', direction: 'LONG', exitPrice: 98, exitBarLow: 98.5, exitBarHigh: 101 },
    ]);
    expect(s.measured).toBe(1);      // it WAS measured — this is not "not recorded"
    expect(s.beyond).toBe(0);
    expect(s.medianPct).toBeNull();  // no population to take a median of
  });

  it('▶ CANARY — a run with no exit-bar fields reports measured 0 and NO note, never a clean bill', () => {
    const s = summariseFillGap([
      { exitReason: 'SL', direction: 'LONG', exitPrice: 100 },   // pre-2026-11-23 shape
    ]);
    expect(s.measured).toBe(0);
    expect(s.beyond).toBe(0);
    expect(s.note).toBeNull();
  });

  it('only stop exits count — a TP or TIME exit has no stop level to be optimistic about', () => {
    const s = summariseFillGap([
      { exitReason: 'TP', direction: 'LONG', exitPrice: 100, exitBarLow: 90, exitBarHigh: 110 },
      { exitReason: 'TIME', direction: 'LONG', exitPrice: 100, exitBarLow: 90, exitBarHigh: 110 },
      { exitReason: 'TRAIL', direction: 'LONG', exitPrice: 100, exitBarLow: 95, exitBarHigh: 110 },
    ]);
    expect(s.measured).toBe(1);
    expect(s.beyond).toBe(1);
    expect(s.worstPct).toBe(5);
  });

  it('empty and absent inputs report zero rather than throwing', () => {
    expect(summariseFillGap([]).measured).toBe(0);
    expect(summariseFillGap(undefined).note).toBeNull();
    expect(summariseFillGap(null).beyond).toBe(0);
  });

  /**
   * ── "NOTHING TO MEASURE" IS NOT ONE STATE (2026-11-26) ─────────────────────────────────────────
   * `measured: 0` covered two possible facts: a population with NO stop exit, and a stop exit recorded
   * WITHOUT the bar's adverse extreme. The counters below make them separable.
   *
   * 🛑 The second state was NOT observed when this was written — an apparent instance on
   * `movers-winners-2026-11-19` turned out to be trades the SELECTION REFUSED, which are in the run's
   * detail but not in the admitted population. The canary is precautionary; do not cite that day.
   */
  it('▶ CANARY — no stop exit and an unreadable stop exit are DIFFERENT states', () => {
    const none = summariseFillGap([
      { exitReason: 'TP', direction: 'LONG', exitPrice: 100, exitBarLow: 90, exitBarHigh: 110 },
      { exitReason: 'TIME', direction: 'LONG', exitPrice: 100, exitBarLow: 90, exitBarHigh: 110 },
    ]);
    expect(none.stopExits).toBe(0);
    expect(none.unrecorded).toBe(0);

    const unreadable = summariseFillGap([
      { exitReason: 'SL', direction: 'LONG', exitPrice: 100 },
      { exitReason: 'SL', direction: 'LONG', exitPrice: 100 },
    ]);
    expect(unreadable.stopExits).toBe(2);
    expect(unreadable.unrecorded).toBe(2);
    expect(unreadable.measured).toBe(0);
    // The note contract is unchanged, so no other page starts rendering because of this field.
    expect(unreadable.note).toBeNull();
  });

  it('counts the unreadable stop exits ALONGSIDE the measured ones', () => {
    const s = summariseFillGap([
      { exitReason: 'SL', direction: 'LONG', exitPrice: 100, exitBarLow: 98, exitBarHigh: 110 },
      { exitReason: 'SL', direction: 'LONG', exitPrice: 100 },
    ]);
    expect(s.stopExits).toBe(2);
    expect(s.measured).toBe(1);
    expect(s.unrecorded).toBe(1);
  });
});
