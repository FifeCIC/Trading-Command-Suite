/**
 * simTslPlan() — translate a bot's simulated trailing stop into the engine's `StopPlan` (#1294).
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * `trading_strategy` has carried `simTslEnabled` / `simTslActivationPct` / `simTslDistancePct` since
 * the trailing stop was first designed, and the UI edits all three. Measured 2026-11-17: **3 of 64
 * active bots** have them on, and `settings-inventory.ts` recorded the whole group as
 * `applied: 'ignored' — "Zero references."`
 *
 * So a bot presented as trail-protected produced backtests with **no trail at all** — the same class
 * as #1136 (`maxHoldHours`), where a knob set on 42 bots was read by nothing.
 *
 * ── WHY IT IS A BUG FIX, NOT A MATHS CHANGE ─────────────────────────────────────────────────────
 * Nothing here invents a number or changes a formula. `StopPlan { lockAtPct, trailPct }` is already
 * implemented, tested and accepted as a request override; this only supplies it from the bot the run
 * says it is testing. The UI, the columns and the engine all already existed — only the wire between
 * them was missing.
 *
 * ── THE MAPPING ─────────────────────────────────────────────────────────────────────────────────
 *   simTslActivationPct → lockAtPct   (once this far in front, the stop moves to breakeven)
 *   simTslDistancePct   → trailPct    (then keeps this far behind the best price)
 *
 * ── WHEN IT RETURNS null ────────────────────────────────────────────────────────────────────────
 * A trailing stop that is off, or that cannot express a usable rule, must produce `null` — "no plan"
 * — rather than a partially-built one. A half-built plan would tighten stops on a bot whose owner
 * never asked for it, which is a silent change to live-shaped behaviour.
 */

/** The subset of `StopPlan` this mapper produces. Kept structural so it imports no service type. */
export interface SimTslPlan {
  lockAtPct: number;
  trailPct: number;
}

function positive(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Build the plan, or `null` when the bot has no usable trailing configuration.
 *
 * ⚠️ `enabled` is checked for truthiness on PURPOSE: the column is `tinyint(1)`, so Prisma may hand
 * back `1` rather than `true` depending on the read path, and `1` must mean on.
 */
export function simTslPlan(
  enabled: unknown,
  activationPct: unknown,
  distancePct: unknown,
): SimTslPlan | null {
  if (!enabled) return null;

  const trailPct = positive(distancePct);
  // No trail distance means no trailing rule. Refuse rather than defaulting to some other number:
  // a default here would silently tighten the stops of every bot that enabled the switch but left
  // the distance blank.
  if (trailPct === null) return null;

  const lockAtPct = positive(activationPct);
  if (lockAtPct === null) return null;

  return { lockAtPct, trailPct };
}
