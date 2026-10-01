import { PositionSyncService } from './position-sync.service';

describe('PositionSyncService', () => {
  const position = {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const trade = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    /**
     * ⚠️ REQUIRED — added for #1014. The reconciler now COUNTS how many `trade` rows carry a
     * position id before booking P&L, because more than one row means the net must be split.
     *
     * Leaving it unmocked is not a harmless omission: the call throws, the reconciler refuses to
     * book a P&L (correctly — it cannot know the sharing), and a test expecting a P&L fails for a
     * reason that has nothing to do with what it is asserting. Defaulted to **1** in the shared
     * `beforeEach`, which is the honest value for every case in this file (one row per position).
     */
    count: jest.fn(),
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
    trade.findMany.mockResolvedValue([]);
    trade.updateMany.mockResolvedValue({ count: 0 });
    // One `trade` row per position id — the honest value for every case in this file. Tests that
    // want the SPLIT path override this with a higher count.
    trade.count.mockResolvedValue(1);
    adapter.getDeals.mockResolvedValue([]);
    service = new PositionSyncService(prisma as any, adapterFactory as any);
  });

  it('does not infer closures from a non-authoritative empty response', async () => {
    const result = await service.syncPositions('mt5', [], { authoritative: false });

    expect(result).toEqual({ synced: 0, created: 0, closed: 0, reaped: 0 });
    expect(position.findMany).not.toHaveBeenCalled();
    // A non-authoritative read must never reap trades either.
    expect(trade.findMany).not.toHaveBeenCalled();
  });

  it('closes the final position from an authoritative empty snapshot', async () => {
    position.findMany.mockResolvedValue([{
      id: 'position-1',
      symbol: 'EURUSD',
      provider: 'mt5',
      brokerTicket: '501',
      side: 'buy',
      quantity: 0.1,
      currentPrice: 1.09,
      pnl: 12,
      openedAt: new Date('2026-09-07T10:00:00Z'),
    }]);
    trade.findFirst.mockResolvedValue({ id: 'trade-1', symbol: 'EURUSD', side: 'buy', quantity: 0.1 });
    adapter.getDeals.mockResolvedValue([{
      positionId: '501',
      brokerTicket: 'deal-2',
      symbol: 'EURUSD',
      side: 'sell',
      volume: 0.1,
      price: 1.09,
      profit: 12,
      commission: -1,
      time: new Date('2026-09-07T12:00:00Z'),
    }]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.closed).toBe(1);
    expect(trade.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'trade-1' },
      data: expect.objectContaining({ status: 'closed', exitPrice: 1.09, pnl: 11 }),
    }));
    expect(position.delete).toHaveBeenCalledWith({ where: { id: 'position-1' } });
  });

  /**
   * The REPAIR path for rows already in the book.
   *
   * Fixing the write sites stops NEW bad rows; it does not touch the legacy rows whose
   * `brokerTicket` holds an ORDER ticket. Those were finalised as "position vanished" and their real
   * P&L was lost. Resolving order → position → deals is what prices them again.
   */
  it('resolves a LEGACY order ticket to its position and prices the close (#1014)', async () => {
    position.findMany.mockResolvedValue([{
      id: 'position-legacy', symbol: 'XAUUSD', provider: 'mt5',
      // An ORDER id, stored by the scale-in path before #1014. It matches no `positionId`.
      brokerTicket: '152690940846',
      side: 'buy', quantity: 0.01, currentPrice: 4157.11, pnl: null,
      openedAt: new Date('2026-09-28T08:52:17Z'),
    }]);
    trade.findFirst.mockResolvedValue({ id: 'legacy-1', symbol: 'XAUUSD', side: 'buy', quantity: 0.01 });
    trade.count.mockResolvedValue(1);
    adapter.getDeals.mockResolvedValue([
      // The order the row recorded, now carrying the POSITION it belongs to.
      { positionId: '152690675067', orderId: '152690940846', side: 'buy', volume: 0.02, price: 4146.30, profit: 0, time: new Date('2026-09-28T08:52:17Z') },
      { positionId: '152690675067', orderId: '152690940848', side: 'buy', volume: 0.02, price: 4145.83, profit: 0, time: new Date('2026-09-28T09:35:55Z') },
      { positionId: '152690675067', orderId: '152690988172', side: 'sell', volume: 0.04, price: 4157.11, profit: 40, time: new Date('2026-09-28T12:28:00Z') },
    ]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.closed).toBe(1);
    const data: any = trade.update.mock.calls[0][0].data;
    expect(data.status).toBe('closed');
    // Priced from the position's deals — the exit is no longer unknown.
    expect(data.exitPrice).toBe(4157.11);
    // ⚠️ A QUARTER of the net, NOT the whole 40. This is the subtle half of the repair: the four
    // orders that built a position carry FOUR DIFFERENT order tickets, so a count by ticket returns
    // 1 for each and the sole-owner branch would book 40 four times over. Resolving from an order id
    // therefore FORCES the volume split — 0.01 / 0.04 opened = 0.25 → 10.
    expect(data.pnl).toBe(10);
  });

  it('does NOT rescue a ticket that is neither a position id nor an order id', async () => {
    position.findMany.mockResolvedValue([{
      id: 'position-bogus', symbol: 'XAUUSD', provider: 'mt5', brokerTicket: '999999999',
      side: 'buy', quantity: 0.01, currentPrice: 4157.11, pnl: null,
      openedAt: new Date('2026-09-28T08:52:17Z'),
    }]);
    trade.findFirst.mockResolvedValue({ id: 'bogus-1', symbol: 'XAUUSD', side: 'buy', quantity: 0.01 });
    adapter.getDeals.mockResolvedValue([
      { positionId: '152690675067', orderId: '152690940846', side: 'sell', volume: 0.04, price: 4157.11, profit: 40, time: new Date('2026-09-28T12:28:00Z') },
    ]);

    await service.syncPositions('mt5', [], { authoritative: true });

    const data: any = trade.update.mock.calls[0][0].data;
    // ⚠️ The symbol fallback must NOT fire here: the deals name ONE lifecycle, but the row's ticket
    // is unrelated to it, and pricing this position off a stranger's deals is the fabrication this
    // guard exists to prevent. Unknown is the honest outcome.
    expect(data.pnl).toBeNull();
  });

  /**
   * #1014 — THE 4x OVERSTATEMENT.
   *
   * This is the case that makes storing the POSITION id safe rather than dangerous. The account is
   * NETTING, so the four A/B scale-in orders share ONE position; four `trade` rows therefore carry
   * the same `brokerTicket`, and every one of them resolves to the same closing deal.
   *
   * ⚠️ BEFORE THIS FIX each row booked the position's ENTIRE net. Four rows × one position =
   * a 4x overstatement in the ledger, with plausible numbers and no error anywhere — the exact
   * signature this repo keeps re-finding. The assertion below is that the four rows SUM to the
   * position instead of each claiming it.
   *
   * Numbers are the incident's own (2026-09-28, XAUUSD): four buys of 0.01, one sell of 0.04.
   */
  it('books only the row\'s SHARE when several rows carry one position id (#1014)', async () => {
    position.findMany.mockResolvedValue([{
      id: 'position-1',
      symbol: 'XAUUSD',
      provider: 'mt5',
      // The POSITION id — stored by the write sites since #1014. The ORDER tickets differed per row.
      brokerTicket: '152690675067',
      side: 'buy',
      quantity: 0.01,
      currentPrice: 4157.11,
      pnl: null,
      openedAt: new Date('2026-09-28T08:52:17Z'),
    }]);
    trade.findFirst.mockResolvedValue({
      id: 'trade-1', symbol: 'XAUUSD', side: 'buy', quantity: 0.01,
    });
    // FOUR rows share this position. Counted, not assumed — this is the whole safety argument.
    trade.count.mockResolvedValue(4);
    adapter.getDeals.mockResolvedValue([
      { positionId: '152690675067', side: 'buy', volume: 0.01, price: 4146.30, profit: 0, time: new Date('2026-09-28T08:52:17Z') },
      { positionId: '152690675067', side: 'buy', volume: 0.01, price: 4145.83, profit: 0, time: new Date('2026-09-28T09:35:55Z') },
      { positionId: '152690675067', side: 'buy', volume: 0.01, price: 4145.83, profit: 0, time: new Date('2026-09-28T09:35:55Z') },
      { positionId: '152690675067', side: 'buy', volume: 0.01, price: 4151.32, profit: 0, time: new Date('2026-09-28T09:43:53Z') },
      // The single trailed-stop close of the whole 0.04 position.
      { positionId: '152690675067', side: 'sell', volume: 0.04, price: 4157.11, profit: 40, time: new Date('2026-09-28T12:28:00Z') },
    ]);

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.closed).toBe(1);
    const data: any = trade.update.mock.calls[0][0].data;
    expect(data.status).toBe('closed');
    // 0.01 / 0.04 = 0.25 → a QUARTER of the net. NOT 40 — that would be the overstatement.
    expect(data.pnl).toBe(10);
    // The exit price is the position's, identical on every row — it is not split.
    expect(data.exitPrice).toBe(4157.11);
  });

  /**
   * The refusal path, and the reason it is a REFUSAL rather than a fallback.
   *
   * If the share cannot be computed with several rows involved, the reconciler writes NO P&L. The
   * two tempting alternatives are both wrong: the whole net is the overstatement, and `0` is a
   * fabricated break-even in a ledger the owner reads. An honest "cannot compute" is the outcome.
   */
  it('writes NO pnl rather than the whole net when the share is not computable (#1014)', async () => {
    position.findMany.mockResolvedValue([{
      id: 'position-1', symbol: 'XAUUSD', provider: 'mt5', brokerTicket: '152690675067',
      side: 'buy', quantity: 0.01, currentPrice: 4157.11, pnl: 40,
      openedAt: new Date('2026-09-28T08:52:17Z'),
    }]);
    trade.findFirst.mockResolvedValue({ id: 'trade-1', symbol: 'XAUUSD', side: 'buy', quantity: 0.01 });
    trade.count.mockResolvedValue(4);
    // ⚠️ The closing deal is present but NO OPENING deals are — so the denominator is unknown.
    adapter.getDeals.mockResolvedValue([
      { positionId: '152690675067', side: 'sell', volume: 0.04, price: 4157.11, profit: 40, time: new Date('2026-09-28T12:28:00Z') },
    ]);

    await service.syncPositions('mt5', [], { authoritative: true });

    const data: any = trade.update.mock.calls[0][0].data;
    expect(data.status).toBe('closed');
    // NOT 40 (the position's whole net booked to one of four rows) and NOT 0 (a claimed break-even).
    expect(data.pnl).toBeNull();
  });

  it('stores same-symbol positions independently by broker ticket', async () => {
    trade.findFirst
      .mockResolvedValueOnce({ id: 'trade-1', brokerTicket: '501' })
      .mockResolvedValueOnce({ id: 'trade-2', brokerTicket: '502' });
    position.findMany.mockResolvedValue([]);
    const base = {
      symbol: 'EURUSD', side: 'buy' as const, quantity: 0.1, avgPrice: 1.08,
      currentPrice: 1.09, pnl: 10, sl: null, tp: null, comment: '', openedAt: new Date(),
    };

    await service.syncPositions('mt5', [
      { ...base, brokerTicket: '501' },
      { ...base, brokerTicket: '502' },
    ], { authoritative: true });

    expect(position.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { provider_brokerTicket: { provider: 'mt5', brokerTicket: '501' } },
    }));
    expect(position.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { provider_brokerTicket: { provider: 'mt5', brokerTicket: '502' } },
    }));
  });

  /**
   * Regression 2026-09-10 — a closed position stayed in the Position table as a
   * phantom "open" row (and kept the duplicate guard blocking the symbol):
   * the closure scan was scoped by accountId, and legacy rows carry NULL.
   */
  it('finalizes a legacy row (no ticket, no account) that is gone from the broker', async () => {
    position.findMany.mockResolvedValue([{
      id: 'phantom-1',
      symbol: 'XAUUSD',
      provider: 'mt5',
      brokerTicket: null,
      accountId: null,
      side: null,
      quantity: 0.01,
      avgPrice: 4478.47,
      currentPrice: 4402.48,
      pnl: 56.13,
      openedAt: new Date('2026-09-03T21:49:31Z'),
    }]);
    trade.findFirst.mockResolvedValue({ id: 'trade-xau', symbol: 'XAUUSD', side: 'sell' });
    adapter.getDeals.mockResolvedValue([]);

    const result = await service.syncPositions('mt5', [], {
      authoritative: true,
      accountId: '10011309743',
    });

    expect(result.closed).toBe(1);
    expect(position.delete).toHaveBeenCalledWith({ where: { id: 'phantom-1' } });
    // The scan must include the legacy NULL-account rows, not just this account.
    expect(position.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ provider: 'mt5', OR: expect.any(Array) }),
    }));
  });

  it('finalizes a legacy duplicate once a ticketed row represents the symbol', async () => {
    position.findMany.mockResolvedValue([
      {
        id: 'legacy-aud', symbol: 'AUDUSD', provider: 'mt5', brokerTicket: null,
        accountId: null, side: null, quantity: 0.01, avgPrice: 0.7206,
        currentPrice: 0.72176, pnl: 0.86, openedAt: new Date('2026-09-03T21:49:56Z'),
      },
      {
        id: 'live-aud', symbol: 'AUDUSD', provider: 'mt5', brokerTicket: '152599651521',
        accountId: '10011309743', side: 'buy', quantity: 0.01, avgPrice: 0.72184,
        currentPrice: 0.7215, pnl: -0.25, openedAt: new Date('2026-09-08T18:49:49Z'),
      },
    ]);
    trade.findFirst.mockResolvedValue({ id: 'trade-aud', symbol: 'AUDUSD', side: 'buy' });
    adapter.getDeals.mockResolvedValue([]);

    const result = await service.syncPositions('mt5', [{
      symbol: 'AUDUSD', brokerTicket: '152599651521', side: 'buy', quantity: 0.01,
      avgPrice: 0.72184, currentPrice: 0.7215, pnl: -0.25,
      sl: null, tp: null, comment: '', openedAt: new Date(),
    }], { authoritative: true, accountId: '10011309743' });

    expect(result.closed).toBe(1);
    expect(position.delete).toHaveBeenCalledWith({ where: { id: 'legacy-aud' } });
    expect(position.delete).not.toHaveBeenCalledWith({ where: { id: 'live-aud' } });
  });

  it('resolves the closing deal from the Trade side when the legacy row has no side', async () => {
    position.findMany.mockResolvedValue([{
      id: 'phantom-2', symbol: 'XAUUSD', provider: 'mt5', brokerTicket: null,
      accountId: null, side: null, quantity: 0.01, avgPrice: 4478.47,
      currentPrice: 4402.48, pnl: 56.13, openedAt: new Date('2026-09-03T21:49:31Z'),
    }]);
    trade.findFirst.mockResolvedValue({ id: 'trade-xau', symbol: 'XAUUSD', side: 'sell' });
    // One lifecycle: short opened @4478.47, closed @4403.27 for +55.55 (swap -0.06).
    adapter.getDeals.mockResolvedValue([
      { positionId: '152582228436', symbol: 'XAUUSD', side: 'sell', volume: 0.01, price: 4478.47, profit: 0, commission: 0, swap: 0, time: new Date('2026-09-03T21:49:31Z') },
      { positionId: '152582228436', symbol: 'XAUUSD', side: 'buy', volume: 0.01, price: 4403.27, profit: 55.55, commission: 0, swap: -0.06, time: new Date('2026-09-07T16:41:31Z') },
    ]);

    await service.syncPositions('mt5', [], { authoritative: true });

    const updateArg: any = trade.update.mock.calls[0][0];
    expect(updateArg.data.status).toBe('closed');
    expect(updateArg.data.exitPrice).toBe(4403.27);
    expect(updateArg.data.pnl).toBeCloseTo(55.49, 2);
    expect(updateArg.data.closedAt.toISOString()).toBe('2026-09-07T16:41:31.000Z');
  });

  /**
   * Regression 2026-09-10 — stranded Trade rows.
   *
   * The Position table self-heals, but `trade` had no reaper: when a position
   * closed, finalizeClosedPosition() only ran for rows still present in
   * `position`. Any Trade whose Position row had already been cleaned stayed
   * `status='open'` forever. Measured: 17 phantom USDCAD rows against ZERO
   * broker positions, inflating every open-exposure count.
   */
  it('reaps an unticketed open Trade whose symbol is absent from the broker snapshot', async () => {
    position.findMany.mockResolvedValue([]);
    trade.findMany.mockResolvedValue([
      { id: 'stranded-1', symbol: 'USDCAD', openedAt: new Date('2026-07-24T18:41:05Z') },
    ]);
    trade.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.syncPositions('mt5', [], { authoritative: true });

    expect(result.reaped).toBe(1);
    expect(trade.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'stranded-1', status: 'open', brokerTicket: null }),
      data: expect.objectContaining({ status: 'closed', pnl: 0 }),
    }));
  });

  it('does NOT reap an unticketed Trade whose symbol IS held by the broker', async () => {
    position.findMany.mockResolvedValue([]);
    trade.findMany.mockResolvedValue([
      { id: 'live-1', symbol: 'XAUUSD', openedAt: new Date('2026-09-03T21:49:31Z') },
    ]);

    const result = await service.syncPositions('mt5', [{
      symbol: 'XAUUSD', side: 'buy', quantity: 0.01, avgPrice: 4380,
      currentPrice: 4388, pnl: 1, sl: null, tp: null, comment: '', openedAt: new Date(),
    }], { authoritative: true });

    expect(result.reaped).toBe(0);
    expect(trade.updateMany).not.toHaveBeenCalled();
  });
});
