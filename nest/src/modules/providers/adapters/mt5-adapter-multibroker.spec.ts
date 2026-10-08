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

/**
 * #1089 — the deal twin of #883. `getDeals()` asked ONLY the primary bridge (:5000 / broker 2),
 * so every finalisation of a broker-3 position found no closing deal at all and wrote the row from
 * the stale snapshot: `closeReason='broker:unknown'`, exit = last snapshot price, pnl = floating.
 *
 * MEASURED 2026-10-08: 48 of 48 broker-3 closes (VIX/GER40/FRA40/US30/UK100/XAGUSD) carried
 * `broker:unknown` and ZERO any other reason — while broker-2 FX carried real `broker:sl` rows.
 * The first test below is the defect itself: the deals for the broker-3 symbol MUST come back.
 */
describe('Mt5Adapter — multi-broker deal history (#1089)', () => {
  beforeEach(() => jest.clearAllMocks());

  /** A bridge deal as `/history` returns it (shape verified live 2026-10-08 on :5001). */
  const deal = (ticket: number, positionId: number, symbol: string, reason: number) => ({
    ticket, symbol, type: 'sell', volume: 0.1, price: 25073.9, profit: -8.18,
    positionId, orderId: positionId + 500000, commission: 0, swap: 0, fee: 0,
    time: '2026-10-07T13:43:32Z', comment: '[sl 25073.9]', reason,
  });

  it('queries EVERY active broker and merges the deals', async () => {
    const seen: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      seen.push(String(url));
      // Broker 2 → EURGBP deals, broker 3 → GER40 deal. Distinct position ids, as live.
      return Promise.resolve(
        String(url).includes(':5001')
          ? ok({ deals: [deal(62463631, 93621464, 'GER40', 4)], orders: [], orderCount: 0, dealCount: 1 })
          : ok({ deals: [deal(15264871, 90555750, 'EURGBP', 4)], orders: [], orderCount: 0, dealCount: 1 }),
      );
    }) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const deals = await adapter.getDeals(new Date('2026-10-01T00:00:00Z'));

    // Both bridges were actually asked for DEALS — the defect was that only broker 2 ever was.
    expect(seen.some((u) => u.includes(':5000') && u.includes('/history'))).toBe(true);
    expect(seen.some((u) => u.includes(':5001') && u.includes('/history'))).toBe(true);
    // THE regression: the broker-3 position's closing deal must be present, or its close is
    // finalised against the snapshot as `broker:unknown` exactly as it was until 2026-10-08.
    expect(deals.map((d) => d.positionId).sort()).toEqual(['90555750', '93621464']);
    const ger40 = deals.find((d) => d.positionId === '93621464')!;
    expect(ger40.reason).toBe(4);
    expect(ger40.profit).toBeCloseTo(-8.18);
  });

  it('keeps the other broker\'s deals when one broker answers none', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes(':5001')) return Promise.reject(new Error('connection refused'));
      return Promise.resolve(ok({ deals: [deal(15264871, 90555750, 'EURGBP', 4)], orders: [], orderCount: 0, dealCount: 1 }));
    }) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const warnings: string[] = [];
    (adapter as any).logger.warn = (msg: string) => warnings.push(String(msg));

    const deals = await adapter.getDeals(new Date('2026-10-01T00:00:00Z'));

    // The survivor's deals still resolve — a broker outage must not blank the whole outcome.
    expect(deals.map((d) => d.positionId)).toEqual(['90555750']);
    // ...and the incompleteness is visible, not silent: that missing broker's positions fall back
    // to the snapshot exactly as the #1089 defect did.
    expect(warnings.some((w) => w.includes('broker 3') && w.includes('no deal history'))).toBe(true);
  });

  it('falls back to the single default bridge when no router is injected', async () => {
    let calls = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(ok({ deals: [deal(1, 2, 'EURUSD', 0)], orders: [], orderCount: 0, dealCount: 1 }));
    }) as any;

    const adapter = new Mt5Adapter();
    const deals = await adapter.getDeals(new Date('2026-10-01T00:00:00Z'));

    expect(calls).toBe(1);
    expect(deals).toHaveLength(1);
  });

  /**
   * #1093 — `recoverDeals()` is the REQUEST half (per-position retries inside the bridge).
   * The ticket list travels to EVERY active broker on purpose: a ticket only resolves on the
   * broker that owns it, so the broader ask needs no account→broker map — and the response must
   * report `stillMissing` as it is (the honest half of the in-app recovery button).
   */
  it('recoverDeals fans the ticket list to EVERY broker and reports stillMissing honestly', async () => {
    const posts: Array<{ url: string; body: any }> = [];
    global.fetch = jest.fn().mockImplementation((url: string, init: any) => {
      posts.push({ url: String(url), body: JSON.parse(init.body) });
      const isBroker3 = String(url).includes(':5001');
      return Promise.resolve(ok({
        deals: isBroker3 ? [deal(62463631, 93621464, 'GER40', 4)] : [],
        perPosition: isBroker3 ? { '93621464': 2 } : {},
        // Keyed by the ids the CALLER sent — the shape every current bridge returns (#1093).
        recoveredIds: isBroker3 ? ['93621464'] : [],
        requested: 3,
        recovered: isBroker3 ? 1 : 0,
        stillMissing: isBroker3 ? ['89649760', '91105906'] : ['89649760', '91105906', '93621464'],
      }));
    }) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const res = await adapter.recoverDeals(['89649760', '91105906', '93621464'], new Date('2026-09-15T00:00:00Z'));

    expect(posts.some((p) => p.url.includes(':5000') && p.url.includes('/history/recover'))).toBe(true);
    expect(posts.some((p) => p.url.includes(':5001') && p.url.includes('/history/recover'))).toBe(true);
    // The SAME ticket list reaches both — resolving on the owner is the broker's job.
    expect(posts.every((p) => Array.isArray(p.body.positions) && p.body.positions.length === 3)).toBe(true);
    expect(res.recovered).toEqual(['93621464']);
    expect(res.stillMissing.sort()).toEqual(['89649760', '91105906']);
    expect(res.deals).toHaveLength(1);
    expect(res.failed).toEqual({});
  });

  /**
   * ⚠️ MEASURED DEFECT, first live run of the #1093 recovery (2026-10-08).
   *
   * `bridgePost` throws on any non-OK response — deliberately, because an order path must never
   * read a refusal as silence. But this fan-out had no per-target catch, so broker 2 (still on a
   * bridge script older than this route) answered 404 and the loop DIED before broker 3 was ever
   * asked. The caller's note then said "the terminals did not serve any of the 81 missing exit
   * records" — a statement about a terminal that had not been consulted. This is #1089's own rule
   * (one broker's failure must not hide another's answer) in the opposite direction.
   */
  it('keeps asking the other brokers when one REFUSES, and records the refusal as a refusal', async () => {
    const posts: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      posts.push(String(url));
      if (String(url).includes(':5000')) {
        // An old bridge: the route does not exist. bridgePost turns this into a thrown refusal.
        return Promise.resolve({ ok: false, status: 404, text: jest.fn().mockResolvedValue('{"error": "not found"}') } as any);
      }
      return Promise.resolve(ok({
        deals: [deal(62463631, 93621464, 'GER40', 4)],
        perPosition: { '93621464': 2 },
        recoveredIds: ['93621464'],
        requested: 3,
        recovered: 1,
        stillMissing: ['89649760', '91105906'],
      }));
    }) as any;

    const adapter = new Mt5Adapter(undefined, undefined, undefined, router([2, 3]) as any);
    const warnings: string[] = [];
    (adapter as any).logger.warn = (msg: string) => warnings.push(String(msg));

    const res = await adapter.recoverDeals(['89649760', '91105906', '93621464'], new Date('2026-09-15T00:00:00Z'));

    // The broker AFTER the refusing one was still asked — the defect was that it was not.
    expect(posts.some((u) => u.includes(':5001') && u.includes('/history/recover'))).toBe(true);
    // And its answer is used: the served ticket is reported recovered, the rest still missing.
    expect(res.recovered).toEqual(['93621464']);
    expect(res.stillMissing.sort()).toEqual(['89649760', '91105906']);
    // The refusal is RECORDED — "not asked" must never render the same as "asked and empty".
    expect(res.failed['2']).toContain('not found');
    expect(res.failed['3']).toBeUndefined();
    expect(warnings.some((w) => w.includes('broker 2') && w.includes('could not be asked'))).toBe(true);
  });
});
