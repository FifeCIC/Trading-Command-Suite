/**
 * Capability-based order routing (#1002).
 *
 * ── WHAT THIS GUARDS ──────────────────────────────────────────────────────────────────────────
 * A broker can LIST a symbol and still refuse to trade it (`broker_symbol.tradeMode = 0`). Measured
 * 2026-09-25: **broker 2 lists 925 such symbols**, broker 3 lists 1. Before this change an unrouted
 * symbol went to `primaryBrokerId()` with no check at all, so it was sent to a broker that could not
 * trade it and refused there, naming nothing useful. US30's own `symbol_route` note records that
 * failure verbatim: *"no route existed (silent fallback to :5000, tradeMode 0)"*.
 *
 * ⚠️ **The most important test in this file is the one asserting we do NOT refuse.** UNKNOWN
 * capability (`undefined`) must keep working, because a broker whose symbol list has never been
 * synced would otherwise refuse every order — a blanket block is a worse failure than the one being
 * fixed, and it would be invisible until someone tried to trade.
 */

import { Mt5SymbolRouter, orderRouteProblems } from './mt5-symbol-router.service';

const mt5Route = (brokerId: number, brokerSymbol = 'US30') => ({
  brokerId,
  url: `http://127.0.0.1:${4998 + brokerId}`,
  brokerSymbol,
  explicit: false,
  mt5: true,
  provider: 'mt5',
});

describe('orderRouteProblems — capability check (#1002)', () => {
  it('refuses when the broker\'s OWN list says tradeMode=0, and NAMES the broker', () => {
    const problems = orderRouteProblems('US30', mt5Route(2) as any, [2, 3], () => false);
    expect(problems).toHaveLength(1);
    // The reason must be actionable: which broker, and the fact that the broker itself said no.
    expect(problems[0]).toContain('broker 2');
    expect(problems[0]).toContain('tradeMode=0');
    expect(problems[0]).toContain('US30');
  });

  it('⚠️ does NOT refuse when capability is UNKNOWN — unknown is not a refusal', () => {
    expect(orderRouteProblems('US30', mt5Route(2) as any, [2, 3], () => undefined)).toEqual([]);
  });

  it('does not refuse when the broker can trade it', () => {
    expect(orderRouteProblems('US30', mt5Route(2) as any, [2, 3], () => true)).toEqual([]);
  });

  it('does not capability-check a NON-MT5 route — crypto must not be mislabelled', () => {
    const binanceRoute = {
      brokerId: 0, url: null, brokerSymbol: 'BTCUSD', explicit: true, mt5: false, provider: 'binance',
    };
    // `canTrade` says "no" for everything; a crypto route must still not acquire an MT5 reason.
    const problems = orderRouteProblems('BTC', binanceRoute as any, [2, 3], () => false);
    expect(problems.join(' ')).not.toContain('tradeMode');
  });

  it('callers that pass no lookup are unaffected (the pre-#1002 behaviour)', () => {
    expect(orderRouteProblems('US30', mt5Route(2) as any, [2, 3])).toEqual([]);
  });
});

/** Minimal harness: the router only needs its two collaborators to exist. */
function makeRouter(overrides: {
  symbolRouteRows?: any[];
  brokerSymbolRows?: any[];
  brokerSymbolThrows?: boolean;
} = {}) {
  const prisma = {
    isAvailable: true,
    symbolRoute: { findMany: jest.fn(async () => overrides.symbolRouteRows ?? []) },
    brokerSymbol: {
      findMany: jest.fn(async () => {
        if (overrides.brokerSymbolThrows) throw new Error('broker_symbol unavailable');
        return overrides.brokerSymbolRows ?? [];
      }),
    },
  };
  const conn = {
    getBrokerIds: () => [2, 3],
    isBroker: (id: number) => [2, 3].includes(id),
    getUrl: (id: number) => `http://127.0.0.1:${4998 + id}`,
  };
  const router = new Mt5SymbolRouter(prisma as any, conn as any);
  (router as any).logger = { log: jest.fn(), warn: jest.fn() };
  return { router, prisma };
}

describe('Mt5SymbolRouter — capability loading and order resolution (#1002)', () => {
  it('capability is UNKNOWN before any load — never assumed tradeable, never assumed blocked', () => {
    const { router } = makeRouter();
    expect(router.canTradeOn(2, 'US30')).toBeUndefined();
    expect(router.tradeableBrokers('US30')).toBeNull();
    // The order check must therefore pass an unrouted symbol through on a cold router.
    expect(orderRouteProblems('US30', mt5Route(2) as any, [2, 3], (b, s) => router.canTradeOn(b, s)))
      .toEqual([]);
  });

  it('refresh() loads per-broker capability from broker_symbol', async () => {
    const { router } = makeRouter({
      brokerSymbolRows: [
        { brokerId: 2, name: 'XAUUSD' },
        { brokerId: 3, name: 'XAUUSD' },
        { brokerId: 2, name: 'US30' },
      ],
    });
    await router.refresh();

    expect(router.canTradeOn(2, 'XAUUSD')).toBe(true);
    expect(router.canTradeOn(3, 'XAUUSD')).toBe(true);
    // Broker 3 does NOT list US30 → it cannot trade it there.
    expect(router.canTradeOn(3, 'US30')).toBe(false);
    // Loaded, and NO broker lists it → cannot be traded on any configured bridge.
    expect(router.canTradeOn(2, 'NOTLISTED')).toBe(false);
    expect(router.tradeableBrokers('XAUUSD')).toEqual([2, 3]);
    expect(router.tradeableBrokers('NOTLISTED')).toEqual([]);
  });

  it('a FAILED capability load stays UNKNOWN rather than becoming "blocked"', async () => {
    const { router } = makeRouter({ brokerSymbolThrows: true });
    await router.refresh();
    // The routes still loaded — a capability failure must not break routing.
    expect(router.canTradeOn(2, 'US30')).toBeUndefined();
    expect(orderRouteProblems('US30', mt5Route(2) as any, [2, 3], (b, s) => router.canTradeOn(b, s)))
      .toEqual([]);
  });

  it('resolveForOrder() prefers an active broker that CAN trade the symbol', async () => {
    const { router } = makeRouter({ brokerSymbolRows: [{ brokerId: 3, name: 'US30' }] });
    await router.refresh();
    // No symbol_route row → the default is the primary broker (2), which cannot trade US30.
    expect(router.resolve('US30').brokerId).toBe(2);
    expect(router.resolveForOrder('US30').brokerId).toBe(3);
    // ⚠️ The FEED route must NOT move — only the order path changes (see the method's comment).
    expect(router.resolve('US30').brokerId).toBe(2);
  });

  it('resolveForOrder() never second-guesses an EXPLICIT symbol_route row', async () => {
    const { router } = makeRouter({
      symbolRouteRows: [{ symbol: 'GER40', brokerId: 3, brokerSymbol: null, provider: 'mt5' }],
      // Capability claims broker 2 can trade it — the explicit row still wins.
      brokerSymbolRows: [{ brokerId: 2, name: 'GER40' }],
    });
    await router.refresh();
    expect(router.resolveForOrder('GER40').brokerId).toBe(3);
  });

  it('resolveForOrder() keeps the default when NO active broker can trade it', async () => {
    const { router } = makeRouter({ brokerSymbolRows: [{ brokerId: 9, name: 'US30' }] });
    await router.refresh();
    // Nobody among [2,3] can trade it → keep the route so the check produces a NAMED refusal
    // rather than a send the broker silently rejects.
    expect(router.resolveForOrder('US30').brokerId).toBe(2);
    expect(orderRouteProblems('US30', router.resolveForOrder('US30'), [2, 3], (b, s) => router.canTradeOn(b, s)))
      .not.toEqual([]);
  });
});
