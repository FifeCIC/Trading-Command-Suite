import { PositionSyncService } from './position-sync.service';

/**
 * #871 — TICKETED open trades that neither reconciler can reach.
 *
 * Kept as its own suite rather than appended to `position-sync.service.spec.ts` because it tests a
 * distinct branch with its own safety argument, and because the older file's shared `beforeEach`
 * carries implementations between tests — see the mock note below.
 *
 * ⚠️ THE GAP THIS CLOSES
 *
 * `position` and `trade` are reconciled by two paths, and a Trade **with a ticket** whose Position
 * row was gone fell through BOTH:
 *
 *   1. `finalizeClosedPosition()` is driven by rows still present in `position` — so if the Position
 *      row had already been cleaned, the Trade was never visited.
 *   2. `reapStrandedTrades()` explicitly filtered `brokerTicket: null` — so a ticketed row was never
 *      even a candidate.
 *
 * Result: `status='open'` forever, with no broker counterpart.
 *
 * Measured 2026-09-18: **5** such rows against 5 live broker positions (10 open trades in total) —
 * and growing. The issue recorded 3; two further VIX orphans appeared the same day it was written,
 * which is the argument for closing the class rather than the rows.
 *
 * ⚠️ WHY THE TICKETED CASE IS NOT CLOSED THE SAME WAY AS THE UNTICKETED ONE
 *
 * An unticketed row is a phantom that never existed at the broker, so `pnl: 0` is the TRUTH.
 * A ticketed row genuinely existed — the ticket is proof — so `pnl: 0` would be a fabricated
 * figure in the ledger. The ticketed branch therefore routes through `finalizeClosedPosition()`,
 * which resolves the real exit price and realised P&L from broker deal history.
 */

const basePosition = {
  symbol: 'EURUSD', brokerTicket: '152654644455', side: 'buy' as const, quantity: 0.1,
  avgPrice: 1.148, currentPrice: 1.14834, pnl: 0, sl: null, tp: null,
  comment: '', openedAt: new Date('2026-09-18T17:22:45Z'),
};

describe('PositionSyncService — ticketed orphans (#871)', () => {
  const position = {
    upsert: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(),
    create: jest.fn(), update: jest.fn(), delete: jest.fn(),
  };
  const trade = {
    findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(),
    update: jest.fn(), updateMany: jest.fn(),
  };
  const prisma = { isAvailable: true, position, trade };
  const adapter = { getDeals: jest.fn() };
  const adapterFactory = { create: jest.fn(() => adapter) };
  let service: PositionSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    position.upsert.mockResolvedValue({});
    position.findMany.mockResolvedValue([]);
    position.delete.mockResolvedValue({});

    trade.update.mockResolvedValue({});
    trade.updateMany.mockResolvedValue({ count: 0 });
    trade.findMany.mockResolvedValue([]);
    trade.findFirst.mockResolvedValue(null);
    /**
     * ⚠️ `trade.create` MUST be mocked, and leaving it out is a FALSE-PASS generator, not an
     * omission. `reconcileTrade()` calls `trade.create()` whenever a broker position has no
     * matching Trade row. Unmocked it returns `undefined`, so the `.catch()` chained onto it
     * throws, the outer catch swallows the error, and `syncPositions()` returns its all-zero
     * result — meaning a test asserting `reaped === 0` goes GREEN WITHOUT THE REAPER EVER RUNNING.
     *
     * Observed live while writing this suite: the "NEVER touches a ticketed Trade" guard passed
     * while the log read `Position sync failed: Cannot read properties of undefined`. A guard
     * that cannot fail for the right reason is not a guard — and this one was hiding the very
     * behaviour it claimed to prove.
     */
    trade.create.mockResolvedValue({ id: 'created-trade' });
    adapter.getDeals.mockResolvedValue([]);

    service = new PositionSyncService(prisma as any, adapterFactory as any);
  });

  it('finalises a TICKETED open Trade the broker no longer reports', async () => {
    trade.findMany.mockResolvedValue([{
      id: 'orphan-1', symbol: 'GER40', openedAt: new Date('2026-09-15T19:28:37Z'),
      brokerTicket: '89649760', side: 'buy', pnl: 0, exitPrice: null,
    }]);
    trade.findFirst.mockResolvedValue({ id: 'orphan-1', symbol: 'GER40', side: 'buy' });
    // Long opened @23700, closed @23500 for -200 less -3 commission and -1 swap.
    adapter.getDeals.mockResolvedValue([
      { positionId: '89649760', symbol: 'GER40', side: 'buy', volume: 0.1, price: 23700, profit: 0, commission: 0, swap: 0, time: new Date('2026-09-15T19:28:37Z') },
      { positionId: '89649760', symbol: 'GER40', side: 'sell', volume: 0.1, price: 23500, profit: -200, commission: -3, swap: -1, time: new Date('2026-09-16T09:00:00Z') },
    ]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    const updateArg: any = trade.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('closed');
    // ⚠️ The whole point: a REAL exit, not a fabricated zero.
    expect(updateArg.data.exitPrice).toBe(23500);
    expect(updateArg.data.pnl).toBeCloseTo(-204, 2);
  });

  it('⚠️ NEVER touches a ticketed Trade the broker still reports — a ticket is proof of life', async () => {
    // THE safety test. Widening the reaper is only acceptable because a ticket present in the
    // snapshot is an absolute stop. If this fails, an ordinary sync pass is closing LIVE trades.
    trade.findMany.mockResolvedValue([{
      id: 'live-trade', symbol: 'EURUSD', openedAt: new Date('2026-09-18T17:22:45Z'),
      brokerTicket: '152654644455', side: 'buy', pnl: 5, exitPrice: null,
    }]);

    const result = await service.syncPositions('mt5', [{ ...basePosition }], { authoritative: true });

    expect(result.reaped).toBe(0);
    // Assert on CLOSURE specifically, not `update` generally: reconcileTrade() legitimately
    // refreshes sl/tp on a live trade, so a blanket not.toHaveBeenCalled() would fail for the
    // wrong reason and hide whether the guard actually held.
    const closed = trade.update.mock.calls.filter((c: any) => c[0]?.data?.status === 'closed');
    expect(closed).toHaveLength(0);
    expect(trade.updateMany).not.toHaveBeenCalled();
  });

  it('does not consider ANY Trade row from a non-authoritative snapshot', async () => {
    // The reaper now looks at MORE rows than before, so this guard matters more, not less.
    // An outage must never be mistaken for "everything closed".
    const result = await service.syncPositions('mt5', [], { authoritative: false });

    expect(result).toEqual({ synced: 0, created: 0, closed: 0, reaped: 0 });
    expect(trade.findMany).not.toHaveBeenCalled();
    expect(trade.updateMany).not.toHaveBeenCalled();
  });

  it('finalises SEVERAL ticketed orphans in one pass — the count grows, so the fix must scale', async () => {
    // The measured set, verbatim. A fix that handled one row would not have held for a week.
    trade.findMany.mockResolvedValue([
      { id: 'o1', symbol: 'GER40', openedAt: new Date('2026-09-15T19:28:37Z'), brokerTicket: '89649760', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o2', symbol: 'VIX', openedAt: new Date('2026-09-15T19:59:33Z'), brokerTicket: '89657501', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o3', symbol: 'XAUUSD', openedAt: new Date('2026-09-17T12:14:44Z'), brokerTicket: '152646338241', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o4', symbol: 'VIX', openedAt: new Date('2026-09-18T16:58:01Z'), brokerTicket: '90555750', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'o5', symbol: 'VIX', openedAt: new Date('2026-09-18T17:39:14Z'), brokerTicket: '90563535', side: 'buy', pnl: 0, exitPrice: null },
    ]);
    trade.findFirst.mockResolvedValue({ id: 'x', symbol: 'X', side: 'buy' });

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(5);
  });

  it('closes ONLY the orphan when the broker still reports other live positions', async () => {
    // The realistic shape: live positions and orphans in the same snapshot. The live one survives.
    trade.findMany.mockResolvedValue([
      { id: 'live-eur', symbol: 'EURUSD', openedAt: new Date('2026-09-18T17:22:45Z'), brokerTicket: '152654644455', side: 'buy', pnl: 0, exitPrice: null },
      { id: 'orphan-vix', symbol: 'VIX', openedAt: new Date('2026-09-18T16:58:01Z'), brokerTicket: '90555750', side: 'buy', pnl: 0, exitPrice: null },
    ]);
    trade.findFirst.mockResolvedValue({ id: 'orphan-vix', symbol: 'VIX', side: 'buy' });

    const result = await service.syncPositions('mt5', [{ ...basePosition }], { authoritative: true });

    expect(result.reaped).toBe(1);
    const closedIds = trade.update.mock.calls
      .filter((c: any) => c[0]?.data?.status === 'closed')
      .map((c: any) => c[0]?.where?.id);
    expect(closedIds).toEqual(['orphan-vix']);
  });

  it('still reaps an UNTICKETED phantom at pnl 0 — the 2026-09-10 behaviour is intact', async () => {
    // Regression on the older fix. An unticketed row never existed at the broker, so a zero here
    // is the truth — which is exactly why the ticketed branch must NOT take this path.
    trade.findMany.mockResolvedValue([
      { id: 'phantom', symbol: 'USDCAD', openedAt: new Date('2026-07-24T18:41:05Z'), brokerTicket: null },
    ]);
    trade.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    expect(trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'phantom', status: 'open', brokerTicket: null }),
      data: expect.objectContaining({ status: 'closed', pnl: 0 }),
    }));
  });
});
