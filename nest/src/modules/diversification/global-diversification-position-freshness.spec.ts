import { GlobalDiversificationService } from './global-diversification.service';

/**
 * GlobalDiversificationService — cached import rows must not gate trades or inflate the book (#778).
 *
 * ⚠️ THE DEFECT THESE TESTS GUARD (measured 2026-09-22): the position table's cached Trading 212
 * import rows (quotes frozen at import time) were served by `getAllPositions()` as if current.
 * Consequences:
 *   - the pre-trade cross-broker duplicate check could WARN or (strict mode) BLOCK a live trade
 *     because a FROZEN row "held" the symbol on another broker;
 *   - the diversification summary counted ~$22,970 of cached value as 99.98% of "portfolio".
 *
 * The rule: only broker-maintained rows participate; cached rows are excluded AND reported.
 */
describe('GlobalDiversificationService — live positions only (#778)', () => {
  function make(rows: any[], settings: Array<{ key: string; value: string }> = []) {
    const svc = Object.create(GlobalDiversificationService.prototype) as GlobalDiversificationService;
    (svc as any).prisma = {
      isAvailable: true,
      position: { findMany: jest.fn(async () => rows) },
      globalSetting: { findMany: jest.fn(async () => settings) },
    };
    (svc as any).logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
    return { svc };
  }

  const posRow = (over: any = {}) => ({
    id: 'p1', symbol: 'EURUSD', provider: 'mt5', quantity: 1, avgPrice: 1, currentPrice: 1.1,
    pnl: 0.1, side: 'buy', lastQuotedAt: new Date(), openedAt: new Date(), ...over,
  });
  const CACHED = { lastQuotedAt: new Date('2026-07-31T01:25:09Z') };

  it('strict mode: a FROZEN row on another broker does NOT block a live trade', async () => {
    const { svc } = make(
      [
        posRow({ symbol: 'EURUSD', provider: 'mt5', lastQuotedAt: new Date() }),
        posRow({ symbol: 'EURUSD', provider: 'trading212', ...CACHED }),
        // Ballast: a realistic portfolio keeps the symbol's exposure below the cap, so the
        // assertion isolates the DUPLICATE check (a one-symbol portfolio is 100% exposure and
        // would block on that separate, legitimate rule).
        posRow({ symbol: 'XAUUSD', provider: 'mt5', quantity: 1, currentPrice: 2000, avgPrice: 2000, lastQuotedAt: new Date() }),
      ],
      [{ key: 'diversification.mode', value: 'strict' }],
    );
    const res = await svc.checkPreTrade('EURUSD', 'mt5');
    expect(res.allowed).toBe(true);
    expect(res.blocked).toBe(false);
  });

  it('an actually-live duplicate on another broker still blocks in strict mode (the guard lives)', async () => {
    const { svc } = make(
      [
        posRow({ symbol: 'EURUSD', provider: 'mt5', lastQuotedAt: new Date() }),
        posRow({ symbol: 'EURUSD', provider: 'trading212', lastQuotedAt: new Date() }),
        posRow({ symbol: 'XAUUSD', provider: 'mt5', quantity: 1, currentPrice: 2000, avgPrice: 2000, lastQuotedAt: new Date() }),
      ],
      [{ key: 'diversification.mode', value: 'strict' }],
    );
    const res = await svc.checkPreTrade('EURUSD', 'mt5');
    expect(res.allowed).toBe(false);
    expect(res.blocked).toBe(true);
  });

  it('summary counts only live value, and reports the excluded cached rows (never silently)', async () => {
    const { svc } = make([
      posRow({ symbol: 'EURUSD', provider: 'mt5', quantity: 1, currentPrice: 1.1, lastQuotedAt: new Date() }),
      posRow({ symbol: '3NVD', provider: 'trading212', quantity: 2, currentPrice: 100, ...CACHED }),
    ]);
    const summary = await svc.getDiversificationSummary();

    expect(summary.totalPortfolioValue).toBeCloseTo(1.1, 5); // live only — not 201.1
    expect(summary.brokerBreakdown.map((b) => b.brokerId)).toEqual(['mt5']);
    expect(summary.cachedImportPositions.count).toBe(1);
    expect(summary.cachedImportPositions.note).toContain('trading212');
    expect(summary.cachedImportPositions.note).toContain('#778');
  });
});
