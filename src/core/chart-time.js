/**
 * chart-time.js — provider candle timestamps → lightweight-charts `time` values.
 *
 * ⚠️ lightweight-charts requires every series' `time` values to be **unique and ascending**. It
 * ASSERTS on violation (`data must be asc ordered by time, index=1, time=…, prev time=…`) and the
 * thrown exception takes the whole page down into the error boundary — so a bad mapping is not a
 * cosmetic glitch, it is a dead page.
 *
 * The defect this exists to prevent, measured 2026-11-13 on `/education/pattern-scanner`
 * (default view SPY · 1H):
 *
 *     time: new Date(c.timestamp).toISOString().split('T')[0]     // ← a DATE STRING
 *     1H bars = 100  →  distinct date-prefix = 13
 *
 * 87 of 100 hourly bars shared a timestamp, `setData` threw before the chart drew, and even without
 * the throw the chart would have shown 13 daily candles for 100 hourly bars — intraday resolution
 * destroyed. Any page that charts intraday candles and builds `time` by truncating to a date has
 * this bug; use this module instead of re-deriving it.
 *
 * A UTCTimestamp (seconds) is valid for BOTH intraday and daily series, so one code path serves
 * every timeframe. `SymbolDetailPage.jsx` still builds `time` by hand and has the same latent bug —
 * it is currently unexercised because the page never receives a symbol (#1266).
 */

/**
 * One provider timestamp → a lightweight-charts UTCTimestamp (seconds), or null if unparseable.
 *
 * Returns null rather than NaN: NaN is what lightweight-charts asserts on, and a null lets the
 * caller DROP the bar instead of poisoning the series.
 */
export function toChartTime(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/**
 * Provider bars → chart-ready candles: unique by time, ascending, NaN-free.
 *
 * Later bars win when two share a timestamp (a provider re-sending a bar should replace, not
 * duplicate). The sort is explicit rather than trusted from the provider, because the assert that
 * punishes an unsorted series does not care whose fault it was.
 *
 * @param {Array<object>} bars
 * @param {(bar: object) => any} [pickTime] which field carries the timestamp; defaults to
 *   `timestamp ?? time ?? date`.
 */
export function toChartSeries(bars, pickTime) {
  const read = pickTime || ((b) => b?.timestamp ?? b?.time ?? b?.date);
  const byTime = new Map();
  for (const bar of bars || []) {
    const secs = toChartTime(read(bar));
    if (secs === null) continue;
    byTime.set(secs, {
      time: secs,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Provider bars → their chart times, index-aligned with the INPUT array (nulls preserved).
 *
 * Needed by anything whose index refers to the RAW bars while the chart consumes the de-duped
 * series — chart markers are built from detector output that carries a raw index, and resolving
 * them against the de-duped array silently points at the wrong bar once any duplicate is dropped.
 */
export function toChartTimes(bars, pickTime) {
  const read = pickTime || ((b) => b?.timestamp ?? b?.time ?? b?.date);
  return (bars || []).map((bar) => toChartTime(read(bar)));
}
