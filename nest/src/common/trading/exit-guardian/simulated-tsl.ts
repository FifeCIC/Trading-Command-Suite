/**
 * simulated-tsl.ts — THE simulated-trailing-stop DECISION, once, for both paths.
 *
 * ── WHY THIS FILE EXISTS (2026-11-20) ───────────────────────────────────────────────────────────
 * The same two columns (`simTslActivationPct`, `simTslDistancePct`) were read by two implementations
 * that computed the same numbers for different purposes:
 *
 *   · `automation/stop-guardian.service.ts` — `observeSimulatedTsl()`: once the position is
 *     `activationPct` in front, track a trigger `distancePct` behind the best price, and **record**
 *     the moment. It moves nothing and closes nothing (`sim_tsl_event.action` is hardcoded
 *     `recorded`), deliberately: acting on it is a maths change (#936) that a copied configuration
 *     must earn first.
 *   · `backtest/backtest.service.ts` — `stopPlan`: the same trigger price, but the stop is **moved**
 *     to it and the trade exits there.
 *
 * The ARITHMETIC was identical and written twice, which is how the two drift. The STRENGTH differs,
 * and that difference is the more serious of the two findings — a run with `simTslEnabled` shows a
 * trailing stop protecting the trade, while live the mere decision point is recorded and the broker
 * stop does all the protecting. See `TRAIL_STRENGTH_NOTE`.
 *
 * ── WHAT THIS DOES AND DOES NOT DO ──────────────────────────────────────────────────────────────
 * It extracts the DECISION (state, trigger price, touched?) as a pure function. It does not decide
 * what a caller may DO with it, because that is the difference above and collapsing it would be the
 * maths change #936 is waiting on.
 *
 * Part of the #1242 extraction: portable, no Nest, no Prisma, no clock. `computeAtr`, `protectiveSl`
 * and the money-target decision follow the same route.
 */

export type TradeSide = 'buy' | 'sell';

/** The bot's trailing configuration, as stored. `null` on either means NOT CONFIGURED. */
export interface TrailConfig {
  activationPct?: number | null;
  distancePct?: number | null;
}

export interface SimTslInput {
  side: TradeSide;
  entryPrice: number;
  currentPrice: number;
  /** The best price seen so far, INCLUDING this one. `undefined` on the first observation. */
  bestSoFar?: number;
  config: TrailConfig;
}

export interface SimTslState {
  /** Favourable-direction move from entry, as a percentage. Never the broker's currency profit. */
  profitPct: number;
  /** The watermark after this observation — the caller stores it. */
  best: number;
  /** The price at which the trail is considered touched. */
  triggerPrice: number;
  /** TRUE when the position is far enough in front for the trail to be armed at all. */
  armed: boolean;
  /** TRUE when the current price has crossed the trigger. Only meaningful when `armed`. */
  touched: boolean;
}

const usable = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * The decision, or `null` when the configuration cannot express one.
 *
 * ⚠️ `null` IS NOT "no touch" — it is "not configured". Returning a state with `touched: false` for
 * a bot with a blank distance would arm a trail nobody set, and the first touch of it would look
 * like a decision the operator made.
 */
export function simulatedTslState(input: SimTslInput): SimTslState | null {
  const activationPct = input.config?.activationPct;
  const distancePct = input.config?.distancePct;
  if (!usable(activationPct) || !usable(distancePct)) return null;
  if (!usable(input.entryPrice)) return null;
  if (typeof input.currentPrice !== 'number' || !Number.isFinite(input.currentPrice)) return null;

  const isBuy = input.side === 'buy';

  // Favourable-direction profit, independent of the broker's own `profit` (which is currency and
  // already net of swap/commission, so it cannot be compared with a percentage threshold).
  const profitPct =
    ((isBuy ? input.currentPrice - input.entryPrice : input.entryPrice - input.currentPrice)
      / input.entryPrice) * 100;

  const previous = input.bestSoFar;
  const best = previous === undefined
    ? input.currentPrice
    : isBuy
      ? Math.max(previous, input.currentPrice)
      : Math.min(previous, input.currentPrice);

  const triggerPrice = trailTriggerPrice(isBuy ? 'buy' : 'sell', best, distancePct);
  const armed = profitPct >= activationPct;
  const touched = isBuy ? input.currentPrice <= triggerPrice : input.currentPrice >= triggerPrice;

  return { profitPct, best, triggerPrice, armed, touched };
}

/**
 * The trigger price itself: `distancePct` behind the best price for a buy, in front for a sell.
 *
 * ⚠️ EXPORTED SEPARATELY because the backtest needs the number without the `armed` gate — it only
 * moves a stop that is already in profit, which it tests itself. Both callers therefore share ONE
 * formula, which is the point: the duplicated expression is what drifts.
 */
export function trailTriggerPrice(side: TradeSide, bestPrice: number, distancePct: number): number {
  return side === 'buy'
    ? bestPrice * (1 - distancePct / 100)
    : bestPrice * (1 + distancePct / 100);
}

/**
 * ── THE STRENGTH DIFFERENCE, WRITTEN DOWN SO A RESULT CANNOT IMPLY MORE THAN LIVE DOES ─────────
 *
 * Live: `observeSimulatedTsl()` records the moment and touches nothing. The broker stop is the only
 * protection. Live: a run that applies `stopPlan` MOVES the stop to the trigger and exits there.
 *
 * ⇒ **A backtest of a `simTslEnabled` bot measures protection the bot does not have.** That is not a
 * bug in either half — it is the declared state of #936 awaiting a copied configuration and a
 * monitored comparison — but it must be said wherever a run's exits are read.
 */
export const TRAIL_STRENGTH_NOTE =
  'The engine MOVES the stop to the trail and exits there; the live guardian only RECORDS the decision '
  + 'point (#936) and leaves the broker stop in charge. A run with a trailing stop therefore shows '
  + 'protection the live bot does not yet have.';
