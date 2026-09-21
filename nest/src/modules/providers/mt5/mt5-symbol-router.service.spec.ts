/**
 * Mt5SymbolRouter — ROUTE INTEGRITY (#914).
 * =========================================
 *
 * The measured defect this spec guards: a route whose `brokerId` is NOT an active MT5 bridge
 * (the four crypto rows carry `brokerId 0` / `provider=binance`) was resolved through
 * `getUrl(0)`, and because `0` is falsy the connection manager answered with the DEFAULT bridge
 * (MetaQuotes :5000). There, the bare ticker `BTC` matched `Nasdaq\ETF\BTC` — so a BTC manual
 * trade was refused quoting a US ETF's 1-lot floor, attributed to "broker 0", with a "fix"
 * (raise to 1 lot) that would have multiplied the position 10x.
 *
 * Asserted BOTH directions, because a guard that has never been seen to fail is decoration:
 *   - a non-MT5 route resolves to `url: null`, `mt5: false`, and the bridge URL is never
 *     manufactured for it (the spy proves the default bridge was not consulted);
 *   - an MT5-routed symbol still resolves to its broker's real URL.
 */

import { Mt5SymbolRouter, orderRouteProblems } from './mt5-symbol-router.service';

function makeRouter(rows: any[], brokerIds: number[] = [2, 3]) {
  const prisma = {
    isAvailable: true,
    symbolRoute: { findMany: async () => rows },
  } as any;

  const urls = new Map<number, string>([[2, 'http://localhost:5000'], [3, 'http://localhost:5001']]);
  const conn = {
    isBroker: (id: number | null | undefined) => id != null && brokerIds.includes(id),
    getUrl: jest.fn((id?: number | null) => {
      if (id == null) return 'http://localhost:5000';
      const url = urls.get(id);
      if (!url) throw new Error(`Broker ${id} is not an MT5 bridge`);
      return url;
    }),
    getBrokerIds: () => brokerIds,
  } as any;

  return { router: new Mt5SymbolRouter(prisma, conn), conn };
}

const BTC_ROW = { symbol: 'BTC', brokerId: 0, brokerSymbol: null, provider: 'binance', enabled: true, priority: 1 };
const XAU_ROW = { symbol: 'XAUUSD', brokerId: 2, brokerSymbol: 'XAUUSD', provider: 'mt5', enabled: true, priority: 1 };

describe('Mt5SymbolRouter.resolve — a non-MT5 route has no bridge (#914)', () => {
  it('resolves the binance BTC row to url:null / mt5:false and never asks for a bridge URL', async () => {
    const { router, conn } = makeRouter([BTC_ROW]);
    await router.refresh();

    const route = router.resolve('BTC');

    expect(route).toMatchObject({
      brokerId: 0,
      url: null,
      mt5: false,
      provider: 'binance',
      brokerSymbol: 'BTC', // bare-ticker fallback is what orderRouteProblems() refuses on
      explicit: true,
    });
    // ⚠️ THE CANARY: the default bridge must never be manufactured for broker 0.
    expect(conn.getUrl).not.toHaveBeenCalled();
  });

  it('still resolves an MT5-routed symbol to its real broker bridge (restore direction)', async () => {
    const { router, conn } = makeRouter([XAU_ROW]);
    await router.refresh();

    const route = router.resolve('XAUUSD');

    expect(route).toMatchObject({ brokerId: 2, url: 'http://localhost:5000', mt5: true, provider: 'mt5' });
    expect(conn.getUrl).toHaveBeenCalledWith(2);
  });

  it('falls back to the primary broker (an MT5 bridge) when no route row exists', async () => {
    const { router } = makeRouter([]);
    await router.refresh();

    expect(router.resolve('NAS100')).toMatchObject({ brokerId: 2, url: 'http://localhost:5000', mt5: true, explicit: false });
  });

  it('routeForBroker(0) is honest too — no URL, mt5 false', async () => {
    const { router } = makeRouter([]);
    await router.refresh();

    expect(router.routeForBroker(0)).toMatchObject({ brokerId: 0, url: null, mt5: false });
    expect(router.routeForBroker(3)).toMatchObject({ brokerId: 3, url: 'http://localhost:5001', mt5: true });
  });
});

describe('orderRouteProblems — the shared order-route check (#903 rules, #914 unification)', () => {
  const binanceRoute = { brokerId: 0, url: null, brokerSymbol: 'BTC', explicit: true, mt5: false, provider: 'binance' };
  const mt5BtcRoute = { brokerId: 3, url: 'http://localhost:5001', brokerSymbol: 'BTCUSD', explicit: true, mt5: true, provider: 'mt5' };

  it('refuses the measured BTC route with BOTH reasons (not-a-bridge + bare ticker)', () => {
    const problems = orderRouteProblems('BTC', binanceRoute as any, [2, 3]);

    expect(problems.join(' ')).toContain('not an active MT5 bridge');
    expect(problems.join(' ')).toContain('BARE ticker');
    expect(problems.join(' ')).toContain('binance');
  });

  it('admits a fully-verified crypto route', () => {
    expect(orderRouteProblems('BTC', mt5BtcRoute as any, [2, 3])).toEqual([]);
  });

  it('refuses a crypto symbol with no explicit row (bare ticker fallback)', () => {
    const route = { brokerId: 2, url: 'http://localhost:5000', brokerSymbol: 'BTC', explicit: false, mt5: true, provider: null };

    const problems = orderRouteProblems('BTC', route as any, [2, 3]);

    expect(problems.join(' ')).toContain('no explicit symbol_route row');
    expect(problems.join(' ')).toContain('BARE ticker');
  });

  it('fails CLOSED for crypto when the router is unavailable, but leaves other assets untouched', () => {
    expect(orderRouteProblems('BTC', null, [2, 3]).join(' ')).toContain('router is unavailable');
    // Non-crypto identity mapping predates the hazard — no route object must not block it.
    expect(orderRouteProblems('XAUUSD', null, [2, 3])).toEqual([]);
  });

  it('refuses a NON-crypto misroute to a non-MT5 broker too (a misroute is a misroute)', () => {
    const route = { brokerId: 0, url: null, brokerSymbol: 'XAUUSD', explicit: true, mt5: false, provider: 'binance' };

    expect(orderRouteProblems('XAUUSD', route as any, [2, 3]).join(' ')).toContain('not an active MT5 bridge');
  });

  it('applies no active-bridge rule when no registry exists (single-bridge installs)', () => {
    const route = { brokerId: 2, url: 'http://localhost:5000', brokerSymbol: 'XAUUSD', explicit: false, mt5: true, provider: null };

    expect(orderRouteProblems('XAUUSD', route as any, [])).toEqual([]);
  });
});
