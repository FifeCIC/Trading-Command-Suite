/**
 * peak-change.ts — "highest % change reached on the answer day" for one symbol.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * The selection page lists each movers day and its symbols. A reader needs to see, beside each
 * symbol, the move the day actually delivered — "BGS +34%" says instantly whether a name was a big
 * mover or a footnote. The dataset endpoint carried only the ticker, so the page had nothing to show.
 *
 * ⚠️ THE DENOMINATOR IS THE PREVIOUS SESSION'S CLOSE — the same convention `selection-ranking.ts`
 * (`moveSoFarPct`) and `session-change.ts` use. "% change today" means close-vs-previous-session-close
 * everywhere in this app; measuring from the day's own open would quietly disagree with the ranking.
 *
 * ⚠️ THE EXTREME FOLLOWS THE SIDE. A winners list is about how HIGH a name went (its intraday high);
 * a losers list is about how FAR it fell (its intraday low). Taking the high for a losers list would
 * report ~0% for a stock that opened flat and collapsed 90%, which is the opposite of useful. When a
 * bar has no usable high/low, the close stands in, so a missing field never renders as a flat day.
 *
 * ⚠️ NULL IS NOT 0. No previous close (the first session in a window) or no usable bar returns null
 * with a reason; the page renders "—". Reporting 0% there would make an unmeasurable day look flat.
 *
 * Pure: no Prisma, no clock. Every branch is testable without a database.
 */

/** A bar reduced to what the peak calculation needs. `high`/`low` preferred; `close` is the fallback. */
export interface PeakBar {
  high?: number | null;
  low?: number | null;
  close?: number | null;
}

export type PeakSide = 'winners' | 'losers';

export interface PeakResult {
  /** The extreme % change reached on the day (signed), or null when it cannot be measured. */
  peakPct: number | null;
  /** The price that produced `peakPct` (the day's high for winners, low for losers), or null. */
  peakPrice: number | null;
  /** Why `peakPct` is null. Always set when it is null — never a silent absence. */
  reason?: string;
}

/**
 * The extreme % change reached on one day, given that day's bars and the previous session's close.
 * Winners look at the HIGH; losers at the LOW.
 */
export function peakChangeOnDay(
  bars: readonly PeakBar[],
  previousClose: number | null,
  side: PeakSide,
): PeakResult {
  if (previousClose === null || !Number.isFinite(previousClose) || previousClose <= 0) {
    return { peakPct: null, peakPrice: null, reason: 'no previous session close to measure from' };
  }

  let extreme: number | null = null;
  for (const bar of bars) {
    const primary = Number(side === 'winners' ? bar.high : bar.low);
    const close = Number(bar.close);
    const price =
      Number.isFinite(primary) && primary > 0
        ? primary
        : Number.isFinite(close) && close > 0
          ? close
          : null;
    if (price === null) continue;
    if (extreme === null) extreme = price;
    else if (side === 'winners') {
      if (price > extreme) extreme = price;
    } else if (price < extreme) {
      extreme = price;
    }
  }

  if (extreme === null) {
    return { peakPct: null, peakPrice: null, reason: 'no usable bar on the answer day' };
  }

  return { peakPct: (extreme / previousClose - 1) * 100, peakPrice: extreme };
}
