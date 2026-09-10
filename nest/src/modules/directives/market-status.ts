import { MarketBar } from './interfaces/directive.interface';

/**
 * market-status.ts — THE tradability boundary.
 *
 * ⚠️ CONTRACT FILE — `computeMarketStatus()` owns INV-GATE-FAILS-CLOSED: when freshness cannot
 * be verified it must return `closed`, never `open`. Three separate paths once failed open
 * (future-dated bars from the MT5 server-clock bug #750; a descending array that collapsed the
 * median cadence to 0 and skipped the staleness test; an indeterminate cadence that was
 * likewise skipped). Those guards look like defensive noise and are NOT — removing one makes
 * a stale or closed market read as tradable, with no error anywhere.
 *
 * Enforced at build time by `nest/scripts/validate-pipeline-contracts.cjs` (canary
 * INV-GATE-FAILS-CLOSED) and covered by `market-status.spec.ts`.
 *
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

/**
 * How far in the FUTURE a bar may be stamped before we call it clock skew.
 * Bars are stamped at bar-OPEN time (the in-progress 5m bar is stamped up to
 * 5m in the past, never ahead) and synthetic placeholders are stamped `now`,
 * so a legitimate future stamp is only ever seconds away. 10 minutes therefore
 * absorbs ordinary clock slop while still tripping on any real timezone error
 * (the #750 regression was +3h; a winter/summer mix-up is 1h).
 */
const FUTURE_BAR_TOLERANCE_MS = 10 * 60_000;

export function computeMarketStatus(bars: MarketBar[], referenceTime = new Date()): MarketStatus {
  // Defensive: coerce string timestamps to Date. Some bridge/serialized paths
  // pass ISO strings; `.getTime()`/`.toISOString()` throw on a string. This
  // function is called directly (automation loop, protocol-gating) as well as
  // from directives, so guard here independently of runAll's normalization.
  for (const b of (bars ?? [])) {
    if (b?.timestamp && !(b.timestamp instanceof Date)) {
      (b as any).timestamp = new Date(b.timestamp as any);
    }
  }

  // ⚠️ ORDER-AGNOSTIC (fixed 2026-09-10, #750 AC-3). The contract for this
  // function is "oldest → newest", but callers disagree: the arena controller
  // loads bars `orderBy: { timestamp: 'desc' }` and passes them straight here.
  // With a descending array every interval is NEGATIVE, so `intervals` stays
  // empty, `medianInterval` collapses to 0, and the staleness test below is
  // SKIPPED — the gate then returns `open: true` for ANY feed, however old.
  // Live proof: BTCUSD (feed frozen 2026-07-18) read `open: true` from
  // POST /scoring/arena/compare, with `asOf` = the array's last element (the
  // OLDEST bar). Sorting here means a caller can never silently disable the
  // gate by passing a differently-ordered series. Cheap: ≤200 bars per call.
  const ordered = [...(bars ?? [])].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  if (ordered.length < 2) {
    const asOf = ordered.length > 0 ? ordered[ordered.length - 1].timestamp.toISOString() : null;
    return { open: false, asOf, reason: 'insufficient bars' };
  }

  // Skip synthetic "current" placeholder bars (volume <= 1). BarRefreshService
  // upserts a 5m bar stamped with `now` and volume=1 even when the market is
  // closed — using it would fool a timestamp-based staleness check.
  const newestBar = ordered[ordered.length - 1];

  // Median bar cadence over the trailing bars (robust to a single gap). Computed
  // over ALL trailing bars — synthetic placeholders keep the same cadence, so
  // they remain valid for measuring the expected bar interval even when the
  // last real bar has scrolled far back in the window.
  const lookback = Math.min(ordered.length - 1, 20);
  const intervals: number[] = [];
  for (let i = ordered.length - lookback; i < ordered.length; i++) {
    const dt = ordered[i].timestamp.getTime() - ordered[i - 1].timestamp.getTime();
    if (dt > 0) intervals.push(dt);
  }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const medianInterval = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  // Walk back from the newest bar to the most recent REAL bar.
  let idx = ordered.length - 1;
  while (idx >= 0 && (ordered[idx].volume ?? 0) <= 1) idx--;

  if (idx < 0) {
    // Every bar in the window is a synthetic placeholder — no real data at all.
    return {
      open: false,
      asOf: newestBar.timestamp.toISOString(),
      reason: 'no real bars in window — all synthetic placeholders',
    };
  }

  const lastRealBar = ordered[idx];
  const ageMs = referenceTime.getTime() - lastRealBar.timestamp.getTime();
  const asOf = lastRealBar.timestamp.toISOString();

  // ⚠️ CLOCK-SKEW GUARD (added 2026-09-10, #750 — the reason this gate can
  // never be trusted on age alone).
  //
  // A bar stamped in the FUTURE makes `ageMs` NEGATIVE, and a negative number
  // can never exceed `medianInterval*3` — so this gate silently FAILS OPEN and
  // stale/weekend data reads `open: true`. That is precisely how the MT5
  // bridge's server-clock bug (+3h, #750) disabled the gate: every MT5 bar
  // looked impossibly fresh, so the tradability check passed on closed markets.
  //
  // The staleness test below is only meaningful once the feed's clock agrees
  // with ours, so validate that FIRST. Fail closed (unusable feed), not open —
  // an unusable feed is exactly the condition this gate exists to catch.
  if (ageMs < -FUTURE_BAR_TOLERANCE_MS) {
    return {
      open: false,
      asOf,
      reason: `data clock skew: last real bar stamped ${Math.round(-ageMs / 60000)}m in the future (broker/bridge timezone regression?)`,
    };
  }

  // ⚠️ UNVERIFIABLE CADENCE (added 2026-09-10, #750 AC-3). `medianInterval === 0`
  // means no positive gap existed between the trailing bars — duplicate
  // timestamps, or (before the sort above) a descending series. Without a
  // cadence we cannot say what "stale" means, and skipping the test silently
  // reads as OPEN. Fail closed instead: an unmeasurable feed is not tradable.
  if (medianInterval <= 0) {
    return {
      open: false,
      asOf,
      reason: 'indeterminate bar cadence (no positive interval between trailing bars) — freshness unverifiable',
    };
  }

  if (ageMs > medianInterval * 3) {
    return {
      open: false,
      asOf,
      reason: `last real bar ${Math.round(ageMs / 60000)}m old (market closed or data stale)`,
    };
  }

  return { open: true, asOf };
}
