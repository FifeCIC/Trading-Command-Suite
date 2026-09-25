/**
 * Mt5Controller — the deprecated order passthrough must not bypass the route guard (#914).
 * =======================================================================================
 *
 * MEASURED (live, 2026-09-21 during the #914 verification): the deprecated
 * `POST /api/providers/mt5/order` was a RAW passthrough to the DEFAULT bridge, resolving no
 * route at all. Sending it a bare crypto ticker reached MetaQuotes, where MT5 fuzzy-matches
 * `BTC` to `Nasdaq\ETF\BTC`; the only thing that stopped the fill was that US ETF's own 1-lot
 * floor ("Volume 0.1 below BTC minimum (1.0)"). Zero callers exist — but a live endpoint that
 * can buy the wrong instrument does not get to wait for its scheduled deletion unguarded.
 *
 * Asserted BOTH directions:
 *   - the passthrough delegates to the canonical executor (which refuses unverified routes),
 *     and never contacts a bridge directly;
 *   - a successful fill through it still records the Trade row (#446's traceability net).
 */

import { Mt5Controller } from './mt5.controller';
import { Mt5Adapter } from './adapters/mt5.adapter';
import { orderRouteProblems } from './mt5/mt5-symbol-router.service';

/**
 * The controller resolves the adapter through `getMt5Adapter()`, which requires a real
 * Mt5Adapter instance — so the spec builds one with a route stub whose rules come from the
 * SAME shared function production uses (orderRouteProblems), rather than restating them.
 */
function makeController(opts: { symbol: string; brokerId: number; url: string; brokerSymbol: string; provider?: string } = {
  symbol: 'BTC', brokerId: 0, url: '', brokerSymbol: 'BTC', provider: 'binance',
}) {
  const route = {
    brokerId: opts.brokerId,
    url: opts.brokerId === 0 ? null : opts.url,
    brokerSymbol: opts.brokerSymbol,
    explicit: true,
    mt5: opts.brokerId !== 0,
    provider: opts.provider ?? 'mt5',
  };
  const router = {
    // ⚠️ This stub must implement what the adapter actually CALLS (#1002). The order path now uses
    // `resolveForOrder`, not `resolve` — and a stub missing a method fails as
    // "resolveForOrder is not a function", which reads like a production bug rather than a stale
    // test. Both are provided so this spec keeps testing route integrity, which is its subject.
    //
    // `canTradeOn` returns UNDEFINED deliberately: it models a router with no capability data,
    // which is a real state, and proves the check does not refuse on unknown.
    resolve: () => route,
    resolveForOrder: () => route,
    canTradeOn: () => undefined,
    brokerIds: () => [2, 3],
  } as any;
  const adapter = new Mt5Adapter(undefined, undefined, undefined, router);
  const adapterFactory = { create: () => adapter } as any;
  const prisma = {
    isAvailable: true,
    trade: { create: jest.fn().mockResolvedValue({}) },
  } as any;
  const controller = new Mt5Controller(adapterFactory, prisma, {} as any, {} as any);
  return { controller, prisma, routeProblems: orderRouteProblems(opts.symbol, route as any, [2, 3]) };
}

describe('Mt5Controller — deprecated order passthrough (#914)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('delegates to the canonical executor and never fetches a bridge directly', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    const { controller, routeProblems } = makeController();

    const res: any = await controller.placeOrder({ symbol: 'BTC', type: 'BUY', volume: 0.1 });

    // The guard's own verdict (shared function) is what the response must carry…
    expect(routeProblems.join(' ')).toContain('not an active MT5 bridge');
    expect(res.success).toBe(false);
    expect(res.error).toContain('not an active MT5 bridge');
    // ⚠️ The canary: the raw passthrough is gone — no direct bridge call may happen here.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still records the Trade row on a successful fill (#446 traceability net)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, ticket: 42, price: 1.23 }),
    }) as any;
    const { controller, prisma } = makeController({
      symbol: 'XAUUSD', brokerId: 3, url: 'http://localhost:5001', brokerSymbol: 'XAUUSD',
    });

    const res: any = await controller.placeOrder({ symbol: 'XAUUSD', type: 'BUY', volume: 0.01 });

    expect(res.success).toBe(true);
    expect(res._deprecated).toBe(true);
    expect(prisma.trade.create).toHaveBeenCalledTimes(1);
    expect(prisma.trade.create.mock.calls[0][0].data).toMatchObject({
      symbol: 'XAUUSD', side: 'buy', quantity: 0.01, ticket: 42,
    });
  });
});
