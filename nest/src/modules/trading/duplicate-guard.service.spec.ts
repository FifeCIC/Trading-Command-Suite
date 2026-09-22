import { DuplicateGuardService } from './duplicate-guard.service';

/**
 * #745 — the duplicate guard must not treat the PROJECTION as authoritative.
 *
 * ⚠️ THE DEFECT THESE TESTS PIN (observed live 2026-09-10): `DUPLICATE BLOCKED: XAUUSD on mt5 —
 * 1 open position(s) on MT5` while the position had ALREADY closed at the broker. The query
 * counted every `Position` row for the symbol with no freshness test, so a row the sync had
 * stopped refreshing blocked new trades indefinitely. A frozen projection row is not evidence
 * that anything is open — it is evidence that the projection is stale.
 */
describe('DuplicateGuardService (#745)', () => {
  const LIVE = new Date();
  const STALE = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000); // outside the 7-day live window

  function make(rows: any[], opts: { trades?: any[]; available?: boolean } = {}) {
    const svc = Object.create(DuplicateGuardService.prototype) as DuplicateGuardService;
    const findMany = jest.fn(async () => rows);
    (svc as any).prisma = {
      isAvailable: opts.available !== false,
      position: { findMany },
      trade: { findMany: jest.fn(async () => opts.trades ?? []) },
    };
    (svc as any).logger = { warn: jest.fn(), log: jest.fn() };
    return { svc, findMany, logger: (svc as any).logger };
  }

  it('a LIVE position blocks', async () => {
    const { svc } = make([{ id: 'p1', quantity: 0.01, lastQuotedAt: LIVE }]);
    const res = await svc.checkDuplicate('XAUUSD', 'mt5');
    expect(res.blocked).toBe(true);
    expect(res.existingPositions).toBe(1);
    expect(res.staleIgnoredPositions).toBe(0);
  });

  it('⭐ REGRESSION — a STALE row does NOT block, and the decision is logged', async () => {
    const { svc, logger } = make([{ id: 'p1', quantity: 0.01, lastQuotedAt: STALE }]);
    const res = await svc.checkDuplicate('XAUUSD', 'mt5');
    expect(res.blocked).toBe(false);
    expect(res.existingPositions).toBe(0);
    expect(res.staleIgnoredPositions).toBe(1);
    // Ignoring rows is a decision; a silent decision is indistinguishable from a broken guard.
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ignored 1 stale position row(s)'));
  });

  it('a row with NO lastQuotedAt is not live — fail-closed on the EVIDENCE, not on the guard', async () => {
    const { svc } = make([{ id: 'p1', quantity: 0.01, lastQuotedAt: null }]);
    const res = await svc.checkDuplicate('XAUUSD', 'mt5');
    expect(res.blocked).toBe(false);
    expect(res.staleIgnoredPositions).toBe(1);
  });

  it('live and stale together: only the live count can block', async () => {
    const { svc } = make([
      { id: 'p1', quantity: 0.01, lastQuotedAt: LIVE },
      { id: 'p2', quantity: 0.01, lastQuotedAt: STALE },
    ]);
    const res = await svc.checkDuplicate('XAUUSD', 'mt5');
    expect(res.existingPositions).toBe(1);
    expect(res.staleIgnoredPositions).toBe(1);
    expect(res.blocked).toBe(true); // the live one is enough
  });

  it('DB unavailable still fails CLOSED — unchanged', async () => {
    const { svc } = make([], { available: false });
    const res = await svc.checkDuplicate('XAUUSD', 'mt5');
    expect(res.blocked).toBe(true);
    expect(res.reason).toContain('Database unavailable');
  });

  it('a recent trade in the cooldown window still blocks', async () => {
    const { svc } = make([], { trades: [{ id: 't1' }] });
    const res = await svc.checkDuplicate('XAUUSD', 'mt5');
    expect(res.blocked).toBe(true);
    expect(res.recentTrades).toBe(1);
  });
});
