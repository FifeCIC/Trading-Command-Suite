import { daysRangeStart } from './backtest.service';

/**
 * #1132 — `days` must measure BACK FROM THE NEWEST BAR.
 *
 * ⚠️ The defect this pins was not arithmetic, it was a query: `orderBy: asc` + `take: days + 120`
 * returns the OLDEST N bars. Measured 2026-11-01: `days: 20` on VIX 1h produced **2026-08-14 → 08-24**
 * — four days in August — while "the last 20 days" was 2026-10-22 → 10-30. Nothing reported it.
 *
 * So these tests hold the two halves apart: the WINDOW must end at the bar that was actually the newest
 * (never at the process clock), and it must reach back exactly `days`.
 */
describe('daysRangeStart — the start of a day-count window', () => {
  const newest = new Date('2026-10-30T20:00:00.000Z');

  it('reaches back exactly `days` days from the newest bar', () => {
    expect(daysRangeStart(newest, 20).toISOString()).toBe('2026-10-10T20:00:00.000Z');
  });

  it('anchors on the NEWEST BAR, not the current time', () => {
    // A market closed for the weekend must not slide the window. If this were `Date.now() - days` the
    // result would depend on when the test runs, which is precisely the invisible-window failure.
    const a = daysRangeStart(newest, 7);
    const b = daysRangeStart(newest, 7);
    expect(a.getTime()).toBe(b.getTime());
    expect(a.getTime()).toBeLessThan(newest.getTime());
  });

  it('is monotonic in `days` — a longer window never starts later', () => {
    expect(daysRangeStart(newest, 30).getTime()).toBeLessThan(daysRangeStart(newest, 7).getTime());
  });

  it('a one-day window starts exactly 24h earlier, so the span is `days` not `days + warm-up`', () => {
    const spanMs = newest.getTime() - daysRangeStart(newest, 1).getTime();
    expect(spanMs).toBe(24 * 60 * 60 * 1000);
  });

  it('zero days starts at the newest bar itself, never in the future', () => {
    expect(daysRangeStart(newest, 0).getTime()).toBe(newest.getTime());
  });
});
