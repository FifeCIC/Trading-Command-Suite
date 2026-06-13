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

/** SMA series over a window. Returns one SMA value per window position. */
export function smaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

/** Williams %R: -100 to 0, similar to stochastic but inverted. %R > -20 = overbought, < -80 = oversold. */
export function williamsR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  if (closes.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1));
    const l = Math.min(...lows.slice(i - period + 1, i + 1));
    result.push(h === l ? 0 : ((h - closes[i]) / (h - l)) * -100);
  }
  return result;
}

/** Rate of Change (momentum): ((current - prev) / prev) * 100 */
export function roc(closes: number[], period = 12): number[] {
  if (closes.length <= period) return [];
  const result: number[] = [];
  for (let i = period; i < closes.length; i++) {
    result.push(((closes[i] - closes[i - period]) / closes[i - period]) * 100);
  }
  return result;
}

/** Typical Price: (H + L + C) / 3 */
export function typicalPrice(highs: number[], lows: number[], closes: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    result.push((highs[i] + lows[i] + closes[i]) / 3);
  }
  return result;
}

/** Highest High over period */
export function highest(highs: number[], period: number): number[] {
  if (highs.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < highs.length; i++) {
    result.push(Math.max(...highs.slice(i - period + 1, i + 1)));
  }
  return result;
}

/** Lowest Low over period */
export function lowest(lows: number[], period: number): number[] {
  if (lows.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < lows.length; i++) {
    result.push(Math.min(...lows.slice(i - period + 1, i + 1)));
  }
  return result;
}

/** Standard Deviation over a window */
export function stdDev(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const result: number[] = [];
  for (let i = period - 1; i < values.length; i++) {
    const window = values.slice(i - period + 1, i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    result.push(Math.sqrt(variance));
  }
  return result;
}

/**
 * On-Balance Volume (OBV).
 * Cumulative total: add volume on up days, subtract on down days.
 * Returns OBV value for each bar (same length as input).
 */
export function obv(
  closes: number[],
  volumes: number[],
): number[] {
  if (closes.length < 2 || volumes.length < 2) return [];
  const result: number[] = [volumes[0]];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) {
      result.push(result[i - 1] + volumes[i]);
    } else if (closes[i] < closes[i - 1]) {
      result.push(result[i - 1] - volumes[i]);
    } else {
      result.push(result[i - 1]);
    }
  }
  return result;
}

/**
 * Money Flow Index (MFI).
 * Volume-weighted RSI using typical price (H+L+C)/3 and money flow over `period` bars.
 * Returns MFI values (0–100) for each bar after the initial period.
 */
export function mfi(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
  period: number = 14,
): number[] {
  const n = closes.length;
  if (n < period + 1) return [];

  const typicalPrices: number[] = [];
  for (let i = 0; i < n; i++) {
    typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
  }

  const rawMoneyFlows: number[] = [];
  for (let i = 1; i < n; i++) {
    rawMoneyFlows.push(typicalPrices[i] * volumes[i]);
  }

  const result: number[] = [];
  for (let i = period - 1; i < rawMoneyFlows.length; i++) {
    let posFlow = 0;
    let negFlow = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (typicalPrices[j + 1] > typicalPrices[j]) {
        posFlow += rawMoneyFlows[j];
      } else if (typicalPrices[j + 1] < typicalPrices[j]) {
        negFlow += rawMoneyFlows[j];
      }
    }
    if (negFlow === 0) {
      result.push(100);
    } else {
      const moneyRatio = posFlow / negFlow;
      result.push(100 - 100 / (1 + moneyRatio));
    }
  }
  return result;
}

/**
 * Average Directional Index (ADX) with +DI and -DI.
 * Uses Wilder's smoothing over `period` bars.
 * Returns { adx, plusDi, minusDi } arrays aligned to input.
 */
export function adx(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): { adx: number[]; plusDi: number[]; minusDi: number[] } {
  const n = closes.length;
  if (n < period + 1) return { adx: [], plusDi: [], minusDi: [] };

  // True Range and Directional Movement
  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];

  for (let i = 1; i < n; i++) {
    const highDiff = highs[i] - highs[i - 1];
    const lowDiff = lows[i - 1] - lows[i];

    // True Range
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ));

    // +DM
    if (highDiff > lowDiff && highDiff > 0) {
      plusDm.push(highDiff);
    } else {
      plusDm.push(0);
    }

    // -DM
    if (lowDiff > highDiff && lowDiff > 0) {
      minusDm.push(lowDiff);
    } else {
      minusDm.push(0);
    }
  }

  // Wilder's smoothing: first value is simple average, then smoothed
  const smooth = (values: number[], p: number): number[] => {
    const result: number[] = [];
    let sum = 0;
    for (let i = 0; i < p; i++) sum += values[i];
    result.push(sum / p);
    for (let i = p; i < values.length; i++) {
      result.push((result[result.length - 1] * (p - 1) + values[i]) / p);
    }
    return result;
  };

  const smoothedTr = smooth(tr, period);
  const smoothedPlusDm = smooth(plusDm, period);
  const smoothedMinusDm = smooth(minusDm, period);

  const plusDi: number[] = [];
  const minusDi: number[] = [];
  const adxResult: number[] = [];
  const dxValues: number[] = [];

  for (let i = 0; i < smoothedTr.length; i++) {
    plusDi.push(smoothedTr[i] === 0 ? 0 : (100 * smoothedPlusDm[i]) / smoothedTr[i]);
    minusDi.push(smoothedTr[i] === 0 ? 0 : (100 * smoothedMinusDm[i]) / smoothedTr[i]);

    const sumDi = plusDi[i] + minusDi[i];
    dxValues.push(sumDi === 0 ? 0 : (100 * Math.abs(plusDi[i] - minusDi[i])) / sumDi);
  }

  // Smooth DX to get ADX (Wilder's again)
  const firstAdx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
  adxResult.push(firstAdx);
  for (let i = period; i < dxValues.length; i++) {
    adxResult.push((adxResult[adxResult.length - 1] * (period - 1) + dxValues[i]) / period);
  }

  return { adx: adxResult, plusDi, minusDi };
}

/**
 * Stochastic Oscillator.
 * %K = 100 * (close - lowest_low) / (highest_high - lowest_low) over `kPeriod` bars.
 * %D = `dPeriod`-period SMA of %K.
 * Returns { k, d } arrays aligned to input.
 */
export function stochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3,
): { k: number[]; d: number[] } {
  const n = closes.length;
  if (n < kPeriod + dPeriod) return { k: [], d: [] };

  const k: number[] = [];
  for (let i = kPeriod - 1; i < n; i++) {
    const sliceHigh = highs.slice(i - kPeriod + 1, i + 1);
    const sliceLow = lows.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...sliceHigh);
    const lowest = Math.min(...sliceLow);
    const range = highest - lowest;
    k.push(range === 0 ? 50 : (100 * (closes[i] - lowest)) / range);
  }

  const d: number[] = [];
  for (let i = dPeriod - 1; i < k.length; i++) {
    const slice = k.slice(i - dPeriod + 1, i + 1);
    d.push(slice.reduce((a, b) => a + b, 0) / dPeriod);
  }

  return { k, d };
}

/**
 * Bollinger Bands.
 * Middle = SMA(period), Upper/Lower = middle ± multiplier * stddev.
 * Returns { upper, middle, lower, bandwidth, percentB } arrays.
 */
export function bollingerBands(
  closes: number[],
  period: number = 20,
  multiplier: number = 2,
): { upper: number[]; middle: number[]; lower: number[]; bandwidth: number[]; percentB: number[] } {
  const n = closes.length;
  if (n < period) return { upper: [], middle: [], lower: [], bandwidth: [], percentB: [] };

  const middle: number[] = [];
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  const percentB: number[] = [];

  for (let i = period - 1; i < n; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const avg = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, v) => sum + (v - avg) ** 2, 0) / period;
    const stddev = Math.sqrt(variance);

    const up = avg + multiplier * stddev;
    const low = avg - multiplier * stddev;
    const range = up - low;

    middle.push(avg);
    upper.push(up);
    lower.push(low);
    bandwidth.push(range > 0 ? (range / avg) * 100 : 0);
    percentB.push(range > 0 ? (closes[i] - low) / range : 0.5);
  }

  return { upper, middle, lower, bandwidth, percentB };
}

/**
 * Awesome Oscillator (AO).
 * Bill Williams: SMA(median, 5) - SMA(median, 34) where median = (H+L)/2.
 * Positive = momentum up. Zero-line cross = signal.
 */
export function awesomeOscillator(highs: number[], lows: number[], fastPeriod = 5, slowPeriod = 34): number[] {
  const n = highs.length;
  if (n < slowPeriod) return [];
  const median: number[] = [];
  for (let i = 0; i < n; i++) median.push((highs[i] + lows[i]) / 2);
  const fastSma = smaSeries(median, fastPeriod);
  const slowSma = smaSeries(median, slowPeriod);
  const offset = slowPeriod - fastPeriod;
  const result: number[] = [];
  for (let i = 0; i < slowSma.length; i++) {
    result.push(fastSma[i + offset] - slowSma[i]);
  }
  return result;
}

/**
 * DeMarker (DeM) indicator.
 * DeM = SMA(deMax, period) / (SMA(deMax, period) + SMA(deMin, period))
 * deMax = high - prevLow if > 0 else 0
 * deMin = prevHigh - low if > 0 else 0
 * Range: 0-1. > 0.7 = overbought, < 0.3 = oversold.
 */
export function demarker(highs: number[], lows: number[], period = 14): number[] {
  const n = highs.length;
  if (n < period + 1) return [];
  const deMax: number[] = [];
  const deMin: number[] = [];
  for (let i = 1; i < n; i++) {
    deMax.push(Math.max(highs[i] - lows[i - 1], 0));
    deMin.push(Math.max(highs[i - 1] - lows[i], 0));
  }
  const maxSma = smaSeries(deMax, period);
  const minSma = smaSeries(deMin, period);
  const result: number[] = [];
  for (let i = 0; i < maxSma.length; i++) {
    const denom = maxSma[i] + minSma[i];
    result.push(denom === 0 ? 0.5 : maxSma[i] / denom);
  }
  return result;
}

/**
 * Bulls Power.
 * BullsPower = High - EMA(close, 13). Positive = buyers in control.
 */
export function bullsPower(highs: number[], closes: number[], period = 13): number[] {
  const emaValues = ema(closes, period);
  const offset = closes.length - emaValues.length;
  const result: number[] = [];
  for (let i = 0; i < emaValues.length; i++) {
    result.push(highs[i + offset] - emaValues[i]);
  }
  return result;
}

/**
 * Bears Power.
 * BearsPower = Low - EMA(close, 13). Negative = sellers in control.
 */
export function bearsPower(lows: number[], closes: number[], period = 13): number[] {
  const emaValues = ema(closes, period);
  const offset = closes.length - emaValues.length;
  const result: number[] = [];
  for (let i = 0; i < emaValues.length; i++) {
    result.push(lows[i + offset] - emaValues[i]);
  }
  return result;
}

/**
 * Force Index.
 * FI = volume * (close - prevClose). Smoothed with EMA(period).
 * Positive = price up on volume (bullish). Negative = down on volume (bearish).
 */
export function forceIndex(closes: number[], volumes: number[], period = 13): number[] {
  const n = closes.length;
  if (n < period + 1) return [];
  const raw: number[] = [];
  for (let i = 1; i < n; i++) {
    raw.push(volumes[i] * (closes[i] - closes[i - 1]));
  }
  const result = ema(raw, period);
  const offset = raw.length - result.length;
  return result.map((v, i) => raw[i + offset]);
}

/**
 * Chaikin Money Flow (CMF).
 * CMF = sum(MFV, period) / sum(volume, period) over `period` bars.
 * MFV = ((close - low) - (high - close)) / (high - low) * volume
 * Positive = accumulation. > 0.2 = strong buying pressure.
 */
export function chaikinMoneyFlow(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): number[] {
  const n = closes.length;
  if (n < period) return [];
  const mfv: number[] = [];
  for (let i = 0; i < n; i++) {
    const range = highs[i] - lows[i];
    if (range === 0) { mfv.push(0); continue; }
    mfv.push(((closes[i] - lows[i]) - (highs[i] - closes[i])) / range * volumes[i]);
  }
  const result: number[] = [];
  for (let i = period - 1; i < n; i++) {
    let volSum = 0;
    let mfvSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volSum += volumes[j];
      mfvSum += mfv[j];
    }
    result.push(volSum === 0 ? 0 : mfvSum / volSum);
  }
  return result;
}

/**
 * Accumulation/Distribution Line (A/D).
 * CLV = ((close - low) - (high - close)) / (high - low)
 * AD = prevAD + CLV * volume
 */
export function accumulationDistribution(highs: number[], lows: number[], closes: number[], volumes: number[]): number[] {
  const n = closes.length;
  if (n < 2) return [];
  const result: number[] = [0];
  for (let i = 1; i < n; i++) {
    const range = highs[i] - lows[i];
    const clv = range === 0 ? 0 : ((closes[i] - lows[i]) - (highs[i] - closes[i])) / range;
    result.push(result[i - 1] + clv * volumes[i]);
  }
  return result;
}

/**
 * Ease of Movement (EoM).
 * EMV = ((H+L)/2 - (prevH+prevL)/2) / (volume / scaleFactor)
 * Positive = price moves up easily (low resistance). High values = strong trend.
 */
export function easeOfMovement(highs: number[], lows: number[], volumes: number[], period = 14, scaleFactor = 1000000): number[] {
  const n = highs.length;
  if (n < period + 1) return [];
  const raw: number[] = [];
  for (let i = 1; i < n; i++) {
    const midpointMove = ((highs[i] + lows[i]) / 2) - ((highs[i - 1] + lows[i - 1]) / 2);
    const volRatio = volumes[i] / scaleFactor;
    raw.push(volRatio === 0 ? 0 : midpointMove / volRatio);
  }
  return smaSeries(raw, period);
}

/**
 * Donchian Channel.
 * Upper = highest high over `period`, Lower = lowest low over `period`, Middle = (U+L)/2.
 */
export function donchianChannel(highs: number[], lows: number[], period = 20): { upper: number[]; middle: number[]; lower: number[] } {
  const n = highs.length;
  if (n < period) return { upper: [], middle: [], lower: [] };
  const upper: number[] = [];
  const lower: number[] = [];
  const middle: number[] = [];
  for (let i = period - 1; i < n; i++) {
    const h = Math.max(...highs.slice(i - period + 1, i + 1));
    const l = Math.min(...lows.slice(i - period + 1, i + 1));
    upper.push(h);
    lower.push(l);
    middle.push((h + l) / 2);
  }
  return { upper, middle, lower };
}

/**
 * Keltner Channel.
 * Middle = EMA(close, period), Upper = Middle + ATR * multiplier, Lower = Middle - ATR * multiplier.
 */
export function keltnerChannel(highs: number[], lows: number[], closes: number[], period = 20, multiplier = 2): { upper: number[]; middle: number[]; lower: number[] } {
  const n = closes.length;
  if (n < period + 1) return { upper: [], middle: [], lower: [] };
  const middle = ema(closes, period);
  const atrValues = atr(highs, lows, closes, period);
  const offset = n - middle.length;
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < middle.length; i++) {
    const atrVal = atrValues[i] || 0;
    upper.push(middle[i] + multiplier * atrVal);
    lower.push(middle[i] - multiplier * atrVal);
  }
  return { upper, middle, lower };
}

/**
 * Parabolic SAR (simplified).
 * Step-based: SAR follows price with acceleration factor.
 * Returns { sar: number[], trend: number[] } where trend > 0 = uptrend, < 0 = downtrend.
 */
export function parabolicSar(highs: number[], lows: number[], step = 0.02, maxStep = 0.2): { sar: number[]; trend: number[] } {
  const n = highs.length;
  if (n < 3) return { sar: [], trend: [] };
  const sar: number[] = [];
  const trend: number[] = [];
  let isUp = true;
  let ep = highs[0];
  let af = step;
  let currentSar = lows[0];
  for (let i = 1; i < n; i++) {
    sar.push(currentSar);
    trend.push(isUp ? 1 : -1);
    if (isUp) {
      if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, maxStep); }
      currentSar = currentSar + af * (ep - currentSar);
      if (currentSar > lows[i]) currentSar = lows[i];
      if (lows[i] < currentSar) { isUp = false; ep = lows[i]; af = step; currentSar = highs[i]; }
    } else {
      if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, maxStep); }
      currentSar = currentSar + af * (ep - currentSar);
      if (currentSar < highs[i]) currentSar = highs[i];
      if (highs[i] > currentSar) { isUp = true; ep = highs[i]; af = step; currentSar = lows[i]; }
    }
  }
  return { sar, trend };
}

/**
 * SuperTrend indicator.
 * Returns { trend: number[]; upper: number[]; lower: number[] } 
 * trend > 0 = uptrend (green), < 0 = downtrend (red).
 */
export function superTrend(highs: number[], lows: number[], closes: number[], period = 10, multiplier = 3): { trend: number[]; upper: number[]; lower: number[]; direction: number[] } {
  const n = closes.length;
  if (n < period + 1) return { trend: [], upper: [], lower: [], direction: [] };
  const atrValues = atr(highs, lows, closes, period);
  const hlAvg: number[] = [];
  for (let i = 0; i < n; i++) hlAvg.push((highs[i] + lows[i]) / 2);
  const atrOffset = n - atrValues.length;
  const upper: number[] = [];
  const lower: number[] = [];
  const direction: number[] = [];
  for (let i = 0; i < atrValues.length; i++) {
    const srcIdx = i + atrOffset;
    upper.push(hlAvg[srcIdx] + multiplier * atrValues[i]);
    lower.push(hlAvg[srcIdx] - multiplier * atrValues[i]);
  }
  direction.push(closes[n - 1] > upper[0] ? 1 : -1);
  for (let i = 1; i < atrValues.length; i++) {
    const prevDir = direction[i - 1];
    if (prevDir > 0) {
      if (closes[i + atrOffset] < lower[i]) direction.push(-1);
      else direction.push(1);
    } else {
      if (closes[i + atrOffset] > upper[i]) direction.push(1);
      else direction.push(-1);
    }
  }
  const result = atrValues.map((_, i) => direction[i] > 0 ? lower[i] : upper[i]);
  return { trend: result, upper, lower, direction };
}

/**
 * Commodity Channel Index (CCI).
 * Typical Price = (H+L+C)/3. CCI = (TP - SMA(TP)) / (0.015 * Mean Deviation).
 */
export function cci(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 20,
): number[] {
  const n = closes.length;
  if (n < period + 1) return [];

  const typicalPrices: number[] = [];
  for (let i = 0; i < n; i++) {
    typicalPrices.push((highs[i] + lows[i] + closes[i]) / 3);
  }

  const result: number[] = [];
  for (let i = period - 1; i < n; i++) {
    const slice = typicalPrices.slice(i - period + 1, i + 1);
    const sma = slice.reduce((a, b) => a + b, 0) / period;
    const meanDev = slice.reduce((sum, v) => sum + Math.abs(v - sma), 0) / period;

    result.push(meanDev === 0 ? 0 : (typicalPrices[i] - sma) / (0.015 * meanDev));
  }

  return result;
}

/**
 * Volume-Weighted Average Price (VWAP).
 * Cumulative: Σ(TypicalPrice × Volume) / ΣVolume.
 */
export function vwap(
  highs: number[],
  lows: number[],
  closes: number[],
  volumes: number[],
): number[] {
  const n = closes.length;
  if (n < 1) return [];
  const result: number[] = [];
  let cumPV = 0;
  let cumV = 0;
  for (let i = 0; i < n; i++) {
    const tp = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += tp * volumes[i];
    cumV += volumes[i];
    result.push(cumV > 0 ? cumPV / cumV : tp);
  }
  return result;
}
