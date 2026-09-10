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

  it('closes the existing trade lifecycle when the v2 bridge reports a realised outcome', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({
        positions: [{ ticket: 42, symbol: 'XAUUSD', type: 'buy', volume: 0.1, priceOpen: 2400, priceCurrent: 2410, profit: 10 }],
      }))
      // `realized: true` = the bridge read the closed deal, so its figures are
      // authoritative and must be persisted verbatim.
      .mockResolvedValueOnce(response({ success: true, ticket: 42, closePrice: 2410, profit: 10, realized: true })) as any;
    prisma.trade.findFirst.mockResolvedValue({ id: 'trade-42' });
    tradeRecorder.close.mockResolvedValue(true);

    const result = await service.closePosition(42);

    expect(result.success).toBe(true);
    expect(tradeRecorder.close).toHaveBeenCalledWith('trade-42', 2410, 10);
    expect(tradeRecorder.record).not.toHaveBeenCalled();
  });

  /**
   * When the bridge CANNOT report the realised outcome (`realized` absent, as in
   * every build before 2026-09-10), its `profit` is a pre-close FLOATING value
   * and must never be persisted as if it were realised. Nest recomputes from
   * entry/exit/side instead — see the fabrication regression below.
   */
  it('recomputes rather than trusting a floating profit from a pre-fix bridge', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({
        positions: [{ ticket: 42, symbol: 'XAUUSD', type: 'buy', volume: 0.1, priceOpen: 2400, priceCurrent: 2410, profit: 10 }],
      }))
      .mockResolvedValueOnce(response({ success: true, ticket: 42, closePrice: 2410, profit: 10 })) as any;
    prisma.trade.findFirst.mockResolvedValue({ id: 'trade-42' });
    tradeRecorder.close.mockResolvedValue(true);

    await service.closePosition(42);

    // (2410 - 2400) * 0.1 * +1 = 1.0 recomputed, not the floating 10.
    expect(tradeRecorder.close).toHaveBeenCalledWith('trade-42', 2410, 1);
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

  /**
   * Regression 2026-09-10 — FABRICATED P&L.
   *
   * The bridge /close endpoint used to return `pos.profit` (floating profit
   * read BEFORE order_send) and a pre-fill `tick.bid|ask` quote. Nest trusted
   * both, falling back to the same pre-close values. Because closeAll() loops
   * closePosition() per ticket, ONE bulk close stamped ONE shared exitPrice and
   * ONE shared pnl onto every row in the batch.
   *
   * Real evidence: 26 EURUSD rows all exitPrice=1.16257 / pnl=-9.02 with a
   * byte-identical closedAt — buys AND sells taking the same sign.
   *
   * This test asserts the property that was violated: two DIFFERENT positions
   * closed in the same batch must never receive identical exit prices, and a
   * long closing higher must not be recorded as a loss.
   */
  it('never shares one exit price or P&L across two positions in a batch close', async () => {
    const recorded: Array<{ id: string; exitPrice: number; pnl: number }> = [];
    tradeRecorder.close.mockImplementation(async (id: string, exitPrice: number, pnl: number) => {
      recorded.push({ id, exitPrice, pnl });
      return true;
    });

    // Two EURUSD positions opened at different prices, both still open.
    global.fetch = jest.fn().mockImplementation(async (url: string) => {
      if (String(url).endsWith('/positions')) {
        return response({
          positions: [
            { ticket: 1, symbol: 'EURUSD', type: 'buy', volume: 0.01, priceOpen: 1.1400, priceCurrent: 1.1500, profit: 1.0 },
            { ticket: 2, symbol: 'EURUSD', type: 'buy', volume: 0.01, priceOpen: 1.1600, priceCurrent: 1.1500, profit: -1.0 },
          ],
        });
      }
      // Bridge now returns the REALISED outcome per ticket (different per position).
      if (String(url).includes('/close/1')) {
        return response({ success: true, ticket: 1, closePrice: 1.1500, profit: 0.10, realized: true });
      }
      return response({ success: true, ticket: 2, closePrice: 1.1500, profit: -0.10, realized: true });
    }) as any;

    prisma.trade.findFirst
      .mockResolvedValueOnce({ id: 'trade-1' })
      .mockResolvedValueOnce({ id: 'trade-2' });

    await service.closePosition(1);
    await service.closePosition(2);

    expect(recorded).toHaveLength(2);
    // The pnl values must differ — a shared value is the bug's signature.
    expect(recorded[0].pnl).not.toBe(recorded[1].pnl);
    // And the long that closed flat-ish must not be booked as a large loss.
    expect(Math.abs(recorded[0].pnl)).toBeLessThan(1);
    expect(Math.abs(recorded[1].pnl)).toBeLessThan(1);
  });

  it('recomputes realised P&L from entry/exit when the bridge reports no realised figure', async () => {
    global.fetch = jest.fn()
      .mockResolvedValueOnce(response({
        positions: [{ ticket: 77, symbol: 'EURUSD', type: 'buy', volume: 0.10, priceOpen: 1.1000, priceCurrent: 1.1500, profit: 99 }],
      }))
      // Stale bridge: no `realized` flag, and `profit` is the OLD floating value.
      .mockResolvedValueOnce(response({ success: true, ticket: 77, closePrice: 1.1200, profit: 99 })) as any;
    prisma.trade.findFirst.mockResolvedValue({ id: 'trade-77' });
    tradeRecorder.close.mockResolvedValue(true);

    await service.closePosition(77);

    // entry 1.10 -> exit 1.12, 0.10 lots, long => +0.0020 * 0.10 = +0.0002... but
    // the KEY assertion is that the floating `99` was NOT persisted as realised.
    const call: any = tradeRecorder.close.mock.calls[0];
    expect(call[2]).not.toBe(99);
    expect(Math.abs(call[2])).toBeLessThan(1);
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
