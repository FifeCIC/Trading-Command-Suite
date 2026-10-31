/**
 * equity-drawdown.spec.ts — the canary for `computeEquityPath()`.
 *
 * ⚠️ EVERY ASSERTION HERE CORRESPONDS TO A NUMBER THAT WAS WRONG ON SCREEN, and the two "must be
 * zero" cases are as load-bearing as the two "must be non-zero" ones. A guard that only checks that a
 * losing run reports a loss cannot tell "the arithmetic works" from "the arithmetic always reports a
 * loss"; a guard that only checks the winning case cannot see the `peak > 0` short-circuit at all.
 *
 * Measured before the fix, run `7f00cfb8` (1,027 trades, `accountSize` 10,000, P&L −155,977.32):
 *   served "Max Drawdown"   8,867.70%    ← denominator was the peak cumulative P&L (£1,809.62)
 *   real peak-to-trough     £161,068.36  = 1,610.68% of capital
 *   worst single trade      −$296.19
 */
import { computeEquityPath } from './equity-drawdown';

const t = (pnl: number, iso: string) => ({ pnl, exitDate: new Date(iso) });

describe('computeEquityPath — the drawdown arithmetic', () => {
  it('reports a real fall on a MONOTONIC LOSER (the −0.00% defect)', () => {
    // Before the fix `peak` stayed at 0 forever, `peak > 0` short-circuited, and this path reported
    // a drawdown of exactly zero while losing 300 of a 10,000 account.
    const { summary } = computeEquityPath(
      [t(-100, '2026-01-01T00:00:00Z'), t(-100, '2026-01-02T00:00:00Z'), t(-100, '2026-01-03T00:00:00Z')],
      { runStart: '2025-12-31T00:00:00Z', accountSize: 10_000 },
    );
    expect(summary.maxDrawdownAmount).toBe(300);
    expect(summary.maxDrawdownPct).toBe(3);
    expect(summary.peakEquity).toBe(0);
    expect(summary.troughEquity).toBe(-300);
    // The fall starts at the flat line the account began on, not at the first losing trade.
    expect(summary.maxDrawdownStart).toBe('2025-12-31T00:00:00.000Z');
    expect(summary.maxDrawdownEnd).toBe('2026-01-03T00:00:00.000Z');
  });

  it('reports NO fall on a monotonic winner (the other direction)', () => {
    const { summary } = computeEquityPath(
      [t(100, '2026-01-01T00:00:00Z'), t(100, '2026-01-02T00:00:00Z')],
      { runStart: '2025-12-31T00:00:00Z', accountSize: 10_000 },
    );
    expect(summary.maxDrawdownAmount).toBe(0);
    expect(summary.maxDrawdownPct).toBe(0);
    expect(summary.peakEquity).toBe(200);
    expect(summary.maxDrawdownStart).toBeNull();
    expect(summary.troughEquity).toBe(0);
  });

  it('uses CAPITAL, not the peak P&L, as the denominator (the 8,867.70% regression)', () => {
    // The real shape of run `7f00cfb8`, from `node logs/measure-drawdown.cjs`: highest realised P&L
    // 2,105.58, deepest  −158,962.79. The OLD code divided that £161,068.37 fall by the peak P&L —
    // which it happened to place at 1,809.62 because it ordered by entry — and served 8,867.70%.
    // Against the £10,000 account the same fall is 1,610.68%, which is the truth of a run that lost
    // 15.6× its capital (#1142).
    const { summary, equity } = computeEquityPath(
      [t(2105.58, '2026-01-01T00:00:00Z'), t(-161068.37, '2026-01-02T00:00:00Z')],
      { runStart: '2025-12-31T00:00:00Z', accountSize: 10_000, totalPnl: -155977.32 },
    );
    expect(summary.maxDrawdownAmount).toBeCloseTo(161068.37, 2);
    expect(summary.maxDrawdownPct).toBeCloseTo(1610.68, 2);
    // ⚠️ The PER-POINT percentage is a separate expression from the SUMMARY one, and the shading is
    // drawn from it. Canary both: mutating only the point-level denominator was caught by nothing
    // until this line existed.
    expect(equity[equity.length - 1].drawdownPct).toBeCloseTo(1610.68, 2);
    // Named basis, so the UI can print what the percentage is a share of.
    expect(summary.maxDrawdownPctBasis).toBe('capital');
    expect(summary.accountSize).toBe(10_000);
  });

  it('returns NULL for the percentage when no capital was recorded — never 0', () => {
    const { summary } = computeEquityPath([t(-500, '2026-01-01T00:00:00Z')], {
      runStart: '2025-12-31T00:00:00Z',
      accountSize: null,
    });
    expect(summary.maxDrawdownPct).toBeNull();
    expect(summary.maxDrawdownPctBasis).toBe('unavailable');
    // The currency figure needs no denominator and is still true.
    expect(summary.maxDrawdownAmount).toBe(500);
  });

  it('treats a zero or negative capital figure as absent, not as a denominator', () => {
    for (const bad of [0, -10_000]) {
      const { summary } = computeEquityPath([t(-500, '2026-01-01T00:00:00Z')], {
        runStart: '2025-12-31T00:00:00Z',
        accountSize: bad,
      });
      expect(summary.maxDrawdownPct).toBeNull();
      expect(summary.accountSize).toBeNull();
    }
  });

  it('replays in EXIT order regardless of the order it is given (the zig-zag defect)', () => {
    // Same trades, deliberately shuffled. Ordered by exit: +100 then −300 → peak 100, trough −200,
    // fall 300. Ordered by entry instead the peak land at a different place, which is the defect.
    const trades = [t(-300, '2026-03-01T00:00:00Z'), t(100, '2026-01-01T00:00:00Z')];
    const { summary, equity } = computeEquityPath(trades, {
      runStart: '2025-12-31T00:00:00Z',
      accountSize: 10_000,
    });
    expect(summary.maxDrawdownAmount).toBe(300);
    expect(summary.peakEquity).toBe(100);
    expect(summary.troughEquity).toBe(-200);
    // The path's own x-axis is ascending.
    const times = equity.map((p) => Date.parse(p.time));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(summary.finalEquity).toBe(-200);
  });

  it('the path sum agrees with the run total, so neither can drift alone', () => {
    const { summary } = computeEquityPath(
      [t(50, '2026-01-01T00:00:00Z'), t(-120, '2026-01-02T00:00:00Z'), t(30, '2026-01-03T00:00:00Z')],
      { runStart: '2025-12-31T00:00:00Z', accountSize: 10_000 },
    );
    expect(summary.totalPnl).toBeCloseTo(-40, 6);
    expect(summary.finalEquity).toBeCloseTo(-40, 6);
    expect(summary.totalTrades).toBe(3);
  });

  it('a run with no trades has one flat point and no fall', () => {
    const { equity, summary } = computeEquityPath([], {
      runStart: '2025-12-31T00:00:00Z',
      accountSize: 10_000,
    });
    expect(equity).toHaveLength(1);
    expect(equity[0]).toMatchObject({ equity: 0, drawdownAmount: 0, drawdownPct: 0 });
    expect(summary.maxDrawdownAmount).toBe(0);
    expect(summary.finalEquity).toBe(0);
    expect(summary.maxDrawdownStart).toBeNull();
  });

  it('keeps the running maximum across recovery, so a second deeper fall is measured from the peak', () => {
    // +500, −200 (peak 500, fall 200), −400 (fall 600) → the worst fall is 600, not 400.
    const { summary } = computeEquityPath(
      [t(500, '2026-01-01T00:00:00Z'), t(-200, '2026-01-02T00:00:00Z'), t(-400, '2026-01-03T00:00:00Z')],
      { runStart: '2025-12-31T00:00:00Z', accountSize: 10_000 },
    );
    expect(summary.maxDrawdownAmount).toBe(600);
    expect(summary.maxDrawdownEnd).toBe('2026-01-03T00:00:00.000Z');
    expect(summary.peakDate).toBe('2026-01-01T00:00:00.000Z');
  });

  it('survives a non-numeric pnl rather than producing NaN in every downstream cell', () => {
    const { summary } = computeEquityPath(
      [{ pnl: '250' as unknown as number, exitDate: new Date('2026-01-01T00:00:00Z') }, { pnl: 'oops' as unknown as number, exitDate: new Date('2026-01-02T00:00:00Z') }],
      { runStart: '2025-12-31T00:00:00Z', accountSize: 10_000 },
    );
    expect(Number.isFinite(summary.finalEquity)).toBe(true);
    expect(summary.finalEquity).toBe(250);
    expect(summary.maxDrawdownAmount).toBe(0);
  });
});
