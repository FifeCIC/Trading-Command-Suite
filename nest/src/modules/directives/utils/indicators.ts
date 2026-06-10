/**
 * Technical Indicator Math Utilities
 * ===================================
 * Pure functions for RSI, EMA, MACD, ATR calculations.
 * Used by directive implementations. No side effects.
 */

/** Exponential Moving Average over close prices. */
export function ema(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result.push(sum / period);

  for (let i = period; i < closes.length; i++) {
    result.push(closes[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

/** RSI(period) series from close prices. Returns array starting at index `period`. */
export function rsi(closes: number[], period = 14): number[] {
  if (closes.length <= period) return [];
  const result: number[] = [];

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  // Smoothed
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

/** MACD (fast, slow, signal). Returns { macd, signal, histogram } arrays. */
export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): { macd: number[]; signal: number[]; histogram: number[] } {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);

  // Align: emaSlow starts at index (slow - fast) relative to emaFast
  const offset = slow - fast;
  const macdLine: number[] = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }

  const signalLine = ema(macdLine, signal);
  const sigOffset = signal - 1;
  const histogram: number[] = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + sigOffset] - signalLine[i]);
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/** Average True Range series. */
export function atr(
  highs: number[],
  lows: number[],
  closes: number[],
  period = 14,
): number[] {
  if (highs.length < period + 1) return [];

  const trValues: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    );
    trValues.push(tr);
  }

  // First ATR is SMA of first `period` TR values
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trValues[i];
  const result: number[] = [sum / period];

  // Smoothed
  for (let i = period; i < trValues.length; i++) {
    result.push(
      (result[result.length - 1] * (period - 1) + trValues[i]) / period,
    );
  }
  return result;
}

/** Simple Moving Average of the last N values. */
export function sma(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}
