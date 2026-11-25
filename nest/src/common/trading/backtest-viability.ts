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
  /**
   * `HH:MM` UTC — the run's entry cutoff (`SelectionRunRequest.cutoffUtc`).
   *
   * ⚠️ NEEDED, AND ITS ABSENCE WAS THE BUG. A boundary only pre-empts the hold by `boundary − cutoff`,
   * and without the cutoff that distance is unknowable. It is the EARLIEST instant an entry can occur, so
   * using it measures the MAXIMUM possible holding time — which is the conservative direction: we only
   * report "unreachable" when even the earliest possible entry cannot get there.
   */
  cutoffUtc?: string | null;
}

export interface Viability {
  verdict: ViabilityVerdict;
  /**
   * FALSE when the time stop cannot possibly fire inside this dataset — `maxHoldHours` reaches past the
     * LAST BAR, or past the declared exit boundary, whichever comes first.
     *
     * ⚠️ CORRECTED 2026-11-24: a declared boundary used to return TRUE ("the clock flattens the position
     * anyway"). That is backwards — a boundary does not make the hold reachable, it PRE-EMPTS it. Measured
     * on two movers sessions: at `exitBeforeUtc: '20:45'` a 6-hour hold produced **zero** `TIME` exits
     * (identical 1,628.73 / 222.69 and an identical `SESSION×21 · EOD×1` mix), while a 2-hour hold
     * produced **TIME×21**. So `true` told a reader a stop could fire when it provably could not.
     * TRUE is still returned when the arithmetic cannot be DONE — an unknown span or an unknown cutoff
     * must never be dressed as "unreachable".
   */
  timeStopReachable: boolean;
  /** One sentence a page prints verbatim, beside the total. Never null, never empty. */
  why: string;
}

const MIN_PER_HOUR = 60;

/** `'HH:MM'` → minutes past UTC midnight, or null when it cannot be read. Total, never throws. */
function hhmmToMinutes(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * The longest a position can be held before something OTHER than the time stop closes it, in minutes.
 * `null` means it cannot be computed and no claim may be made.
 */
export function maxHoldingMinutes(
  input: Pick<ViabilityInput, 'sessionSpanMinutes' | 'exitBeforeUtc' | 'cutoffUtc'>,
): number | null {
  const span = Number(input.sessionSpanMinutes);
  const spanOk = Number.isFinite(span) && span > 0;
  if (!input.exitBeforeUtc) return spanOk ? span : null;

  const boundary = hhmmToMinutes(input.exitBeforeUtc);
  const cutoff = hhmmToMinutes(input.cutoffUtc);
  // A boundary with no cutoff, or an unreadable time, cannot be reasoned about.
  if (boundary == null || cutoff == null) return null;
  // A boundary at or before the cutoff would fire on entry — a different pathology, not arithmetic.
  if (boundary <= cutoff) return null;
  const toBoundary = boundary - cutoff;
  return spanOk ? Math.min(span, toBoundary) : toBoundary;
}

/**
 * Is the time stop reachable inside the data?
 *
 * ⚠️ THREE ANSWERS, NOT TWO. An unknown span, an unknown cutoff or an undeclared hold returns `true` —
 * "cannot judge" must not be dressed as "unreachable", because the banner it would produce claims the
 * run is meaningless.
 */
export function timeStopReachable(input: ViabilityInput): boolean {
  const hold = Number(input.maxHoldHours);
  if (!Number.isFinite(hold) || hold <= 0) return true; // no declared hold → nothing to reach
  const limit = maxHoldingMinutes(input);
  if (limit == null) return true; // cannot judge
  return hold * MIN_PER_HOUR <= limit;
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

  /**
   * Which constraint binds, and by how much — a boundary and a short series are different causes and a
   * reader acting on this sentence needs to know which one to change.
   *
   * ⚠️ REPORTED ON EVERY UNREACHABLE VERDICT, not only `mark-only`. Measured 2026-11-24: a run with 21
   * of 22 trades closed on decisions carried `timeStopReachable: false` and a sentence that said nothing
   * about why, so the only place the arithmetic appeared was a boolean with no explanation.
   */
  const hold = Number(input.maxHoldHours);
  const span = Number(input.sessionSpanMinutes);
  const limit = maxHoldingMinutes(input);
  const byBoundary = limit != null && Number.isFinite(span) && span > 0 && limit < span;
  const arithmetic = !reachable
    ? ` The bot holds for ${hold}h and this dataset spans ${(span / MIN_PER_HOUR).toFixed(1)}h`
      + (byBoundary ? `, with a ${input.exitBeforeUtc} UTC boundary leaving at most ${(limit! / MIN_PER_HOUR).toFixed(2)}h` : '')
      + ', so its time stop cannot fire at all.'
    : '';

  if (trades <= 0) {
    return {
      verdict: 'no-trades',
      timeStopReachable: reachable,
      why: 'No trade closed, so this run says nothing about how the strategy exits.' + arithmetic,
    };
  }

  if (eod < trades) {
    return {
      verdict: 'decision-exits',
      timeStopReachable: reachable,
      why: `${trades - eod} of ${trades} trade(s) closed on a decision the account also makes.` + arithmetic,
    };
  }

  // Every trade ended with the data.
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
