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
 * Is this bar timestamp AHEAD of now — i.e. impossible for open-stamped data?
 *
 * ⚠️ THE RULE IS "NOT IN THE FUTURE", NOT "NOT MORE THAN ONE BAR LENGTH AHEAD"
 *
 * A bar is stamped by the time its period **OPENED** (`alignBarTimestamp` floors, and
 * `market-status.ts` states the contract). A period that opens in the future cannot
 * have happened, **so no legitimate bar is ever stamped ahead of `now`** — not by a
 * minute, not by a second. The only permitted lead is `BAR_LEAD_TOLERANCE_MS`, which
 * absorbs clock jitter between the source host and this one.
 *
 * ⚠️ WHY THE OLD BOUND (one bar length + tolerance) WAS WRONG
 *
 * It was chosen on the reasoning that "a bar can't be more than one bar-length early",
 * which is true but far too loose to be safe. Measured 2026-09-15 (#832): MT5 served a
 * 4h bar stamped `20:00` while the current bucket was `16:00–20:00` — a lead of only
 * ~21–52 minutes, comfortably INSIDE the old bound, so this guard returned `false` and
 * the row was persisted. A test naming this case already existed
 * (`bar-refresh-alignment.spec.ts`: *"the raw 20:45 bar IS future-dated, and
 * `isBarBeyondItsOwnLength` cannot see it"*), and the chosen remedy — aligning `:45`
 * to `:00` — cannot help a bar that is ALREADY on a boundary.
 *
 * The consequence is the same one this guard was built for (#780), just smaller:
 * the row pins `MAX(timestamp)` ahead of now, so `computeMarketStatus()` fails closed
 * with *"data clock skew"* and the symbol reads as permanently untradeable. Live
 * evidence: `Gold Position 4H` (XAUUSD / `xau-speed-4h`) was blocked pre-trade on every
 * pass, and the row is unoverwritable because the upsert only touches rows it fetched.
 *
 * The duplicate is also redundant: `open[20:00]` was identical to `open[16:00]`, so the
 * 20:00 row re-described a bucket that a correct row already covered. Rejecting it loses
 * nothing.
 *
 * `dataIsOpenStamped` exists so a future close-stamped source can be admitted explicitly
 * rather than by silently loosening this bound for everything.
 *
 * Return false for a malformed timestamp: an unparseable value is a different fault and
 * must not be silently swallowed by this check.
 */
export function isBarFutureStamped(
  timestamp: unknown,
  now: number = Date.now(),
  /** Set false ONLY for a proven close-stamped source; see the note above. */
  dataIsOpenStamped = true,
): boolean {
  const ms = new Date(timestamp as any).getTime();
  if (Number.isNaN(ms)) return false;
  if (!dataIsOpenStamped) return false;
  return ms > now + BAR_LEAD_TOLERANCE_MS;
}

/**
 * @deprecated Superseded by {@link isBarFutureStamped} (#832).
 *
 * Kept ONLY so the historical `#780` specs still express what they were written to
 * assert. Its bound — one full bar length plus tolerance — is too loose to protect the
 * feed: a 4h bar stamped 21 minutes ahead passes it (measured, #832). New callers must
 * use `isBarFutureStamped`.
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

// ─── Bar alignment (INV-BAR-ALIGNED, #783) ───────────────────────────────────

/**
 * Bar boundaries for cadences that are NOT a clean division of the UTC day.
 *
 * Every intraday cadence up to `4h` divides evenly into 24h, so flooring against
 * the UTC epoch is correct for it. `1d` does not: the daily boundary is a
 * property of the **provider and the market**, not of UTC:
 *
 *   | boundary (UTC) | provider | meaning                                    |
 *   |----------------|----------|--------------------------------------------|
 *   | 21:00          | mt5      | CME/COMEX/FX daily close (17:00 ET)        |
 *   | 00:00          | binance  | crypto daily close, midnight UTC           |
 *   | 07:00          | yahoo    | some exchanges' local close                |
 *
 * ⚠️ A hardcoded "floor 1d to 21:00" is therefore WRONG for binance and yahoo — it
 * would shift every legitimate daily bar by three hours. `1d` is handled by
 * resolving the provider's own boundary from the series already stored (see
 * `resolveAlignmentBoundaryMs`), and only falls back to 21:00 for an unknown
 * provider because mt5 is the dominant source.
 *
 * Verified live before this was written: mt5 `1d` bars sit at 21:00 (2,885 rows)
 * and 21:30 (1,256 rows) — the 21:30 group is the #783 phantom, and 1,227 of those
 * 1,256 are byte-identical duplicates of the 21:00 bar.
 */
const DAILY_BOUNDARY_HOUR_UTC: Record<string, number> = {
  mt5: 21,
  binance: 0,
  yahoo: 7,
};

/** The default daily boundary (mt5/CME close) when a provider is unknown. */
const DEFAULT_DAILY_BOUNDARY_HOUR_UTC = 21;

/**
 * Floor a timestamp to its **bar-open** boundary for the given cadence and provider.
 *
 * WHY THIS EXISTS (#783)
 * ----------------------
 * `importBars()` previously stored `new Date(bar.timestamp)` **verbatim** and relied
 * solely on the unique key `(symbolId, timeframe, timestamp)` for deduplication. A
 * bulk re-import that stamped a bar 30 minutes differently (`13:30` instead of the
 * real `13:00`) therefore created a **second row for the same period**: the
 * timestamps genuinely differ, so `P2002` never fired and the constraint could not
 * help. Measured result: ~27,376 phantom bars in a 266,890-row table (~10%), and a
 * **fake 30-minute median interval** on `1h`/`4h`/`1d` series — which then corrupted
 * `computeMarketStatus()`'s `effectiveCadenceMs` for every multi-hour timeframe.
 *
 * Flooring makes the constraint work again: `13:30` floors to `13:00`, collides with
 * the real bar, and is correctly skipped as a duplicate.
 *
 * ⚠️ A BAR IS STAMPED BY ITS **OPEN** TIME, so flooring (never rounding) is the only
 * correct direction. Rounding UP would move a bar into the next period and silently
 * rewrite history.
 *
 * @param timestamp  The raw bar timestamp (Date | ISO string | epoch ms).
 * @param timeframe  Declared cadence, e.g. '15m', '1h', '1d'.
 * @param provider   Data source, used only to resolve the `1d` boundary.
 * @returns A new Date floored to the boundary, or `null` if the input is unparseable
 *          (a malformed timestamp is a different fault — the caller must reject it,
 *          never silently coerce it to now or epoch 0).
 */
export function alignBarTimestamp(
  timestamp: unknown,
  timeframe: string,
  provider?: string,
): Date | null {
  // ⚠️ Guard the null-ish cases EXPLICITLY. `new Date(null).getTime()` is `0`, not
  // `NaN`, so a naive `Number.isNaN` check lets `null` through and it silently becomes
  // **epoch 0 (1970-01-01)** — a bar dated 1970 that looks like real data. Same for
  // `false` and `[]`. Only a non-empty string or a number/Date may be parsed.
  if (timestamp === null || timestamp === undefined || timestamp === '') return null;
  if (typeof timestamp !== 'string' && typeof timestamp !== 'number' && !(timestamp instanceof Date)) {
    return null;
  }
  if (typeof timestamp === 'string' && timestamp.trim() === '') return null;

  const ms = new Date(timestamp as any).getTime();
  if (Number.isNaN(ms)) return null;

  if (timeframe === '1d') {
    // Place the bar on the provider's own daily close boundary. We keep the
    // calendar DATE of the bar and snap the time-of-day to that boundary.
    const d = new Date(ms);
    const boundaryHour = DAILY_BOUNDARY_HOUR_UTC[(provider ?? '').toLowerCase()]
      ?? DEFAULT_DAILY_BOUNDARY_HOUR_UTC;
    const out = new Date(Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), boundaryHour, 0, 0, 0,
    ));
    // A bar stamped BEFORE its own boundary belongs to the PREVIOUS session:
    // e.g. an mt5 daily bar at 20:00 UTC is the close of the prior day, not a
    // new one. Pulling it back keeps one row per session instead of two.
    if (d.getTime() < out.getTime()) out.setUTCDate(out.getUTCDate() - 1);
    return out;
  }

  if (timeframe === '1w') {
    // Floor to Monday 00:00 UTC — ISO week start.
    const d = new Date(ms);
    const day = d.getUTCDay();               // 0 = Sunday
    const back = day === 0 ? 6 : day - 1;    // days since Monday
    return new Date(Date.UTC(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back, 0, 0, 0, 0,
    ));
  }

  const len = barLengthMs(timeframe);
  return new Date(Math.floor(ms / len) * len);
}

/** True when `timestamp` already sits exactly on its cadence boundary. */
export function isBarAligned(
  timestamp: unknown,
  timeframe: string,
  provider?: string,
): boolean {
  const aligned = alignBarTimestamp(timestamp, timeframe, provider);
  if (!aligned) return false;
  return aligned.getTime() === new Date(timestamp as any).getTime();
}
