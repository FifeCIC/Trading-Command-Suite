import { MarketBar } from './interfaces/directive.interface';

/**
 * Market status from bar freshness (2026-08-15).
 * ==============================================
 * "Is this symbol's market producing data right now?" — a symbol-agnostic
 * tradability check. Exchange calendars only cover US equities, but this works
 * for gold, forex, crypto, etc. by asking whether new bars are still arriving.
 *
 * Logic: if the most recent bar is older than 3× the median bar interval,
 * the market is closed (or the data feed is stale). Crypto (24/7) keeps
 * producing bars so it always reads `open`; gold/forex freeze over the weekend
 * so they read `closed`.
 */
export interface MarketStatus {
  open: boolean;
  /** ISO timestamp of the most recent bar (the "as of" moment). */
  asOf: string | null;
  reason?: string;
}

export function computeMarketStatus(bars: MarketBar[]): MarketStatus {
  if (!bars || bars.length < 2) {
    const asOf = bars && bars.length > 0 ? bars[bars.length - 1].timestamp.toISOString() : null;
    return { open: false, asOf, reason: 'insufficient bars' };
  }

  // Skip synthetic "current" placeholder bars (volume <= 1). BarRefreshService
  // upserts a 5m bar stamped with `now` and volume=1 even when the market is
  // closed — using it would fool a timestamp-based staleness check.
  const newestBar = bars[bars.length - 1];

  // Median bar cadence over the trailing bars (robust to a single gap). Computed
  // over ALL trailing bars — synthetic placeholders keep the same cadence, so
  // they remain valid for measuring the expected bar interval even when the
  // last real bar has scrolled far back in the window.
  const lookback = Math.min(bars.length - 1, 20);
  const intervals: number[] = [];
  for (let i = bars.length - lookback; i < bars.length; i++) {
    const dt = bars[i].timestamp.getTime() - bars[i - 1].timestamp.getTime();
    if (dt > 0) intervals.push(dt);
  }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const medianInterval = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  // Walk back from the newest bar to the most recent REAL bar.
  let idx = bars.length - 1;
  while (idx >= 0 && (bars[idx].volume ?? 0) <= 1) idx--;

  if (idx < 0) {
    // Every bar in the window is a synthetic placeholder — no real data at all.
    return {
      open: false,
      asOf: newestBar.timestamp.toISOString(),
      reason: 'no real bars in window — all synthetic placeholders',
    };
  }

  const lastRealBar = bars[idx];
  const ageMs = Date.now() - lastRealBar.timestamp.getTime();
  const asOf = lastRealBar.timestamp.toISOString();

  if (medianInterval > 0 && ageMs > medianInterval * 3) {
    return {
      open: false,
      asOf,
      reason: `last real bar ${Math.round(ageMs / 60000)}m old (market closed or data stale)`,
    };
  }

  return { open: true, asOf };
}
