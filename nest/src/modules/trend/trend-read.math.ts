/**
 * trend-read.math.ts — PURE maths for the trend READING (#1190, experiment).
 *
 * ============================================================================================
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ============================================================================================
 *
 * A trader draws a line on a chart and calls it "the trend". That single act is three different
 * things, and conflating them is why "can software see trend?" feels unanswerable:
 *
 *   1. TREND STATE   — is the series trending, which way, how strongly.   → COMPUTED HERE
 *   2. A TREND LINE  — a fitted object you can project and invalidate.    → COMPUTED HERE
 *   3. A FORECAST    — where price will go.                              → NOT COMPUTED, EVER
 *
 * This module does 1 and 2. Number 3 is deliberately absent, and the reason is not squeamishness:
 * a trendline's *predictive* content is small, while its *invalidation level* is the half that
 * actually protects a position. `projection.value` below is an EXTENSION OF THE FIT, not a
 * prediction, and it is returned beside the R² that bounds how much of the line is noise.
 *
 * ⚠️ NOTHING HERE MAY FEED A SCORE. `trend-read` must never be imported by the scoring, gating,
 * sizing or execution paths. A reading that changed what a protocol SCORED would stop being an
 * observation and become a maths change — which needs a copied configuration and an A/B under the
 * owner's rule.
 *
 * ============================================================================================
 * WHY TWO FAMILIES AND NOT ONE
 * ============================================================================================
 *
 * `linearRegression()` measures how LINE-LIKE the closes are (R²) and which way the line leans.
 * `adx()` measures how much directional MOVEMENT there is, with no line at all. They answer
 * different questions and they regularly disagree — a wide swing that returns to where it started
 * has plenty of directional movement and no line-like behaviour. The verdict therefore reports
 * both, and `familiesAgree` says plainly when they do not.
 */

import { adx, donchianChannel } from '../directives/utils/indicators';

export interface TrendBarLike {
  timestamp: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

/** Coefficients of a least-squares line through a series of closes. */
export interface RegressionFit {
  /** Slope in PRICE UNITS per bar. Not comparable across instruments — see `slopePctPerBar`. */
  slope: number;
  /** Slope as a percentage of the mean price per bar. Comparable across instruments. */
  slopePctPerBar: number;
  intercept: number;
  /**
   * Goodness of fit, 0..1 — "how line-like is this series".
   *
   * ⚠️ When every close is identical the fit is DEGENERATE: the total variance is 0 and R² is
   * mathematically undefined. It is reported as **0**, not 1, because a flat series carries no
   * trend information and returning 1 would claim a perfect trend where there is none.
   */
  r2: number;
  /** RMS distance of the closes from the fitted line, in price units. Sizes the channel. */
  residualStd: number;
  /** Mean of the closes the fit was taken over — the denominator for `slopePctPerBar`. */
  meanPrice: number;
  /** Bar index (into the array passed in) of the first point of the fit. */
  startIndex: number;
  /** Bar index of the last point of the fit. */
  endIndex: number;
  /** Fitted value at `startIndex`; the fit is `fittedAt(i) = slope * (i - startIndex) + startValue`. */
  startValue: number;
  /** Fitted value at `endIndex`. */
  endValue: number;
}

/** A swing point that cannot move again, because it has been closed over by `rightBars` bars. */
export interface Pivot {
  /** Index into the ORIGINAL bars array. */
  index: number;
  price: number;
  kind: 'high' | 'low';
  timestamp: string;
}

export interface ChannelReading {
  /** Regression line extended `multiplier × residualStd` either side, at the LAST bar. */
  upper: number;
  middle: number;
  lower: number;
  /** Where the last close sits in the channel: 0 = lower edge, 100 = upper edge. May exceed. */
  positionPct: number;
  /** Channel width as a percentage of the middle line — "how wide is normal here". */
  widthPct: number;
}

export type TrendVerdict = 'trending-up' | 'trending-down' | 'ranging' | 'indeterminate';

export interface TrendRead {
  verdict: TrendVerdict;
  /**
   * 0..100 of threshold HEADROOM, from both families. Deliberately not a probability — it is a
   * reading of how far past (or short of) the bands each family sits, and it is named that way in
   * the UI so it cannot be mistaken for a confidence that a trade will work.
   */
  confidence: number;
  /** `true` when R² and ADX land on the same side of their bands — the case to trust most. */
  familiesAgree: boolean;
  regression: RegressionFit;
  adx: { value: number; plusDi: number; minusDi: number };
  channel: ChannelReading;
  /** Where the last close sits in the N-bar Donchian range: 0 = lowest low, 100 = highest high. */
  donchianPositionPct: number;
  pivots: { recentHigh: Pivot | null; recentLow: Pivot | null };
  /**
   * The level at which this reading is WRONG, plus both candidates.
   *
   * ⚠️ Two candidates is the honest answer, not indecision: a regression-relative level and a
   * structural swing fail at different moments. `chosen` is the candidate a reversal reaches FIRST
   * that is still on the CORRECT SIDE of price, and `chosenBasis` names which one won.
   *
   * ⚠️ `alreadyBroken` is the case the first version of this got WRONG, and it is not hypothetical.
   * MEASURED 2026-11-03 on WTI 1h: the fit read `trending-up`, yet the last close (3.59) was BELOW
   * the most recent confirmed swing low (3.87) — so the reading put its own invalidation ABOVE price
   * and labelled it "invalid below". A level that has already been breached is not an invalidation;
   * it is evidence the structure has failed while the 200-bar fit still leans up. Presenting it as a
   * stop would have pointed a reader at a price the market had already passed.
   */
  invalidation: {
    regressionEdge: number | null;
    swingLevel: number | null;
    chosen: number | null;
    chosenBasis: 'regression-edge' | 'swing-level' | 'none';
    /** No candidate is on the correct side of price — the structure has already failed. */
    alreadyBroken: boolean;
    /** `true` when the verdict is ranging/indeterminate, where "invalidation" is not the right idea. */
    notApplicable: boolean;
  };
  /**
   * The fit extended `horizonBars` forward — an EXTRAPOLATION, not a forecast.
   * ⚠️ Read it with `confidence`: at R² below the ranging band the line is describing noise, and
   * extending noise is arithmetic without meaning.
   */
  projection: {
    horizonBars: number;
    value: number;
    upper: number;
    lower: number;
    strength: 'strong' | 'moderate' | 'weak' | 'none';
  };
  sample: { bars: number; used: number; sufficient: boolean };
  /** Thresholds actually applied, echoed so a reader can audit the verdict without the source. */
  thresholds: { adxTrending: number; adxRanging: number; r2Trending: number; r2Ranging: number };
}

/**
 * The thresholds, declared as data so the UI can print them and a reader can disagree with them.
 *
 * ⚠️ These are CONVENTIONS from technical analysis — Wilder's 25/20 ADX bands, and 0.5 R² as "the
 * line explains half the variance" — NOT values fitted to this app. Nothing here is tuned, because
 * nothing here feeds a decision: a reading is allowed to be approximately right, and pretending
 * otherwise would invite tuning an observation until it agreed with a conclusion.
 */
export const TREND_THRESHOLDS = {
  adxTrending: 25,
  adxRanging: 20,
  r2Trending: 0.5,
  r2Ranging: 0.3,
} as const;

/** Bars needed before a reading is attempted at all. Below this every number is noise. */
export const TREND_MIN_BARS = 30;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round5 = (v: number) => Math.round(v * 100000) / 100000;

/**
 * Round, or answer `null` when there is nothing to round.
 *
 * ⚠️ `NaN` and `null` both survive `JSON.stringify` differently — `NaN` becomes `null` in JSON but
 * stays `NaN` in TypeScript, so a caller comparing with `=== null` gets a different answer from the
 * same value depending on whether it crossed the wire. Returning `null` explicitly removes that.
 */
const roundOrNull = (v: number | null): number | null => (isNum(v) ? round5(v) : null);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Least-squares fit of `closes[start..end]` (inclusive; both default to the whole array).
 *
 * Returns `null` — never zeros — when there is not enough data or the input is non-finite: absence
 * of information and a flat line are different answers, and collapsing them is this repo's most
 * expensive recurring defect.
 */
export function linearRegression(closes: number[], start = 0, end = closes.length - 1): RegressionFit | null {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(closes.length - 1, Math.floor(end));
  const n = to - from + 1;
  if (n < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = from; i <= to; i++) {
    const y = closes[i];
    if (!isNum(y)) return null;
    const x = i - from;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const denom = n * sumXX - sumX * sumX;
  // Guard the divide: a NaN slope would propagate into a plausible-looking channel.
  if (denom === 0) return null;

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const meanPrice = sumY / n;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = from; i <= to; i++) {
    const x = i - from;
    const fitted = intercept + slope * x;
    const dRes = closes[i] - fitted;
    const dTot = closes[i] - meanPrice;
    ssRes += dRes * dRes;
    ssTot += dTot * dTot;
  }
  const r2 = ssTot === 0 ? 0 : Math.max(0, 1 - ssRes / ssTot);

  return {
    slope,
    slopePctPerBar: meanPrice === 0 ? 0 : (slope / meanPrice) * 100,
    intercept,
    r2,
    residualStd: Math.sqrt(ssRes / n),
    meanPrice,
    startIndex: from,
    endIndex: to,
    startValue: intercept,
    endValue: intercept + slope * (n - 1),
  };
}

/**
 * Confirmed swing pivots — a pivot is emitted only once `rightBars` bars exist AFTER it, so a pivot
 * that has been returned can never move.
 *
 * ⚠️ WHY THIS IS THE HONEST VERSION OF "the line a trader draws". Most chart tools show the newest
 * candidate immediately and then REPAINT it when the next bar disagrees. A reading that repaints
 * cannot be checked against what it said yesterday, so this one refuses to emit an unconfirmed
 * point. The cost is `rightBars` bars of lag — and that cost is stated in the response, not hidden.
 *
 * Comparison is non-strict on both sides, so a flat top yields ONE pivot (the earliest bar) rather
 * than a run of them — the result must be deterministic on repeated highs.
 */
export function confirmedPivots(bars: TrendBarLike[], leftBars = 3, rightBars = 3): Pivot[] {
  const out: Pivot[] = [];
  if (!Array.isArray(bars) || bars.length < leftBars + rightBars + 1) return out;

  for (let i = leftBars; i <= bars.length - 1 - rightBars; i++) {
    const b = bars[i];
    let isHigh = true;
    let isLow = true;
    for (let k = 1; k <= leftBars && (isHigh || isLow); k++) {
      if (!(b.high >= bars[i - k].high)) isHigh = false;
      if (!(b.low <= bars[i - k].low)) isLow = false;
    }
    for (let k = 1; k <= rightBars && (isHigh || isLow); k++) {
      if (!(b.high >= bars[i + k].high)) isHigh = false;
      if (!(b.low <= bars[i + k].low)) isLow = false;
    }
    // A bar that is both a pivot high and a pivot low is a single-bar spike; neither is meaningful.
    if (isHigh && !isLow) out.push({ index: i, price: b.high, kind: 'high', timestamp: toIso(b.timestamp) });
    else if (isLow && !isHigh) out.push({ index: i, price: b.low, kind: 'low', timestamp: toIso(b.timestamp) });
  }
  return out;
}

/** Position of `value` within `[lo, hi]` as 0..100. `null` for a degenerate or non-finite range. */
export function positionInRange(value: number, lo: number, hi: number): number | null {
  if (!isNum(value) || !isNum(lo) || !isNum(hi)) return null;
  if (hi === lo) return null; // a zero-width range says nothing about position
  return ((value - lo) / (hi - lo)) * 100;
}

function toIso(t: Date | string): string {
  return t instanceof Date ? t.toISOString() : String(t);
}

/**
 * Build the full reading. Pure: the same bars always produce the same answer, with no clock and no
 * database — which is what makes it testable, and what makes a before/after comparison meaningful.
 *
 * Returns `null` when there are fewer than `TREND_MIN_BARS` bars. That is the one "cannot judge"
 * that is worth returning as nothing at all, because every number below it would be invented.
 */
export function readTrend(
  bars: TrendBarLike[],
  opts: {
    channelMultiplier?: number;
    pivotLookback?: number;
    donchianPeriod?: number;
    horizonBars?: number;
    adxPeriod?: number;
  } = {},
): TrendRead | null {
  const channelMultiplier = opts.channelMultiplier ?? 2;
  const pivotLookback = opts.pivotLookback ?? 3;
  const donchianPeriod = opts.donchianPeriod ?? 20;
  const horizonBars = opts.horizonBars ?? 10;
  const adxPeriod = opts.adxPeriod ?? 14;

  if (!Array.isArray(bars) || bars.length < TREND_MIN_BARS) return null;

  const closes = bars.map((b) => b.close);
  const highs = bars.map((b) => b.high);
  const lows = bars.map((b) => b.low);
  if (!closes.every(isNum) || !highs.every(isNum) || !lows.every(isNum)) return null;

  const fit = linearRegression(closes);
  if (!fit) return null;

  // ── Family 2: directional movement, no line involved ──
  const adxSeries = adx(highs, lows, closes, adxPeriod);
  const last = <T,>(a: T[]): T | null => (Array.isArray(a) && a.length ? a[a.length - 1] : null);
  const adxRaw = last(adxSeries.adx);
  const adxValue = isNum(adxRaw) ? adxRaw : 0;
  const plusDi = last(adxSeries.plusDi);
  const minusDi = last(adxSeries.minusDi);

  // ── Verdict: each family votes; disagreement is reported, never averaged away ──
  const r2SaysTrending = fit.r2 >= TREND_THRESHOLDS.r2Trending;
  const r2SaysRanging = fit.r2 < TREND_THRESHOLDS.r2Ranging;
  const adxSaysTrending = adxValue >= TREND_THRESHOLDS.adxTrending;
  const adxSaysRanging = adxValue < TREND_THRESHOLDS.adxRanging;
  const leaningUp = fit.slope > 0;

  let verdict: TrendVerdict;
  if (r2SaysTrending && adxSaysTrending) {
    verdict = leaningUp ? 'trending-up' : 'trending-down';
  } else if (r2SaysRanging || adxSaysRanging) {
    verdict = 'ranging';
  } else {
    // Both families are inside their ambiguous band, or exactly one confirms. Naming a direction
    // here would be a guess dressed as a reading.
    verdict = 'indeterminate';
  }

  // Confidence: how far each family sits past its LOWER band, in its own units.
  const r2Headroom = Math.max(0, Math.min(1, (fit.r2 - TREND_THRESHOLDS.r2Ranging) / (1 - TREND_THRESHOLDS.r2Ranging)));
  const adxHeadroom = Math.max(0, Math.min(1, adxValue / 60)); // 60 ADX is about as strong as it reads
  const confidence = Math.round(((r2Headroom + adxHeadroom) / 2) * 100);

  // ── Channel, at the last bar ──
  const band = channelMultiplier * fit.residualStd;
  const middle = fit.endValue;
  const upper = middle + band;
  const lower = middle - band;
  const lastClose = closes[closes.length - 1];
  const channel: ChannelReading = {
    upper: round5(upper),
    middle: round5(middle),
    lower: round5(lower),
    // `?? 50` only when the range is degenerate (residualStd 0 → zero-width channel), where every
    // close IS the line and "position" has no meaning. Stated rather than silently zeroed.
    positionPct: round1(positionInRange(lastClose, lower, upper) ?? 50),
    widthPct: middle === 0 ? 0 : round1(((upper - lower) / Math.abs(middle)) * 100),
  };

  // ── Donchian position: an independent "where am I in the recent range" ──
  const dc = donchianChannel(highs, lows, donchianPeriod);
  const dcUpper = dc.upper.length ? dc.upper[dc.upper.length - 1] : NaN;
  const dcLower = dc.lower.length ? dc.lower[dc.lower.length - 1] : NaN;
  const donchianPositionPct = round1(positionInRange(lastClose, dcLower, dcUpper) ?? 50);

  // ── Pivots: the structural half of the reading ──
  const pivots = confirmedPivots(bars, pivotLookback, pivotLookback);
  const recentHigh = [...pivots].reverse().find((p) => p.kind === 'high') ?? null;
  const recentLow = [...pivots].reverse().find((p) => p.kind === 'low') ?? null;

  // ── Invalidation ──
  //
  // ⚠️ THE RULE THAT MATTERS IS "on the CORRECT SIDE of price", and the first version of this
  // omitted it. An uptrend is invalidated BELOW price and a downtrend ABOVE, so a candidate on the
  // wrong side is not an invalidation — it is a level the market has ALREADY passed.
  //
  // MEASURED 2026-11-03 on WTI 1h: `trending-up`, last close 3.59, most recent confirmed swing low
  // 3.87. The old code picked the "tighter" candidate (3.87) and the UI labelled it "invalid below",
  // i.e. a stop ABOVE the price it was supposed to protect. The structure had already failed while
  // the 200-bar fit still leaned up — which is itself worth knowing, so it is reported as
  // `alreadyBroken` rather than hidden by dropping the level.
  const regressionEdge = verdict === 'trending-down' ? upper : lower;
  const swingLevel = verdict === 'trending-down'
    ? (recentHigh ? recentHigh.price : null)
    : (recentLow ? recentLow.price : null);

  const notApplicable = verdict === 'ranging' || verdict === 'indeterminate';

  // A direction is needed before a level can be on the "correct" side of price.
  const correctSide = (lvl: number) => (verdict === 'trending-down' ? lvl > lastClose : lvl < lastClose);
  const candidates = [regressionEdge, swingLevel]
    .filter((v): v is number => isNum(v))
    .filter(correctSide);

  // Closest to price wins: that is the level a reversal reaches FIRST. One rule for both directions,
  // because "closest" and "reached first" are the same thing whichever way price would have to move.
  let chosen: number | null = null;
  let chosenBasis: 'regression-edge' | 'swing-level' | 'none' = 'none';
  if (!notApplicable && candidates.length > 0) {
    const tightest = candidates.reduce((a, b) => (Math.abs(b - lastClose) < Math.abs(a - lastClose) ? b : a));
    chosen = round5(tightest);
    chosenBasis = isNum(swingLevel) && tightest === swingLevel ? 'swing-level' : 'regression-edge';
  }
  const alreadyBroken = !notApplicable && candidates.length === 0 && (isNum(regressionEdge) || isNum(swingLevel));

  // ── Projection: an extension of the fit, bounded by the R² it was fitted with ──
  const projectedMiddle = fit.endValue + fit.slope * horizonBars;
  const strength: 'strong' | 'moderate' | 'weak' | 'none' =
    confidence >= 70 ? 'strong' : confidence >= 45 ? 'moderate' : confidence > 0 ? 'weak' : 'none';

  return {
    verdict,
    confidence,
    // Agreement means both families landed in the SAME regime — either both trending or both ranging.
    familiesAgree: (r2SaysTrending && adxSaysTrending) || (r2SaysRanging && adxSaysRanging),
    regression: {
      ...fit,
      slope: round5(fit.slope),
      slopePctPerBar: round5(fit.slopePctPerBar),
      intercept: round5(fit.intercept),
      r2: round3(fit.r2),
      residualStd: round5(fit.residualStd),
      meanPrice: round5(fit.meanPrice),
      startValue: round5(fit.startValue),
      endValue: round5(fit.endValue),
    },
    adx: { value: round1(adxValue), plusDi: round1(isNum(plusDi) ? plusDi : 0), minusDi: round1(isNum(minusDi) ? minusDi : 0) },
    channel,
    donchianPositionPct,
    pivots: { recentHigh, recentLow },
    invalidation: {
      regressionEdge: roundOrNull(regressionEdge),
      swingLevel: roundOrNull(swingLevel),
      chosen,
      chosenBasis,
      alreadyBroken,
      notApplicable,
    },
    projection: {
      horizonBars,
      value: round5(projectedMiddle),
      upper: round5(projectedMiddle + band),
      lower: round5(projectedMiddle - band),
      strength,
    },
    sample: { bars: bars.length, used: fit.endIndex - fit.startIndex + 1, sufficient: true },
    thresholds: { ...TREND_THRESHOLDS },
  };
}
