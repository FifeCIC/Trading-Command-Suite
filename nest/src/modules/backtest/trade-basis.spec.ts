/**
 * trade-basis.spec.ts — canary for #1135 parts 1 and 2.
 *
 * ⚠️ WHY THIS FILE EXISTS: both figures were computed inline inside `run()`, which needs a database,
 * a protocol and a window to reach. So neither could be tested, and #1135's own acceptance criterion
 * — "each fix carries a guard test that has been observed to fail without it" — could not be met.
 * Extracting them to `trade-basis.ts` changed no arithmetic; it changed the address of the test.
 *
 * ── #1135 part 1, the unit trap this pins ─────────────────────────────────────────────────────────
 * `avgTradePnl` is a percentage OF THE POSITION. `avgTradePnlPctOfAccount` is a percentage OF THE
 * ACCOUNT. With the pre-#1142 one-whole-unit floor a BTC position committed ~10× a $10,000 account,
 * so the two differ by ~11.5×. Multiplying the mean position % by the account is only correct when
 * every notional equals the account, which is what the old code wrongly assumed.
 *
 * ── #1135 part 2, the invariant ──────────────────────────────────────────────────────────────────
 * The affordability refusal is the ONLY path that turns an entry signal into no trade, so
 * `signals − trades` MUST equal the refusal count. Equity is expected; a mismatch means a second
 * separator was introduced without being counted.
 */
import { tradeBasis } from './trade-basis';

const base = {
  totalPnl: 0,
  accountSize: 10000,
  tradeCount: 0,
  signalCount: 0,
  sizingRefusalCount: 0,
};

describe('tradeBasis — avgTradePnlPctOfAccount (#1135 part 1)', () => {
  it('divides currency P&L by the DECLARED ACCOUNT, not by a position notional', () => {
    // 10 trades, $500 net, $10,000 account → 500 / (10000 × 10) × 100 = 0.5% of the account.
    const { avgTradePnlPctOfAccount } = tradeBasis({
      ...base, totalPnl: 500, tradeCount: 10, signalCount: 10,
    });
    expect(avgTradePnlPctOfAccount).toBeCloseTo(0.5, 10);
  });

  it('is NOT the mean position percentage — the 11.5× case from the issue', () => {
    // Measured shape: totalPnl $97,699.97 over 1,285 trades on a $10,000 account.
    // The position-basis mean was 0.0658%. The account-basis mean must be far larger, because
    // each position committed ~10× the account.
    const { avgTradePnlPctOfAccount } = tradeBasis({
      ...base, totalPnl: 97699.97, tradeCount: 1285, signalCount: 1285,
    });
    expect(avgTradePnlPctOfAccount).toBeCloseTo(0.7603, 3);
    // The distinguishing assertion: it is an order of magnitude away from the position mean.
    expect(avgTradePnlPctOfAccount).toBeGreaterThan(0.0658 * 5);
  });

  it('returns 0 rather than Infinity/NaN for a zero-trade run', () => {
    const { avgTradePnlPctOfAccount } = tradeBasis({ ...base, totalPnl: 0, tradeCount: 0 });
    expect(avgTradePnlPctOfAccount).toBe(0);
    expect(Number.isFinite(avgTradePnlPctOfAccount)).toBe(true);
  });

  it('returns 0 for a non-positive accountSize instead of dividing by it', () => {
    expect(tradeBasis({ ...base, totalPnl: 500, tradeCount: 2, accountSize: 0 })
      .avgTradePnlPctOfAccount).toBe(0);
    expect(tradeBasis({ ...base, totalPnl: 500, tradeCount: 2, accountSize: -100 })
      .avgTradePnlPctOfAccount).toBe(0);
  });

  it('handles a loss without flipping the sign of the basis', () => {
    const { avgTradePnlPctOfAccount } = tradeBasis({
      ...base, totalPnl: -250, tradeCount: 5, signalCount: 5,
    });
    expect(avgTradePnlPctOfAccount).toBeCloseTo(-0.5, 10);
  });
});

describe('tradeBasis — signals vs trades (#1135 part 2)', () => {
  it('reports no mismatch when the difference equals the affordability refusals', () => {
    // 1,468 signals, 0 trades, 1,468 refusals — the measured BTC-on-$10k case.
    const r = tradeBasis({ ...base, signalCount: 1468, tradeCount: 0, sizingRefusalCount: 1468 });
    expect(r.signalsWithoutTrade).toBe(1468);
    expect(r.populationMismatch).toBeNull();
  });

  it('reports no mismatch when every signal became a trade', () => {
    const r = tradeBasis({ ...base, signalCount: 40, tradeCount: 40, sizingRefusalCount: 0 });
    expect(r.signalsWithoutTrade).toBe(0);
    expect(r.populationMismatch).toBeNull();
  });

  it('WARNS when a signal vanished without a recorded refusal', () => {
    const r = tradeBasis({ ...base, signalCount: 100, tradeCount: 60, sizingRefusalCount: 10 });
    expect(r.signalsWithoutTrade).toBe(40);
    expect(r.populationMismatch).not.toBeNull();
    // The message must carry the numbers, or it is a complaint rather than a finding.
    expect(r.populationMismatch).toContain('100 signals');
    expect(r.populationMismatch).toContain('60 trades');
    expect(r.populationMismatch).toContain('40');
    expect(r.populationMismatch).toContain('10 sizing refusal');
  });

  it('publishes signalsWithoutTrade even when it does NOT reconcile', () => {
    // The field is information either way — a guard that hides the number when it disagrees would
    // remove the only handle on the disagreement.
    const r = tradeBasis({ ...base, signalCount: 50, tradeCount: 50, sizingRefusalCount: 7 });
    expect(r.signalsWithoutTrade).toBe(0);
    expect(r.populationMismatch).not.toBeNull();
  });

  it('never throws — a mismatch makes the REPORT wrong, not the measurement', () => {
    expect(() => tradeBasis({ ...base, signalCount: 5, tradeCount: 99, sizingRefusalCount: 0 }))
      .not.toThrow();
  });
});
