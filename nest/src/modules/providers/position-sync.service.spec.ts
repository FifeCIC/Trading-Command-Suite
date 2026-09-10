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
