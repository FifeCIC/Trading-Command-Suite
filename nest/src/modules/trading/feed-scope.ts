/**
 * feed-scope.ts — THE one decision "may this bot trade THIS symbol?" (#1314).
 *
 * BEFORE: `SignalQueueService.syncQueues()` answered that with one line —
 *   `if (sub.strategySymbol && sub.strategySymbol !== rec.symbol) continue;`
 * so a bot was permanently pinned to exactly one instrument. A movers strategy is the opposite:
 * its instrument is whichever ticker is at the top of today's winners or losers list.
 *
 * AFTER: `scopeVerdict()` answers it, and there are TWO scopes.
 *   - `fixed` — unchanged: the bot trades `trading_strategy.symbol`.
 *   - `feed`  — the bot trades whatever is on today's list named by `trading_strategy.feedList`,
 *               and `symbol` is a placeholder that this function IGNORES.
 *
 * ⚠️ WHY THIS IS A PURE FUNCTION AND NOT A PRISMA QUERY: the answer gates whether an order can be
 * dispatched. It has to be exercisable without a database, a feed, or a running API, so both
 * directions of every rule can be canaried (see `feed-scope.spec.ts`).
 *
 * ⚠️ REFUSAL IS THE DEFAULT, DELIBERATELY. Every unknown — an unrecognised `scopeMode`, a missing
 * feed, a `feed` bot with no `feedList` — REFUSES and names why. The failure this defends against is
 * a feed-scoped bot quietly degrading into "trade everything the protocol scored", which would look
 * like the strategy working while it took positions nobody selected. A refusal is reported; a silent
 * widening is not.
 */

export type ScopeMode = 'fixed' | 'feed';

/** Which movers list a `feed`-scoped bot draws from. */
export type FeedList = 'winners' | 'losers';

export type ScopeRefusalCode =
  | 'scope-symbol-mismatch'
  | 'scope-mode-unknown'
  | 'feed-unavailable'
  | 'feed-entry-not-allowed'
  | 'feed-list-unspecified'
  | 'feed-list-empty'
  | 'not-on-todays-list';

export type ScopeVerdict =
  | { allowed: true }
  | { allowed: false; code: ScopeRefusalCode; reason: string };

/**
 * The subset of `MarketMovers` this decision needs.
 *
 * ⚠️ `stale` and `delayed` are intentionally NOT read here. `entryAllowed` already folds both of
 * them in (`MarketMoversService.entryGate()`, thresholds `movers.maxAgeMinutes` /
 * `movers.maxDelayMinutes`). Re-deriving staleness from the raw flags would make a SECOND source of
 * truth for one fact, and the two would eventually disagree — the banner would say "fine" while
 * routing said "stale", or worse, the reverse.
 */
export interface FeedSnapshot {
  entryAllowed: boolean;
  entryRefusalReason: string | null;
  winners: ReadonlyArray<{ ticker: string }>;
  losers: ReadonlyArray<{ ticker: string }>;
}

export interface ScopeInput {
  /** `trading_strategy.scopeMode`. Null/undefined means a row that predates #1314. */
  scopeMode: string | null | undefined;
  /** `trading_strategy.feedList`. Only meaningful when `scopeMode === 'feed'`. */
  feedList: string | null | undefined;
  /** `trading_strategy.symbol` — the fixed instrument, or the placeholder for a feed-scoped bot. */
  strategySymbol: string | null | undefined;
  /** The symbol the protocol actually signalled on. */
  candidateSymbol: string;
  /** Today's movers payload, or null when it could not be fetched. */
  feed: FeedSnapshot | null;
}

/**
 * Narrowing predicate for `trading_strategy.feedList`, which is a free-form `varchar` — the column
 * does not enforce the union. Exported so readers that must hand a typed value onward (e.g. the
 * `findAll()` mapper) use THIS test rather than a second copy that would drift.
 */
export function isFeedList(v: string | null | undefined): v is FeedList {
  return v === 'winners' || v === 'losers';
}

/** Case/whitespace-insensitive ticker comparison — a feed returns `AAPL`, the DB may hold `aapl`. */
function sameTicker(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/**
 * The decision. Called once per (bot, signal) pair by `syncQueues()`.
 *
 * @returns `{ allowed: true }`, or `{ allowed: false, code, reason }` where `code` is a MACHINE
 *   token for counters and `reason` is the human line for the log. There is no "probably" — a
 *   caller that receives `allowed: false` must not send the signal.
 */
export function scopeVerdict(input: ScopeInput): ScopeVerdict {
  const mode = (input.scopeMode ?? 'fixed').trim();

  if (mode === 'fixed') {
    // Preserved EXACTLY from the pre-#1314 line: an empty `symbol` meant "no symbol filter", so
    // that stays true. Only a non-empty symbol pins the bot.
    const pinned = (input.strategySymbol ?? '').trim();
    if (pinned && !sameTicker(pinned, input.candidateSymbol)) {
      return {
        allowed: false,
        code: 'scope-symbol-mismatch',
        reason: `bot is pinned to ${pinned}, signal is for ${input.candidateSymbol}`,
      };
    }
    return { allowed: true };
  }

  if (mode !== 'feed') {
    // An unrecognised value is NOT treated as `fixed` and NOT as `feed`. Treating it as `fixed`
    // would dispatch on a placeholder; treating it as `feed` would trade a list nobody chose.
    return {
      allowed: false,
      code: 'scope-mode-unknown',
      reason: `scopeMode '${mode}' is not one of 'fixed' | 'feed' — refusing rather than guessing`,
    };
  }

  // ── scopeMode === 'feed' ──
  if (!isFeedList(input.feedList)) {
    return {
      allowed: false,
      code: 'feed-list-unspecified',
      reason:
        `feed-scoped bot has feedList=${input.feedList === null || input.feedList === undefined ? 'NULL' : `'${input.feedList}'`}` +
        ` — expected 'winners' or 'losers'`,
    };
  }

  if (!input.feed) {
    return {
      allowed: false,
      code: 'feed-unavailable',
      reason: 'movers feed could not be read — refusing rather than trading a stale placeholder',
    };
  }

  if (!input.feed.entryAllowed) {
    // The feed's own verdict on itself, carried through unchanged so the log line and the banner
    // cannot say different things.
    return {
      allowed: false,
      code: 'feed-entry-not-allowed',
      reason: input.feed.entryRefusalReason ?? 'feed reports entryAllowed=false with no reason given',
    };
  }

  const list = input.feedList === 'winners' ? input.feed.winners : input.feed.losers;
  if (!list || list.length === 0) {
    return {
      allowed: false,
      code: 'feed-list-empty',
      reason: `today's ${input.feedList} list is empty`,
    };
  }

  if (!list.some(r => sameTicker(r.ticker, input.candidateSymbol))) {
    return {
      allowed: false,
      code: 'not-on-todays-list',
      reason: `${input.candidateSymbol} is not on today's ${input.feedList} list (${list.length} tickers)`,
    };
  }

  return { allowed: true };
}
