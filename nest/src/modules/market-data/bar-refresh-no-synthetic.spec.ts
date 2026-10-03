/**
 * bar-refresh-no-synthetic.spec.ts — the refresh may only store bars the BRIDGE SERVED.
 * =====================================================================================
 *
 * THE DEFECT THIS GUARDS (measured 2026-10-03, live database)
 * ----------------------------------------------------------
 * `BarRefreshService.refresh()` ended with a loop that called `getQuote(symbol)`, took
 * `(bid+ask)/2`, floored the LOCAL clock to the current 5m bucket, and INSERTed a bar:
 * `provider 'mt5'`, `timeframe '5m'`, `o=h=l=c=mid`, **`volume 1`**.
 *
 * It fired **1,016 times across 52 symbols**, every row flat and every row `volume <= 1`, all
 * stamped after Friday's close — 21:05, 21:10, 21:15 ... and then Sat 13:40, 13:45, ...
 *
 * Proven rather than inferred: `GET :5000/quote?symbol=XAUUSD` returns `bid 4147.62 / ask 4147.97`,
 * mid **4147.795** — the exact value carried by every one of those rows — while the bridge's own
 * `/candles` returns NOTHING after Fri 20:54. The bars were never market data.
 *
 * WHY IT WAS DANGEROUS, in one line: the bar is stamped at the CURRENT bucket, so `MAX(timestamp)`
 * is always ~now and a symbol whose feed died on Friday still measures FRESH on Monday.
 *
 * ⚠️ WHY THE EXISTING SUITE COULD NOT SEE IT. `bar-refresh-stale-recheck.spec.ts` builds the adapter
 * mock with `getCandles` only and records the reason in a comment — *"No `getQuote` → the
 * synthetic-quote loop is skipped, so it cannot add writes."* The mock was shaped so the defect
 * could not fire, so every assertion passed while the live system fabricated bars. **A suite that
 * excludes the condition under test is indistinguishable from a suite that passes.**
 *
 * THE INVARIANT
 * -------------
 * **Every row this service writes must carry a timestamp that came from a fetched bar set.**
 * Not "close to now", not "the current bucket" — from the fetch. A writer in this path has exactly
 * one legitimate source of a bar: `getCandles()`.
 *
 * ⚠️ THE POSITIVE CONTROL IS THE POINT. `expectNoFabricatedBars` is a pure function over the
 * recorded writes, so it can be fed a fabricated write directly and shown to FAIL. Without that,
 * a green suite here would only prove the detector runs — not that it can detect.
 */
import { BarRefreshService } from './bar-refresh.service';

const NOW = Date.parse('2026-10-03T13:50:00.000Z');   // Saturday — market shut
const FRIDAY_NEWEST = '2026-10-02T20:50:00.000Z';      // the bridge's genuine last 5m bar
const PRIMARY_URL = 'http://localhost:5000';

/** One bar as the bridge serves it — real OHLCV, real volume, no two bars alike. */
const realBar = (timestamp: string, price: number) => ({
  timestamp, open: price, high: price + 2, low: price - 2, close: price + 1, volume: 623,
});

/**
 * The value layout of the refresh's INSERT:
 *   [symbolId, provider, timeframe, timestamp, open, high, low, close, volume]
 */
const FABRICATED_SIGNATURE = (v: unknown[]): boolean => {
  const [, provider, tf, , open, high, low, close, volume] = v as any[];
  return (
    provider === 'mt5' &&
    tf === '5m' &&
    Number(open) === Number(high) &&
    Number(high) === Number(low) &&
    Number(low) === Number(close) &&
    Number(volume) <= 1
  );
};

/**
 * The invariant. Returns the offending writes so a failure names them instead of just asserting.
 * Two independent ways a write can be fabricated:
 *   1. it is stamped AFTER the newest bar the bridge actually served, or
 *   2. it carries the synthetic signature (flat OHLC, volume <= 1).
 */
function fabricatedWrites(writes: unknown[][], newestServedIso: string): unknown[][] {
  const newest = Date.parse(newestServedIso);
  return writes.filter(
    (v) => Date.parse(String((v as any[])[3])) > newest || FABRICATED_SIGNATURE(v),
  );
}

describe('BarRefreshService — only bars the BRIDGE SERVED may be stored', () => {
  let service: BarRefreshService;
  let writes: unknown[][];
  let candles: any[];
  let quote: any;
  // Hoisted so the core-set tests can swap them per case.
  let prismaMock: any;
  let resolverMock: any;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));

    writes = [];
    candles = [realBar(FRIDAY_NEWEST, 4139)];
    // ⚠️ A LIVE-LOOKING QUOTE FOR A CLOSED MARKET — this is the exact live condition that
    // produced the 1,016 rows: the bid/ask keep answering after the feed stops.
    quote = { bid: 4147.62, ask: 4147.97, last: 4147.62 };

    const prisma: any = prismaMock = {
      $queryRawUnsafe: jest.fn(async () => []),
      // ⚠️ BOTH are required by `resolveRefreshSymbols()`. Without `findMany` the core-set read
      // throws and the method falls back to the full list, so the tests would pass while never
      // running the filter they appear to cover.
      symbol: {
        findFirst: jest.fn(async () => ({ id: 'sym-1', ticker: 'XAUUSD' })),
        findMany: jest.fn(async () => [{ ticker: 'XAUUSD' }]),
      },
      $executeRaw: jest.fn(async (_s: any, ...values: any[]) => { writes.push(values); return 1; }),
    };
    const adapterFactory: any = {
      create: jest.fn(() => ({
        getCandles: jest.fn(async () => candles),
        // ⚠️ `getQuote` IS DELIBERATELY PRESENT. The sibling spec omits it, which is precisely why
        // this defect survived — omitting it makes the fabrication path unreachable in the test.
        getQuote: jest.fn(async () => quote),
      })),
    };
    const symbolResolver: any = resolverMock = { getSymbolsForFeature: jest.fn(async () => ({ symbols: ['XAUUSD'] })) };
    const mt5Conn: any = { getBrokerIds: jest.fn(() => [2]), getUrl: jest.fn(() => PRIMARY_URL) };

    service = new BarRefreshService(prisma, adapterFactory, symbolResolver, mt5Conn);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => undefined);

    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ bars: candles }) })) as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('stores the served bars and fabricates NOTHING, even with a quote answering', async () => {
    await service.refresh();

    // POSITIVE: the real bar WAS written — otherwise "nothing fabricated" is vacuous.
    expect(writes.length).toBeGreaterThan(0);

    const bad = fabricatedWrites(writes, FRIDAY_NEWEST);
    expect(bad).toEqual([]);
  });

  it('never stamps a bar at the CURRENT bucket while the feed is closed', async () => {
    await service.refresh();

    // The defect's signature, asserted directly: at 13:50 the current 5m bucket is 13:50.
    // Nothing may be stamped there, because the bridge served nothing there.
    const currentBucket = Date.parse('2026-10-03T13:50:00.000Z');
    const atNow = writes.filter((v) => Date.parse(String((v as any[])[3])) >= currentBucket);
    expect(atNow).toEqual([]);
  });

  it('writes no 5m bar with volume <= 1 — a fabricated volume is a claim about trading', async () => {
    await service.refresh();

    const fakeVolume = writes.filter((v) => Number((v as any[])[8]) <= 1);
    expect(fakeVolume).toEqual([]);
  });

  // ── POSITIVE CONTROL ────────────────────────────────────────────────────────────────────────
  // Proves the detector can FAIL. A guard that has never been observed to fail is a decoration.
  describe('⚠️ positive control — the detector must be able to fail', () => {
    it('REJECTS the exact row the removed loop produced', () => {
      const synthetic = [
        'sym-1', 'mt5', '5m', new Date('2026-10-03T13:50:00.000Z'),
        4147.795, 4147.795, 4147.795, 4147.795, 1,
      ];
      expect(FABRICATED_SIGNATURE(synthetic)).toBe(true);
      expect(fabricatedWrites([synthetic], FRIDAY_NEWEST)).toHaveLength(1);
    });

    it('REJECTS a future-bucket stamp even when the OHLCV looks real', () => {
      const futureStamped = [
        'sym-1', 'mt5', '5m', new Date('2026-10-03T13:50:00.000Z'),
        4147.795, 4149.1, 4146.2, 4148.0, 900,
      ];
      expect(fabricatedWrites([futureStamped], FRIDAY_NEWEST)).toHaveLength(1);
    });

    it('ACCEPTS a genuinely served bar — so it is not rejecting everything', () => {
      const served = [
        'sym-1', 'mt5', '5m', new Date(FRIDAY_NEWEST),
        4137.45, 4139.72, 4136.68, 4139.36, 623,
      ];
      expect(fabricatedWrites([served], FRIDAY_NEWEST)).toEqual([]);
    });
  });

  // ── THE CORE SET — `symbol.active` bounds the work, and MUST NOT starve a held position ──────
  describe('resolveRefreshSymbols — the core-set gate (R37)', () => {
    it('drops a symbol that is neither active nor protected', async () => {
      resolverMock.getSymbolsForFeature = jest.fn(async (f: string) =>
        ({ symbols: f === 'automation' ? [] : ['XAUUSD', 'SOMETHING'] }));
      prismaMock.symbol.findMany = jest.fn(async () => [{ ticker: 'XAUUSD' }]);

      await expect(service.resolveRefreshSymbols()).resolves.toEqual(['XAUUSD']);
    });

    // ⚠️ THE SAFETY-CRITICAL CASE. An inactive symbol we HOLD or TRADE must keep its feed: a
    // starved feed stops the stop guardian pricing the position, and the symptom is "the stop did
    // not fire" — no error, nothing pointing back here.
    it('KEEPS an inactive symbol that has a position or an active bot', async () => {
      resolverMock.getSymbolsForFeature = jest.fn(async (f: string) =>
        ({ symbols: f === 'automation' ? ['BTC'] : ['XAUUSD', 'BTC'] }));
      prismaMock.symbol.findMany = jest.fn(async () => [{ ticker: 'XAUUSD' }]);

      const out = await service.resolveRefreshSymbols();
      expect(out).toContain('BTC');      // protected despite being inactive
      expect(out).toContain('XAUUSD');   // active
    });

    it('FAILS OPEN — if the active read throws, the full list survives', async () => {
      resolverMock.getSymbolsForFeature = jest.fn(async () => ({ symbols: ['XAUUSD', 'BTC'] }));
      prismaMock.symbol.findMany = jest.fn(async () => { throw new Error('db down'); });

      await expect(service.resolveRefreshSymbols()).resolves.toEqual(['XAUUSD', 'BTC']);
    });
  });
});
