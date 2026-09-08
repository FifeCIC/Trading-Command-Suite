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
    create: jest.fn(),
    update: jest.fn(),
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
    adapter.getDeals.mockResolvedValue([]);
    service = new PositionSyncService(prisma as any, adapterFactory as any);
  });

  it('does not infer closures from a non-authoritative empty response', async () => {
    const result = await service.syncPositions('mt5', [], { authoritative: false });

    expect(result).toEqual({ synced: 0, created: 0, closed: 0 });
    expect(position.findMany).not.toHaveBeenCalled();
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
});
