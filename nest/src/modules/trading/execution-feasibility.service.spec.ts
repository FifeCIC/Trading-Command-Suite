/**
 * ExecutionFeasibilityService — the BROKER-CONSTRAINT blockers (#US500).
 * =====================================================================
 * These cover the two facts the bridge's `/order` pre-flight tests before it will send
 * an order, and which the app previously could not see:
 *
 *   1. `tradeMode !== 4`  — the broker has trading DISABLED for that symbol
 *   2. `volume < volumeMin` — the requested size is below the broker's floor
 *
 * WHY THIS SPEC EXISTS (the incident, 2026-09-15)
 * ------------------------------------------------
 * US500 had no `symbol_route` row, so orders silently fell back to the primary broker
 * (MetaQuotes :5000), which reports US500 as `tradeMode 0`. The Signals card showed the
 * setup as fully actionable — the app knew only that the symbol was LISTED — and the
 * refusal ("US500 not tradeable (trade mode: 0)") appeared only AFTER the click.
 *
 * The two checks are asserted separately and deliberately:
 *   - `symbol-not-tradeable` must fire on a non-4 trade mode, per broker.
 *   - `size-below-minimum` must fire on a size under the floor AND stay silent when the
 *     floor is unknown, so an older bridge cannot block every trade.
 *
 * Both are "fail open on UNKNOWN, closed on a measured refusal" — an unreachable broker
 * is not evidence that a symbol is untradeable, and the bridge still refuses safely.
 */

import { ExecutionFeasibilityService } from './execution-feasibility.service';

/** A broker whose constraints we control per test. */
function makeAdapter(opts: {
  symbols?: string[];
  tradability?: Record<string, { tradeMode: number; volumeMin: number | null; volumeMax?: number | null }> | null;
}) {
  const symbols = new Set((opts.symbols ?? ['US500']).map((s) => s.toUpperCase()));
  const tradability = opts.tradability === null
    ? null
    : new Map(Object.entries(opts.tradability ?? {}).map(([k, v]) => [
      k.toUpperCase(),
      { tradeMode: v.tradeMode, volumeMin: v.volumeMin, volumeMax: v.volumeMax ?? null },
    ]));
  return {
    id: 'mt5',
    getSymbols: async () => symbols,
    getSymbolTradability: async () => tradability,
  };
}

function makeService(adapter: ReturnType<typeof makeAdapter>, route: Record<string, unknown> = ROUTE_MT5) {
  const prisma = {
    trade: { findFirst: async () => null },
  } as any;
  const adapterFactory = { create: () => adapter } as any;
  const duplicateGuard = { checkDuplicate: async () => ({ blocked: false }) } as any;
  const diversification = { checkPreTrade: async () => ({ blocked: false }) } as any;
  const pyramidPolicy = { evaluate: async () => ({ blockers: [], hasOpenPosition: false }) } as any;
  const symbolRouter = {
    resolve: () => route,
    // #1002 — `assess()` uses `resolveForOrder`, so the card shows the route the ORDER travels.
    resolveForOrder: () => route,
    canTradeOn: () => undefined, // capability UNKNOWN — the check must not refuse on unknown
    brokerIds: () => [2, 3],
    getBrokerId: () => route.brokerId,
    getBrokerSymbol: (s: string) => s.toUpperCase(),
  } as any;
  return new ExecutionFeasibilityService(
    prisma, adapterFactory, duplicateGuard, diversification, pyramidPolicy, symbolRouter,
  );
}

/** A normal MT5-routed symbol — the restore direction for every #914 assertion. */
const ROUTE_MT5 = { brokerId: 3, url: 'http://localhost:5001', brokerSymbol: 'US500', explicit: true, mt5: true, provider: 'mt5' };

/**
 * The measured #914 route: `symbol_route` row `BTC → binance, brokerId 0, brokerSymbol NULL`.
 * `url` is null because there is no bridge behind it — resolving one is the defect.
 */
const ROUTE_BINANCE = { brokerId: 0, url: null, brokerSymbol: 'BTC', explicit: true, mt5: false, provider: 'binance' };

const keysOf = (blockers: Array<{ key: string }>) => blockers.map((b) => b.key);

describe('ExecutionFeasibilityService — broker trade mode (#US500)', () => {
  it('blocks a symbol the routed broker reports as NOT tradeable, and names the trade mode', async () => {
    const service = makeService(makeAdapter({
      tradability: { US500: { tradeMode: 0, volumeMin: 0.1 } },
    }));

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    expect(res.feasible).toBe(false);
    expect(keysOf(res.blockers)).toContain('symbol-not-tradeable');
    const blocker = res.blockers.find((b) => b.key === 'symbol-not-tradeable')!;
    expect(blocker.message).toContain('trade mode 0');
    // The hint must be actionable — a dead end is not a hint.
    expect(blocker.hint).toContain('symbol_route');
  });

  it('does NOT block when the routed broker reports tradeMode 4', async () => {
    const service = makeService(makeAdapter({
      tradability: { US500: { tradeMode: 4, volumeMin: 0.1 } },
    }));

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    expect(keysOf(res.blockers)).not.toContain('symbol-not-tradeable');
    expect(res.feasible).toBe(true);
  });

  it('treats an unreachable broker as UNKNOWN — never as untradeable (fails open)', async () => {
    const service = makeService(makeAdapter({ tradability: null }));

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    expect(keysOf(res.blockers)).not.toContain('symbol-not-tradeable');
    expect(res.feasible).toBe(true);
  });

  it('is PER BROKER: the same symbol is blocked on one broker and allowed on another', async () => {
    const blocked = makeService(makeAdapter({ tradability: { US500: { tradeMode: 0, volumeMin: 0.1 } } }));
    const allowed = makeService(makeAdapter({ tradability: { US500: { tradeMode: 4, volumeMin: 0.1 } } }));

    const a = await blocked.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.1 });
    const b = await allowed.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    expect(keysOf(a.blockers)).toContain('symbol-not-tradeable');
    expect(keysOf(b.blockers)).not.toContain('symbol-not-tradeable');
  });
});

describe('ExecutionFeasibilityService — broker volume floor (#US500)', () => {
  it('blocks a size below the broker minimum, and names both numbers', async () => {
    const service = makeService(makeAdapter({
      tradability: { US500: { tradeMode: 4, volumeMin: 0.1 } },
    }));

    // 0.01 lots is the shipped manual-trade default.
    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.01 });

    expect(res.feasible).toBe(false);
    const blocker = res.blockers.find((b) => b.key === 'size-below-minimum')!;
    expect(blocker.message).toContain('0.01');
    expect(blocker.message).toContain('0.1');
    expect(blocker.hint).toContain('0.1');
  });

  it('does not block a size exactly at the minimum', async () => {
    const service = makeService(makeAdapter({
      tradability: { US500: { tradeMode: 4, volumeMin: 0.1 } },
    }));

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    expect(keysOf(res.blockers)).not.toContain('size-below-minimum');
  });

  it('stays silent when the floor is unknown (older bridge reports no volumeMin)', async () => {
    const service = makeService(makeAdapter({
      tradability: { US500: { tradeMode: 4, volumeMin: null } },
    }));

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.01 });

    expect(keysOf(res.blockers)).not.toContain('size-below-minimum');
  });

  it('skips the floor check when no size is supplied (execution phase omitted it)', async () => {
    const service = makeService(makeAdapter({
      tradability: { US500: { tradeMode: 4, volumeMin: 0.1 } },
    }));

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5' });

    expect(keysOf(res.blockers)).not.toContain('size-below-minimum');
  });
});

/**
 * #914 — ROUTE INTEGRITY, the canary for the fabricated refusal.
 * =================================================================
 * The incident: clicking Buy on a BTC signal produced
 *
 *   "0.1 lots is below BTC's 1-lot minimum on broker 0"
 *
 * ...every part wrong. The route was `→ binance, brokerId 0, brokerSymbol NULL`; `getUrl(0)`
 * fell back to the DEFAULT bridge because `0` is falsy; and the bare ticker `BTC` matched
 * `Nasdaq\ETF\BTC` on that bridge, so a crypto position was measured against a US ETF's floor.
 *
 * The canary is therefore TWO assertions, in both directions:
 *   1. no `size-below-minimum` / `symbol-not-tradeable` may be produced from a non-MT5 route,
 *      and the broker's symbol lists must not even be consulted for it;
 *   2. the SAME adapter + tradability table still produces the genuine floor blocker when the
 *      symbol IS routed to that MT5 broker.
 */
describe('ExecutionFeasibilityService — route integrity (#914)', () => {
  it('never reads a lot floor for a symbol routed to a non-MT5 broker, and says why instead', async () => {
    const adapter = makeAdapter({
      // MetaQuotes really does list a 'BTC' — it is the Nasdaq ETF, with a 1-lot floor.
      symbols: ['BTC'],
      tradability: { BTC: { tradeMode: 4, volumeMin: 1 } },
    });
    const symbolsSpy = jest.spyOn(adapter, 'getSymbols');
    const tradabilitySpy = jest.spyOn(adapter, 'getSymbolTradability');
    const service = makeService(adapter, ROUTE_BINANCE);

    const res = await service.assess({ symbol: 'BTC', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    expect(res.feasible).toBe(false);
    const keys = keysOf(res.blockers);
    // The honest blocker…
    expect(keys).toContain('route-unverified');
    // …and the fabricated ones are gone.
    expect(keys).not.toContain('size-below-minimum');
    expect(keys).not.toContain('symbol-not-tradeable');
    // ⚠️ The strong form: the wrong broker is not consulted AT ALL.
    expect(symbolsSpy).not.toHaveBeenCalled();
    expect(tradabilitySpy).not.toHaveBeenCalled();
  });

  it('names the route that cannot take the order — not a broker that was never asked', async () => {
    const service = makeService(makeAdapter({ symbols: ['BTC'] }), ROUTE_BINANCE);

    const res = await service.assess({ symbol: 'BTC', side: 'BUY', brokerId: 'mt5', size: 0.1 });

    const blocker = res.blockers.find((b) => b.key === 'route-unverified')!;
    expect(blocker.message).toContain('broker 0');
    expect(blocker.message).toContain('binance');
    expect(blocker.message).toContain('not an active MT5 bridge');
    // The remedy must not be the harmful one ("raise the size to 1 lot").
    expect(blocker.hint).not.toContain('Raise the manual trade size');
    expect(blocker.hint).toContain('No action available');
  });

  it('still reports the genuine floor for a symbol routed to that MT5 broker (restore direction)', async () => {
    const service = makeService(
      makeAdapter({ symbols: ['US500'], tradability: { US500: { tradeMode: 4, volumeMin: 0.1 } } }),
      ROUTE_MT5,
    );

    const res = await service.assess({ symbol: 'US500', side: 'BUY', brokerId: 'mt5', size: 0.01 });

    const blocker = res.blockers.find((b) => b.key === 'size-below-minimum')!;
    // The broker named is the ROUTED broker (3), which is the one consulted.
    expect(blocker.message).toContain('broker 3');
    expect(keysOf(res.blockers)).not.toContain('route-unverified');
  });
});
