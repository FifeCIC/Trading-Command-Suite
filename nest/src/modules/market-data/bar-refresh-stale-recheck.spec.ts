/**
 * bar-refresh-stale-recheck.spec.ts — the post-fallback staleness re-check (#838).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * `isStaleSet()` was consulted ONCE, to decide whether to TRY another broker. It was never
 * consulted again to decide whether the surviving set was USABLE — the only post-fallback
 * rejection was for EMPTY. So when every broker was stale, the least-stale set was persisted.
 *
 * ⚠️ THE ROW IS THEN UNOVERWRITABLE, which is why this is not a cosmetic defect. The upsert is
 * `ON DUPLICATE KEY UPDATE` keyed on `(symbolId, timeframe, timestamp)`. A later fetch carries a
 * DIFFERENT timestamp, so the stale row is never matched — the fresh row is inserted ALONGSIDE
 * it. If the stale row is the newest, `MAX(timestamp)` is months old and every freshness check
 * downstream reads the symbol as stale. Same mechanism as the future-stamp defect (#832), which
 * is why the guard mirrors it.
 *
 * ⚠️ THESE TESTS DRIVE THE REAL SERVICE, not a copy of its logic. A local re-implementation of
 * the branch would pass while the service stayed broken — the recurring "test passes for the
 * wrong reason" failure in this repo. The service is constructed with mocks and `refresh()` is
 * called, so `isStaleSet`, the fallback loop, the counters and the logger are all the real ones.
 */
import { BarRefreshService } from './bar-refresh.service';

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const PRIMARY_URL = 'http://localhost:5000'; // must match resolveMt5BridgeUrl() to be excluded
const FALLBACK_URL = 'http://localhost:5001';

/** 4 months old — outside EVERY cadence tolerance (the largest is 1d = 72h). */
const STALE_TS = '2026-05-17T00:00:00.000Z';
/** 60s old — inside every tolerance, and past-stamped so the future guard lets it through. */
const FRESH_TS = '2026-09-15T11:59:00.000Z';

const bar = (timestamp: string, close = 1) => ({ timestamp, open: close, high: close, low: close, close, volume: 1 });

describe('BarRefreshService — post-fallback staleness re-check (#838)', () => {
  let service: BarRefreshService;
  let upserted: unknown[][];
  let warns: string[];
  let debugs: string[];
  let primaryBars: any[];
  let fallbackBars: any[];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));

    upserted = [];
    warns = [];
    debugs = [];
    primaryBars = [bar(STALE_TS)];
    fallbackBars = [bar(STALE_TS)];

    const prisma: any = {
      $queryRawUnsafe: jest.fn(async () => []), // no routes → every symbol defaults to mt5
      symbol: { findFirst: jest.fn(async () => ({ id: 'sym-1', ticker: 'EURUSD' })) },
      $executeRaw: jest.fn(async (_strings: any, ...values: any[]) => {
        // Only marketbar writes count; record them so we can assert nothing was persisted.
        upserted.push(values);
        return 1;
      }),
    };
    const adapterFactory: any = {
      create: jest.fn(() => ({
        getCandles: jest.fn(async () => primaryBars),
        // No `getQuote` → the synthetic-quote loop is skipped, so it cannot add writes.
      })),
    };
    const symbolResolver: any = { getSymbolsForFeature: jest.fn(async () => ({ symbols: ['EURUSD'] })) };
    const mt5Conn: any = {
      getBrokerIds: jest.fn(() => [2, 3]),
      getUrl: jest.fn((id: number) => (id === 2 ? PRIMARY_URL : FALLBACK_URL)),
    };

    service = new BarRefreshService(prisma, adapterFactory, symbolResolver, mt5Conn);
    jest.spyOn((service as any).logger, 'warn').mockImplementation((m: any) => { warns.push(String(m)); });
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'debug').mockImplementation((m: any) => { debugs.push(String(m)); });

    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ bars: fallbackBars }),
    })) as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('both brokers stale — the defect', () => {
    it('persists NOTHING rather than writing the least-stale set', async () => {
      // Both the primary AND the fallback serve a 4-month-old set.
      primaryBars = [bar(STALE_TS)];
      fallbackBars = [bar(STALE_TS)];

      await service.refresh();

      expect(upserted).toHaveLength(0);
      expect(debugs.some((w) => w.includes('Skipped stale bar set'))).toBe(true);
    });

    it('names the symbol, cadence and tolerance, so a real dead feed is diagnosable', async () => {
      await service.refresh();

      const msg = debugs.find((w) => w.includes('Skipped stale bar set'));
      expect(msg).toBeDefined();
      expect(msg).toContain('EURUSD');
      // 1m tolerance is 1h — the tightest, and the one that must be reported first.
      expect(msg).toContain('3600000ms');
    });

    it('⚠️ reports the count at WARN level in aggregate, so it cannot look like a clean refresh', async () => {
      // The per-pair line is DEBUG (see below), so the AGGREGATE is what guarantees visibility.
      // This is the assertion that stops a mass rejection hiding behind a tidy summary.
      const logSpy = jest.spyOn((service as any).logger, 'log');
      await service.refresh();

      expect(warns.some((w) => w.includes('stale bar set(s)'))).toBe(true);
      const lines = logSpy.mock.calls.map((c) => String(c[0]));
      expect(lines.some((l) => l.includes('stale sets skipped'))).toBe(true);
    });

    it('⚠️ does NOT delete — it only skips. A fresher fetch must still be able to write.', async () => {
      // Rejection must never be destructive: the tolerance exists to stop NEW stale rows,
      // not to purge history. Proven by running once stale, then once fresh.
      await service.refresh();
      expect(upserted).toHaveLength(0);

      primaryBars = [bar(FRESH_TS)];
      await service.refresh();
      expect(upserted.length).toBeGreaterThan(0);
    });
  });

  describe('⚠️ SESSION BREAKS — the over-rejection risk, pinned deliberately', () => {
    it('rejects a 1m set during a nightly close, and does so at DEBUG — not WARN', async () => {
      // MEASURED, not hypothetical: on 2026-09-15 every rejected pair under 1 day old (18 of them)
      // was `1m`, 1.9-4.6h old, on a symbol ALIVE on 5-6 other timeframes — SPY, QQQ, AMZN, UK100,
      // GER40. That is the overnight gap: the `1m` tolerance is 1h and a US equity's nightly gap is
      // ~17h. It recurs EVERY night for every equity, which is why warning here would be 18+ lines
      // of noise per night and would get the check switched off.
      //
      // The rejection itself is HARMLESS in this case: those bars are already stored, so skipping
      // the write is a no-op and no data is lost. Only the per-pair log LEVEL is load-bearing.
      const twoHoursAgo = new Date(NOW - 2 * 3600_000).toISOString();
      primaryBars = [bar(twoHoursAgo)];
      fallbackBars = [bar(twoHoursAgo)];

      await service.refresh();

      // ⚠️ IMPORTANT, AND THE REASON THIS TEST EXISTS: the check is PER (symbol, timeframe),
      // not per symbol. A 2h-old stamp is stale for `1m` (1h tolerance) but FRESH for `5m`, `15m`,
      // `1h`, `4h` and `1d`. So a session break rejects ONLY the tightest cadence and the other
      // five still refresh — the symbol is never suppressed wholesale. An earlier version of this
      // test asserted `upserted` was empty and failed, which is how the distinction was found.
      const tfsWritten = upserted.map((v) => v[2]);
      expect(tfsWritten).not.toContain('1m');
      // ⚠️ `.sort()` is LEXICOGRAPHIC, so '1d' precedes '1h' ('1'='1', then 'd' < 'h').
      // Sorting both sides keeps the assertion order-independent instead of encoding that quirk.
      expect([...tfsWritten].sort()).toEqual(['15m', '1d', '1h', '4h', '5m']);

      // ...and SILENTLY at per-pair level, so the nightly case raises no alarm.
      const perPairWarns = warns.filter((w) => w.includes('Skipped stale bar set'));
      expect(perPairWarns).toHaveLength(0);
      expect(debugs.some((w) => w.includes('Skipped stale bar set'))).toBe(true);
    });
  });

  describe('primary stale, fallback fresh — the no-regression case', () => {
    it('still chooses the fallback and persists it', async () => {
      primaryBars = [bar(STALE_TS)];
      fallbackBars = [bar(FRESH_TS)];

      const res = await service.refresh();

      expect(upserted.length).toBeGreaterThan(0);
      expect(res.upserted).toBeGreaterThan(0);
      expect(debugs.some((w) => w.includes('Skipped stale bar set'))).toBe(false);
    });
  });

  describe('a legitimately fresh primary is untouched', () => {
    it('writes normally and never calls the fallback', async () => {
      primaryBars = [bar(FRESH_TS)];
      fallbackBars = [bar(FRESH_TS)];

      await service.refresh();

      expect(global.fetch).not.toHaveBeenCalled();
      expect(upserted.length).toBeGreaterThan(0);
    });
  });

  describe('the tolerance does not over-reject a legitimate gap', () => {
    it('accepts a 1d set that is exactly at the 72h weekend boundary', async () => {
      // Fri 21:00 → Mon 21:00 is EXACTLY 72h, the documented 1d tolerance, and is the real
      // weekend gap for an mt5 daily feed. `isStaleSet` uses `>` so the boundary is inclusive.
      // If this ever starts failing, the tolerance was tightened and quiet symbols will be
      // rejected — the one risk the issue flagged before landing.
      const seventyTwoHoursAgo = new Date(NOW - 72 * 3600_000).toISOString();
      primaryBars = [bar(seventyTwoHoursAgo)];
      fallbackBars = [bar(seventyTwoHoursAgo)];

      await service.refresh();

      const wrote1d = upserted.some((v) => v.includes('1d'));
      expect(wrote1d).toBe(true);
    });
  });
});
