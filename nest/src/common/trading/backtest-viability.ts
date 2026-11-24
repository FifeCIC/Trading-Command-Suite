/**
 * backtest-viability.ts — CAN THIS RUN PRODUCE A CLOSED TRADE AT ALL, AND IF NOT, WHY?
 *
 * ── WHY THIS EXISTS (2026-11-24, from the measurement in #1345) ─────────────────────────────────
 * A movers run reported profits of 606.00 and 2,631.96 across two days, and **every trade in both was
 * still open when the data ended**. Nothing errored. The engine did exactly what it was told: it opened
 * positions, marked them to the last bar and closed them because the series stopped.
 *
 * Measured cause, and it is ARITHMETIC rather than a hunch:
 *
 *   the US session dataset spans **6.5 hours** (14:30 → 21:00 UTC, measured from `marketbar`)
 *   `movers-v1-long` declares `maxHoldHours: 10` and `exitBeforeUtc: null`
 *
 *   ⇒ a position opened at the bell needs **10 hours** to reach its time stop and has **6.5** before the
 *     data ends. **The time stop can never fire.** The only exits left are the price bracket (which did
 *     not fire on either day) and the data ending.
 *
 * That is computable BEFORE a run, and it was computable all along. This module makes it a stated
 * property of the run instead of something a reader has to notice.
 *
 * ── ⚠️ IT IS A VERDICT, NOT AN ADJUSTMENT ───────────────────────────────────────────────────────
 * No number is changed, no trade is removed and no run is refused here — refusing is a contract change
 * (#1345) and belongs with the maths decision (register row 23). What this adds is that a run which
 * cannot produce a decision exit SAYS SO, in its own payload, next to the total it invalidates.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 270
 * GUARD:    backtest-viability.spec.ts
 */

export type ViabilityVerdict =
  /** Nothing closed, so there is nothing to judge. */
  | 'no-trades'
  /** At least one trade closed on a decision the account also makes. The run is a result. */
  | 'decision-exits'
  /**
   * Every trade ended because the data ended. ⚠️ This is NOT a result: the P/L is a mark of positions
   * that were never closed, and live has no equivalent event.
   */
  | 'mark-only';

export interface ViabilityInput {
  trades: number;
  /** Trades whose exit reason was `EOD` — positions still open when the series stopped. */
  endOfDataTrades: number;
  /** `trading_strategy.maxHoldHours`, or null when the bot declares none. */
  maxHoldHours?: number | null;
  /** `trading_strategy.exitBeforeUtc`, or null when the bot declares no boundary. */
  exitBeforeUtc?: string | null;
  /** The dataset's own span, in minutes. Measured from the bars, not assumed from a session name. */
  sessionSpanMinutes?: number | null;
}

export interface Viability {
  verdict: ViabilityVerdict;
  /**
   * FALSE when the time stop cannot possibly fire inside this dataset — `maxHoldHours` reaches past the
   * last bar AND no earlier boundary is declared. TRUE otherwise, including when the arithmetic cannot
   * be done (an unknown span must not be reported as "unreachable").
   */
  timeStopReachable: boolean;
  /** One sentence a page prints verbatim, beside the total. Never null, never empty. */
  why: string;
}

const MIN_PER_HOUR = 60;

/**
 * Is the time stop reachable inside the data?
 *
 * ⚠️ THREE ANSWERS, NOT TWO. An unknown span (`null`) or an undeclared hold returns `true` — "cannot
 * judge" must not be dressed as "unreachable", because the banner it would produce claims the run is
 * meaningless.
 */
export function timeStopReachable(input: ViabilityInput): boolean {
  const hold = Number(input.maxHoldHours);
  const span = Number(input.sessionSpanMinutes);
  if (!Number.isFinite(hold) || hold <= 0) return true; // no declared hold → nothing to reach
  if (!Number.isFinite(span) || span <= 0) return true; // unknown span → cannot judge
  // A declared boundary makes the time stop moot: the position is flattened by the clock regardless.
  if (input.exitBeforeUtc) return true;
  return hold * MIN_PER_HOUR <= span;
}

/** The whole verdict for one run. */
/**
 * ── DECISION (2026-11-24, primary) ─────────────────────────────────────────────────────────────
 * WHAT:      a run whose EVERY trade ended with the data is reported as `mark-only`, and the page
 *            states it ABOVE the totals rather than inside a caveat list or a later step.
 * WHY:       both movers days produced 100% end-of-data exits and the only signal was one line of
 *            prose beside a headline figure. A total that is a mark of open positions must not be
 *            able to look like a result — that is the whole reason a backtest is run.
 * INSTEAD OF: refusing the run, which is a contract change, or capping the hold, which is a maths
 *            change (row 23) and needs a copied configuration and a comparison.
 * REVERSE BY: remove the `viability` field from `SelectionRunResult` and the banner in step 2; nothing
 *            is stored, so the reversal is the removal alone.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 270
 * GUARD:     backtest-viability.spec.ts (14 cases, both directions)
 */
export function viabilityOf(input: ViabilityInput): Viability {
  const trades = Number(input.trades) || 0;
  const eod = Number(input.endOfDataTrades) || 0;
  const reachable = timeStopReachable(input);

  if (trades <= 0) {
    return {
      verdict: 'no-trades',
      timeStopReachable: reachable,
      why: 'No trade closed, so this run says nothing about how the strategy exits.',
    };
  }

  if (eod < trades) {
    return {
      verdict: 'decision-exits',
      timeStopReachable: reachable,
      why: `${trades - eod} of ${trades} trade(s) closed on a decision the account also makes.`,
    };
  }

  // Every trade ended with the data.
  const hold = Number(input.maxHoldHours);
  const span = Number(input.sessionSpanMinutes);
  const arithmetic = !reachable
    ? ` The bot holds for ${hold}h and this dataset spans ${(span / MIN_PER_HOUR).toFixed(1)}h, so its time `
      + 'stop cannot fire at all.'
    : '';

  return {
    verdict: 'mark-only',
    timeStopReachable: reachable,
    why:
      `All ${trades} trade(s) were still open when the data ended, so every figure above is a MARK of an `
      + `open position — unrealised, with no live event behind it.${arithmetic} Treat this as a position `
      + 'mark, not a result.',
  };
}

/**
 * The dataset's span in minutes, from its own bars.
 *
 * ⚠️ Measured, never inferred from a session name. A `us` session is 6.5 hours here and a `24h` FX
 * series is 21.9 — assuming the first from the label is how a 10-hour hold looked fine.
 */
export function sessionSpanMinutes(bars: ReadonlyArray<{ timestamp?: Date | string }> | null | undefined): number | null {
  const list = Array.isArray(bars) ? bars : [];
  if (list.length < 2) return null;
  const times = list
    .map((b) => (b?.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b?.timestamp ?? '').getTime()))
    .filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  const spanMs = Math.max(...times) - Math.min(...times);
  if (!Number.isFinite(spanMs) || spanMs <= 0) return null;
  return spanMs / 60000;
}
