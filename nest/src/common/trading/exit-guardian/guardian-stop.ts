/**
 * guardian-stop.ts — THE STOP GUARDIAN'S RULE, once, so a backtest can call the same one.
 *
 * ── WHY THIS FILE EXISTS (2026-11-23) ───────────────────────────────────────────────────────────
 * Owner: *"backtesting should be using the existing pipeline and so I have to assume you mean
 * everything."* Measured that day: the live Stop Guardian is **running** — `stop_adjustment` holds
 * **5,328 rows**, last written that afternoon, with reasons like
 * `Consensus 62 | ATR=0.00033 | dist=1.000% | slPct=1 | Wick=50` — while `BacktestService` has no
 * equivalent, so a run and an account of the same bot do not share a stop policy.
 *
 * ⚠️ THE MISSING PIECE IS AN INPUT, NOT A CALL. The guardian tightens when a **directive consensus**
 * clears 55, computed over `STOP_GUARDIAN_DIRECTIVES` (`alignedAvg − opposingAvg`). The engine keeps
 * only the protocol's COMPOSITE score per bar and no directive breakdown, so it cannot compute that
 * consensus today. What CAN be shared now is the rule itself: given the same inputs, both paths must
 * produce the same stop. This module is that rule, extracted from the live service **without changing
 * its arithmetic**.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────────────────────────
 *   1. distance to leave = `max(3 × ATR, the declared slPct distance from entry)`
 *      ⚠️ The declared-distance FLOOR is not cosmetic: measured 2026-09-21, `3 × ATR(5m)` on FX is
 *      ~0.03–0.11% while `slPct` is ~1%, so the trail tightened a stop to ~0.05% away and SEVEN
 *      positions closed inside 28 minutes, every one exactly at a guardian-set stop.
 *   2. recommended level = price ∓ distance, then **never loosened** — only moved toward profit.
 *   3. apply only when consensus >= 55 AND the level actually moved.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 257
 * GUARD:    guardian-stop.spec.ts
 */

/** The consensus a tighten must clear. A constant, not a setting — measured: `appsetting` has none. */
export const GUARDIAN_MIN_CONSENSUS = 55;

/**
 * A level must move by more than this to be worth an order. ⚠️ Not zero: a float-equal "move" would
 * send a modify for nothing, and the live path has used this exact epsilon since #476.
 */
export const GUARDIAN_MIN_MOVE = 0.00001;

/**
 * The strategy's own declared stop distance, in PRICE units, measured from ENTRY.
 *
 * ⚠️ `slPct` of 0 / null / negative falls back to **1%**, matching live (`Number(x ?? 1) || 1`).
 * That is deliberately NOT the backtest's reading of 0 ("no bracket") — the difference is recorded at
 * `protective-stop.ts` and asserted in `exit-decisions.spec.ts`; changing either here would change
 * live behaviour.
 */
export function declaredStopDistance(entryPrice: number, slPct: number): number {
  const pct = Number(slPct);
  const safePct = Number.isFinite(pct) && pct > 0 ? pct : 1;
  const entry = Number(entryPrice);
  if (!Number.isFinite(entry) || entry <= 0) return 0;
  return Math.abs(entry * (safePct / 100));
}

/** The distance a trailing tighten must leave between price and the stop (price units). */
export function trailDistanceFor(atrValue: number, declaredDistance: number): number {
  const atr = Number(atrValue);
  const atrTrail = Number.isFinite(atr) && atr > 0 ? 3 * atr : 0;
  return Math.max(atrTrail, declaredDistance);
}

/**
 * The #927 invariant, as a checkable function rather than an implied `Math.max`.
 *
 * ⚠️ WITH `trailDistanceFor` `max()`ing, THIS SHOULD NEVER FIRE — which is exactly why it exists. It
 * makes the invariant canaried instead of resting on one `Math.max` nobody re-reads. Copied verbatim
 * from the live service on 2026-11-23 (including the epsilon and the "no declared distance → nothing
 * to enforce" branch) so the ceiling and any other driver test the same thing.
 */
export function trailDistanceProblem(trailDistance: number, declaredDistance: number): string | null {
  if (!(declaredDistance > 0)) return null; // no declared distance → nothing to enforce
  if (trailDistance + 1e-9 >= declaredDistance) return null;
  return (
    `trail distance ${trailDistance.toFixed(5)} is inside the declared stop distance ` +
    `${declaredDistance.toFixed(5)} — refusing to place a stop tighter than the position's own risk (#927)`
  );
}

export type GuardianStopOutcome =
  /** the stop should be moved to `newSl` */
  | 'adjusted'
  /** consensus below the threshold — no directional case to tighten on */
  | 'below-threshold'
  /** no usable ATR, so no trail distance can be computed — nothing is recommended */
  | 'no-recommendation'
  /** the #927 invariant fired: a trail tighter than the declared risk. Should never fire */
  | 'distance-refused'
  /** the recommended level is not better than the stop already in force */
  | 'at-target';

export interface GuardianStopDecision {
  outcome: GuardianStopOutcome;
  /** The level to send, or `null` when nothing should be sent. */
  newSl: number | null;
  /** `max(3 × ATR, declared distance)`, in price units — reported so a caller can log it. */
  trailDistance: number;
  declaredDistance: number;
  /** One sentence a caller can print; never silent. */
  because: string;
}

/**
 * Decide whether the guardian would move this position's stop, and to where.
 *
 * ⚠️ PURE, and it returns a DECISION rather than applying one: the live caller sends the order, the
 * engine would set its in-memory stop. Same rule, two drivers — which is the only form of parity that
 * survives a later edit.
 *
 * ⚠️ IT ONLY EVER TIGHTENS. For a BUY the recommended level is raised and can never fall below the
 * stop in force; for a SELL it is lowered and can never rise above it. A rule that loosened a stop
 * would be worse than no rule, because it would silently widen declared risk.
 *
 * ⚠️ A SMALL ATR IS **FLOORED, NOT REFUSED** — and this was got wrong on the first attempt, which the
 * spec caught. `trailDistanceFor` `max()`s with the declared distance, so 3 × ATR being tiny widens the
 * trail back to the declared risk and the tighten still happens. Live's `trailDistanceProblem()` says so
 * itself: *"with `trailDistanceFor` max()ing, this should never fire — which is exactly why it exists."*
 * Treating it as a refusal would have made the backtest decline moves the live account makes.
 *
 * ⚠️ IT ASSUMES THE CALLER HAS ALREADY HANDLED AN UNLOCKED POSITION (SL null/0). Live sets a protective
 * floor there instead; this function is the branch that runs once a stop exists.
 */
export function guardianStopDecision(input: {
  side: 'BUY' | 'SELL';
  /** Current price. */
  price: number;
  /** The stop in force. `null`/0 means UNLOCKED — the protective-floor branch, not this one. */
  currentSl: number | null;
  /** ATR over the guardian's own bar set. */
  atrValue: number;
  /** Entry price — the denominator the declared distance is measured from. */
  entryPrice: number;
  slPct: number;
  /** `alignedAvg − opposingAvg`, clamped at 0 by the caller. */
  stopConfidence: number;
  minConsensus?: number;
}): GuardianStopDecision {
  const minConsensus = Number.isFinite(input.minConsensus) ? Number(input.minConsensus) : GUARDIAN_MIN_CONSENSUS;
  const declaredDistance = declaredStopDistance(input.entryPrice, input.slPct);
  const trailDistance = trailDistanceFor(input.atrValue, declaredDistance);
  const price = Number(input.price);

  if (!Number.isFinite(price) || price <= 0) {
    return {
      outcome: 'no-recommendation',
      newSl: null,
      trailDistance,
      declaredDistance,
      because: 'no usable price — refusing to compute a stop level from it',
    };
  }
  // The #927 invariant, from the ONE implementation (`trailDistanceProblem`, shared with the live tick).
  const distanceProblem = trailDistanceProblem(trailDistance, declaredDistance);
  if (distanceProblem) {
    return {
      outcome: 'distance-refused',
      newSl: null,
      trailDistance,
      declaredDistance,
      because: distanceProblem,
    };
  }
  // No ATR at all: live computes no recommendation (`atrValue > 0` guards it), so nothing is sent.
  if (!(Number(input.atrValue) > 0)) {
    return {
      outcome: 'no-recommendation',
      newSl: null,
      trailDistance,
      declaredDistance,
      because: 'no usable ATR — no trail distance to recommend',
    };
  }

  const current = Number(input.currentSl);
  const hasStop = Number.isFinite(current) && current > 0;
  if (Number(input.stopConfidence) < minConsensus) {
    return {
      outcome: 'below-threshold',
      newSl: null,
      trailDistance,
      declaredDistance,
      because: `consensus ${input.stopConfidence} is below ${minConsensus} — no directional case to tighten on`,
    };
  }

  const raw = input.side === 'BUY' ? price - trailDistance : price + trailDistance;
  // Never loosen: a BUY's stop only rises, a SELL's only falls.
  const candidate = hasStop
    ? (input.side === 'BUY' ? Math.max(raw, current) : Math.min(raw, current))
    : raw;

  if (hasStop && Math.abs(candidate - current) <= GUARDIAN_MIN_MOVE) {
    return {
      outcome: 'at-target',
      newSl: null,
      trailDistance,
      declaredDistance,
      because: `the recommended level ${raw} is not better than the stop in force ${current}`,
    };
  }

  return {
    outcome: 'adjusted',
    newSl: candidate,
    trailDistance,
    declaredDistance,
    because: `consensus ${input.stopConfidence} >= ${minConsensus} and ${trailDistance} clears the declared ${declaredDistance}`,
  };
}
