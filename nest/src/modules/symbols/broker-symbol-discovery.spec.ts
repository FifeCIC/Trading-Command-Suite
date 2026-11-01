/**
 * BrokerSymbolDiscoveryService — the FAILURE PATH is the point of these tests (#958).
 *
 * The defect this issue exists to fix was not "a sync produced wrong rows". It was that
 * **nothing imported the broker's list at all**, and nothing could tell that it hadn't. So the
 * assertions that matter most here are the negative ones:
 *
 *   • a broker that cannot be reached must NOT write catalogue rows,
 *   • it must NOT advance `lastSuccessAt` (or every instrument would look "no longer offered"),
 *   • it must NOT report `ok` — an empty catalogue reading as success is the same defect class
 *     as a check that inspects nothing and reports OK.
 *
 * A sync that cannot read its input must ERROR. That is asserted, not assumed.
 *
 * Instantiation is direct (`new BrokerSymbolDiscoveryService(prisma, mt5, router)`) with hand
 * built mocks, matching `mt5-symbol-router.service.spec.ts` — no Nest testing module, because
 * a DI module would only prove the wiring, not the behaviour.
 */
import { BrokerSymbolDiscoveryService } from './broker-symbol-discovery.service';

type RawCall = { sql: string; params: unknown[] };

function makeHarness(opts?: {
  instruments?: Array<{
    name: string;
    path: string | null;
    tradeMode: number | null;
    digits: number | null;
    volumeMin: number | null;
    volumeMax: number | null;
  }> | null;
  throws?: string;
  onboardedTickers?: string[];
  syncState?: { brokerId: number; state: string; lastSuccessAt: Date | null } | null;
  counts?: Partial<Record<string, number>>;
}) {
  const rawCalls: RawCall[] = [];
  const upserts: Array<Record<string, any>> = [];

  const prisma: any = {
    brokerSymbol: { count: jest.fn(async () => 0) },
    brokerSymbolSync: {
      findUnique: jest.fn(async () => opts?.syncState ?? null),
      upsert: jest.fn(async (args: any) => {
        upserts.push(args);
        return args;
      }),
    },
    symbol: {
      findMany: jest.fn(async () =>
        (opts?.onboardedTickers ?? []).map((ticker) => ({ ticker })),
      ),
    },
    $executeRawUnsafe: jest.fn(async (sql: string, ...params: unknown[]) => {
      rawCalls.push({ sql, params });
      return params.length;
    }),
  };

  const mt5: any = {
    listBrokerInstruments: jest.fn(async () => {
      if (opts?.throws) throw new Error(opts.throws);
      return opts?.instruments ?? null;
    }),
  };

  const router: any = { brokerIds: () => [2] };

  const service = new BrokerSymbolDiscoveryService(prisma, mt5, router);
  return { service, prisma, mt5, rawCalls, upserts };
}

const INSTRUMENT = (name: string, path: string | null = `Nasdaq\\${name}`, tradeMode = 4) => ({
  name,
  path,
  tradeMode,
  digits: 2,
  volumeMin: 1,
  volumeMax: 1000,
  // #1170 — present on every real catalogue row; the fixture carries them so the positional
  // assertions below mean what they claim.
  volumeStep: 0.01,
  contractSize: 100,
});

describe('BrokerSymbolDiscoveryService — a broker that cannot be reached', () => {
  it('records "unreachable" and writes NO catalogue rows', async () => {
    const { service, rawCalls, upserts } = makeHarness({ instruments: null });

    const result = await service.syncBroker(2);

    expect(result.state).toBe('unreachable');
    expect(result.fetched).toBe(0);
    // THE assertion: a failed sync must not touch the catalogue.
    expect(rawCalls).toHaveLength(0);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].update.state).toBe('unreachable');
  });

  it('does NOT advance lastSuccessAt, so nothing is marked stale by a failure', async () => {
    const { service, upserts } = makeHarness({ instruments: null });

    await service.syncBroker(2);

    // Absent key = the existing value is left alone. Present-and-null would be a different bug.
    expect(upserts[0].update).not.toHaveProperty('lastSuccessAt');
    expect(upserts[0].update).toHaveProperty('lastSyncAt');
  });

  it('does NOT blank the last known counts', async () => {
    const { service, upserts } = makeHarness({ instruments: null });

    await service.syncBroker(2);

    expect(upserts[0].update).not.toHaveProperty('symbolCount');
    expect(upserts[0].update).not.toHaveProperty('tradeableCount');
  });

  it('records "error", not silence, when the bridge call throws', async () => {
    const { service, upserts, rawCalls } = makeHarness({ throws: 'ECONNREFUSED' });

    const result = await service.syncBroker(2);

    expect(result.state).toBe('error');
    expect(result.reason).toContain('ECONNREFUSED');
    expect(rawCalls).toHaveLength(0);
    expect(upserts[0].update).not.toHaveProperty('lastSuccessAt');
  });

  it('treats an EMPTY list as unreachable rather than as "this broker has nothing"', async () => {
    const { service, rawCalls } = makeHarness({ instruments: [] });

    const result = await service.syncBroker(2);

    expect(result.state).toBe('unreachable');
    expect(rawCalls).toHaveLength(0);
  });
});

describe('BrokerSymbolDiscoveryService — a broker that answers', () => {
  it('writes the catalogue and advances lastSuccessAt', async () => {
    const { service, rawCalls, upserts } = makeHarness({
      instruments: [INSTRUMENT('GRML'), INSTRUMENT('AAPL')],
    });

    const result = await service.syncBroker(2);

    expect(result.state).toBe('ok');
    expect(result.fetched).toBe(2);
    expect(rawCalls).toHaveLength(1);
    expect(upserts[0].update).toHaveProperty('lastSuccessAt');
    expect(upserts[0].update).toHaveProperty('symbolCount', 2);
  });

  it('derives assetClass from the broker path, and leaves it null when path is absent', async () => {
    const { service, rawCalls } = makeHarness({
      instruments: [INSTRUMENT('GRML', 'Nasdaq\\GRML'), INSTRUMENT('X', null)],
    });

    await service.syncBroker(2);

    // params are flat: 12 values per row, assetClass is index 4 within each row
    expect(rawCalls[0].params[4]).toBe('Nasdaq');
    expect(rawCalls[0].params[16]).toBeNull();
  });

  it('writes volumeStep and contractSize, so the backtest can size in broker units offline', async () => {
    // ⚠️ #1170/#1143. The bridge reports both; before this the sync dropped them, so the backtester
    // had no idea that 0.01 lots of XAUUSD is 1 oz and sized in whole units instead. The consequence
    // was four instruments recorded ZERO trades at a $10k account. `null` must survive as `null` —
    // defaulting to 1 would re-create the whole-unit assumption this column exists to remove.
    const { service, rawCalls } = makeHarness({ instruments: [INSTRUMENT('XAUUSD')] });

    await service.syncBroker(2);

    const sql = rawCalls[0].sql;
    expect(sql.split('VALUES')[0]).toContain('volumeStep');
    expect(sql.split('VALUES')[0]).toContain('contractSize');
    expect(sql).toContain('volumeStep = new.volumeStep');
    expect(sql).toContain('contractSize = new.contractSize');
    // Index 9 and 10 of each row, straight through from the instrument payload.
    expect(rawCalls[0].params[9]).toBe(0.01);
    expect(rawCalls[0].params[10]).toBe(100);
  });

  it('never writes firstSeenAt — re-seeding must not rewrite first sighting', async () => {
    const { service, rawCalls } = makeHarness({ instruments: [INSTRUMENT('GRML')] });

    await service.syncBroker(2);

    const insertColumns = rawCalls[0].sql.split('VALUES')[0];
    expect(insertColumns).not.toContain('firstSeenAt');
    // …but lastSeenAt must be refreshed, or "no longer offered" cannot be derived.
    expect(rawCalls[0].sql).toContain('lastSeenAt = UTC_TIMESTAMP(3)');
  });

  it('marks registered=true only for tickers the app has already onboarded', async () => {
    const { service, rawCalls } = makeHarness({
      instruments: [INSTRUMENT('GRML'), INSTRUMENT('EURUSD')],
      onboardedTickers: ['eurusd'],
    });

    const result = await service.syncBroker(2);

    expect(result.registered).toBe(1);
    // registered is the 11th value of each row (index 11, then 23) — 12 values per row since
    // volumeStep/contractSize were added (#1170).
    expect(rawCalls[0].params[11]).toBe(0); // GRML — not onboarded, the discovery backlog
    expect(rawCalls[0].params[23]).toBe(1); // EURUSD — already known
  });

  it('counts tradeable as tradeMode === 4, not as "listed"', async () => {
    const { service } = makeHarness({
      instruments: [INSTRUMENT('A', 'Nasdaq\\A', 4), INSTRUMENT('B', 'Nasdaq\\B', 0)],
    });

    const result = await service.syncBroker(2);

    expect(result.fetched).toBe(2);
    expect(result.tradeable).toBe(1);
  });
});

describe('BrokerSymbolDiscoveryService — syncIfStale', () => {
  it('skips a broker whose last success is recent', async () => {
    const { service, mt5 } = makeHarness({
      syncState: { brokerId: 2, state: 'ok', lastSuccessAt: new Date() },
    });

    const out = await service.syncIfStale();

    expect(out.skipped).toEqual([2]);
    expect(out.synced).toEqual([]);
    expect(mt5.listBrokerInstruments).not.toHaveBeenCalled();
  });

  it('syncs a broker that has never succeeded', async () => {
    const { service, mt5 } = makeHarness({
      syncState: { brokerId: 2, state: 'never', lastSuccessAt: null },
      instruments: [INSTRUMENT('GRML')],
    });

    const out = await service.syncIfStale();

    expect(out.synced).toEqual([2]);
    expect(mt5.listBrokerInstruments).toHaveBeenCalledWith(2);
  });
});

/**
 * THE BOUNDARY GUARD (#958).
 *
 * Discovery answers "what does the broker offer?". Onboarding answers "what does the app trade?".
 * They are separate on purpose, and the tempting simplification — promoting discovered
 * instruments straight into the app — breaks every symbol picker in the app at once, because
 * `getTopMovers`, the tier resolver and the pickers all enumerate `symbol`.
 *
 * The other table that must stay untouched is `symbol_route`: it has exactly ONE seeder
 * (`nest/prisma/seed-symbol-onboarding.ts`) and that seeder is the only thing that survives a
 * reinstall. A second, silent writer would produce routes that vanish on rebuild while the app
 * still believed they worked.
 *
 * This test fails the moment someone adds either write. It is a guard on the CLASS, not the
 * instance — the same reasoning as the `symbol-silent` trigger: make the boundary explicit so a
 * later change cannot cross it by accident.
 */
describe('BrokerSymbolDiscoveryService — the boundary it must never cross', () => {
  it('writes ONLY broker_symbol — never the onboarded set or the route table', async () => {
    const { service, rawCalls } = makeHarness({
      instruments: [INSTRUMENT('GRML'), INSTRUMENT('EURUSD')],
      onboardedTickers: ['EURUSD'],
    });

    await service.syncBroker(2);

    expect(rawCalls.length).toBeGreaterThan(0);
    for (const call of rawCalls) {
      expect(call.sql).toContain('INSERT INTO broker_symbol');
      expect(call.sql).not.toMatch(/INSERT INTO\s+symbol\b/i);
      expect(call.sql).not.toMatch(/INSERT INTO\s+symbol_route/i);
      expect(call.sql).not.toMatch(/INSERT INTO\s+symbol_protocol_assignment/i);
      expect(call.sql).not.toMatch(/\bUPDATE\s+symbol\b/i);
      expect(call.sql).not.toMatch(/\bDELETE\b/i);
    }
  });
});

