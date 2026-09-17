/**
 * signal-direction.ts — THE single authority on what a signal class MEANS.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (measured 2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Several call sites decided direction with `signal.startsWith('SELL')`:
 *
 *     'BUY'.startsWith('SELL')          -> false  -> LONG    ok
 *     'STRONG_BUY'.startsWith('SELL')   -> false  -> LONG    ok
 *     'SELL'.startsWith('SELL')         -> true   -> SHORT   ok
 *     'STRONG_SELL'.startsWith('SELL')  -> false  -> LONG    ❌ INVERTED
 *
 * `'STRONG_SELL'` starts with `STRONG`, not with `SELL`. So **every STRONG_SELL — the highest
 * conviction bearish signal in the system — was routed as a LONG/BUY.** Observed live: the signal
 * ladder reported VIX at `STRONG_SELL` (composite 230, `preTradeReady: true`, no blockers) while
 * `strategy_signal_queue` held `direction=LONG, signal=BUY` for the bot named
 * "VIX Spike Short (demo proof #772)". The execution path reads direction off the QUEUE, so that
 * pending row would have placed a BUY on a sell signal.
 *
 * The same predicate also broke the ladder's own buy/sell counters: `STRONG_SELL` matched neither
 * `startsWith('SELL')` nor `startsWith('BUY')`, so it was counted as neither.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE RULE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Signal classes are `BUY | STRONG_BUY | SELL | STRONG_SELL | HOLD`. **Classify by the WHOLE token,
 * never by prefix.** A prefix test cannot distinguish `SELL` from `STRONG_SELL` for the same reason
 * it cannot distinguish `BUY` from `STRONG_BUY` — the strength qualifier comes first.
 *
 * ⚠️ `classifySignal()` is TOTAL and never throws, so a caller can always branch. It returns
 * `'unknown'` rather than guessing — because silently defaulting an unrecognised class to `long` is
 * precisely how the inversion above stayed hidden. A new signal class must fail loudly, not become
 * a BUY.
 *
 * ⚠️ `signalToDirection` / `signalToSide` return `null` for hold/unknown. Callers must handle it.
 * Returning 'LONG' by default would re-create this bug in a new shape.
 *
 * Related: #714 (queue routing), #820 (long-only population), #850 (VIX never queued).
 */

/** What a signal class means, reduced to the only three answers a caller needs. */
export type SignalClass = 'buy' | 'sell' | 'hold' | 'unknown';

/**
 * Classify a signal class token. TOTAL — never throws, never guesses.
 *
 * Accepts the canonical `BUY | STRONG_BUY | SELL | STRONG_SELL | HOLD` plus the direction words
 * (`LONG` / `SHORT` / `NEUTRAL`) because both are used across the codebase.
 */
export function classifySignal(signal: unknown): SignalClass {
  const s = String(signal ?? '').trim().toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY' || s === 'LONG') return 'buy';
  if (s === 'SELL' || s === 'STRONG_SELL' || s === 'SHORT') return 'sell';
  if (s === 'HOLD' || s === 'NEUTRAL' || s === '') return 'hold';
  return 'unknown';
}

export function isSellSignal(signal: unknown): boolean {
  return classifySignal(signal) === 'sell';
}

export function isBuySignal(signal: unknown): boolean {
  return classifySignal(signal) === 'buy';
}

/** Canonical queue/record direction. `null` for hold/unknown — the caller decides. */
export function signalToDirection(signal: unknown): 'LONG' | 'SHORT' | null {
  const c = classifySignal(signal);
  if (c === 'buy') return 'LONG';
  if (c === 'sell') return 'SHORT';
  return null;
}

/** Canonical broker side. `null` for hold/unknown — the caller decides. */
export function signalToSide(signal: unknown): 'BUY' | 'SELL' | null {
  const c = classifySignal(signal);
  if (c === 'buy') return 'BUY';
  if (c === 'sell') return 'SELL';
  return null;
}

/**
 * Broker side for a queue/record direction.
 *
 * ⚠️ Unknown direction → `'BUY'`? NO. It returns `null`. The execution path previously wrote
 * `direction === 'SHORT' ? 'SELL' : 'BUY'`, so ANY unrecognised direction became a buy — the same
 * silent-default failure mode as the prefix test. Uses `classifySignal` so `'short'`, `'SHORT'`
 * and `'sell'` all resolve consistently.
 */
export function directionToSide(direction: unknown): 'BUY' | 'SELL' | null {
  const c = classifySignal(direction);
  if (c === 'buy') return 'BUY';
  if (c === 'sell') return 'SELL';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// DIRECTION PERMISSION — which way a bot is allowed to trade
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** A bot's direction permission for one subscription. `null` = unconstrained. */
export type DirectionRole = 'long' | 'short' | 'both' | null;

/**
 * Resolve the effective direction permission for ONE subscription.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE FUNCTION (measured 2026-09-17)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Two fields described the same thing and NEITHER was enforced:
 *
 *   - `strategy_protocol.role` — read by nothing. The routing query did not even SELECT it.
 *   - `trading_strategy.requireDirection` — read only by the retired legacy path.
 *
 * Measured: 24 subscriptions `role='long'`, **1** `role='short'` (the VIX bot), and exactly one bot
 * with `requireDirection` set (also the VIX bot, value `SELL`). So the ONLY bot configured to sell
 * had two direction fields, neither read, and the routing filter matched on protocol + symbol only.
 *
 * **Precedence, stated ONCE and implemented here only:** the subscription's `role` is authoritative
 * because it is per-subscription (a bot may be long on one protocol and short on another, which is
 * the whole point of multi-protocol subscriptions). `requireDirection` is the BOT-LEVEL fallback,
 * used only when the subscription does not say. Specific beats general.
 */
export function resolveEffectiveRole(
  subscriptionRole: unknown,
  botRequireDirection: unknown,
): DirectionRole {
  const fromRole = String(subscriptionRole ?? '').trim().toLowerCase();
  if (fromRole === 'long' || fromRole === 'buy') return 'long';
  if (fromRole === 'short' || fromRole === 'sell') return 'short';
  if (fromRole === 'both' || fromRole === 'any' || fromRole === 'all') return 'both';

  // Subscription said nothing usable → fall back to the bot-level declaration.
  const c = classifySignal(botRequireDirection);
  if (c === 'buy') return 'long';
  if (c === 'sell') return 'short';
  return null; // unconstrained
}

/**
 * May this permission take this direction?
 *
 * ⚠️ `null` (unconstrained) allows BOTH directions — that is the documented meaning of "not
 * configured", and it is why a missing `role` must not silently mean "long only".
 */
export function directionAllowed(effectiveRole: DirectionRole, direction: unknown): boolean {
  if (effectiveRole === null || effectiveRole === 'both') return true;
  const c = classifySignal(direction);
  if (c === 'buy') return effectiveRole === 'long';
  if (c === 'sell') return effectiveRole === 'short';
  // A direction we cannot classify is not permitted by a CONSTRAINED role. An unconstrained role
  // returned above, so reaching here means the role was specific and the direction is unreadable —
  // refusing is the safe answer (the alternative is a wrong-side trade).
  return false;
}

