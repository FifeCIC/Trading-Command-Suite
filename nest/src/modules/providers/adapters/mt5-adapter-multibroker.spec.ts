import { Mt5Adapter } from './mt5.adapter';

/**
 * #883 — the adapter must ask EVERY active MT5 broker for positions.
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `MT5_ACTIVE_BROKERS=2,3` runs two bridges — MetaQuotes (:5000) and Pepperstone (:5001).
 * `getPositions()` called `bridgeGet('/positions')` with NO route, which resolves to the DEFAULT
 * bridge only. The snapshot therefore held broker 2's positions and nothing from broker 3.
 *
 * Downstream, `position-sync` closes any open `trade` whose ticket is absent from the snapshot.
 * Broker 3's tickets were absent from EVERY snapshot, so broker 2's sync closed broker 3's
 * trades. Measured 2026-09-18: two LIVE Pepperstone VIX positions (`90555750`, `90563535`) were
 * written `closed` with `exitPrice=NULL, pnl=0` while the broker still held them.
 *
 * ⚠️ THE SECOND TEST IS THE SAFETY PROPERTY, not a nicety
 * ------------------------------------------------------
 * `authoritative` decides whether closure detection runs at all. If one bridge is down and the
 * combined snapshot is still called authoritative, the surviving broker's sync closes the
 * missing broker's trades — the same defect, one bridge further out. A partial snapshot MUST
 * refuse to be authoritative, because downstream that flag is the only thing standing between
 * "missing" and "closed".
 */

const ok = (body: unknown) => ({ ok: true, status: 200, json: jest.fn().mockResolvedValue(body) }) as any;

/** A broker slot as `Mt5SymbolRouter` exposes it, without pulling in the real router. */
const router = (brokerIds: number[]) => ({
  brokerIds: () => brokerIds,
  primaryBrokerId: () => brokerIds[0] ?? 2,
  routeForBroker: (brokerId: number) => ({
    brokerId,
    url: `http://127.0.0.1:${5000 + brokerId - 2}`,
    brokerSymbol: '',
    explicit: true,
    // #914 — these ids are active MT5 bridges; the field is required by ResolvedSymbolRoute.
    mt5: true,
    provider: 'mt5',
  }),
});

const pos = (ticket: number, symbol: string) => ({
  ticket, symbol, type: 'buy', volume: 0.1, priceOpen: 1.1, priceCurrent: 1.12,
  profit: 2, swap: 0, openTime: '2026-09-18T17:00:00Z', contractSize: 100000,
});

describe('Mt5Adapter — multi-broker position snapshot (#883)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queries EVERY active broker and merges the result', async () => {
    const seen: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      seen.push(String(url));
      // Broker 2 → EURGBP, broker 3 → VIX. Distinct tickets, as on the live boxes.
      return Promise.resolve(
        String(url).includes(':5001')
          ? ok({ positions: [pos(90555750, 'VIX')], count: 1 })
          : ok({ positions: [pos(152648715111, 'EURGBP')], count: 1 }),
      );
    }) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const positions = await adapter.getPositions();

    // Both bridges were actually asked — the defect was that one of them never was.
    expect(seen.some((u) => u.includes(':5000'))).toBe(true);
    expect(seen.some((u) => u.includes(':5001'))).toBe(true);
    expect(positions.map((p) => p.symbol).sort()).toEqual(['EURGBP', 'VIX']);
  });

  it('⭐ is NOT authoritative when one broker fails to answer', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes(':5001')) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(ok({ positions: [pos(152648715111, 'EURGBP')], count: 1 }));
    }) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const snapshot = await adapter.getPositionSnapshot();

    // Broker 2 answered, so its position is present...
    expect(snapshot.positions.map((p) => p.symbol)).toEqual(['EURGBP']);
    // ...but the union is INCOMPLETE, so closure detection must not run. Without this, broker 2's
    // sync would close every broker-3 trade simply because broker 3 was unreachable.
    expect(snapshot.authoritative).toBe(false);
  });

  it('is authoritative only when EVERY broker answers', async () => {
    global.fetch = jest.fn().mockResolvedValue(ok({ positions: [], count: 0 })) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const snapshot = await adapter.getPositionSnapshot();

    // Two genuine empty answers is a real "flat" — that MUST stay authoritative, or the app could
    // never record a closure at all.
    expect(snapshot.authoritative).toBe(true);
    expect(snapshot.positions).toEqual([]);
  });

  it('tags each position with its own broker ACCOUNT, not a shared one', async () => {
    process.env.MT5_ACCOUNT_2 = '10011309743';
    process.env.MT5_ACCOUNT_3 = '62135531';
    global.fetch = jest.fn().mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes(':5001')
          ? ok({ positions: [pos(90555750, 'VIX')], count: 1 })
          : ok({ positions: [pos(152648715111, 'EURGBP')], count: 1 }),
      ),
    ) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const positions = await adapter.getPositions();

    const bySymbol = Object.fromEntries(positions.map((p) => [p.symbol, p.accountId]));
    // ⚠️ One provider id (`mt5`) covers both bridges. Without a per-position account the
    // reconciler cannot scope a write to the right account — which is what let one broker's
    // snapshot close the other's trades.
    expect(bySymbol.EURGBP).toBe('10011309743');
    expect(bySymbol.VIX).toBe('62135531');
  });

  it('falls back to the single default bridge when no router is injected', async () => {
    // Tests and single-bridge installs construct the adapter bare. That path must be unchanged.
    let calls = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(ok({ positions: [pos(1, 'EURUSD')], count: 1 }));
    }) as any;

    const adapter = new Mt5Adapter();
    const snapshot = await adapter.getPositionSnapshot();

    expect(calls).toBe(1);
    expect(snapshot.authoritative).toBe(true);
    expect(snapshot.positions).toHaveLength(1);
  });
});
