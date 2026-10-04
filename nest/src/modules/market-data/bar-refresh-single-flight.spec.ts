/**
 * bar-refresh-single-flight.spec.ts — two drivers, one method, ONE cycle (#1067).
 * =====================================================================================
 * THE DEFECT: every bar fetch and upsert appeared TWICE, interleaved, under ONE pid, and one
 * automation tick took **24.9 minutes**. Two API instances were ruled out — one listener on :3201,
 * one process, both copies carrying the same `[Nest] 5588` prefix.
 *
 * TWO INDEPENDENT DRIVERS shared `refresh()` and neither knew about the other:
 *   - `BarRefreshService.start()` owns a 5-minute timer
 *   - the automation loop calls `refresh()` once per tick
 *
 * ⚠️ KEYWORD IN THE ASSERTION IS **CONCURRENTLY**. Asserting "two sequential calls run two cycles"
 * would pass against the broken code too. The guard only fires while a cycle is in flight, so the
 * test must hold the first cycle open and start the second inside it.
 *
 * ⚠️ AND IT ASSERTS **JOINING**, NOT SKIPPING. A caller that arrives mid-cycle must receive the
 * running cycle's result, not an empty one — "a refresh ran and wrote nothing" and "no refresh ran"
 * are different facts. A guard that returned `{ upserted: 0 }` would be worse than the race.
 */
import { BarRefreshService } from './bar-refresh.service';

const NOW = Date.parse('2026-10-04T12:00:00.000Z');

/** Real bars, real OHLCV, no two alike — so nothing else in the pipeline rejects them. */
const realBar = (timestamp: string, price: number) => ({
  timestamp, open: price, high: price + 2, low: price - 2, close: price + 1, volume: 623,
});

const FRESH_TS = '2026-10-04T11:59:00.000Z';

describe('BarRefreshService — single-flight (#1067)', () => {
  let service: BarRefreshService;
  let getCandles: jest.Mock;
  let releaseFirstCycle: () => void;
  let gate: Promise<void>;
  // ⚠️ OPT-IN, and this matters. The first version of this spec blocked the FIRST `getCandles` in
  // EVERY test, so the sequential tests awaited a gate nothing ever released and timed out — the
  // suite failed while the CODE was correct. A mock that changes global behaviour to set up one
  // case makes every other case test the mock.
  let blockFirst = false;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(NOW));
    blockFirst = false;

    // A gate we control, so the first cycle can be held OPEN while a second caller arrives.
    gate = new Promise<void>((resolve) => { releaseFirstCycle = resolve; });
    let call = 0;
    getCandles = jest.fn(async () => {
      call += 1;
      if (call === 1 && blockFirst) await gate;   // only the concurrency case blocks
      return [realBar(FRESH_TS, 4139)];
    });

    const prisma: any = {
      $queryRawUnsafe: jest.fn(async () => []),
      symbol: {
        findFirst: jest.fn(async () => ({ id: 'sym-1', ticker: 'XAUUSD' })),
        findMany: jest.fn(async () => [{ ticker: 'XAUUSD' }]),
      },
      $executeRaw: jest.fn(async () => 1),
    };
    const adapterFactory: any = { create: jest.fn(() => ({ getCandles })) };
    const symbolResolver: any = { getSymbolsForFeature: jest.fn(async () => ({ symbols: ['XAUUSD'] })) };
    const mt5Conn: any = { getBrokerIds: jest.fn(() => []), getUrl: jest.fn(() => 'http://localhost:5000') };

    service = new BarRefreshService(prisma, adapterFactory, symbolResolver, mt5Conn);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'log').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'debug').mockImplementation(() => undefined);
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ bars: [] }) })) as any;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('runs ONE cycle for two CONCURRENT callers, and both get the same result', async () => {
    blockFirst = true;                          // hold the first cycle open
    const first = service.refresh();            // starts the cycle and blocks inside getCandles
    await Promise.resolve();
    const second = service.refresh();           // arrives while the first is in flight
    releaseFirstCycle();

    const [a, b] = await Promise.all([first, second]);

    // The decisive number: 6 timeframes fetched ONCE, not twelve times.
    expect(getCandles).toHaveBeenCalledTimes(6);
    // And the joining caller received the real result, not an empty one.
    expect(b).toEqual(a);
  });

  it('still runs a NEW cycle once the previous one has finished', async () => {
    await service.refresh();
    getCandles.mockClear();

    await service.refresh();

    // 6 again — the guard must not latch and starve every later refresh.
    expect(getCandles).toHaveBeenCalledTimes(6);
  });

  // ── POSITIVE CONTROL ────────────────────────────────────────────────────────────────────────
  // Proves the assertion can FAIL. Without this, a green suite only shows the test ran.
  it('⚠️ positive control — the same assertion REJECTS two genuinely separate cycles', async () => {
    await service.refresh();
    await service.refresh();
    // Two sequential cycles DID fetch twice over. So `toHaveBeenCalledTimes(6)` is a real
    // measurement of concurrency, not a number that happens to be true either way.
    expect(getCandles).toHaveBeenCalledTimes(12);
  });
});
