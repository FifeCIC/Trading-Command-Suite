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
 * THE canonical cadence→duration table. Single source for the whole application.
 *
 * ⚠️ DO NOT ADD A SECOND COPY OF THIS TABLE. "How long is a 1h bar?" had FOUR independent
 * answers before 2026-09-15 — here, in `directives/market-status.ts`, as a derived parser in
 * `scoring/outcome-tracker.service.ts`, and in `scripts/contract-probe.cjs`. They agreed on the
 * seven common lowercase cadences and DIVERGED on everything else, measured:
 *
 *     tf     this table    market-status   outcome-tracker
 *     1w     604800000     undefined       3600000   (1h — 168x too small)
 *     '1M'   86400000      undefined       60000     (1min — 1440x too small)
 *
 * Guarded at build time by `nest/scripts/validate-timeframe-sources.cjs`. Import `barLengthMs()`
 * (or `barLengthMsOrUndefined()` when "unknown" must stay distinguishable) — never a local map.
 *
 * ⚠️ KEYS ARE CASE-SENSITIVE, DELIBERATELY. `'1M'` is NOT `'1m'`. Do not make this lookup
 * case-insensitive: an uppercase string reaching here is a BUG upstream (the frontend has
 * `['1M','5M','15M','1H']` display arrays), and silently reading `'1M'` as one minute would hide
 * it. Falling back to daily is visible; accepting it would not be.
 */
export const BAR_LENGTH_MS: Record<string, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

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
  return BAR_LENGTH_MS[timeframe] ?? 86_400_000;
}

/**
 * The same lookup, but `undefined` for an unrecognised cadence instead of a daily default.
 *
 * ⚠️ WHY THIS EXISTS — the difference is LOAD-BEARING, not a convenience.
 *
 * `computeMarketStatus()` uses "no declared cadence" to decide whether it can measure staleness
 * at all, and FAILS CLOSED when it cannot:
 *
 *     if (!declaredCadenceMs && medianInterval <= 0) return { open: false, reason: 'indeterminate…' }
 *
 * If that call site used `barLengthMs()` it would always receive a number, the fail-closed branch
 * would become unreachable, and an unmeasurable feed would silently read as OPEN. Returning
 * `undefined` here is what keeps that guard alive — so do NOT "simplify" callers onto
 * `barLengthMs()` without checking whether they depend on the absence.
 */
export function barLengthMsOrUndefined(timeframe: string | null | undefined): number | undefined {
  if (!timeframe) return undefined;
  return BAR_LENGTH_MS[timeframe];
}

/**
 * How old the NEWEST bar of a cadence may be before that cadence's data is treated as STALE.
 *
 * ⚠️ THIS IS NOT A BAR LENGTH, AND THE DISTINCTION IS THE WHOLE POINT.
 *
 * `BAR_LENGTH_MS` answers "how long is one bar?" (`1m` = 60s). This answers "how long may the
 * newest bar be before I stop trusting the series?" (`1m` = 1h — 60x larger). They are different
 * questions with different answers. Conflating them would either reject every live feed (if the
 * tolerance were one bar length) or accept months-old data (if it were too generous).
 *
 * Each value allows for the cadence's NATURAL gap plus scheduling slack — a quiet market, a
 * weekend, a slow refresh — while still catching a feed that has actually stopped:
 *
 *     cadence   tolerance   why
 *     1m        1h          an equity's overnight break is ~17h, so this rejects only a dead feed
 *     5m        2h
 *     15m       4h
 *     1h        12h
 *     4h        24h
 *     1d        72h         exactly Fri 21:00 -> Mon 21:00, the real weekend gap for mt5 dailies
 *
 * ⚠️ MEASURED 2026-09-15 against all 456 live (symbol, timeframe) pairs: the rejected pairs showed
 * 18 under 1 day, **ZERO in the 1-3 day band**, and 233 at 3-60 days, while the freshest KEPT pairs
 * sat at 77% of tolerance. A threshold that lands in an EMPTY GAP between two clear populations is
 * set correctly; a threshold inside a distribution is not. If you change these numbers, re-check
 * that gap — see the note on `isStaleForCadence` below for why the borderline cases are harmless.
 *
 * ⚠️ SINGLE OWNER (moved here 2026-09-16). This table lived as `TF_STALE_MS`, a LOCAL constant
 * inside `bar-refresh.service.ts`, and `barLengthMs()`'s own doc comment referred to it by name —
 * a cross-file reference to a local, which is how a second copy starts. It now has TWO consumers
 * that must never disagree:
 *
 *   - `bar-refresh.service.ts` — should the ingest try another broker, and is the winner usable?
 *     (#838). Persisting a stale set is permanent, because the upsert keys on timestamp so a later
 *     fetch cannot overwrite it.
 *   - `signal-envelope.service.ts` — should this symbol be SCORED at all? (#827). A stale symbol
 *     has no current market state to judge; scoring it stamps a prediction with a months-old date,
 *     which then sorts to the FRONT of the maturation queue (`orderBy: predictedAt ASC`) and is
 *     consumed in preference to real rows.
 *
 * Guarded by `nest/scripts/validate-timeframe-sources.cjs`.
 */
export const CADENCE_STALE_MS: Record<string, number> = {
  '1m': 1 * 3_600_000,
  '5m': 2 * 3_600_000,
  '15m': 4 * 3_600_000,
  '1h': 12 * 3_600_000,
  '4h': 24 * 3_600_000,
  '1d': 72 * 3_600_000,
};

/** Tolerance applied to a cadence with no declared value — daily, the coarsest entry above. */
export const DEFAULT_CADENCE_STALE_MS = 24 * 3_600_000;

/** The tolerance for this cadence, falling back to {@link DEFAULT_CADENCE_STALE_MS}. */
export function cadenceStaleMs(timeframe: string): number {
  return CADENCE_STALE_MS[timeframe] ?? DEFAULT_CADENCE_STALE_MS;
}

/**
 * Is the newest bar of this cadence too old to trust?
 *
 * ⚠️ REJECTION IS ALWAYS HARMLESS — IT ONLY DECLINES, NEVER DELETES.
 *
 * This is what makes the borderline cases safe rather than lucky. A stale set's bars are almost
 * always ALREADY STORED, so refusing to write (ingest) or refusing to score (envelope) loses
 * nothing; and a genuinely fresh feed is never older than its tolerance, so it always proceeds.
 * The asymmetry matters: being slightly too strict costs a redundant skip, while being too loose
 * persists an unoverwritable stale row or scores a market that is not there.
 *
 * ⚠️ VERIFIED IN BOTH DIRECTIONS, not just the passing one — the same discipline the ingest guard
 * needed (#838). These thresholds were checked to REJECT a dead feed and to ACCEPT a legitimate
 * weekend boundary, because a threshold only confirmed to "not fire" has not been tested at all.
 *
 * ⚠️ CASE-SENSITIVE, matching `BAR_LENGTH_MS`. `'1M'` is month, `'1m'` is minute; an uppercase
 * cadence arriving here is an upstream bug and falls back to daily, which is visible.
 *
 * @param newest    Newest bar timestamp of the set (Date | ISO string | epoch ms).
 * @param timeframe Declared cadence, e.g. '15m', '1h', '1d'.
 * @param now       Current time, injectable so tests do not depend on the wall clock.
 */
export function isStaleForCadence(
  newest: unknown,
  timeframe: string,
  now: number = Date.now(),
): boolean {
  const ms = new Date(newest as any).getTime();
  // An unparseable timestamp is a DIFFERENT fault and must not be reported as staleness —
  // the caller needs to distinguish "old" from "malformed", the same way
  // `isBarFutureStamped` returns false for a malformed value rather than absorbing it.
  if (Number.isNaN(ms)) return false;
  return now - ms > cadenceStaleMs(timeframe);
}

/**
 * Is this SYMBOL dead — i.e. is every one of its cadences stale?
 *
 * ⚠️ THIS IS THE RULE THAT MATTERS, AND THE OBVIOUS ALTERNATIVE IS WRONG.
 *
 * "Is the base cadence stale?" is NOT the same question, and answering that one instead was
 * measured to skip **11 symbols that were all ALIVE** (#827): SPY, QQQ, US500, USTEC, XAUUSD,
 * XAGUSD, UK100, GER40, FRA40, CHINA50, VIX. Their `1m` feeds were 4-12 hours quiet while their
 * `5m`/`15m` feeds were MINUTES old:
 *
 *     SPY    1m=12h   5m=0.1h   15m=12h  1h=4.7h  1d=35h   <- 1m stale, symbol trading
 *     XAUUSD 1m=8.6h  5m=0.0h   15m=0.0h  1h=0.7h  1d=11h   <- 1m stale, symbol trading
 *
 * A `1m` feed goes quiet whenever the market is closed or the session is thin — the `1m` tolerance
 * is 1h, while a US equity's overnight gap is ~17h — so a base-cadence-only test removes the core
 * instruments from the ladder outside cash hours. **That is a far worse failure than the one it
 * fixes**, and it is invisible: the symbol simply stops appearing.
 *
 * A genuinely dead symbol is stale on EVERY cadence. Measured: the 17 July cohort (TSLA, COIN,
 * PLTR, SOFI, RKLB, RIOT, MARA, ASTS, HOOD…) had `1h` ending 31 July and `1d` ending 21 July —
 * every cadence stale, correctly rejected.
 *
 * ⚠️ EMPTY INPUT IS NOT DEAD. `false` here, because "I have no cadences to judge" is a different
 * condition from "I judged them and they are all stale" — the caller already handles an empty
 * marketBars array separately, and conflating the two would skip a symbol for a loading fault.
 *
 * @param sets Every cadence available for the symbol, with its newest bar timestamp.
 * @param now  Current time, injectable for tests.
 */
export function everyCadenceStale(
  sets: Array<{ timeframe: string; newest: unknown }>,
  now: number = Date.now(),
): boolean {
  if (sets.length === 0) return false;
  return sets.every((s) => isStaleForCadence(s.newest, s.timeframe, now));
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
