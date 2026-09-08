import { Mt5TradingService } from './mt5-trading.service';

describe('Mt5TradingService broker contracts', () => {
  const tradeRecorder = { record: jest.fn(), close: jest.fn() };
  const stopGuardian = { recordAdjustment: jest.fn() };
  const prisma = {
    isAvailable: true,
    order: { create: jest.fn().mockResolvedValue({}) },
    trade: { findFirst: jest.fn() },
  };
  const connection = { getUrl: () => 'http://mt5.test' };
  let service: Mt5TradingService;

  const response = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: jest.fn().mockResolvedValue(body),
  }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new Mt5TradingService(
      tradeRecorder as any,
      stopGuardian as any,
      prisma as any,
      connection as any,
    );
  });

  it('unwraps and normalizes the v2 bridge position envelope', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({
      positions: [{
        ticket: 152239905341,
        symbol: 'EURUSD',
        type: 'buy',
        volume: 0.2,
        priceOpen: 1.08,
        priceCurrent: 1.09,
        profit: 20,
        openTime: '2026-09-07T12:00:00Z',
      }],
      count: 1,
    })) as any;

    const positions = await service.getPositions();

    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      ticket: 152239905341,
      price_open: 1.08,
      price_current: 1.09,
      type: 'buy',
    });
  });

  it('closes the existing trade lifecycle when the v2 bridge reports success', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({
        positions: [{ ticket: 42, symbol: 'XAUUSD', type: 'buy', volume: 0.1, priceOpen: 2400, priceCurrent: 2410, profit: 10 }],
      }))
      .mockResolvedValueOnce(response({ success: true, ticket: 42, closePrice: 2410, profit: 10 })) as any;
    prisma.trade.findFirst.mockResolvedValue({ id: 'trade-42' });
    tradeRecorder.close.mockResolvedValue(true);

    const result = await service.closePosition(42);

    expect(result.success).toBe(true);
    expect(tradeRecorder.close).toHaveBeenCalledWith('trade-42', 2410, 10);
    expect(tradeRecorder.record).not.toHaveBeenCalled();
  });

  it('uses the bridge partial-close endpoint', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ success: true, ticket: 42, closed: 0.05 })) as any;

    const result = await service.closePartial(42, 0.05);

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://mt5.test/close/partial/42',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('keeps the trade lifecycle open when a requested full close only partially fills', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({
        positions: [{ ticket: 42, symbol: 'XAUUSD', type: 'buy', volume: 0.1, priceOpen: 2400, priceCurrent: 2410, profit: 10 }],
      }))
      .mockResolvedValueOnce(response({ success: true, ticket: 42, partial: true, closePrice: 2410 })) as any;

    const result = await service.closePosition(42);

    expect(result.success).toBe(true);
    expect(tradeRecorder.close).not.toHaveBeenCalled();
    expect(tradeRecorder.record).not.toHaveBeenCalled();
  });

  it('forwards the caller idempotency key when placing an order', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ success: true, ticket: 99, price: 1.1 })) as any;

    await service.placeOrder({
      symbol: 'EURUSD',
      type: 'BUY',
      volume: 0.1,
      clientOrderId: 'queue-signal-1',
    });

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(JSON.parse(init.body)).toMatchObject({ clientOrderId: 'queue-signal-1' });
  });
});
