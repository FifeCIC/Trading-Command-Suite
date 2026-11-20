/**
 * session-gate.ts — CAN THE BOT'S TRADING CLOCK BE TESTED ON THIS TIMEFRAME?
 *
 * ── THE TRAP THIS EXISTS FOR (measured 2026-11-20) ─────────────────────────────────────────────
 * The engine began applying `trading_strategy.sessionWindow` per bar (#1242). On NVDA **daily** bars,
 * stamped at the session CLOSE (21:00 UTC = 16:00 ET), a window of `["us"]` (9:30–16:00 ET) excluded
 * EVERY bar: the same run that produced **26 trades produced 0**, and an empty trade list reads as
 * "the strategy never fires". Nothing errored.
 *
 * A bar of a day or longer SUMMARISES a whole session and carries its END as a timestamp, so there is
 * no intraday instant to test a clock against. The live loop tests a real tick and has no equivalent.
 * So the gate applies to INTRADAY bars only — and when a window is declared on a timeframe that cannot
 * carry it, the run SAYS SO rather than silently trading nothing.
 *
 * Pure and separate from the engine so the boundary is a test rather than a comment: a guard that only
 * lives in prose is one that gets widened by whoever hits it next.
 */

/** A bar of a day or longer summarises a session; its stamp is the end of it. */
export const INTRADAY_MAX_BAR_MINUTES = 1_439;

export interface SessionGatePlan {
  /** True → the per-bar `checkSessionWindow()` call decides entries. */
  apply: boolean;
  /** Set only when a window was declared AND cannot be applied — ready to put on the result. */
  notice: string | null;
}

/** Is a window declared at all? `null`, `undefined`, `''` and `'[]'` are all "no window". */
function declared(window: unknown): boolean {
  if (window === null || window === undefined) return false;
  const raw = String(window).trim();
  if (raw === '') return false;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length > 0 : true;
  } catch {
    // Not JSON — treat the text itself as a declaration (`checkSessionWindow` parses aliases too).
    return true;
  }
}

/**
 * Decide whether this run can apply the window, and produce the sentence when it cannot.
 *
 * @param window     `trading_strategy.sessionWindow` as stored (`'["us"]'`).
 * @param barMinutes The run's timeframe in minutes (`timeframeMinutes()`).
 * @param timeframe  The label, for the message only.
 */
export function sessionGatePlan(
  window: unknown,
  barMinutes: number,
  timeframe: string,
): SessionGatePlan {
  if (!declared(window)) return { apply: false, notice: null };
  if (Number.isFinite(barMinutes) && barMinutes <= INTRADAY_MAX_BAR_MINUTES) {
    return { apply: true, notice: null };
  }
  return {
    apply: false,
    notice:
      `The bot's session window (${String(window)}) was NOT applied: this run measures ${timeframe} bars, ` +
      'which carry the END of the session they summarise, so there is no intraday instant to test a ' +
      'trading clock against. Measured 2026-11-20: applying it here excluded every bar (26 trades → 0). ' +
      'Run an intraday timeframe to test the window.',
  };
}
