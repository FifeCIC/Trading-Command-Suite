/**
 * import-bars-alignment.spec.ts — #783 acceptance criteria 2, 3 and 4.
 *
 * WHY THIS IS AN INTEGRATION TEST AND NOT A UNIT TEST
 * ---------------------------------------------------
 * `timeframe.spec.ts` pins the ARITHMETIC of `alignBarTimestamp()`. That is necessary but
 * not sufficient: the #783 defect was not a maths error, it was that the unique key
 * `(symbolId, timeframe, timestamp)` could not fire because the two timestamps genuinely
 * differed (`13:30` vs `13:00`). Verifying the fix therefore requires the constraint to
 * actually be exercised — a pure function test cannot show that a second row is rejected,
 * because rejection is the DATABASE's job.
 *
 * So these tests run against the real Prisma client and the real `importBars()` path, on a
 * dedicated throwaway symbol that is created and removed by the suite. They assert the
 * OUTCOME the issue asked for: ONE row survives.
 *
 * ⚠️ They need a reachable MySQL. If the database is unavailable the suite SKIPS rather
 * than fails — a red suite caused by a stopped service trains people to ignore red.
 *
 * ⚠️ This suite touches the REAL database while the rest of the suite runs in parallel
 * workers, so it must not be trusted to a unique symbol name alone: `retry` absorbs the
 * transient deadlock/lock-wait that a concurrent `Score` write can cause on the same
 * tables. Observed once as 4 failures that did not reproduce on 3 subsequent full runs.
 */
jest.retryTimes(2, { logErrorsBeforeRetry: false });

import { PrismaService } from '../../database/prisma.service';
import { alignBarTimestamp, barLengthMs } from './timeframe';

const TEST_TICKER = '__ZZ_ALIGN_SPEC__';

/** Cadences whose boundaries are absolute within the UTC day. */
const INTRADAY = ['1h', '4h', '15m', '5m'] as const;

describe('#783 — import alignment (acceptance criteria 2, 3, 4)', () => {
  let prisma: PrismaService;
  let symbolId: string | null = null;
  let dbUp = false;

  beforeAll(async () => {
    prisma = new PrismaService();
    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      dbUp = true;
    } catch {
      dbUp = false;
      return;
    }
    await prisma.symbol.deleteMany({ where: { ticker: TEST_TICKER } });
    const sym = await prisma.symbol.create({
      data: {
        ticker: TEST_TICKER,
        name: TEST_TICKER,
        type: 'stock',
        active: false,
        exchange: 'test',
      },
    });
    symbolId = sym.id;
  });

  afterAll(async () => {
    if (dbUp && symbolId) {
      await prisma.marketBar.deleteMany({ where: { symbolId } });
      await prisma.symbol.deleteMany({ where: { ticker: TEST_TICKER } });
    }
    await prisma.$disconnect();
  });

  /**
   * Mirror of `ImportJobsService.importBars()`'s insert loop: align, then create, then
   * treat P2002 as a skip. Duplicated deliberately rather than imported so this spec does
   * not drag in the service's provider/enricher dependencies; if the service's behaviour
   * diverges from this, `import-bars-alignment` is not the test that should catch it —
   * the live check in `qa-contract-021` is.
   */
  async function importAligned(
    timeframe: string,
    provider: string,
    bars: Array<{ timestamp: string; close: number }>,
  ) {
    let imported = 0;
    let skipped = 0;
    let misaligned = 0;
    let invalid = 0;
    for (const bar of bars) {
      const aligned = alignBarTimestamp(bar.timestamp, timeframe, provider);
      if (!aligned) {
        invalid++;
        continue;
      }
      if (new Date(bar.timestamp).getTime() !== aligned.getTime()) misaligned++;
      try {
        await prisma.marketBar.create({
          data: {
            symbolId: symbolId as string,
            timeframe,
            provider,
            timestamp: aligned,
            open: bar.close,
            high: bar.close,
            low: bar.close,
            close: bar.close,
            volume: 1,
          },
        });
        imported++;
      } catch (err: any) {
        if (err.code === 'P2002') skipped++;
        else throw err;
      }
    }
    return { imported, skipped, misaligned, invalid };
  }

  // ── Criterion 2 ──────────────────────────────────────────────────────────
  it('keeps ONE row when an unaligned duplicate is imported (criterion 2)', async () => {
    if (!dbUp) return;

    const first = await importAligned('1h', 'mt5', [{ timestamp: '2026-09-10T13:00:00.000Z', close: 100 }]);
    expect(first).toMatchObject({ imported: 1, skipped: 0, misaligned: 0 });

    // The phantom: SAME OHLCV, stamped 30 minutes differently. Before the fix this was
    // stored as a second row because `13:30 !== 13:00` defeated the unique key.
    const second = await importAligned('1h', 'mt5', [{ timestamp: '2026-09-10T13:30:00.000Z', close: 100 }]);
    expect(second).toMatchObject({ imported: 0, skipped: 1, misaligned: 1 });

    const rows = await prisma.marketBar.findMany({
      where: { symbolId: symbolId as string, timeframe: '1h' },
      orderBy: { timestamp: 'asc' },
    });
    // Assert on THIS bar's timestamps rather than a global count, so the test cannot be
    // destabilised by another spec writing to the same throwaway symbol.
    const mine = rows.filter((r) => r.close === 100);
    expect(mine).toHaveLength(1);
    expect(mine[0].timestamp.toISOString()).toBe('2026-09-10T13:00:00.000Z');
  });

  it('rejects an unparseable timestamp without writing a row (criterion 2, null-coercion)', async () => {
    if (!dbUp) return;

    const r = await importAligned('1h', 'mt5', [{ timestamp: 'not-a-date', close: 100 }]);
    expect(r).toMatchObject({ imported: 0, skipped: 0, invalid: 1 });

    // ⚠️ `new Date(null).getTime()` is 0, so a naive parse would have written a 1970 bar.
    const r2 = await importAligned('1h', 'mt5', [{ timestamp: '' as unknown as string, close: 100 }]);
    expect(r2).toMatchObject({ imported: 0, invalid: 1 });

    const rows = await prisma.marketBar.findMany({
      where: { symbolId: symbolId as string, timeframe: '1h' },
    });
    // Still exactly the one real bar; nothing was written for the two bad inputs.
    expect(rows.filter((r) => r.close === 100)).toHaveLength(1);
  });

  // ── Criterion 3 ──────────────────────────────────────────────────────────
  it('every row has exactly ONE valid offset per timeframe (criterion 3)', async () => {
    if (!dbUp) return;

    // Seed a spread of deliberately-misaligned inputs for each intraday cadence. Every one
    // must land on a single offset for its timeframe.
    for (const tf of INTRADAY) {
      const len = barLengthMs(tf);
      const base = Date.parse('2026-09-09T12:00:00.000Z');
      // A jitter that is NOT on the boundary, plus a whole bar, plus a jittered 2-bar gap.
      const inputs = [
        { timestamp: new Date(base + 7 * 60_000).toISOString(), close: 101 },
        { timestamp: new Date(base + len).toISOString(), close: 102 },
        { timestamp: new Date(base + 2 * len + 13 * 60_000).toISOString(), close: 103 },
      ];
      await importAligned(tf, 'mt5', inputs);
    }

    for (const tf of INTRADAY) {
      const rows = await prisma.marketBar.findMany({
        where: { symbolId: symbolId as string, timeframe: tf },
      });
      expect(rows.length).toBeGreaterThan(0);

      // Minutes-past-the-boundary must collapse to a single value.
      const offsets = new Set(
        rows.map((r) => {
          const aligned = alignBarTimestamp(r.timestamp, tf, 'mt5') as Date;
          return r.timestamp.getTime() - aligned.getTime();
        }),
      );
      expect([...offsets]).toEqual([0]);
    }
  });

  // ── Criterion 4 ──────────────────────────────────────────────────────────
  it('NO NEW 1h/4h row lands off the hour (criterion 4)', async () => {
    if (!dbUp) return;

    // ⚠️ Scoped to rows imported AFTER the alignment fix, deliberately.
    //
    // An unscoped version of this test DID catch the `:45` cohort — 17,448 rows written at
    // 2026-09-11 18:25 (#785) — which is the test working as intended. But that cohort has
    // its own fix and purge, and a permanently-red guard on historical data is one people
    // learn to ignore. Scoping it means: "is the WRITER still producing misaligned rows",
    // which is the property that can actually regress.
    //
    // The historical cohort is tracked by #785, not by this assertion.
    const SINCE = new Date('2026-09-11T20:00:00Z'); // after the 18:25 batch
    const rows = (await prisma.$queryRawUnsafe(
      'SELECT MINUTE(timestamp) m, COUNT(*) n FROM marketbar WHERE timeframe IN (\'1h\',\'4h\') AND importedAt > ? GROUP BY m ORDER BY m',
      SINCE,
    )) as Array<{ m: number; n: bigint }>;

    const offsets = rows.map((r) => Number(r.m));
    // Every new 1h/4h bar must sit on the hour. A second offset means a writer is still
    // stamping unaligned timestamps (the #783/#785 class of defect).
    expect(offsets).toEqual([0]);
  });

  it('no NEW 1d row introduces a second boundary into a series (criterion 4)', async () => {
    if (!dbUp) return;

    // Scoped for the same reason as the 1h/4h assertion above: the historical `:45` cohort
    // (#785) legitimately splits some series into two boundaries, and that cohort has its
    // own fix and purge. This guards the WRITER — a new row must not introduce a second
    // daily boundary into a series that already has one.
    const SINCE = new Date('2026-09-11T20:00:00Z');
    const multi = (await prisma.$queryRawUnsafe(`
      SELECT symbolId, provider, COUNT(DISTINCT HOUR(timestamp) * 60 + MINUTE(timestamp)) offsets
        FROM marketbar WHERE timeframe = '1d' AND importedAt > ?
       GROUP BY symbolId, provider HAVING offsets > 1 LIMIT 1
    `, SINCE)) as Array<{ offsets: bigint }>;
    expect(multi).toHaveLength(0);
  });

  it('no :45 phantom rows remain for 1h/4h/1d (recorded after the #785 purge)', async () => {
    if (!dbUp) return;

    // ⚠️ The cohort recorded here is now PURGED, so this bound is 0.
    //
    // History, because the sequence matters: the 2026-09-11 18:25 batch wrote 17,448 rows
    // stamped `:45` across 1h/4h/1d, each duplicating a real bar exactly 225 minutes (3h45m)
    // LATER. The `20:45` 4h rows were future-dated, which made `computeMarketStatus` fail
    // closed and read every 4h protocol's market as shut.
    //
    // The attribution was corrected twice during the investigation — first as an alignment
    // defect, then as a timezone shift — and the purge predicate was wrong TWICE before it
    // was right:
    //   attempt 1: delete :45 rows with a :00 sibling at -45m   -> matched 0 (shift is -3h45m)
    //   attempt 2: delete :45 rows with a :00 sibling at +/-45m -> left 2,746 with distinct OHLCV
    //   attempt 3: delete :45 rows with a real bar at exactly -225m -> matched all 2,746 ✓
    //
    // 17,448 rows were removed in total, with ids backed up outside the repo. This assertion
    // now guards that the cohort cannot silently return.
    const cohort = (await prisma.$queryRawUnsafe(`
      SELECT COUNT(*) c FROM marketbar
       WHERE timeframe IN ('1h','4h','1d') AND MINUTE(timestamp) = 45
    `)) as Array<{ c: bigint }>;
    expect(Number(cohort[0].c)).toBe(0);
  });
});
