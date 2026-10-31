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

/**
 * #1155 — A SHORT PAYS THE SAME COST IN THE OPPOSITE DIRECTION.
 *
 * ⚠️ Both directions must be asserted, because the failure mode of getting this wrong is SILENT: the
 * wrong sign CREDITS the round trip to every short instead of charging it, so a short run reports
 * better-than-free fills and the question the feature exists to answer ("is shorting VIX more
 * profitable?") is answered in the wrong direction by an accounting bug.
 */
describe('applyExecutionCosts — side', () => {
  const pctCost = (close: number, exit: number, spread: number, slip: number, side: 1 | -1) => {
    const { entryCost, exitCost } = applyExecutionCosts(close, exit, spread, slip, side);
    // Long: cost = entry − close, plus exit − cost. Short: close − entry, plus cost − exit.
    return side > 0
      ? ((entryCost - close) + (exit - exitCost)) / close * 100
      : ((close - entryCost) + (exitCost - exit)) / close * 100;
  };

  it('charges the SAME round-trip percentage on a short as on a long', () => {
    for (const close of [1, 17, 100_000]) {
      const long = pctCost(close, close, 0.01, 0.01, 1);
      const short = pctCost(close, close, 0.01, 0.01, -1);
      expect(long).toBeCloseTo(3, 6);
      expect(short).toBeCloseTo(3, 6);
      // Same magnitude, opposite side of the mid — not the same sign.
      expect(Math.sign(long)).toBe(Math.sign(short));
    }
  });

  it('sites a short entry BELOW the mid and its exit ABOVE the level', () => {
    const { entryCost, exitCost } = applyExecutionCosts(17, 16.15, 0.01, 0.01, -1);
    expect(entryCost).toBeCloseTo(17 * 0.985, 6); // sells at the bid
    expect(exitCost).toBeCloseTo(16.15 * 1.015, 6); // buys back at the ask
  });

  it('defaults to the long side, so every existing caller and stored number is unchanged', () => {
    const implied = applyExecutionCosts(17, 17.85, 0.01, 0.01);
    const explicitLong = applyExecutionCosts(17, 17.85, 0.01, 0.01, 1);
    expect(implied).toEqual(explicitLong);
  });

  it('a winning short nets slightly MORE than the mirror long, and the asymmetry is stated not hidden', () => {
    // ⚠️ THE TWO SIDES ARE NOT EXACTLY SYMMETRIC, and this test records the real number rather than an
    // ideal one. Costs are charged as a fraction of EACH LEG'S OWN PRICE, so on a winner the second leg
    // is charged on a lower price for a short (16.39) than for a long (17.58), while the return is
    // measured against a lower entry (16.745 vs 17.255). Measured: 5% move at a 3% round trip nets
    // **1.897% long / 2.107% short** — 0.21pp apart.
    //
    // That is a property of proportional costs, not a bug, and it is stated here because the obvious
    // "they should be equal" assertion is wrong and would be "fixed" by breaking the model.
    const close = 17;
    const long = applyExecutionCosts(close, close * 1.05, 0.01, 0.01, 1);
    const short = applyExecutionCosts(close, close * 0.95, 0.01, 0.01, -1);
    const longNet = (long.exitCost / long.entryCost - 1) * 100;
    const shortNet = (1 - short.exitCost / short.entryCost) * 100;

    expect(longNet).toBeCloseTo(1.897, 3);
    expect(shortNet).toBeCloseTo(2.107, 3);
    // Both stay well under the 5% move: the round trip is genuinely charged on each side.
    expect(shortNet).toBeLessThan(5);
    expect(longNet).toBeGreaterThan(0);
    // And the sign is right: a LOSING short is charged, not credited.
    const losingShort = applyExecutionCosts(close, close * 1.05, 0.01, 0.01, -1);
    expect((1 - losingShort.exitCost / losingShort.entryCost) * 100).toBeLessThan(-5);
  });
});
