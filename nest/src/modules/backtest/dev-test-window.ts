/**
 * dev-test-window.ts — the ONE date window development testing is judged on (#1132 option A).
 *
 * ⚠️ WHY A FIXED WINDOW. A comparison is only scientific if both sides saw the SAME data. Live A/B
 * arms accrue on whatever the market does while they run, and `POST /api/backtest/run` takes `days`,
 * which is a **ROW LIMIT** (`take: days + 120` from the newest bar), not a date range — so "30 days"
 * at 1h covers about three, and the span depends on the timeframe. Every comparison built on `days`
 * measures a window the caller neither chose nor can see.
 *
 * ⚠️ THE START IS COMPUTED, NOT CHOSEN. It is the first date on which EVERY traded symbol has bars at
 * EVERY development timeframe. Measured 2026-10-22 with `scripts/audit-dev-window-coverage.cjs`:
 *
 *     timeframe   earliest ANY symbol   ALL SEVEN covered from   bounded by
 *     15m         2026-08-05            2026-09-08                US500
 *     1h          2026-08-05            2026-08-28                US500
 *     5m          2026-08-05            2026-09-09                US500
 *
 * US500 is the binding symbol. A window starting earlier silently gives some symbols less history
 * than others, and the comparison then reads as like-for-like when it is not. Re-run the audit before
 * ever moving this date.
 *
 * ⚠️ THE END IS FIXED TOO, AND THAT IS NOT AN OVERSIGHT. "To today" is not a fixed window: it moves
 * every midnight, so yesterday's result is not comparable with today's. `2026-10-20` is the last full
 * day before this version was cut.
 *
 * ⚠️ CHANGING THE DATES CREATES A NEW VERSION — never edit in place. A frozen window is comparable
 * with earlier work ONLY while it stays frozen; moving it silently invalidates every past comparison,
 * which is the exact failure this exists to prevent. Bump `version`, extend the dates, re-seed, and
 * comparisons must then refuse across versions (the guard already exists for windows via
 * `compareRuns()`'s `incomparable-window` verdict).
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 89
 * ISSUE:    #1132 (option A)
 */

export const DEV_TEST_WINDOW = {
  /** Bump on ANY date change. Never edit the dates under an existing version. */
  version: 'dev-window-v1',
  /** First date every traded symbol has bars at every development timeframe (bounded by US500 @5m). */
  from: '2026-09-09',
  /** Last FULL day before the version was cut. Not "today" — that would not be fixed. */
  to: '2026-10-20',
} as const;

/** Timeframes a development window is seeded for. Kept here so the seeder cannot drift from the doc. */
export const DEV_TEST_TIMEFRAMES = ['5m', '15m', '1h'] as const;

/** The traded symbols the coverage measurement was taken against. */
export const DEV_TEST_SYMBOLS = ['XAUUSD', 'XAGUSD', 'VIX', 'SPY', 'US500', 'BTC', 'EURUSD'] as const;

/** The `backtest_period.name` a seeded row carries, e.g. `dev-window-v1`. */
export const devTestPeriodName = (version: string = DEV_TEST_WINDOW.version): string => version;
