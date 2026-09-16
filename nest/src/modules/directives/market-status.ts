import { MarketBar } from './interfaces/directive.interface';
// ⚠️ Cadence→duration comes from the ONE owner. Do not add a local map here (2026-09-15).
// ⚠️ Use the *OrUndefined variant: the fail-closed branch below tests for absence.
import { barLengthMsOrUndefined } from '../../common/utils/timeframe';

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
 * Candidate cadence of a bar series, in milliseconds, keyed by the timeframe
 * label the platform uses. Used to make the staleness threshold
 * timeframe-RELATIVE instead of deriving it from a possibly-mixed array.
 *
 * Why this is needed (2026-09-10): the threshold below is `medianInterval * 3`,
 * computed over whatever bars the caller passed. When a caller hands in a MIXED
 * timeframe array (a protocol loading `1d` bars for its directives while the
 * market-status check saw `1m`/`5m`/`15m` too), the median is meaningless — and
 * a perfectly fresh feed reads as closed. Measured live: `ftse-speed-v1` (a 1d
 * protocol) was told "last real bar 4m old (market closed)" while its newest 5m
 * bar was 8 minutes old, i.e. entirely fresh. The same symbol alternated
 * between "highly liquid 94/100" and "Market closed" seconds apart, and
 * `spy-day-v1` / `qqq-day-v1` were gated shut on EVERY tick in a 45-minute
 * window. Bar ages observed tripping the false close were 4m, 17m and 18m —
 * 17m and 18m being ordinary mid-formation states for a 15m bar.
 *
 * ⚠️ THE CADENCE TABLE THAT USED TO LIVE HERE IS GONE (2026-09-15).
 *
 * It was a verbatim copy of `barLengthMs()` minus `1w`, so `1w` resolved to `undefined` here
 * while the owner returned 604800000. Two tables, one concept.
 *
 * The fix uses `barLengthMsOrUndefined()` — NOT `barLengthMs()` — because the `undefined` is
 * load-bearing: the fail-closed branch tests `!declaredCadenceMs` to detect an unmeasurable feed.
 * `barLengthMs()` always returns a number (defaulting to daily), which would have made that
 * branch unreachable and let a dead feed read as OPEN. Same owner, strict variant.
 * The import is at the top of this file with the others.
 */

/**
 * Hard floor for the staleness window, so a very short cadence (1m, or a
 * degenerate median from a sparse array) cannot declare a market closed simply
 * because one bar has not yet formed. A market that produced a bar 20 minutes
 * ago is producing data; 20 minutes is not staleness on any timeframe the
 * platform scores.
 */
const MIN_STALE_WINDOW_MS = 20 * 60_000;

/**
 * Grace added to the expected cadence to absorb a bar still in formation plus
 * ordinary bridge/clock slop. A 15m bar is legitimately up to ~15m old the
 * moment after it opens, so a 1x window would flap.
 *
 * ⚠️ It is an ADDITIVE allowance, not a multiple (reworked 2026-09-10). A
 * multiplier looks harmless but scales with the cadence, and on a daily feed it
 * silently doubles the window: 2 × 1d = 2 days, so a daily feed with NO bar for
 * two whole days would read `open`. Forgiving a bar that is still forming needs
 * a fixed allowance, not a proportional one — a 1d bar is `2 × cadence` old
 * only if it opens and the market then does nothing for a further 24h, which is
 * precisely the staleness this gate exists to catch.
 */
const CADENCE_GRACE_MS = 15 * 60_000;

/**
 * How far in the FUTURE a bar may be stamped before we call it clock skew.
 * Bars are stamped at bar-OPEN time (the in-progress 5m bar is stamped up to
 * 5m in the past, never ahead) and synthetic placeholders are stamped `now`,
 * so a legitimate future stamp is only ever seconds away. 10 minutes therefore
 * absorbs ordinary clock slop while still tripping on any real timezone error
 * (the #750 regression was +3h; a winter/summer mix-up is 1h).
 */
const FUTURE_BAR_TOLERANCE_MS = 10 * 60_000;

export function computeMarketStatus(
  bars: MarketBar[],
  referenceTime = new Date(),
  /**
   * The cadence these bars are supposed to be on (e.g. '5m', '1d'). When known,
   * the staleness window is derived from THIS rather than from the array, so a
   * mixed-timeframe array cannot make a fresh feed read as closed (2026-09-10).
   * Omit it and the window falls back to the measured median, as before.
   */
  timeframe?: string,
): MarketStatus {
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
  //
  // EXCEPT when the caller told us the cadence explicitly — then the window does
  // not depend on measuring intervals at all, so an unmeasurable median is not a
  // reason to veto. This keeps fail-closed for callers that gave us nothing while
  // not punishing a caller that gave us the timeframe (2026-09-10).
  const declaredCadenceMs = barLengthMsOrUndefined(timeframe);
  if (!declaredCadenceMs && medianInterval <= 0) {
    return {
      open: false,
      asOf,
      reason: 'indeterminate bar cadence (no positive interval between trailing bars) — freshness unverifiable',
    };
  }

  // ⚠️ TIMEFRAME-RELATIVE STALENESS WINDOW (reworked 2026-09-10, and again the
  // same day — the first rework was too tight for 1h and 4h, see point 4).
  //
  // The window is `2 × cadence + grace`, floored at MIN_STALE_WINDOW_MS.
  //
  //  1. MIXED ARRAYS. The old window was `medianInterval * 3` over whatever bars
  //     were passed. A protocol loading `1d` bars while the caller's array also
  //     held `1m`/`5m`/`15m` produced a meaningless median, so a FRESH feed read
  //     as closed. Preferring the DECLARED cadence makes the window independent
  //     of what happens to be in the array.
  //
  //  2. MID-FORMATION BARS. A 15m bar is legitimately up to 15m old the moment
  //     after it opens, so a tight window flapped.
  //
  //  3. FALSE CLOSE ON LIVE DATA. Measured failing bar ages were 4m, 17m and
  //     18m on live markets with fresh 5m/15m bars.
  //
  //  4. ⚠️ BARS ARE STAMPED AT BAR-**OPEN** — this is why the window is 2× the
  //     cadence, not 1× + grace. A 1h bar stamped 19:00 COVERS 19:00–20:00, so at
  //     20:38 it is 98 minutes old **and is still the current bar**. The first
  //     rework used `cadence + 15m` = 75m, so that legitimately-current bar read
  //     CLOSED.
  //
  //     Measured live on a Trading Thursday evening with XAUUSD actively trading
  //     (its 5m bar was 3 minutes old):
  //
  //       tf   newest bar   age    cadence  1x+grace  2x+grace   verdict
  //       5m   20:35         3m      5m        20m       25m       OPEN  ✓
  //       1m   19:59        39m      1m        20m       20m       OPEN  ✓
  //       15m  19:45        53m     15m        30m       45m       closed ✗ ← should be open
  //       1h   19:00        98m     60m        75m      135m       closed ✗ ← should be open
  //       4h   17:30       188m    240m       255m      495m       OPEN  ✓
  //
  //     The 15m case is the tighter proof: a 15m bar stamped 19:45 covers
  //     19:45–20:00, and it was being read at 20:38 as "market closed" — 8 minutes
  //     after that bar's window ENDED, which is one normal refresh cycle away from
  //     the next bar. Both `xau-speed-m15` and `xau-speed-1h` were buried in the
  //     Ladder's ordering as a direct result (a `frozen` card sorts below a live
  //     one), so the HIGHEST-scoring card on the page — `xau-speed-1h` at
  //     composite 185 — never appeared at the top.
  //
  //     `2 × cadence` allows a bar to be up to one full window old while still
  //     being the current one, which is the honest bound for open-stamped bars.
  //
  // Fail-closed is preserved where it matters: a genuinely dead feed (weekend,
  // frozen bridge — the BTCUSD 7-week freeze, the #750 clock skew) still ages
  // far beyond `2 × cadence + 15m`. On a daily cadence the window is 48h15m, and
  // on a weekly-ish freeze the age is in weeks.
  const effectiveCadenceMs = Math.max(declaredCadenceMs ?? 0, medianInterval);
  const staleWindowMs = Math.max(
    effectiveCadenceMs * 2 + CADENCE_GRACE_MS,
    MIN_STALE_WINDOW_MS,
  );

  if (ageMs > staleWindowMs) {
    return {
      open: false,
      asOf,
      reason: `last real bar ${Math.round(ageMs / 60000)}m old (market closed or data stale)`,
    };
  }

  return { open: true, asOf };
}
