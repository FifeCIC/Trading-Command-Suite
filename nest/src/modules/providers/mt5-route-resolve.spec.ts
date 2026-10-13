/**
 * mt5-route-resolve.spec.ts — GET /api/providers/mt5/routes/:symbol (capability half of #1112).
 *
 * WHY THIS SPEC EXISTS (2026-10-12). #1112 fixed `canTradeOn` ignoring `symbol_route.brokerSymbol`
 * and added a case to `mt5-route-capability.spec.ts` — but that case supplies its OWN caller
 * (`(b, s, bs) => router.canTradeOn(b, s, bs)`), so it proves the FUNCTION forwards a broker-native
 * name. It never covered the PRODUCTION call sites, and this endpoint had none.
 *
 * Measured the same day: `mt5.controller.ts` had its `brokerSymbol` argument removed at BOTH call
 * sites and only the switch guard failed. This one stayed green AND silent — so a mapped route
 * (USTEC → NAS100) would report `canTrade: false` here while the suite passed.
 *
 * ⚠️ The distinction this asserts is not cosmetic. `broker_symbol` is keyed by the BROKER's name:
 * USTEC exists on broker 3 as `NAS100`. Asking with the canonical ticker returns a DEFINITE `false`,
 * which the panel renders as "this account cannot trade it" — a false refusal on a tradeable route.
 *
 * WHY A NON-CURRENT BROKER IS ASKED DIFFERENTLY. Only the broker the route actually points at can
 * be looked up by its route-specific broker-native name; the others are asked canonically. That
 * asymmetry is deliberate, so it is pinned here rather than left to whoever edits the map callback.
 */

import { Mt5Controller } from './mt5.controller';

const ROUTE = {
  symbol: 'USTEC',
  brokerId: 3,
  brokerSymbol: 'NAS100',
  explicit: true,
  url: 'http://localhost:5001',
  mt5: true,
  provider: 'mt5',
};

function build(opts: {
  /** Per-broker capability answer: `undefined` means "never synced" — UNKNOWN, not blocked (#1002). */
  canTrade?: Record<number, boolean | undefined>;
  healths?: any[];
  botsCountThrows?: boolean;
}) {
  const canTradeOn = jest.fn((brokerId: number) => opts.canTrade?.[brokerId]);
  const count = jest.fn(async () => {
    if (opts.botsCountThrows) throw new Error('trading_strategy unavailable');
    return 2;
  });
  const ctrl: any = Object.create(Mt5Controller.prototype);
  ctrl.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  ctrl.prisma = { symbolRoute: { findFirst: jest.fn(async () => null) }, tradingStrategy: { count } };
  ctrl.mt5Connection = {
    getAllBrokerHealths: jest.fn(async () =>
      opts.healths ?? [
        { brokerId: 2, server: 'MetaQuotes-Demo', reachable: true, connected: true, connectionState: 'connected', health: { account: 9001, connected: true } },
        { brokerId: 3, server: 'PepperstoneUK-Demo', reachable: true, connected: true, connectionState: 'connected', health: { account: 9002, connected: true } },
      ],
    ),
  };
  ctrl.symbolRouter = { resolve: jest.fn(() => ({ ...ROUTE })), canTradeOn, invalidate: jest.fn(), refresh: jest.fn() };
  return { ctrl, canTradeOn, count };
}

describe('resolveRoute — GET /routes/:symbol per-broker capability (#1112)', () => {
  it("asks the CURRENT broker with the ROUTE's broker-native name — USTEC exists as NAS100", async () => {
    const { ctrl, canTradeOn } = build({ canTrade: { 2: true, 3: true } });

    const res: any = await ctrl.resolveRoute('ustec');

    // Broker 3 IS the route's broker → must be asked as NAS100, not USTEC.
    expect(canTradeOn).toHaveBeenCalledWith(3, 'USTEC', 'NAS100');
    // Broker 2 is not the route's broker → canonical ask, no broker-native name available.
    expect(canTradeOn).toHaveBeenCalledWith(2, 'USTEC', undefined);
    expect(res.symbol).toBe('USTEC');
    expect(res.brokers.find((b: any) => b.brokerId === 3).canTrade).toBe(true);
  });

  it('a mapped route does NOT report a false refusal — the regression #1112 fixed', async () => {
    // canTradeOn answers per the NAME it was asked with. Asked correctly (NAS100) → tradeable;
    // asked wrongly (USTEC) → a definite false. This is the whole failure, expressed as data.
    const canTradeOn = jest.fn((brokerId: number, _sym: string, brokerSymbol?: string | null) =>
      brokerId === 3 ? brokerSymbol === 'NAS100' : true,
    );
    const ctrl: any = Object.create(Mt5Controller.prototype);
    ctrl.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    ctrl.prisma = { symbolRoute: { findFirst: jest.fn(async () => null) }, tradingStrategy: { count: jest.fn(async () => 0) } };
    ctrl.mt5Connection = {
      getAllBrokerHealths: jest.fn(async () => [
        { brokerId: 2, server: 'MetaQuotes-Demo', reachable: true, connected: true, connectionState: 'connected', health: { account: 9001, connected: true } },
        { brokerId: 3, server: 'PepperstoneUK-Demo', reachable: true, connected: true, connectionState: 'connected', health: { account: 9002, connected: true } },
      ]),
    };
    ctrl.symbolRouter = { resolve: jest.fn(() => ({ ...ROUTE })), canTradeOn, invalidate: jest.fn(), refresh: jest.fn() };

    const res: any = await ctrl.resolveRoute('USTEC');
    const b3 = res.brokers.find((b: any) => b.brokerId === 3);

    expect(b3.canTrade).toBe(true);
    expect(b3.current).toBe(true);
  });

  it('⚠️ capability UNKNOWN renders as null, never as "blocked" (#1002)', async () => {
    const { ctrl } = build({ canTrade: { 2: undefined, 3: undefined } });

    const res: any = await ctrl.resolveRoute('USTEC');

    expect(res.brokers.map((b: any) => b.canTrade)).toEqual([null, null]);
  });

  it('a broker that genuinely cannot trade it still reads false — unknown and blocked are not merged', async () => {
    const { ctrl } = build({ canTrade: { 2: false, 3: true } });

    const res: any = await ctrl.resolveRoute('USTEC');

    expect(res.brokers.find((b: any) => b.brokerId === 2).canTrade).toBe(false);
    expect(res.brokers.find((b: any) => b.brokerId === 3).canTrade).toBe(true);
  });

  it('botsOnSymbol is null when the count fails — "cannot count" is not zero', async () => {
    const { ctrl } = build({ canTrade: { 2: true, 3: true }, botsCountThrows: true });

    const res: any = await ctrl.resolveRoute('USTEC');

    expect(res.botsOnSymbol).toBeNull();
  });
});
