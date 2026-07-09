/**
 * ZigZag Swing Detector
 * ======================
 * Identifies significant swing highs and lows in price data using
 * a configurable lookback window and minimum price movement filter.
 *
 * This is a data preprocessor — NOT a directive. It provides swing
 * points that Fibonacci, S/R, and other structure-aware directives
 * consume as inputs.
 *
 * Algorithm (TradingView-style):
 *   1. Scan each bar as a candidate pivot
 *   2. A swing high = bar whose high is higher than `lookback` bars
 *      on EACH side (left and right)
 *   3. A swing low = bar whose low is lower than `lookback` bars
 *      on EACH side
 *   4. Noise filter: ignore swings whose price difference from the
 *      last confirmed swing is less than `minMovePct` % of price
 *   5. Returns ordered array of SwingPoint { index, price, type }
 *
 * Reference: https://www.tradingview.com/script/HBwvfMC8-Swing-High-Low-ZigZag-Aala-heaven/
 *
 * @module ZigZag
 */

export interface SwingPoint {
  /** Bar index in the source array (0 = oldest) */
  index: number;
  /** Price level (high for swing highs, low for swing lows) */
  price: number;
  /** Whether this is a swing high or swing low */
  type: 'high' | 'low';
}

export interface ZigZagOptions {
  /** Number of bars on each side that must be lower/higher (default 5) */
  lookback?: number;
  /** Minimum % price movement from last confirmed swing to qualify (default 0.5) */
  minMovePct?: number;
}

/**
 * Detect swing highs and lows using the ZigZag algorithm.
 *
 * @param highs  - Array of high prices (oldest at index 0)
 * @param lows   - Array of low prices (oldest at index 0)
 * @param closes - Array of close prices for minMovePct calculation
 * @param options - { lookback (default 5), minMovePct (default 0.5) }
 * @returns Array of SwingPoint ordered by bar index ascending
 */
export function detectZigZagSwings(
  highs: number[],
  lows: number[],
  closes: number[],
  options: ZigZagOptions = {},
): SwingPoint[] {
  const lookback = options.lookback ?? 5;
  const minMovePct = options.minMovePct ?? 0.5;

  const len = highs.length;
  if (len < lookback * 2 + 1) return [];

  const swings: SwingPoint[] = [];
  let lastSwingPrice: number | null = null;
  let lastSwingType: 'high' | 'low' | null = null;

  // Scan each candidate bar (must have `lookback` bars on each side)
  for (let i = lookback; i < len - lookback; i++) {
    const high = highs[i];
    const low = lows[i];

    // ── Check swing high ──
    let isSwingHigh = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] >= high) {
        isSwingHigh = false;
        break;
      }
    }

    // ── Check swing low ──
    let isSwingLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (lows[j] <= low) {
        isSwingLow = false;
        break;
      }
    }

    // Both can't be true simultaneously (would require a single-bar
    // range to dominate the entire window)
    if (isSwingHigh && isSwingLow) {
      // Pick the more extreme relative to closes
      const closeAtI = closes[i];
      if (high - closeAtI > closeAtI - low) {
        isSwingLow = false;
      } else {
        isSwingHigh = false;
      }
    }

    // ── Apply noise filter ──
    if (isSwingHigh) {
      const price = high;
      if (shouldAcceptSwing(price, 'high', lastSwingPrice, lastSwingType, closes[i], minMovePct)) {
        swings.push({ index: i, price, type: 'high' });
        lastSwingPrice = price;
        lastSwingType = 'high';
      }
    } else if (isSwingLow) {
      const price = low;
      if (shouldAcceptSwing(price, 'low', lastSwingPrice, lastSwingType, closes[i], minMovePct)) {
        swings.push({ index: i, price, type: 'low' });
        lastSwingPrice = price;
        lastSwingType = 'low';
      }
    }
  }

  return swings;
}

/**
 * Decide whether to accept a candidate swing based on the noise filter.
 * - First swing is always accepted.
 * - Subsequent swings must alternate (high → low → high).
 * - The % move from the last confirmed swing must exceed minMovePct.
 */
function shouldAcceptSwing(
  price: number,
  type: 'high' | 'low',
  lastPrice: number | null,
  lastType: 'high' | 'low' | null,
  currentClose: number,
  minMovePct: number,
): boolean {
  // First swing — always accept
  if (lastPrice === null || lastType === null) return true;

  // Must alternate
  if (type === lastType) {
    // Same direction: replace if more extreme
    if (type === 'high') return price > lastPrice;
    return price < lastPrice;
  }

  // Check minimum move %
  const referencePrice = currentClose > 0 ? currentClose : price;
  const movePct = (Math.abs(price - lastPrice) / referencePrice) * 100;
  return movePct >= minMovePct;
}

/**
 * Convenience: extract just the swing high prices from a ZigZag result.
 */
export function swingHighs(swings: SwingPoint[]): number[] {
  return swings.filter(s => s.type === 'high').map(s => s.price);
}

/**
 * Convenience: extract just the swing low prices from a ZigZag result.
 */
export function swingLows(swings: SwingPoint[]): number[] {
  return swings.filter(s => s.type === 'low').map(s => s.price);
}

/**
 * Convenience: get the most recent swing high before a given bar index.
 * Returns null if none found.
 */
export function lastSwingHigh(swings: SwingPoint[], beforeIndex?: number): SwingPoint | null {
  const filtered = beforeIndex !== undefined
    ? swings.filter(s => s.index < beforeIndex && s.type === 'high')
    : swings.filter(s => s.type === 'high');
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}

/**
 * Convenience: get the most recent swing low before a given bar index.
 * Returns null if none found.
 */
export function lastSwingLow(swings: SwingPoint[], beforeIndex?: number): SwingPoint | null {
  const filtered = beforeIndex !== undefined
    ? swings.filter(s => s.index < beforeIndex && s.type === 'low')
    : swings.filter(s => s.type === 'low');
  return filtered.length > 0 ? filtered[filtered.length - 1] : null;
}
