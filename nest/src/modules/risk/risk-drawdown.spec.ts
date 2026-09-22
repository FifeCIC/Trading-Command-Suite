import { computeDrawdownDetail } from './risk.controller';

/**
 * #950 — the drawdown figure must have a DEFINED meaning.
 *
 * ⚠️ THE TWO DEFECTS THESE TESTS PIN, both measured on the live endpoint 2026-09-22:
 *
 * 1. "Drawdown at 1557.8%". The ratio was taken against the window's PEAK CUMULATIVE P&L — a
 *    number that can sit near zero (the live window peaked at a few currency units) — so the
 *    percentage was unbounded and meaningless on a RISK surface.
 * 2. The opposite: `peak` started at 0, so a window that lost from its FIRST trade never set a
 *    peak and reported ZERO drawdown. "Nothing wrong" and "never measured" rendered identically.
 *
 * The definition these tests pin: peak-to-trough of the cumulative realised P&L over the window;
 * `currency` is always the true figure; `pctOfPeak` is provided ONLY when the peak is positive,
 * and is `null` otherwise rather than a fabricated 0 or 100.
 */
describe('computeDrawdownDetail (#950)', () => {
  const t = (pnl: number, day: number) => ({ pnl, closedAt: new Date(Date.UTC(2026, 8, day)) });

  it('measures the fall from the peak to the lowest point after it', () => {
    // Chronological: +10 (peak 10), +5 (peak 15), −30 (trough −15).
    const dd = computeDrawdownDetail([t(-30, 3), t(5, 2), t(10, 1)]); // newest-first, as queried
    expect(dd.currency).toBe(30);      // 15 − (−15)
    expect(dd.peak).toBe(15);
    expect(dd.trough).toBe(-15);
    expect(dd.pctOfPeak).toBe(200);    // 30 / 15
    expect(dd.trades).toBe(3);
    expect(dd.peakAt).toBe('2026-09-02T00:00:00.000Z');
    expect(dd.troughAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('⭐ REGRESSION — a window that only ever lost reports its TRUE fall, not zero, and NO percentage', () => {
    // The old implementation returned 0 here (peak never left its initial 0).
    // Chronological: −5 (cum −5), −15 (cum −20), −35 (cum −55).
    const dd = computeDrawdownDetail([t(-35, 3), t(-15, 2), t(-5, 1)]);
    expect(dd.currency).toBe(50);      // −5 − (−55): the fall below the best point SO FAR
    expect(dd.peak).toBe(-5);
    expect(dd.trough).toBe(-55);
    // No denominator: the window never rose above zero. null, never 0 — 0 would read as "no drawdown".
    expect(dd.pctOfPeak).toBeNull();
  });

  it('a recovery does not retroactively cancel the drawdown that happened', () => {
    // +10, −40 (trough −30), +50 (cum 20, new peak — no fall AFTER it)
    const dd = computeDrawdownDetail([t(50, 3), t(-40, 2), t(10, 1)]);
    expect(dd.currency).toBe(40);      // 10 − (−30), from the peak that PRECEDED the trough
    expect(dd.peak).toBe(10);
    expect(dd.pctOfPeak).toBe(400);
  });

  it('a single trade cannot draw down', () => {
    const dd = computeDrawdownDetail([t(-12, 1)]);
    expect(dd.currency).toBe(0);
    expect(dd.pctOfPeak).toBeNull();
    expect(dd.trades).toBe(1);
  });

  it('an empty window is reported as measured-and-empty, not as a clean zero with no denominator', () => {
    const dd = computeDrawdownDetail([]);
    expect(dd).toEqual({ currency: 0, pctOfPeak: null, peak: 0, trough: 0, trades: 0, peakAt: null, troughAt: null });
  });

  it('a window that PEAKED and never fell reports a MEASURED zero — peak stated, pct 0, not null', () => {
    // The distinction the null is FOR: +8 and holding is not the same claim as 'never rose above
    // zero'. Peak must be 8 (not the placeholder 0), and 0% is a real reading here.
    const dd = computeDrawdownDetail([t(null as any, 2), t(8, 1)]);
    expect(dd.peak).toBe(8);
    expect(dd.currency).toBe(0);       // a null pnl is 0 P&L, not a loss
    expect(dd.trough).toBe(8);
    expect(dd.pctOfPeak).toBe(0);
  });
});
