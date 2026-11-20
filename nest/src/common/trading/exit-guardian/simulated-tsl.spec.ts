/**
 * simulated-tsl.spec.ts — the shared trailing-stop decision.
 *
 * ⚠️ THE POINT OF THESE CASES IS THAT ONE FORMULA NOW SERVES BOTH PATHS. A long and a short must be
 * exact mirrors, an unconfigured bot must produce `null` rather than an armed trail at zero distance,
 * and the watermark must never move backwards — the three ways a trail stops being a trail.
 */
import { simulatedTslState, trailTriggerPrice, TRAIL_STRENGTH_NOTE } from './simulated-tsl';

describe('trailTriggerPrice', () => {
  it('sits the given distance BELOW the best price for a buy, and ABOVE for a sell', () => {
    expect(trailTriggerPrice('buy', 100, 5)).toBeCloseTo(95, 10);
    expect(trailTriggerPrice('sell', 100, 5)).toBeCloseTo(105, 10);
  });

  it('a zero distance is the best price itself — the caller must refuse it before calling', () => {
    // Documented, not guarded here: the guard lives in `simulatedTslState` and in each caller, because
    // this function is arithmetic and must stay total.
    expect(trailTriggerPrice('buy', 100, 0)).toBe(100);
  });
});

describe('simulatedTslState', () => {
  const config = { activationPct: 2, distancePct: 1 };

  it('▶ CANARY — an unconfigured bot produces NULL, never an armed trail at zero distance', () => {
    expect(simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: 110, config: {} })).toBeNull();
    expect(simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: 110, config: { activationPct: 2 } })).toBeNull();
    expect(simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: 110, config: { activationPct: 0, distancePct: 1 } })).toBeNull();
    expect(simulatedTslState({ side: 'buy', entryPrice: 0, currentPrice: 110, config })).toBeNull();
    expect(simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: NaN, config })).toBeNull();
  });

  it('is not armed until the position is activationPct in front', () => {
    const early = simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: 101, config })!;
    expect(early.profitPct).toBeCloseTo(1, 10);
    expect(early.armed).toBe(false);

    const armed = simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: 102, config })!;
    expect(armed.armed).toBe(true);
  });

  it('tracks the best price and reports a touch when the price crosses the trigger', () => {
    const climbing = simulatedTslState({
      side: 'buy', entryPrice: 100, currentPrice: 110, bestSoFar: undefined, config,
    })!;
    expect(climbing.best).toBe(110);
    expect(climbing.triggerPrice).toBeCloseTo(108.9, 10);
    expect(climbing.touched).toBe(false);

    const pulledBack = simulatedTslState({
      side: 'buy', entryPrice: 100, currentPrice: 108.8, bestSoFar: 110, config,
    })!;
    expect(pulledBack.best).toBe(110); // the watermark did NOT follow the price down
    expect(pulledBack.touched).toBe(true);
  });

  it('▶ CANARY — the watermark never moves backwards, in either direction', () => {
    const long = simulatedTslState({ side: 'buy', entryPrice: 100, currentPrice: 104, bestSoFar: 112, config })!;
    expect(long.best).toBe(112);

    const short = simulatedTslState({ side: 'sell', entryPrice: 100, currentPrice: 96, bestSoFar: 88, config })!;
    expect(short.best).toBe(88); // for a sell, "best" is the LOWEST price
  });

  it('a sell is the exact mirror: profit, trigger above the best, touch on the way up', () => {
    const st = simulatedTslState({ side: 'sell', entryPrice: 100, currentPrice: 90, bestSoFar: undefined, config })!;
    expect(st.profitPct).toBeCloseTo(10, 10);
    expect(st.best).toBe(90);
    expect(st.triggerPrice).toBeCloseTo(90.9, 10);
    expect(st.touched).toBe(false);

    const rising = simulatedTslState({ side: 'sell', entryPrice: 100, currentPrice: 91, bestSoFar: 90, config })!;
    expect(rising.touched).toBe(true);
  });

  it('profit is the favourable MOVE from entry, not the broker’s currency figure', () => {
    const st = simulatedTslState({ side: 'buy', entryPrice: 0.45, currentPrice: 2.24, config: { activationPct: 2, distancePct: 5 } })!;
    expect(st.profitPct).toBeCloseTo(397.7778, 3);
    expect(st.best).toBe(2.24);
  });

  it('states the strength difference, because a result must not imply protection live lacks', () => {
    expect(TRAIL_STRENGTH_NOTE).toContain('MOVES the stop');
    expect(TRAIL_STRENGTH_NOTE).toContain('#936');
  });
});
