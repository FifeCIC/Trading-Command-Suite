/**
 * Timeframe helpers — the ONE mapping from free-text protocol guidance to a cadence.
 * =================================================================================
 * ⚠️ CONTRACT FILE — `selectBaseTimeframe()` is the ONE mapping from a protocol's free-text
 * `recommendedTimeframe` to a cadence that exists in `marketbar`. It was previously
 * module-private in `signal-envelope.service.ts`; that privacy is why two other callers
 * hand-rolled bar queries and lost the filter (INV-SINGLE-CADENCE). If you need a cadence,
 * import this — do not add a second parser anywhere. Guarded at build time by
 * `nest/scripts/validate-pipeline-contracts.cjs` (canary INV-SINGLE-CADENCE).
 *
 * WHY THIS IS SHARED (#751, 2026-09-10)
 * -------------------------------------
 * Protocols declare `recommendedTimeframe` as **free text** — real examples from the
 * seed data: `'5s–30s'`, `'5m–1h'`, `'15m–1d'`, `'1d–4h'`, `'1d (signal), 1h/15m'`,
 * `'1m–5m'`, and `null`. Everything that loads bars, however, needs a single cadence
 * that actually exists in the `marketbar.timeframe` column.
 *
 * This mapping started life as a module-private function in
 * `signals/signal-envelope.service.ts`. Two callers (the Arena and the scoring path)
 * did not have access to it, so they hand-rolled their own bar queries — and both lost
 * the `timeframe` filter entirely, splicing mixed cadences into one array. A mixed
 * array silently changes what every window means: RSI(14) is 70 minutes on 5m bars but
 * 14 days on daily bars, and `computeMarketStatus` derives its staleness threshold from
 * the array's own cadence. No error, just plausible wrong numbers.
 *
 * So: resolve the cadence here, then load with `MarketDataService.getBars(symbolId,
 * cadence, count)` — the canonical loader that also guarantees oldest → newest order.
 *
 * PRE-EXISTING BEHAVIOUR IS PRESERVED VERBATIM — the regex order below decides the
 * result for overlapping strings (finest cadence mentioned wins, so `'5m–1h'` → `5m`),
 * and `timeframe.spec.ts` pins the whole table. If you change a rule, change the test
 * with it.
 */

/** Map free-text protocol guidance to the finest supported primary cadence. */
export function selectBaseTimeframe(recommended?: string | null): string {
  const value = (recommended ?? '').toLowerCase();
  if (/\b(5s|30s|1m)\b/.test(value)) return '1m';
  if (/\b5m\b/.test(value)) return '5m';
  if (/\b15m\b/.test(value)) return '15m';
  if (/\b1h\b/.test(value)) return '1h';
  if (/\b4h\b/.test(value)) return '4h';
  return '1d';
}

/**
 * The cadence used when a symbol has no bars at the requested cadence and is not
 * covered by a protocol recommendation — the application's live base cadence
 * (`automation-loop.service.ts` scores on 5m).
 *
 * Callers should still fall back to the cadence the symbol actually HAS before giving
 * up: equity symbols are daily-only in `marketbar`, so asking for 5m returns nothing.
 */
export const DEFAULT_LIVE_TIMEFRAME = '5m';

/**
 * Duration of one bar of this cadence, in milliseconds. Unknown cadences are treated as
 * daily, matching `TF_STALE_MS`'s own default in `bar-refresh.service.ts`.
 *
 * ⚠️ A BAR IS STAMPED BY ITS **OPEN** TIME. So the currently-forming bar is legitimately
 * *ahead* of the wall clock by up to one bar length:
 *
 *     forming 15m bar opens 19:15 while the clock reads 19:02  ->  +13min : correct
 *     forming  1m bar opens 19:02 while the clock reads 19:01  ->  +1 min : correct
 *
 * This is why "is this timestamp in the future?" is the WRONG question, and why
 * `INV-NO-FUTURE-ROWS` originally failed on healthy data (#780). The right question is
 * `isBarBeyondItsOwnLength()` below.
 */
export function barLengthMs(timeframe: string): number {
  return {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
  }[timeframe] ?? 86_400_000;
}

/**
 * Tolerance for clock jitter between the bar's source host and this host, before an
 * over-length lead is treated as impossible rather than merely borderline.
 */
export const BAR_LEAD_TOLERANCE_MS = 120_000;

/**
 * Would this bar timestamp be impossible for its own cadence?
 *
 * True when the timestamp leads `now` by more than one bar length plus a jitter
 * tolerance. Such a row cannot be a real closed OR forming bar, so it must never be
 * persisted — and the reason is worse than "it looks odd":
 *
 *   The upsert only touches rows it just fetched (`ON DUPLICATE KEY UPDATE`), and a
 *   bridge never serves a future bar. So once an over-length row exists, **nothing can
 *   ever overwrite it**. It pins `MAX(timestamp)` for its symbol indefinitely, making the
 *   feed read as permanently future-dated and defeating every staleness check downstream.
 *
 * Measured live (#780): 226 such rows were written while the bridges were DOWN, pinning 17
 * symbols. They also propagated into `directiveoutcome` — `predictedAt` copies the
 * evaluated bar's open time — so one bad bar produced bad outcome rows too.
 *
 * Return false for a malformed timestamp: an unparseable value is a different fault and
 * must not be silently swallowed by this check.
 */
export function isBarBeyondItsOwnLength(
  timestamp: unknown,
  timeframe: string,
  now: number = Date.now(),
): boolean {
  const ms = new Date(timestamp as any).getTime();
  if (Number.isNaN(ms)) return false;
  return ms > now + barLengthMs(timeframe) + BAR_LEAD_TOLERANCE_MS;
}
