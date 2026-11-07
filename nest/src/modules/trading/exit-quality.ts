/**
 * exit-quality.ts — "did we leave profit on the table?" as one pure function (#1149 / owner question).
 *
 * ⚠️ TWO DIFFERENT UNITS LIVE IN A `trade` ROW AND MUST NOT BE COMPARED (measured 2026-11-07).
 * `peakProfitPct` is a PERCENT of the entry price — recorded by the position tracker while the trade
 * was open. `pnl` is CURRENCY. Comparing them produces a number that looks entirely plausible and is
 * meaningless: a "+2.85% peak against +0.06 pnl" reading implies a 2.79 percentage-point give-back
 * when the second figure is pounds.
 *
 * So the realised figure is DERIVED from the prices in the same unit as the peak:
 *
 *     realisedPct = (exitPrice - entryPrice) / entryPrice * 100 * (side === 'sell' ? -1 : 1)
 *
 * Both sides are then percentages of the entry price, and `giveBackPct = peak - realised` is a real
 * subtraction. `pnl` is never used for the comparison; it is only carried through for display.
 *
 * ⚠️ `pnlInvalid = 1` rows are EXCLUDED. Those are fabricated/reconstructed rows whose P&L is not a
 * measurement (the #805 family that made a report count 82 fabricated trades as real). Including them
 * would poison exactly the statistic this file exists to produce.
 *
 * ⚠️ COVERAGE IS PART OF THE OUTPUT, not a footnote. As at 2026-11-07 only 139 of 700 trades carry
 * `peakProfitPct` at all (the tracker was added in October 2026), so every average below is an average
 * of `nWithPeak`, NOT of `n`. A reader who assumes otherwise draws a conclusion from a fifth of the
 * data.
 */

export type TradeSide = 'long' | 'short' | 'unknown';

export interface ExitQualityInput {
  symbol: string;
  side: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  peakProfitPct: number | null;
  /**
   * The TRUE maximum favourable excursion, reconstructed from `marketbar` high/low inside the
   * position window. ⚠️ NEVER A REPLACEMENT FOR `peakProfitPct` — see the header note. `null` means
   * the bars do not cover the window, which is NOT the same as "the position did not move".
   */
  barMaxPct?: number | null;
  closeReason: string | null;
  strategy: string | null;
  pnlInvalid?: number | boolean | null;
}

export interface ExitQualityBucket {
  /** Rows considered (after exclusions). */
  n: number;
  /** Rows with a recorded peak — the true denominator of every average below. */
  nWithPeak: number;
  /** Rows where a realised percent could be derived from the prices. */
  nWithRealised: number;
  /** Rows where BOTH exist — the only rows a give-back can be computed from. */
  nComparable: number;
  /** Average of `peakProfitPct` over `nWithPeak`. */
  avgPeakPct: number | null;
  /** Average of the derived realised percent over `nWithRealised`. */
  avgRealisedPct: number | null;
  /** Average of (peak − realised) over `nComparable`. Positive = profit given back. */
  avgGiveBackPct: number | null;
  /** Comparable rows that reached a profit and still closed at or below break-even. */
  peakedThenLost: number;
  /** Comparable rows that captured less than half of a positive peak. */
  capturedUnderHalf: number;
  /** Rows whose peak exceeded `thresholdPct` — i.e. the position actually MOVED. */
  reached: number;
  /** `reached` as a percentage of `nWithPeak`. Null when no row has a peak. */
  reachedPct: number | null;
  /** Rows where the bar-derived maximum could be computed. */
  nWithBarMax: number;
  /** Average TRUE maximum from bars — the measurement, where `avgPeakPct` is the record. */
  avgBarMaxPct: number | null;
  /** Rows whose TRUE maximum exceeded the threshold. */
  reachedBars: number;
  /** `reachedBars` as a percentage of `nWithBarMax`. Null when no row could be bar-measured. */
  reachedBarsPct: number | null;
  /** Average (trueMax − realised) over rows with both. The honest give-back. */
  avgTrueGiveBackPct: number | null;
}

export interface ExitQualityResult {
  overall: ExitQualityBucket;
  byCloseReason: Array<ExitQualityBucket & { closeReason: string }>;
  byStrategy: Array<ExitQualityBucket & { strategy: string }>;
  exclusions: { pnlInvalid: number; noPrices: number };
  note: string;
}

export function normaliseSide(side: string | null | undefined): TradeSide {
  const s = String(side ?? '').toLowerCase();
  if (s === 'buy' || s === 'long') return 'long';
  if (s === 'sell' || s === 'short') return 'short';
  return 'unknown';
}

/** Realised return as a percentage of the entry price, in the SAME unit as `peakProfitPct`. */
export function realisedPct(
  side: TradeSide,
  entryPrice: number | null | undefined,
  exitPrice: number | null | undefined,
): number | null {
  if (entryPrice == null || exitPrice == null) return null;
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry === 0) return null;
  if (side === 'unknown') return null;
  const raw = ((exit - entry) / entry) * 100;
  return Number((side === 'long' ? raw : -raw).toFixed(4));
}

function emptyBucket(): ExitQualityBucket {
  return {
    n: 0,
    nWithPeak: 0,
    nWithRealised: 0,
    nComparable: 0,
    avgPeakPct: null,
    avgRealisedPct: null,
    avgGiveBackPct: null,
    peakedThenLost: 0,
    capturedUnderHalf: 0,
    reached: 0,
    reachedPct: null,
    nWithBarMax: 0,
    avgBarMaxPct: null,
    reachedBars: 0,
    reachedBarsPct: null,
    avgTrueGiveBackPct: null,
  };
}

interface Accumulator extends ExitQualityBucket {
  peakSum: number;
  realisedSum: number;
  giveBackSum: number;
  barMaxSum: number;
  trueGiveBackSum: number;
}
function accOf(b: ExitQualityBucket): Accumulator {
  return { ...b, peakSum: 0, realisedSum: 0, giveBackSum: 0, barMaxSum: 0, trueGiveBackSum: 0 };
}

function finish(a: Accumulator): ExitQualityBucket {
  return {
    n: a.n,
    nWithPeak: a.nWithPeak,
    nWithRealised: a.nWithRealised,
    nComparable: a.nComparable,
    avgPeakPct: a.nWithPeak ? Number((a.peakSum / a.nWithPeak).toFixed(3)) : null,
    avgRealisedPct: a.nWithRealised ? Number((a.realisedSum / a.nWithRealised).toFixed(3)) : null,
    avgGiveBackPct: a.nComparable ? Number((a.giveBackSum / a.nComparable).toFixed(3)) : null,
    peakedThenLost: a.peakedThenLost,
    capturedUnderHalf: a.capturedUnderHalf,
    reached: a.reached,
    // ⚠️ Denominator is `nWithPeak`, NOT `n`. A bucket with no peaks must report null, never 0% —
    // "none of them moved" and "we never measured" are different statements.
    reachedPct: a.nWithPeak ? Number(((a.reached / a.nWithPeak) * 100).toFixed(1)) : null,
    nWithBarMax: a.nWithBarMax,
    avgBarMaxPct: a.nWithBarMax ? Number((a.barMaxSum / a.nWithBarMax).toFixed(3)) : null,
    reachedBars: a.reachedBars,
    reachedBarsPct: a.nWithBarMax ? Number(((a.reachedBars / a.nWithBarMax) * 100).toFixed(1)) : null,
    avgTrueGiveBackPct: a.nWithBarMax ? Number((a.trueGiveBackSum / a.nWithBarMax).toFixed(3)) : null,
  };
}

function add(
  a: Accumulator,
  row: ExitQualityInput,
  peak: number | null,
  realised: number | null,
  thresholdPct: number,
): void {
  a.n += 1;
  if (peak != null) {
    a.nWithPeak += 1;
    a.peakSum += peak;
    if (peak > thresholdPct) a.reached += 1;
  }
  if (realised != null) {
    a.nWithRealised += 1;
    a.realisedSum += realised;
  }
  if (peak != null && realised != null) {
    a.nComparable += 1;
    a.giveBackSum += peak - realised;
    // "Reached a profit and still closed at or below break-even" — the owner's question, verbatim.
    if (peak > 0 && realised <= 0) a.peakedThenLost += 1;
    if (peak > 0 && realised < peak / 2) a.capturedUnderHalf += 1;
  }

  // ⚠️ THE BAR-DERIVED MAXIMUM IS A SEPARATE DENOMINATOR ON PURPOSE. It covers a different subset of
  // rows than `peakProfitPct` does, and folding the two together would let a bucket whose bars are
  // missing silently inherit the sampled figure — the precise bias this field exists to expose.
  const barMax = row.barMaxPct == null ? null : Number(row.barMaxPct);
  if (barMax != null && Number.isFinite(barMax)) {
    a.nWithBarMax += 1;
    a.barMaxSum += barMax;
    if (barMax > thresholdPct) a.reachedBars += 1;
    if (realised != null) a.trueGiveBackSum += barMax - realised;
  }
}

export const DEFAULT_REACHED_THRESHOLD_PCT = 0.5;

export function computeExitQuality(
  rows: ExitQualityInput[],
  thresholdPct: number = DEFAULT_REACHED_THRESHOLD_PCT,
): ExitQualityResult {
  const overall = accOf(emptyBucket());
  const byReason = new Map<string, Accumulator>();
  const byStrategy = new Map<string, Accumulator>();
  const exclusions = { pnlInvalid: 0, noPrices: 0 };

  for (const row of rows) {
    if (Number(row.pnlInvalid ?? 0) === 1) {
      exclusions.pnlInvalid += 1;
      continue;
    }

    const side = normaliseSide(row.side);
    const peak = row.peakProfitPct == null ? null : Number(row.peakProfitPct);
    const realised = realisedPct(side, row.entryPrice, row.exitPrice);
    if (realised == null) exclusions.noPrices += 1;

    const peakOrNull = Number.isFinite(peak as number) ? peak : null;

    const reason = row.closeReason && String(row.closeReason).trim() ? String(row.closeReason) : '(unrecorded)';
    const strategy = row.strategy && String(row.strategy).trim() ? String(row.strategy) : '(unassigned)';

    if (!byReason.has(reason)) byReason.set(reason, accOf(emptyBucket()));
    if (!byStrategy.has(strategy)) byStrategy.set(strategy, accOf(emptyBucket()));

    add(overall, row, peakOrNull, realised, thresholdPct);
    add(byReason.get(reason)!, row, peakOrNull, realised, thresholdPct);
    add(byStrategy.get(strategy)!, row, peakOrNull, realised, thresholdPct);
  }

  const sortByN = (a: { n: number }, b: { n: number }) => b.n - a.n;

  return {
    overall: finish(overall),
    byCloseReason: [...byReason.entries()]
      .map(([closeReason, a]) => ({ closeReason, ...finish(a) }))
      .sort(sortByN),
    byStrategy: [...byStrategy.entries()]
      .map(([strategy, a]) => ({ strategy, ...finish(a) }))
      .sort(sortByN),
    exclusions,
    note:
      'Every average is over the rows that HAVE the measurement, not over n. `peakProfitPct` exists ' +
      'only from October 2026, so older trades contribute to `n` and to nothing else. Realised is ' +
      'derived from entryPrice/exitPrice — `pnl` is currency and is never mixed into a percentage.',
  };
}
