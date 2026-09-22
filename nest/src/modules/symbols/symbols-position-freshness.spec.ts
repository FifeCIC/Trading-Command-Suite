import { SymbolsService } from './symbols.service';

/**
 * /api/symbols/positions — only sync-refreshed rows are holdings (#854).
 *
 * ⚠️ THE DEFECT THESE TESTS GUARD. The `position` table holds two populations: rows refreshed
 * by a broker sync on every loop tick (quote age: minutes), and rows from a one-off Trading 212
 * portfolio import that were never touched again (measured 2026-09-22: 24 rows frozen at
 * 2026-07-31, ~8 weeks). The endpoint returned EVERY row with `hasPosition: true`, so 24
 * imported stocks rendered as current holdings with live P&L — plausible numbers, no error.
 *
 * The rule now: live = `lastQuotedAt` inside the live window. Stale rows are returned as
 * `staleHoldings` (counted, with the reason), never as positions — the exclusion is visible,
 * and no consumer has to guess.
 */
describe('SymbolsService.getPositionMap — live vs stale holdings (#854)', () => {
  function make(rows: any[]) {
    const svc = Object.create(SymbolsService.prototype) as SymbolsService;
    (svc as any).prisma = { isAvailable: true, position: { findMany: jest.fn(async () => rows) } };
    (svc as any).logger = { warn: jest.fn(), log: jest.fn() };
    return { svc };
  }

  const row = (over: any = {}) => ({
    symbol: 'EURUSD', provider: 'mt5', quantity: 0.01, avgPrice: 1.1, currentPrice: 1.11,
    pnl: 1, side: 'buy', lastQuotedAt: new Date(), ...over,
  });

  // Read the ACTUAL window from the service — a test that mirrors the constant would drift
  // silently the day someone tunes it.
  const windowMs = (SymbolsService as any).POSITION_LIVE_WINDOW_MS as number;

  it('returns ONLY sync-refreshed rows as positions — a frozen import row is not a holding', async () => {
    const { svc } = make([
      row({ symbol: 'EURUSD', lastQuotedAt: new Date() }),
      row({ symbol: '3NVD', provider: 'trading212', lastQuotedAt: new Date('2026-07-31T01:25:09Z') }),
    ]);
    const out = await svc.getPositionMap();

    expect(out.positions.map((p) => p.symbol)).toEqual(['EURUSD']);
    expect(out.positions[0].hasPosition).toBe(true);

    // ⚠️ The exclusion is VISIBLE, not silent: counted, named by provider, and dated.
    expect(out.staleHoldings.count).toBe(1);
    expect(out.staleHoldings.note).toContain('trading212');
    expect(out.staleHoldings.note).toContain('2026-07-31');
    expect(out.staleHoldings.note).toContain('#854');
  });

  it('every returned row carries the freshness claim (lastQuotedAt) — hasPosition is never bare', async () => {
    const { svc } = make([row({})]);
    const out = await svc.getPositionMap();
    for (const p of out.positions) {
      expect(typeof p.lastQuotedAt).toBe('string'); // ISO — the evidence behind hasPosition: true
    }
  });

  it('an unreadable quote date is STALE, not live (fail-closed: cannot date it, cannot claim it)', async () => {
    const { svc } = make([row({ symbol: 'GHOST', lastQuotedAt: null })]);
    const out = await svc.getPositionMap();
    expect(out.positions).toHaveLength(0);
    expect(out.staleHoldings.count).toBe(1);
  });

  it('boundary is INCLUSIVE and named: a quote just inside the window is live', async () => {
    const { svc } = make([row({ lastQuotedAt: new Date(Date.now() - windowMs + 60_000) })]);
    const out = await svc.getPositionMap();
    expect(out.positions).toHaveLength(1);
    expect(out.staleHoldings.count).toBe(0);
  });

  it('a quote just outside the window is stale (the other side of the boundary)', async () => {
    const { svc } = make([row({ lastQuotedAt: new Date(Date.now() - windowMs - 60_000) })]);
    const out = await svc.getPositionMap();
    expect(out.positions).toHaveLength(0);
    expect(out.staleHoldings.count).toBe(1);
  });
});
