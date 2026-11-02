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

/**
 * ── SYMBOLS ADDED WITH A RESTRICTED TIMEFRAME SET (2026-11-02) ──────────────────────────────────
 * The matrix above seeds EVERY development timeframe for every symbol, which is correct only where
 * the coverage measurement proved all of them. A symbol whose 5m bars begin mid-window cannot be
 * declared at 5m without the period row asserting a window the data cannot fill — so it is declared
 * here with the timeframes it CAN cover, measured, rather than left out entirely.
 *
 * NVDA measured 2026-11-02 inside `dev-window-v1` (2026-09-09 → 2026-10-20):
 *   `1d` 30 bars, Sep 09 → Oct 20 — FULL coverage
 *   `1h` 291 bars, Sep 09 → Oct 20 — FULL coverage
 *   `15m` starts Sep 14 · `5m` starts Sep 21 — INCOMPLETE, so deliberately NOT declared
 *
 * ⚠️ Do not add a pair here without measuring it first. A period row that over-claims coverage is
 * the same defect as a fabricated statistic: it reports a window that was never measured.
 */
export const DEV_TEST_EXTRA_SYMBOLS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  NVDA: ['1d', '1h'],
  // USDJPY measured 2026-11-02 inside the window: `1h` 648 bars, Sep 09 → Oct 21 — FULL coverage.
  // `5m` (7,860) and `15m` (2,554) both END at Oct 14, i.e. eight trading days short, so they are
  // deliberately NOT declared. Tokyo USDJPY Session runs 1h, so the coverage that matters is here.
  USDJPY: ['1h'],
});

/** The `backtest_period.name` a seeded row carries, e.g. `dev-window-v1`. */
export const devTestPeriodName = (version: string = DEV_TEST_WINDOW.version): string => version;
