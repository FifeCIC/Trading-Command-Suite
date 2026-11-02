import { signalProfitFactor, tradeProfitFactor } from './profit-factor';

/**
 * profit-factor.spec.ts — the profit factor must be a RATIO, or an explicit absence.
 *
 * ⚠️ THIS IMPORTS THE REAL FUNCTIONS. An earlier draft of this file re-stated the arithmetic
 * inline, which would have passed while `backtest.service.ts` stayed wrong — a guard that cannot
 * fail is a decoration. The service now imports the same module, so breaking the implementation
 * breaks these tests.
 *
 * ── THE TWO DEFECTS IT GUARDS (#126, 2026-11-02) ──
 *   1. Six stop-plan arms moved net P&L from +63.29 to −657.54 and every one reported
 *      `profitFactor 0.72`, because the field measures ENTRY SIGNALS and is invariant to exits.
 *   2. `btc-speed-v1` stored a profit factor of **956.87** because `grossLoss ... || 1` forced the
 *      denominator to 1, turning a ratio into an absolute value.
 */

describe('signalProfitFactor — a ratio, or NULL', () => {
  it('computes the ratio when there are winners and losers', () => {
    expect(signalProfitFactor([2, -1])).toBeCloseTo(2, 6);
    expect(signalProfitFactor([1, 3, -2])).toBeCloseTo(2, 6);
  });

  it('returns NULL, not grossProfit, when nothing lost — the 956.87 defect', () => {
    expect(signalProfitFactor([956.87])).toBeNull();
    expect(signalProfitFactor([5, 10, 20])).toBeNull();
  });

  it('returns NULL for an empty or unusable sample, rather than 0 or 1', () => {
    expect(signalProfitFactor([])).toBeNull();
    expect(signalProfitFactor([null, undefined])).toBeNull();
  });

  it('is always the ratio of two measured sums when a losing sample exists', () => {
    const r = signalProfitFactor([100, -0.5]);
    expect(Number.isFinite(r as number)).toBe(true);
    expect(r as number).toBeCloseTo(200, 6);
  });

  it('is INVARIANT to exits by construction — why it cannot judge a stop change', () => {
    // Same entries, therefore same value. Stated as a test so the next reader does not treat this
    // field as the strategy's profitability.
    const entries = [1, -0.5, 0.8, -0.4];
    expect(signalProfitFactor(entries)).toBe(signalProfitFactor([...entries]));
  });
});

describe('tradeProfitFactor — moves when the exits move', () => {
  it('computes the ratio over closed trades', () => {
    expect(tradeProfitFactor([{ pnl: 30 }, { pnl: -10 }])).toBeCloseTo(3, 6);
    expect(tradeProfitFactor([{ pnl: 5 }, { pnl: -10 }, { pnl: 4 }, { pnl: -8 }])).toBeCloseTo(9 / 18, 6);
  });

  it('returns NULL with no trades, and NULL when no trade lost', () => {
    expect(tradeProfitFactor([])).toBeNull();
    expect(tradeProfitFactor([{ pnl: 1 }, { pnl: 2 }])).toBeNull();
  });

  it('DIFFERS between two exits of the same entries — the property the A/B needed', () => {
    const heldToStop = [{ pnl: 5 }, { pnl: -10 }, { pnl: 4 }, { pnl: -8 }];
    const trailedOut = [{ pnl: 5 }, { pnl: 2 }, { pnl: 4 }, { pnl: -3 }];
    const a = tradeProfitFactor(heldToStop);
    const b = tradeProfitFactor(trailedOut);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBeCloseTo(9 / 18, 6);
    expect(b).toBeCloseTo(11 / 3, 6);
  });
});
