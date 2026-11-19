/**
 * market-movers.spec.ts — canaries for the market-wide movers feed (#1283).
 *
 * ⚠️ WHY THESE FOUR THINGS AND NOT MORE. Each one corresponds to a measured defect or a
 * plausible-output failure mode, not to a line of code:
 *
 *   1. `classifyInstrument` — 60% of the live feed is warrants/rights. The classifier is a
 *      HEURISTIC, so the test pins what it does AND what it cannot do.
 *   2. `applyFilters` — the exclusion ORDER decides which reason gets recorded, and a warrant that
 *      is also sub-$1 must be reported as "instrument", not "price".
 *   3. `staleness` — the live feed returned a THREE-DAY-OLD timestamp. An unreadable timestamp must
 *      read as stale, never as fresh.
 *   4. Provider parsing now lives in `movers-providers.ts` with its own spec. The rule it carries is
 *      the same one: a missing field stays `null` and must never become 0.
 */
import {
  applyFilters,
  classifyInstrument,
  staleness,
  type RawMover,
} from './market-movers.service';

const row = (ticker: string, price: number | null, volume: number | null): RawMover => ({
  ticker,
  price,
  volume,
  changePct: 100,
  direction: 'winner',
});

describe('classifyInstrument', () => {
  it('classifies the real tickers measured on the live feed', () => {
    // Every one of these appeared in one Alpha Vantage response on 2026-11-16.
    expect(classifyInstrument('BZFDW')).toBe('warrant');
    expect(classifyInstrument('BEATW')).toBe('warrant');
    expect(classifyInstrument('SBCWW')).toBe('warrant');
    expect(classifyInstrument('DAICW')).toBe('warrant');
    expect(classifyInstrument('HCICR')).toBe('right');
    expect(classifyInstrument('EONR+')).toBe('share-class');
    expect(classifyInstrument('FCUV')).toBe('common');
    expect(classifyInstrument('WWB')).toBe('common');
    expect(classifyInstrument('NVDA')).toBe('common');
  });

  it('is case-insensitive and trims, because the feed is not guaranteed to be either', () => {
    expect(classifyInstrument(' bzfdw ')).toBe('warrant');
    expect(classifyInstrument('Hcicr')).toBe('right');
  });

  it('⚠️ KNOWN LIMIT — a common ticker ending in W R or U is still flagged', () => {
    // This is asserted deliberately. The suffix is a heuristic, so the limitation is pinned rather
    // than discovered later: a real company whose ticker ends in U is misclassified, and the ONLY
    // mitigation is that the exclusion is reported with its reason (see applyFilters).
    expect(classifyInstrument('UUU')).toBe('unit');
    expect(classifyInstrument('RC')).toBe('common');
  });
});

describe('applyFilters', () => {
  const f = { minPrice: 1, minVolume: 100_000, excludeWarrants: true };

  it('keeps a normal liquid stock', () => {
    const { kept, excluded } = applyFilters([row('FCUV', 7.08, 114_584_389)], f);
    expect(kept.map((r) => r.ticker)).toEqual(['FCUV']);
    expect(excluded).toEqual([]);
  });

  it('excludes the warrants that dominate the raw feed, with a reason', () => {
    const { kept, excluded } = applyFilters(
      [row('BZFDW', 0.02, 77_115), row('BEATW', 0.011, 838_793), row('AKAN', 1.36, 75_892_407)],
      f,
    );
    expect(kept.map((r) => r.ticker)).toEqual(['AKAN']);
    expect(excluded).toHaveLength(2);
    expect(excluded.every((e) => e.reason === 'instrument')).toBe(true);
  });

  it('records "instrument" ahead of "price" when a row fails both', () => {
    // Order is the policy: a warrant can never be routed, whereas price is a preference the requirement
    // can change. Reporting "price" here would imply raising minPrice is what would let it in.
    const { excluded } = applyFilters([row('BZFDW', 0.02, 10)], f);
    expect(excluded[0].reason).toBe('instrument');
  });

  it('excludes a cheap common stock on price and a thin one on volume', () => {
    const { kept, excluded } = applyFilters(
      [row('CHEAP', 0.31, 5_000_000), row('THIN', 4.0, 45_555), row('OK', 12.0, 2_000_000)],
      f,
    );
    expect(kept.map((r) => r.ticker)).toEqual(['OK']);
    expect(excluded.map((e) => e.reason)).toEqual(['price', 'volume']);
  });

  it('reports an unusable price or volume rather than treating it as zero', () => {
    // ⚠️ `Number(null) === 0` and 0 is finite — the repo's most repeated trap. A missing volume must
    // be "unparseable", NOT "volume 0 failed the floor", because the two imply different repairs.
    const { excluded } = applyFilters([row('NOPRICE', null, 999_999), row('NOVOL', 5, null)], f);
    expect(excluded.map((e) => e.reason)).toEqual(['unparseable', 'unparseable']);
    expect(excluded[0].detail).toMatch(/price/);
    expect(excluded[1].detail).toMatch(/volume/);
  });

  it('lets the warrants through when the requirement turns the filter off — it is a POLICY, not a law', () => {
    // minVolume is set to 0 as well, so this isolates the instrument policy. (My first version left
    // it at 100,000 and BZFDW's 77,115 shares failed the VOLUME floor — the test was wrong, not the
    // code, and it is worth saying so rather than quietly widening the assertion.)
    const { kept } = applyFilters(
      [row('BZFDW', 0.02, 77_115)],
      { ...f, excludeWarrants: false, minPrice: 0, minVolume: 0 },
    );
    expect(kept.map((r) => r.ticker)).toEqual(['BZFDW']);
  });
});

describe('staleness', () => {
  const now = new Date('2026-11-16T17:00:00Z');

  it('calls a three-day-old feed stale — the measured case', () => {
    // Measured 2026-11-16 17:00 UTC: the provider returned "2026-11-13 16:15:59 US/Eastern".
    const { ageMinutes, stale } = staleness('2026-11-13 16:15:59 US/Eastern', now, 60);
    expect(stale).toBe(true);
    expect(ageMinutes).toBeGreaterThan(4000);
  });

  it('accepts a feed inside the limit', () => {
    const { ageMinutes, stale } = staleness('2026-11-16 16:30:00 US/Eastern', now, 60);
    expect(stale).toBe(false);
    expect(ageMinutes).toBeGreaterThan(0);
  });

  it('⚠️ treats a MISSING timestamp as stale, never as fresh', () => {
    expect(staleness(null, now, 60)).toEqual({ ageMinutes: null, stale: true });
  });

  it('⚠️ treats an UNPARSEABLE timestamp as stale, never as fresh', () => {
    // Absence of evidence is not freshness: a corrupt timestamp must not un-block trading.
    expect(staleness('last friday-ish', now, 60).stale).toBe(true);
  });
});
