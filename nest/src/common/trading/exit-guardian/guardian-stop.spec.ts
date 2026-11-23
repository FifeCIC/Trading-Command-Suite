/**
 * guardian-stop.spec.ts — the guardian's rule, and the equivalence that keeps it ONE rule.
 *
 * ⚠️ THE EQUIVALENCE CASE IS THE POINT. `guardianStopDecision()` now exists beside the live tick, which
 * still carries its own inline branch. Two implementations of one rule drift, and only one gets the next
 * fix — so a grid of inputs is computed BOTH ways and must agree. When the live branch is rewritten to
 * call the shared function, this case becomes redundant rather than wrong.
 */
import {
  GUARDIAN_MIN_CONSENSUS,
  declaredStopDistance,
  trailDistanceFor,
  guardianStopDecision,
} from './guardian-stop';

describe('guardian-stop — one rule for the live tick and any other driver', () => {
  const base = {
    side: 'BUY' as const,
    price: 100,
    currentSl: 98,
    atrValue: 0.5,          // 3 x ATR = 1.5
    entryPrice: 99,
    slPct: 1,               // declared distance = 0.99
    stopConfidence: 62,
  };

  it('▶ CANARY — a BUY tightens to price minus the trail distance', () => {
    const d = guardianStopDecision(base);
    expect(d.outcome).toBe('adjusted');
    expect(d.newSl).toBeCloseTo(98.5, 6);
    expect(d.trailDistance).toBeCloseTo(1.5, 6);
  });

  it('▶ CANARY — a SELL tightens DOWNWARD, never upward', () => {
    // A mirror-image bug would move a short's stop the wrong way and widen risk silently.
    const sell = guardianStopDecision({
      ...base, side: 'SELL', price: 100, currentSl: 102, entryPrice: 101,
    });
    expect(sell.outcome).toBe('adjusted');
    expect(sell.newSl).toBeCloseTo(101.5, 6);
    expect(sell.newSl!).toBeLessThan(102);
  });

  it('▶ CANARY — a stop is never LOOSENED when the recommendation is worse', () => {
    // Price fell, so price − 1.5 is below the stop in force: nothing to do.
    const d = guardianStopDecision({ ...base, price: 99, currentSl: 98.2 });
    expect(d.outcome).toBe('at-target');
    expect(d.newSl).toBeNull();
  });

  it('the consensus boundary is INCLUSIVE at 55', () => {
    expect(guardianStopDecision({ ...base, stopConfidence: GUARDIAN_MIN_CONSENSUS }).outcome).toBe('adjusted');
    expect(guardianStopDecision({ ...base, stopConfidence: GUARDIAN_MIN_CONSENSUS - 1 }).outcome).toBe('below-threshold');
  });

  /**
   * ⚠️ THE FIRST VERSION OF THIS CASE WAS WRONG, and the correction is the finding: a small ATR is
   * FLOORED to the declared distance, not refused. The live `trailDistanceProblem()` says so itself
   * ("with `trailDistanceFor` max()ing, this should never fire"). A refusal here would have made a
   * backtest decline tightens the live account performs.
   */
  it('▶ CANARY — 3 x ATR inside the DECLARED risk is FLOORED to the declared distance, not refused', () => {
    const d = guardianStopDecision({ ...base, atrValue: 0.01 });
    expect(d.outcome).toBe('adjusted');
    expect(d.trailDistance).toBeCloseTo(0.99, 6);   // the declared distance, not 0.03
    expect(d.newSl).toBeCloseTo(99.01, 6);
  });

  it('no usable ATR is a no-recommendation, never a zero distance', () => {
    expect(guardianStopDecision({ ...base, atrValue: 0 }).outcome).toBe('no-recommendation');
    expect(guardianStopDecision({ ...base, atrValue: Number.NaN }).outcome).toBe('no-recommendation');
  });

  it('an unusable price is a no-recommendation rather than a level computed from it', () => {
    expect(guardianStopDecision({ ...base, price: 0 }).outcome).toBe('no-recommendation');
    expect(guardianStopDecision({ ...base, price: Number.NaN }).outcome).toBe('no-recommendation');
  });

  it('the declared distance falls back to 1% for a zero or missing slPct, exactly as live does', () => {
    expect(declaredStopDistance(100, 0)).toBeCloseTo(1, 6);
    expect(declaredStopDistance(100, null as unknown as number)).toBeCloseTo(1, 6);
    expect(declaredStopDistance(100, 2.5)).toBeCloseTo(2.5, 6);
    expect(declaredStopDistance(0, 2.5)).toBe(0);            // no entry → no distance
    expect(trailDistanceFor(0.1, 2.5)).toBeCloseTo(2.5, 6);  // the floor wins
    expect(trailDistanceFor(2, 2.5)).toBeCloseTo(6, 6);      // ATR wins when wider
  });

  /**
   * ⚠️ THE LIVE TICK'S INLINE BRANCH, written out here as the reference. If this and the shared function
   * ever disagree, one of them has drifted — which is the failure this file exists to catch.
   */
  it('▶ CANARY — equivalence with the live tick’s inline rule across a grid', () => {
    const liveDecide = (side: 'BUY' | 'SELL', price: number, sl: number | null, atr: number, entry: number, slPct: number, conf: number) => {
      const declaredDistance = declaredStopDistance(entry, slPct);
      const trailDistance = trailDistanceFor(atr, declaredDistance);
      const distanceProblem = !(atr > 0) || trailDistance < declaredDistance;
      let recommendedSl: number | null = null;
      if (atr > 0 && !distanceProblem) {
        recommendedSl = side === 'BUY' ? price - trailDistance : price + trailDistance;
        if (sl != null && sl > 0) {
          if (side === 'BUY' && recommendedSl < sl) recommendedSl = sl;
          if (side === 'SELL' && recommendedSl > sl) recommendedSl = sl;
        }
      }
      const shouldAdjust = conf >= 55 && recommendedSl !== null && Math.abs(recommendedSl - (sl || 0)) > 0.00001;
      return shouldAdjust ? recommendedSl : null;
    };

    const prices = [95, 99, 100, 101, 105];
    const stops = [null, 0, 96, 98, 99.5];
    const atrs = [0, 0.05, 0.5, 3];
    const confs = [40, 55, 70];
    let compared = 0;
    for (const side of ['BUY', 'SELL'] as const) {
      for (const price of prices) {
        for (const sl of stops) {
          for (const atr of atrs) {
            for (const conf of confs) {
              const live = liveDecide(side, price, sl, atr, 99, 1, conf);
              const shared = guardianStopDecision({
                side, price, currentSl: sl, atrValue: atr, entryPrice: 99, slPct: 1, stopConfidence: conf,
              });
              const sharedLevel = shared.outcome === 'adjusted' ? shared.newSl : null;
              // A null must match a null: "no order" is a decision too.
              if (live === null) expect(sharedLevel).toBeNull();
              else expect(sharedLevel).toBeCloseTo(live, 6);
              compared += 1;
            }
          }
        }
      }
    }
    // A guard against the grid silently collapsing to nothing.
    expect(compared).toBe(2 * prices.length * stops.length * atrs.length * confs.length);
  });
});
