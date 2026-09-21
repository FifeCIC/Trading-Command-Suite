import { Mt5Adapter } from './mt5.adapter';

describe('Mt5Adapter execution contracts', () => {
  const response = (body: unknown) => ({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  }) as any;

  beforeEach(() => jest.clearAllMocks());

  it('marks a successfully fetched empty position snapshot as authoritative', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ positions: [], count: 0 })) as any;
    const adapter = new Mt5Adapter();

    await expect(adapter.getPositionSnapshot()).resolves.toEqual({
      positions: [],
      authoritative: true,
    });
  });

  it('marks a failed position fetch as non-authoritative', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('connection refused')) as any;
    const adapter = new Mt5Adapter();

    await expect(adapter.getPositionSnapshot()).resolves.toEqual({
      positions: [],
      authoritative: false,
    });
  });

  it('forwards idempotency and exposes partial fills', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({
      success: true,
      ticket: 99,
      status: 'partially_filled',
      filledVolume: 0.05,
      price: 1.1,
    })) as any;
    const adapter = new Mt5Adapter();

    const result = await adapter.placeOrder({
      symbol: 'EURUSD',
      side: 'BUY',
      quantity: 0.1,
      clientOrderId: 'queue-1',
    });

    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(JSON.parse(init.body)).toMatchObject({ clientOrderId: 'queue-1' });
    expect(result).toMatchObject({
      success: true,
      status: 'PARTIALLY_FILLED',
      filledQuantity: 0.05,
    });
  });

  /**
   * #914 — THE ORDER PATH'S ROUTE GUARD.
   *
   * This adapter is the path manual trades (signal-actions) and the automation loop actually
   * use. Before the fix, a route to a non-MT5 broker (the binance BTC row, brokerId 0) reached
   * `bridgePost('/order', …)` with the bare ticker `BTC` — which MT5 resolves to
   * `Nasdaq\ETF\BTC`, a different instrument that FILLS. The guard is asserted here because the
   * feasibility library's blocker is only as good as the path behind it.
   */
  it('refuses to place an order through a route that is not an MT5 bridge (#914)', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const router = {
      resolve: () => ({ brokerId: 0, url: null, brokerSymbol: 'BTC', explicit: true, mt5: false, provider: 'binance' }),
      brokerIds: () => [2, 3],
    } as any;
    const adapter = new Mt5Adapter(undefined, undefined, undefined, router);

    const result = await adapter.placeOrder({ symbol: 'BTC', side: 'BUY', quantity: 0.1 });

    expect(result.success).toBe(false);
    expect(result.status).toBe('REJECTED');
    expect(result.error).toContain('not an active MT5 bridge');
    expect(result.error).toContain('BARE ticker');
    // ⚠️ The order must never reach a bridge.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still places an order for a symbol routed to an active MT5 bridge (restore direction)', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ success: true, ticket: 7 })) as any;
    const router = {
      resolve: () => ({ brokerId: 3, url: 'http://localhost:5001', brokerSymbol: 'XAUUSD', explicit: true, mt5: true, provider: 'mt5' }),
      brokerIds: () => [2, 3],
    } as any;
    const adapter = new Mt5Adapter(undefined, undefined, undefined, router);

    const result = await adapter.placeOrder({ symbol: 'XAUUSD', side: 'BUY', quantity: 0.01 });

    expect(result.success).toBe(true);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5001/order');
    expect(JSON.parse(String(init.body)).symbol).toBe('XAUUSD');
  });
});
