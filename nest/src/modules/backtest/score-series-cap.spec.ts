import { MAX_SCORE_SERIES_ROWS, capScoreSeries } from './backtest.service';

/**
 * The `scoreSeries` cap — a DEFAULT for rendering, not a contract for measuring (#1182 follow-up).
 *
 * ⚠️ WHY THIS EXISTS. `scoreSeries` was capped with the inline literal `slice(-2000)`, so the only
 * way to observe the behaviour was to run a whole backtest. That cap silently narrowed a real
 * measurement: a 5m run over `dev-window-v1` scores 8,559 bars, the response carried 2,000 — about
 * **7 days of a 42-day window** — and the run still reported the full window in `measuredPeriod`.
 * A reader computing "do high scores beat low scores on forward returns" therefore measured a
 * twentieth of the range while believing they had all of it. That is the plausible-output-no-error
 * shape this repo keeps paying for.
 *
 * The fix is an opt-in (`fullScoreSeries`), and this pins both directions: the UI must keep its cap,
 * and a measuring caller must be able to get every bar.
 */
describe('capScoreSeries — the scoreSeries default cap', () => {
  const series = Array.from({ length: 8_559 }, (_, i) => ({ i }));

  it('caps by DEFAULT — the browser table must not receive 8,559 rows', () => {
    const out = capScoreSeries(series);
    expect(out).toHaveLength(MAX_SCORE_SERIES_ROWS);
    // The TAIL is kept, not the head: the cap is for "the most recent picture", and returning the
    // first 2,000 would show a caller the oldest bars while labelling it the run.
    expect(out[out.length - 1]).toEqual({ i: 8_558 });
  });

  it('caps when the flag is explicitly false — an absent-vs-false distinction must not exist', () => {
    expect(capScoreSeries(series, false)).toHaveLength(MAX_SCORE_SERIES_ROWS);
  });

  it('returns EVERY row when asked — the measuring direction', () => {
    const out = capScoreSeries(series, true);
    expect(out).toHaveLength(8_559);
    expect(out[0]).toEqual({ i: 0 });
  });

  it('is a no-op below the cap in both directions — it must never pad or reorder', () => {
    const short = series.slice(0, 10);
    expect(capScoreSeries(short)).toEqual(short);
    expect(capScoreSeries(short, true)).toEqual(short);
  });

  it('an empty series stays empty — [] is information, not a failure', () => {
    expect(capScoreSeries([], false)).toEqual([]);
    expect(capScoreSeries([], true)).toEqual([]);
  });

  it('the cap is 2,000 — a change to the constant is a change to what every caller sees', () => {
    expect(MAX_SCORE_SERIES_ROWS).toBe(2_000);
  });
});
