/**
 * Divergence detection — the ONE copy of the algorithm.
 *
 * WHY THIS MODULE EXISTS (2026-09-21)
 * ===================================
 * `macd-divergence`, `obv-divergence` and `rsi-divergence` each carried a PRIVATE
 * copy of these five functions. Measured before extraction:
 *
 *   - `findSwingLows`, `findSwingHighs`, `checkBullishDivergence`,
 *     `checkBearishDivergence` were **semantically identical in all three files**.
 *     Every difference was an identifier name (`cur`/`current`,
 *     `getInd`/`getIndicator`) or brace placement. Comparing them character-by-
 *     character after stripping comments was the check that established this.
 *   - `computeDivergenceStrength` was **different in all three** — and justifiably
 *     so, because the three indicators live on wildly different scales (see
 *     `StrengthModel` below).
 *
 * The comments were the worst part. `macd-divergence.directive.ts` opened with
 * "Uses the shared divergence utilities from rsi-divergence.directive.ts" and then
 * contained, 118 lines later, "Local copies of shared utilities (avoid cross-file
 * imports)". `rsi-divergence.directive.ts` labelled its private block
 * "Shared Divergence Utilities". **A file documenting a design it had abandoned is
 * worse than no comment at all**, because the reader trusts it and stops looking.
 *
 * WHAT IS DELIBERATELY *NOT* SHARED
 * ---------------------------------
 * The strength formula's CONSTANTS. Three copies of a number is duplication; one
 * copy of a number used by three different indicator scales would be a BUG. The
 * function is shared and the calibration is declared per directive, so the three
 * choices sit next to each other and can be compared — which they could not while
 * they were buried in separate files.
 */

/** A local extreme in price, with the indicator's value at that same bar. */
export interface SwingPoint {
  index: number;
  price: number;
  indicatorValue: number;
}

/** A confirmed divergence between two consecutive swing points. */
export interface DivergencePair {
  price1: number;
  price2: number;
  ind1: number;
  ind2: number;
  index: number;
}

/**
 * How one directive normalises the two movements before combining them.
 *
 * ⚠️ These differ per directive ON PURPOSE. The indicator denominator exists to
 * express "how big is this move FOR THIS INDICATOR", and the scales are not
 * comparable:
 *
 *   | directive | indicator            | typical magnitude | denominator        |
 *   |-----------|----------------------|-------------------|--------------------|
 *   | macd      | MACD histogram       | ~1e-3 to 1e-2     | max(|ind1|, 0.0001)|
 *   | obv       | cumulative volume    | ~1e6              | max(|ind1|, 1)     |
 *   | rsi       | RSI                  | 0-100 (bounded)   | 100 (constant)     |
 *
 * A single shared denominator would either annihilate MACD's signal (divide by 1)
 * or saturate OBV's (divide by 0.0001). So the ALGORITHM is shared and the
 * CALIBRATION is declared by the caller.
 */
export interface StrengthModel {
  /** Weight on relative price movement. */
  priceWeight: number;
  /** Weight on indicator movement. */
  indWeight: number;
  /** Denominator for the indicator move — i.e. the indicator's own scale. */
  indDenominator: (ind1: number) => number;
}

/**
 * Prices at local minima: a low strictly below every low within `lookback` bars.
 * The indicator value at each of those bars is carried along.
 */
export function findSwingLows(
  lows: number[],
  lookback: number,
  getIndicator: (index: number) => number,
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    const current = lows[i];
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (lows[j] < current) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) {
      swings.push({
        index: i,
        price: current,
        indicatorValue: getIndicator(i),
      });
    }
  }
  return swings;
}

/** Prices at local maxima: a high strictly above every high within `lookback` bars. */
export function findSwingHighs(
  highs: number[],
  lookback: number,
  getIndicator: (index: number) => number,
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    const current = highs[i];
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] > current) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) {
      swings.push({
        index: i,
        price: current,
        indicatorValue: getIndicator(i),
      });
    }
  }
  return swings;
}

/**
 * Bullish divergence: price makes a LOWER low while the indicator makes a HIGHER low.
 * Compares only the last two swing lows — a divergence older than that is stale.
 */
export function checkBullishDivergence(
  swingLows: SwingPoint[],
): DivergencePair | null {
  if (swingLows.length < 2) return null;
  const prev = swingLows[swingLows.length - 2];
  const last = swingLows[swingLows.length - 1];
  if (last.price < prev.price && last.indicatorValue > prev.indicatorValue) {
    return {
      price1: prev.price,
      price2: last.price,
      ind1: prev.indicatorValue,
      ind2: last.indicatorValue,
      index: last.index,
    };
  }
  return null;
}

/**
 * Bearish divergence: price makes a HIGHER high while the indicator makes a LOWER high.
 * The mirror of `checkBullishDivergence`, and independent of it — a series can
 * produce both, and the caller decides which to prefer.
 */
export function checkBearishDivergence(
  swingHighs: SwingPoint[],
): DivergencePair | null {
  if (swingHighs.length < 2) return null;
  const prev = swingHighs[swingHighs.length - 2];
  const last = swingHighs[swingHighs.length - 1];
  if (last.price > prev.price && last.indicatorValue < prev.indicatorValue) {
    return {
      price1: prev.price,
      price2: last.price,
      ind1: prev.indicatorValue,
      ind2: last.indicatorValue,
      index: last.index,
    };
  }
  return null;
}

/**
 * Combined strength of a divergence, 0-1, capped so a violent move cannot exceed the
 * directive's ceiling. The price denominator has a fixed floor of 0.01 (a percentage
 * of price, so it is scale-free); the indicator denominator comes from the caller's
 * `StrengthModel` because it is NOT scale-free.
 */
export function computeDivergenceStrength(
  div: DivergencePair,
  model: StrengthModel,
): number {
  const priceMove =
    Math.abs(div.price2 - div.price1) / Math.max(Math.abs(div.price1), 0.01);
  const indMove =
    Math.abs(div.ind2 - div.ind1) / model.indDenominator(div.ind1);
  return Math.min(
    1.0,
    priceMove * model.priceWeight + indMove * model.indWeight,
  );
}
