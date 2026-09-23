import { Mt5TradingService } from './mt5-trading.service';

/**
 * mt5-trading.routed-reads.spec.ts — #972 guard: a SYMBOL read must ask the broker that SERVES it.
 *
 * ⚠️ WHY THIS EXISTS. `placeOrder()` already resolved `route!.url` before posting, but every READ
 * used the bare `bridgeUrl` getter, which is `mt5Connection.getUrl()` with no argument — i.e. the
 * PRIMARY broker. Measured 2026-09-23: `GER40` and `VIX` are routed to broker 3 (`:5001`) and
 * 404 on `:5000`, so the risk estimate got no spec and no price, `price` came back `0`, and the
 * per-symbol cap refused 35 and 23 times respectively:
 *
 *   BLOCKED  Cannot evaluate the per-symbol cap for GER40: price is 0 (no quote)
 *
 * The refusal was correct behaviour; the read was unanswerable. This spec pins the fix so the
 * asymmetry cannot come back — orders routed, reads not.
 *
 * ⚠️ It asserts the FETCHED URL, not that a method was called. A test that only checked "fetch
 * happened" would pass against the broken code, which is exactly the failure it is guarding.
 */
describe('Mt5TradingService routed reads (#972)', () => {
  const tradeRecorder = { record: jest.fn(), close: jest.fn() };
  const stopGuardian = { recordAdjustment: jest.fn() };
  const prisma = { isAvailable: true, order: { create: jest.fn() }, trade: { findFirst: jest.fn() } };

  const PRIMARY = 'http://primary.test';
  const PEPPERSTONE = 'http://pepperstone.test';

  /** Broker 3 is a real bridge; broker 0 is the crypto (non-MT5) route. */
  const connection = {
    getUrl: (brokerId?: number) => (brokerId === 3 ? PEPPERSTONE : PRIMARY),
    isBroker: (id: number) => id === 2 || id === 3,
    getBrokerIds: () => [2, 3],
  };

  const symbolRouter = {
    getBrokerId: (symbol: string) => {
      const s = (symbol || '').toUpperCase();
      if (s === 'GER40' || s === 'VIX') return 3;
      if (s === 'BTC') return 0; // routed to a non-MT5 broker
      return 2;
    },
  };

  const response = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: jest.fn().mockResolvedValue(body),
  }) as any;

  const fetchUrl = (n = 0) => String((global.fetch as jest.Mock).mock.calls[n][0]);

  let service: Mt5TradingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new Mt5TradingService(
      tradeRecorder as any,
      stopGuardian as any,
      prisma as any,
      connection as any,
      symbolRouter as any,
    );
    // The constructor signature above is asserted by the first test — if the 5th arg is not the
    // router, that test fails rather than these passing for the wrong reason.
  });

  it('getSymbolInfo() asks the ROUTED broker, not the primary', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({ name: 'GER40', digits: 1, contractSize: 1, volumeMin: 0.1, volumeMax: 100 }),
    ) as any;

    await service.getSymbolInfo('GER40');

    expect(fetchUrl()).toBe(`${PEPPERSTONE}/symbol/GER40/info`);
  });

  it('getQuote() asks the ROUTED broker, not the primary', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ bid: 1, ask: 2, last: 1.5 })) as any;

    await service.getQuote('VIX');

    expect(fetchUrl()).toBe(`${PEPPERSTONE}/quote?symbol=VIX`);
  });

  it('getCandles() asks the ROUTED broker — bars are as broker-specific as prices', async () => {
    global.fetch = jest.fn().mockResolvedValue(response({ bars: [] })) as any;

    await service.getCandles('GER40', '1h', 10);

    expect(fetchUrl().startsWith(`${PEPPERSTONE}/candles`)).toBe(true);
  });

  // ── The OTHER direction: the fallback must still work ─────────────────────────────────────
  // A guard that only proves the routed case would pass if the primary were dropped entirely.

  it('an UNROUTED symbol still uses the primary broker', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      response({ name: 'EURUSD', digits: 5, contractSize: 100000, volumeMin: 0.01, volumeMax: 100 }),
    ) as any;

    await service.getSymbolInfo('EURUSD');

    expect(fetchUrl()).toBe(`${PRIMARY}/symbol/EURUSD/info`);
  });

  it('a route to a NON-MT5 broker falls back to the primary and does NOT throw', async () => {
    // `getUrl(0)` throws by design (#914 — never answer an explicit id with the default bridge).
    // A ROUTE is not an explicit id, so here the fallback is the correct behaviour.
    global.fetch = jest.fn().mockResolvedValue(
      response({ name: 'BTC', digits: 2, contractSize: 1, volumeMin: 0.01, volumeMax: 10 }),
    ) as any;

    await expect(service.getSymbolInfo('BTC')).resolves.toBeDefined();
    expect(fetchUrl()).toBe(`${PRIMARY}/symbol/BTC/info`);
  });

  it('a missing router degrades to the primary rather than failing', async () => {
    const noRouter = new Mt5TradingService(
      tradeRecorder as any,
      stopGuardian as any,
      prisma as any,
      connection as any,
    );
    global.fetch = jest.fn().mockResolvedValue(
      response({ name: 'GER40', digits: 1, contractSize: 1, volumeMin: 0.1, volumeMax: 100 }),
    ) as any;

    await noRouter.getSymbolInfo('GER40');

    expect(fetchUrl()).toBe(`${PRIMARY}/symbol/GER40/info`);
  });
});
