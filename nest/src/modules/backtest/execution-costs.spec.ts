import { applyExecutionCosts, roundTripCost } from './execution-costs';

/**
 * execution-costs.spec.ts — the cost model must charge a PERCENTAGE, at any instrument price.
 *
 * WHY THIS EXISTS (#1146)
 * -----------------------
 * The engine charged `close + spread/2 + slippage`, i.e. it added the fraction as ABSOLUTE PRICE. That
 * under-charged every instrument not priced near 1.00 — measured 17x too little on VIX at ~17.00 — which
 * made a strategy that loses look profitable (+$141k on a $10,000 account) and made a 1%-target geometry
 * report a **0% win rate** once costs were real.
 *
 * The two cases that would have caught it are here: the charge must be the SAME PERCENTAGE at $1 and at
 * $100,000, and it must equal the figure the UI prints as "break-even".
 */

describe('applyExecutionCosts — a fraction of price, not a price', () => {
  it('charges the same PERCENTAGE whatever the instrument is priced at', () => {
    // 1% spread + 1% slippage each way = 3% round trip. If the charge depended on the absolute price this
    // pair would disagree, which is exactly what the old code did (VIX 0.088%, BTC ~0%).
    const cheap = applyExecutionCosts(1, 1, 0.01, 0.01);
    const dear = applyExecutionCosts(100_000, 100_000, 0.01, 0.01);

    const pct = (c: { entryCost: number; exitCost: number }, close: number) =>
      ((c.entryCost - c.exitCost) / close) * 100;

    expect(pct(cheap, 1)).toBeCloseTo(3, 6);
    expect(pct(dear, 100_000)).toBeCloseTo(3, 6);
  });

  it('moves the entry ABOVE the close and the exit BELOW the level, symmetrically', () => {
    const { entryCost, exitCost } = applyExecutionCosts(17, 17.85, 0.01, 0.01);
    expect(entryCost).toBeCloseTo(17 * 1.015, 6); // 1.5% above the mid
    expect(exitCost).toBeCloseTo(17.85 * 0.985, 6); // 1.5% below the level
  });

  it('nets a 5% target to ~1.9% at a 3.1% round trip — the number measured on VIX run 88c247f6', () => {
    const entry = 17;
    const tp = entry * 1.05;
    const { entryCost, exitCost } = applyExecutionCosts(entry, tp, 0.01, 0.01);
    const netPct = (exitCost / entryCost - 1) * 100;
    expect(netPct).toBeGreaterThan(1.8);
    expect(netPct).toBeLessThan(2.0);
  });

  it('is zero cost only when both inputs are zero', () => {
    const none = applyExecutionCosts(50, 55, 0, 0);
    expect(none.entryCost).toBe(50);
    expect(none.exitCost).toBe(55);

    const tiny = applyExecutionCosts(50, 55, 0.0001, 0.0001);
    expect(tiny.entryCost).toBeGreaterThan(50);
    expect(tiny.entryCost - 50).toBeLessThan(0.01); // 0.015% of 50
  });

  it('roundTripCost matches the figure the Costs & sizing step prints', () => {
    // "Break-even move 3.00% of price — 1% spread + 1% slippage each way".
    expect(roundTripCost(0.01, 0.01)).toBeCloseTo(0.03, 10);
    expect(roundTripCost(0.0001, 0.0001)).toBeCloseTo(0.0003, 10); // FX: ~3 pips round trip
    expect(roundTripCost(0, 0)).toBe(0);
  });
});
