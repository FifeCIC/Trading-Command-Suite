import { MarketDataService } from './market-data.service';

/**
 * market-data.service.spec.ts — the canonical bar loader contract (#751).
 *
 * WHY THIS IS TESTED
 * ------------------
 * `getBars()` is the ONLY loader that guarantees the two things a scoring array must
 * have: a single `timeframe` (no mixed cadences) and oldest → newest order. Two
 * hand-rolled `prisma.marketBar` queries had bypassed it and both had lost the
 * `timeframe` filter:
 *
 *   - the Arena passed a DESCENDING array to directives, so "current price" became the
 *     OLDEST bar in the window;
 *   - `ScoringService.loadBars()` used `asc + take`, which returns the OLDEST N rows —
 *     for AUDUSD that window ended 2026-05-18 while the newest bar was 2026-09-10.
 *
 * Anything that re-implements this loader will drift again, so pin the contract here.
 */
describe('MarketDataService.getBars (#751)', () => {
  function build(rows: any[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const service = new MarketDataService({ marketBar: { findMany } } as any);
    return { service, findMany };
  }

  const newestFirst = [
    { timestamp: new Date('2026-09-10T09:10:00Z'), close: 3 },
    { timestamp: new Date('2026-09-10T09:05:00Z'), close: 2 },
    { timestamp: new Date('2026-09-10T09:00:00Z'), close: 1 },
  ];

  it('filters by timeframe — the filter both hand-rolled queries had lost', async () => {
    const { service, findMany } = build([]);

    await service.getBars('sym-1', '5m', 100);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { symbolId: 'sym-1', timeframe: '5m' } }),
    );
  });

  it('selects the NEWEST N bars (desc + take) and returns them oldest → newest', async () => {
    const { service, findMany } = build(newestFirst);

    const bars = await service.getBars('sym-1', '5m', 3);

    // Newest N: desc + take. (asc + take would return the OLDEST N — the #751 bug.)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ timestamp: 'desc' }], take: 3 }),
    );
    // …then reversed for the directive contract, so bars[last] is the CURRENT bar.
    expect(bars.map((b: any) => b.close)).toEqual([1, 2, 3]);
    expect(bars[bars.length - 1].close).toBe(3);
  });

  it('does not mutate the caller-visible ordering when called repeatedly', async () => {
    const { service } = build(newestFirst);

    const first = await service.getBars('sym-1', '5m', 3);
    const second = await service.getBars('sym-1', '5m', 3);

    expect(first.map((b: any) => b.close)).toEqual(second.map((b: any) => b.close));
  });

  it('returns an empty array when the symbol has no rows at that cadence', async () => {
    const { service } = build([]);

    await expect(service.getBars('sym-1', '1d', 200)).resolves.toEqual([]);
  });
});
