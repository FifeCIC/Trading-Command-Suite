/**
 * capacity-coverage.spec.ts — the window READ versus the window ASKED FOR (#1245).
 *
 * ⚠️ WHY THE BOUNDARY IS THE WHOLE TEST. `score` is throttled to ~100 rows per (symbol, protocol),
 * which is about 4.2 hours on a hot pair. Measured 2026-11-18: `?days=1` and `?days=7` both returned
 * the SAME 9,048 rows, and nothing in the response said the answer was a 4-hour read. `truncated`
 * exists so that can never be silent again.
 *
 * Both directions are asserted, because either mistake makes the flag useless:
 *   · too eager  → every complete window reports truncated, and within a day nobody reads it
 *   · too lax    → a 4-hour read keeps presenting itself as a 7-day one, which is the original bug
 */
import { newCoverage, finaliseCoverage } from './capacity-coverage';

const NOW = Date.parse('2026-11-18T20:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/** Build a finished coverage block for a 7-day request whose data spans `fromH`..`toH` ago. */
function coverageFor(fromH: number | null, toH: number | null, days = 7, rows = 1000) {
  const c = newCoverage(days, new Date(NOW - days * 24 * 3_600_000), rows);
  c.from = fromH === null ? null : hoursAgo(fromH);
  c.to = toH === null ? null : hoursAgo(toH);
  return finaliseCoverage(c);
}

describe('capacity coverage — a partial window must say so', () => {
  it('⚠️ the measured case: 4.2 hours of data against a 7-day request is TRUNCATED', () => {
    // 4.2h ago -> now. This is what the live database actually held.
    const c = coverageFor(4.2, 0);
    expect(c.truncated).toBe(true);
    expect(c.hoursCovered).toBeCloseTo(4.2, 1);
    // 4.2 / 168 hours
    expect(c.coveredPct).toBeLessThan(3);
  });

  it('a window that genuinely reaches the boundary is NOT truncated', () => {
    const c = coverageFor(168, 0);
    expect(c.truncated).toBe(false);
    expect(c.hoursCovered).toBeCloseTo(168, 0);
    expect(c.coveredPct).toBeCloseTo(100, 0);
  });

  it('⚠️ a few seconds inside the boundary is NOT truncation — the last tick precedes `now`', () => {
    // The boundary is `now - 7d`; on a complete window the oldest row lands ~30 s AFTER it.
    const c = coverageFor(168 - 30 / 3600, 0);
    expect(c.truncated).toBe(false);
  });

  it('⚠️ …but more than the slack inside it IS truncation', () => {
    const c = coverageFor(168 - 90 / 3600, 0); // 90 seconds inside the boundary
    expect(c.truncated).toBe(true);
  });

  it('no rows at all is truncated, and hours/percent are 0 — never a confident zero-coverage pass', () => {
    const c = coverageFor(null, null);
    expect(c.truncated).toBe(true);
    expect(c.hoursCovered).toBe(0);
    expect(c.coveredPct).toBe(0);
    expect(c.from).toBeNull();
  });

  it('a 1-day request over 4.2 hours is also truncated — the bug was not specific to 7 days', () => {
    const c = coverageFor(4.2, 0, 1);
    expect(c.truncated).toBe(true);
    expect(c.coveredPct).toBeLessThan(20);
  });

  it('carries the request forward, so a reader can tell what was asked without the query string', () => {
    const c = coverageFor(4.2, 0, 7, 9048);
    expect(c.requestedDays).toBe(7);
    expect(c.rowsScanned).toBe(9048);
    expect(Date.parse(c.requestedFrom)).toBe(NOW - 7 * 24 * 3_600_000);
  });

  it('hours are derived from the data span, not from the request', () => {
    const c = coverageFor(10, 2); // 8 hours of data
    expect(c.hoursCovered).toBeCloseTo(8, 1);
  });
});
