/**
 * exit-trigger.ts — WHY a managed position is being closed, decided in ONE pure function (#928).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN MODULE
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * The decision was inline in `PositionTimeStopService.evaluate()`, which needs a live broker and a
 * database to run. That made the single most consequential thing in the exit path — "does this
 * position close, and which mechanism do we blame?" — **untestable**, and the repo's rule is that a
 * guard which has never been observed to fail is a decoration.
 *
 * Extracting it here costs one import and buys a canaried test that runs in milliseconds with no
 * infrastructure. It is pure: no clock is read unless the caller omits `at`, no I/O, no Nest.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * THE TWO MECHANISMS, AND WHY THEY MUST NOT MASK EACH OTHER
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   | mechanism       | column          | the question it answers           |
 *   |-----------------|-----------------|-----------------------------------|
 *   | `max_hold`      | `maxHoldHours`  | "has this position been held TOO LONG?"  |
 *   | `exit_boundary` | `exitBeforeUtc` | "is the clock PAST a boundary the bot named?" |
 *
 * ⚠️ **A bot may declare EITHER, BOTH, or NEITHER.** The original code `continue`d the moment
 * `maxHoldHours` was null, which would have made a boundary-only bot **permanently inert** while its
 * configuration showed the gate as armed. The `boundary-only` case below is therefore a canary, not
 * a nicety.
 *
 * ⚠️ **WHEN BOTH ARE DUE, `max_hold` IS NAMED.** The hold limit is a limit on the position's AGE, so
 * reporting an aged-out position as a session exit would attribute the close to the wrong mechanism
 * — and `replay-exit-counterfactual.cjs`, which is the only evidence deciding whether the boundary
 * earns its place, reads that attribution.
 *
 * 🛑 **THIS FUNCTION DECIDES NOTHING ABOUT MONEY ON ITS OWN.** It answers "should this close?". The
 * caller still owns the dry-run switch, the broker round trip, and the durable `closeReason` write.
 * Keeping those out of here is what makes this testable without a broker.
 */
import { checkExitBoundary, type ExitBoundaryResult } from '../trading/session-window';

/** Which mechanism closed a position. Carried to the close so the reason is never re-derived. */
export type TimedStopTrigger = 'max_hold' | 'exit_boundary';

export interface ExitTriggerInput {
  /** The strategy's `maxHoldHours`. `null` = no limit declared. */
  maxHoldHours: number | null;
  /** How long the position has been open. */
  hoursHeld: number;
  /** The strategy's `exitBeforeUtc` (`'HH:MM'` UTC). `unknown` because it arrives unvalidated. */
  exitBeforeUtc: unknown;
  /** Injectable clock — the tests pin the boundary rather than depending on the wall clock. */
  at?: Date;
}

/**
 * The decision, as a DISCRIMINATED UNION so `trigger` cannot be null on the `due: true` branch.
 *
 * ⚠️ An optional `trigger` would force the caller into `?? 'max_hold'`, and a silent fallback is how
 * a close gets attributed to the wrong mechanism. The union makes that unrepresentable.
 */
export type ExitTriggerDecision = {
  /** True when the HOLD LIMIT is exceeded — reported even when the boundary also fired. */
  overMaxHold: boolean;
  /** Hours past the hold limit, rounded. 0 when no limit is declared. */
  overByHours: number;
  /** The boundary's own verdict, including `invalid` — the caller surfaces that, never swallows it. */
  boundary: ExitBoundaryResult;
} & ({ due: false; trigger: null } | { due: true; trigger: TimedStopTrigger });

export function decideExitTrigger(input: ExitTriggerInput): ExitTriggerDecision {
  const { maxHoldHours, hoursHeld, exitBeforeUtc } = input;
  const boundary = checkExitBoundary(exitBeforeUtc, input.at);

  // `null` and 0 are DIFFERENT: `parseMaxHoldHours` returns null for "no limit" precisely so a
  // missing limit cannot be read as "close everything immediately". `overBy` follows that.
  const overBy = maxHoldHours === null ? null : hoursHeld - maxHoldHours;
  const overMaxHold = overBy !== null && overBy > 0;

  const base = {
    overMaxHold,
    // 0 rather than a fabricated "over by" figure: `trigger` is what says why this row is here, and
    // a made-up number for a boundary-only bot would be a plausible value with no error behind it.
    overByHours: overBy === null ? 0 : Math.round(overBy * 10) / 10,
    boundary,
  };

  if (!overMaxHold && !boundary.due) return { ...base, due: false, trigger: null };
  return { ...base, due: true, trigger: overMaxHold ? 'max_hold' : 'exit_boundary' };
}

/**
 * Is ANY exit rule declared for this bot? Distinguishes "this bot opted out of both" from "this bot
 * was never matched to the position" — two states that used to render identically.
 */
export function hasAnyExitRule(maxHoldHours: number | null, exitBeforeUtc: unknown): boolean {
  if (maxHoldHours !== null) return true;
  const p = decideExitTrigger({ maxHoldHours: null, hoursHeld: 0, exitBeforeUtc });
  // `status` is `none` only when nothing readable was declared; an unreadable value counts as
  // "declared but broken", which the caller reports rather than treating as opted-out.
  return p.boundary.status !== 'none';
}
