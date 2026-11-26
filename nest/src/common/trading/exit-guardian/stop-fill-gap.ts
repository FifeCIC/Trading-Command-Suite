/**
 * stop-fill-gap.ts — HOW OPTIMISTIC IS A STOP FILL THAT ASSUMES THE LEVEL?
 *
 * ── WHY THIS EXISTS (2026-11-23, #1335) ─────────────────────────────────────────────────────────
 * The engine books every stop exit at `state.stop` (`position-bar.ts` returns `price: state.stop`
 * unconditionally). A real broker's resting stop fills at whatever the market offers when it triggers,
 * and on a thin small-cap moving 60% in a day that is not the level.
 *
 * Owner, 2026-11-23: the broker stop loss was not being simulated, and that had gone unnoticed.
 * Half right, and the distinction is the substance:
 *
 *   · the stop **LEVEL** is fully simulated — the engine calls the same `protectiveStopPrice()`, to
 *     the same 5 decimal places, that the guardian sends to the broker;
 *   · the stop **FILL** is assumed to be exactly the level, always, on every bar.
 *
 * ⚠️ THE DISTANCE PAST THE STOP IS NOT PROVEN SLIPPAGE. OHLC cannot order the path inside a bar, so a
 * bar whose low is below a long's stop may have traded smoothly down through it (a normal fill at the
 * level) or gapped below and stayed (a far worse fill). This measures the **potential**, and calls it
 * that. It is deliberately not added to P&L: doing so would change every stored result on a guess
 * about a path we cannot see.
 *
 * Measured on 40,606 stored `5m` stop exits (one publisher per symbol, register row 250):
 * **65.9%** of bars had an extreme beyond the stop; overshoot median **0.338%**, p90 **4.477%**.
 * The 65.9% is expected — a stop is normally reached INSIDE its bar. The p90 is the interesting number,
 * on a bot whose stop distance is 2.5%.
 *
 * REGISTER: docs/SETTLED-DECISIONS.md row 252
 * GUARD:    stop-fill-gap.spec.ts
 */

/** The trade fields this needs. All optional: a run recorded before 2026-11-23 has none. */
export interface FillGapTrade {
  exitReason?: string;
  direction?: 'LONG' | 'SHORT';
  exitPrice?: number;
  exitBarLow?: number;
  exitBarHigh?: number;
}

export interface FillGapSummary {
  /**
   * SL/TRAIL exits in the population — the DENOMINATOR for `measured`, counted whether or not the exit
   * bar's extremes were recorded.
   *
   * ⚠️ `measured: 0` HAD TWO POSSIBLE MEANINGS and now has an explicit separator: `stopExits: 0` means
   * the population contains no stop exit to be optimistic about; `stopExits > 0` beside `measured: 0`
   * would mean stop exits exist and could not be read — a gap in what was recorded.
   *
   * 🛑 CORRECTION (2026-11-26, same day). An apparent instance of the second state was investigated and
   * was NOT one: `movers-winners-2026-11-19` showed 4 SL exits with blank bar extremes in the run's
   * DETAIL, but `detail.trades` includes trades the SELECTION REFUSED, and none of those 4 were in the
   * admitted population (`stopExits: 0`). **No recording gap was demonstrated.** The counters are kept
   * because the distinction is real and cheap to carry — but do not cite that day as an instance of it.
   */
  stopExits: number;
  /** Stop exits that could NOT be measured because the bar's adverse extreme was not recorded. */
  unrecorded: number;
  /** Stop exits that could be measured (both the level and the bar's extreme were recorded). */
  measured: number;
  /** Of those, how many had an extreme beyond the stop — i.e. the fill may have been worse. */
  beyond: number;
  /** Overshoot beyond the stop, as % of the stop, over the `beyond` population. */
  medianPct: number | null;
  p90Pct: number | null;
  worstPct: number | null;
  /** One sentence to print verbatim, or `null` when nothing could be measured. */
  note: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aggregate the potential fill gap over a run's stop exits.
 *
 * ⚠️ `measured: 0` MEANS "NOT RECORDED", NOT "NO GAP". Every run made before the exit-bar fields
 * existed lands here, and a summary that read it as a clean bill of health would be the exact defect
 * this file documents. The caller must render `measured` beside any percentage.
 */
export function summariseFillGap(trades: FillGapTrade[] | null | undefined): FillGapSummary {
  const list = Array.isArray(trades) ? trades : [];
  const overshoots: number[] = [];
  let measured = 0;
  let stopExits = 0;

  for (const t of list) {
    if (t?.exitReason !== 'SL' && t?.exitReason !== 'TRAIL') continue;
    // Counted BEFORE the field checks, so "no stop exit" and "stop exit we could not read" stay
    // distinguishable — see the interface docblock.
    stopExits += 1;
    const stop = Number(t?.exitPrice);
    const low = Number(t?.exitBarLow);
    const high = Number(t?.exitBarHigh);
    if (!Number.isFinite(stop) || stop <= 0) continue;
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    measured += 1;
    // The adverse side only: a long is stopped by the LOW, a short by the HIGH.
    const over = t?.direction === 'SHORT' ? ((high - stop) / stop) * 100 : ((stop - low) / stop) * 100;
    if (Number.isFinite(over) && over > 0) overshoots.push(over);
  }

  overshoots.sort((a, b) => a - b);
  const at = (q: number) => (overshoots.length ? round2(overshoots[Math.floor((overshoots.length - 1) * q)]) : null);
  const medianPct = at(0.5);
  const p90Pct = at(0.9);
  const worstPct = at(1);

  return {
    stopExits,
    unrecorded: stopExits - measured,
    measured,
    beyond: overshoots.length,
    medianPct,
    p90Pct,
    worstPct,
    /**
     * ⚠️ `note` KEEPS ITS ORIGINAL CONTRACT — a sentence only when something was measured, `null`
     * otherwise — because `BacktestPage.jsx` renders on `fillGap.note` being truthy and a surface that
     * suddenly appeared for old runs is a behaviour change in a page this work does not touch.
     *
     * The "there WERE stops but none could be read" case is therefore NOT in this string. It is in
     * `stopExits`/`unrecorded`, so a caller that wants to state it precisely can — that is the movers
     * page's new block, which reads those two fields rather than this sentence.
     */
    note: measured
      ? `${overshoots.length} of ${measured} stop exit(s) had a bar extreme beyond the stop level — the engine filled at the level, a broker may not have (median overshoot ${medianPct}%, p90 ${p90Pct}%).`
      : null,
  };
}
