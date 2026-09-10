import {
  normalizeSide,
  sideDirection,
  unrealizedPnlAmount,
  unrealizedPnlPct,
  resolvePositionPnl,
} from './position-pnl';

/**
 * Regression tests for the 2026-09-10 data-quality investigation.
 *
 * Reported symptom: the Ladder "Details" panel showed a row with
 * `P&L +56.13` beside `P&L −1.70%` — the amount came from the broker (a
 * profitable XAUUSD SHORT) while the percentage was computed with a long-only
 * formula, so the two disagreed in sign inside one payload.
 */
describe('position-pnl — side-aware P&L', () => {
  it('reports a profitable short as positive in both the amount and the percentage', () => {
    // XAUUSD short: entry 4478.47 → 4402.48 (price −1.70%) = a PROFIT.
    const { pnl, pnlPct } = resolvePositionPnl({
      side: 'sell',
      avgPrice: 4478.47,
      currentPrice: 4402.48,
      quantity: 0.01,
      brokerPnl: 56.13,
    });

    expect(pnl).toBe(56.13);
    expect(pnlPct).toBeGreaterThan(0); // was −1.70 before the fix
    expect(pnlPct).toBeCloseTo(1.697, 2);
  });

  it('reports a losing short as negative', () => {
    const { pnlPct } = resolvePositionPnl({
      side: 'sell',
      avgPrice: 4400,
      currentPrice: 4478.47,
      quantity: 0.01,
    });
    expect(pnlPct).toBeCloseTo(-1.783, 2);
  });

  it('leaves long behaviour unchanged', () => {
    expect(unrealizedPnlPct(100, 110, 'buy')).toBeCloseTo(10, 6);
    expect(unrealizedPnlPct(100, 90, 'buy')).toBeCloseTo(-10, 6);
    expect(unrealizedPnlAmount(100, 110, 2, 'buy')).toBeCloseTo(20, 6);
  });

  it('treats quantity as a magnitude so a negative short size cannot double-negate', () => {
    expect(unrealizedPnlAmount(100, 90, -2, 'sell')).toBeCloseTo(20, 6);
  });

  it('normalises the brokers\u2019 side representations', () => {
    expect(normalizeSide(0)).toBe('buy'); // MT5 numeric type codes
    expect(normalizeSide(1)).toBe('sell');
    expect(normalizeSide('SELL')).toBe('sell');
    expect(normalizeSide('short')).toBe('sell');
    expect(normalizeSide('buy')).toBe('buy');
    expect(normalizeSide(null)).toBe('buy'); // unknown side = long, as before
    expect(sideDirection(null)).toBe(1);
    expect(sideDirection('sell')).toBe(-1);
  });

  it('overrides a percentage whose sign contradicts the resolved amount', () => {
    // The exact reported shape: amount positive, percentage negative.
    const { pnlPct } = resolvePositionPnl({
      side: 'sell',
      avgPrice: 4478.47,
      currentPrice: 4402.48,
      quantity: 0.01,
      brokerPnl: 56.13,
      brokerPnlPct: -1.7,
    });
    expect(pnlPct).toBeGreaterThan(0);
  });

  it('falls back to the computed amount when the broker omits pnl', () => {
    const { pnl, pnlPct } = resolvePositionPnl({
      side: 'sell',
      avgPrice: 100,
      currentPrice: 90,
      quantity: 1,
      brokerPnl: undefined,
    });
    expect(pnl).toBeCloseTo(10, 6);
    expect(pnlPct).toBeCloseTo(10, 6);
  });

  it('returns null instead of fabricating a percentage', () => {
    expect(unrealizedPnlPct(0, 10, 'buy')).toBeNull();
    expect(unrealizedPnlPct(null, 10, 'buy')).toBeNull();
    expect(unrealizedPnlPct(100, null, 'buy')).toBeNull();
    expect(unrealizedPnlAmount(100, null, 1, 'buy')).toBeNull();
  });

  it('replaces a stale stored amount once the side is known (QNTM shape)', () => {
    // Stored pnl from an earlier import (+0.22) vs current prices that say a
    // loss (29.83 → 29.74). Known side = the price-derived amount wins.
    const { pnl, pnlPct, amountOverridden } = resolvePositionPnl({
      side: 'buy',
      avgPrice: 29.83,
      currentPrice: 29.74,
      quantity: 6,
      brokerPnl: 0.22,
    });

    expect(amountOverridden).toBe(true);
    expect(pnl).toBeCloseTo(-0.54, 2);
    expect(pnlPct).toBeLessThan(0);
    expect(Math.sign(pnl!)).toBe(Math.sign(pnlPct!));
  });

  it('withholds the percentage when the side is unknown and the pair disagrees', () => {
    const { pnl, pnlPct } = resolvePositionPnl({
      side: null,
      avgPrice: 29.83,
      currentPrice: 29.74,
      quantity: 6,
      brokerPnl: 0.22,
    });

    expect(pnl).toBe(0.22); // keep the broker amount
    expect(pnlPct).toBeNull(); // rather than publish a contradicting pair
  });

  it('keeps an agreeing pair untouched', () => {
    const { pnl, pnlPct, amountOverridden } = resolvePositionPnl({
      side: 'buy',
      avgPrice: 100,
      currentPrice: 110,
      quantity: 2,
      brokerPnl: 20,
    });

    expect(pnl).toBe(20);
    expect(pnlPct).toBeCloseTo(10, 6);
    expect(amountOverridden).toBe(false);
  });
});
