import { Mt5TradingService } from './mt5-trading.service';

/**
 * The crypto route guard (#903) — the last line before the bridge, canaried in BOTH directions.
 *
 * ⚠️ THE MEASURED HAZARD THIS PREVENTS. The `symbol_route` row for BTC was
 * `→ binance, brokerId 0, brokerSymbol NULL`. MT5 resolves order symbols BY NAME with fuzzy
 * matching, so handing it the bare ticker `BTC` selects `Nasdaq\ETF\BTC` (~$35.86) — a different
 * instrument at a different price, and the order FILLS. An app that scores crypto on weekends
 * (which this one now does, correctly) must not be one auto-mode flip away from buying an ETF by
 * accident.
 *
 * The guard refuses unless the route passes ALL of: explicit row, brokerSymbol ≠ bare ticker,
 * active MT5 broker target. When it passes, the broker-native name is what is SENT — the route's
 * brokerSymbol, not the canonical ticker.
 */
describe('Mt5TradingService.placeOrder — crypto route guard (#903)', () => {
  function build(route: any | 'none', activeBrokerIds = [2, 3]) {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, ticket: 123, price: 67000 }),
    } as any);

    const svc = new Mt5TradingService(
      { record: jest.fn() } as any,        // tradeRecorder
      { recordAdjustment: jest.fn() } as any, // stopGuardian
      { isAvailable: false } as any,       // prisma — recordOrder short-circuits, nothing persists
      { getUrl: () => 'http://localhost:5000', getBrokerIds: () => activeBrokerIds } as any,
      route === 'none' ? undefined : ({ resolve: () => route } as any),
    );
    return { svc, fetchMock };
  }

  afterEach(() => jest.restoreAllMocks());

  it('REFUSES a crypto order with no explicit route — the measured BTC → Nasdaq\\ETF\\BTC case', async () => {
    // What resolve() returns when NO symbol_route row exists: brokerSymbol falls back to the bare
    // ticker itself. That fallback is exactly the fuzzy-match hazard.
    const { svc, fetchMock } = build({ brokerId: 2, url: 'http://localhost:5000', brokerSymbol: 'BTC', explicit: false });

    const res = await svc.placeOrder({ symbol: 'BTC', type: 'BUY', volume: 0.01 });

    expect(res.success).toBe(false);
    expect(res.error).toContain('#903');
    expect(res.error).toContain('no explicit symbol_route row');
    expect(res.error).toContain('BARE ticker');
    // ⚠️ The order must never reach a bridge.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REFUSES a route that targets broker 0 (the binance row) even with a good brokerSymbol', async () => {
    const { svc, fetchMock } = build({ brokerId: 0, url: 'http://localhost:5000', brokerSymbol: 'BTCUSD', explicit: true });

    const res = await svc.placeOrder({ symbol: 'BTC', type: 'BUY', volume: 0.01 });

    expect(res.success).toBe(false);
    expect(res.error).toContain('not an active MT5 bridge');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REFUSES a route with an empty brokerSymbol', async () => {
    const { svc, fetchMock } = build({ brokerId: 3, url: 'http://localhost:5001', brokerSymbol: '', explicit: true });
    const res = await svc.placeOrder({ symbol: 'ETHUSD', type: 'BUY', volume: 0.1 });
    expect(res.success).toBe(false);
    expect(res.error).toContain('no brokerSymbol');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('REFUSES when the router is unavailable — unverifiable is never \"probably fine\"', async () => {
    const { svc, fetchMock } = build('none');
    const res = await svc.placeOrder({ symbol: 'BTC', type: 'BUY', volume: 0.01 });
    expect(res.success).toBe(false);
    expect(res.error).toContain('router is unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ADMITS a fully-verified route and sends the BROKER-NATIVE name to that route's bridge", async () => {
    const { svc, fetchMock } = build({ brokerId: 3, url: 'http://localhost:5001', brokerSymbol: 'BTCUSD', explicit: true });

    const res = await svc.placeOrder({ symbol: 'BTC', type: 'BUY', volume: 0.01 });

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // The route's broker is addressed, not the default…
    expect(url).toBe('http://localhost:5001/order');
    // …and the payload carries the broker's real symbol, never the bare ticker.
    expect(JSON.parse(String(init.body)).symbol).toBe('BTCUSD');
  });

  it('leaves NON-crypto orders untouched — default bridge, canonical symbol (restore direction)', async () => {
    const { svc, fetchMock } = build({ brokerId: 2, url: 'http://localhost:5000', brokerSymbol: 'XAUUSD', explicit: true });

    const res = await svc.placeOrder({ symbol: 'XAUUSD', type: 'BUY', volume: 0.01 });

    expect(res.success).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5000/order');
    expect(JSON.parse(String(init.body)).symbol).toBe('XAUUSD');
  });
});
