/**
 * MT5-Sourced Directives — Batch 1
 * =================================
 * Derived from popular free MT5/MQL5 indicators and trading strategies.
 * Each directive does ONE thing with fixed, known math.
 *
 * Sources: MQL5 Market free indicators, MetaEditor Code Base,
 * TradePress PHP directive library.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import {
  williamsR,
  roc,
  highest,
  lowest,
  stdDev,
  typicalPrice,
  ema,
  sma,
  smaSeries,
  atr,
  adx,
  bollingerBands,
  macd,
  rsi,
} from '../utils/indicators';

// ── Helpers ─────────────────────────────────────────────────

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// =====================================================================
// 1. Williams %R — Oversold/Overbought oscillator
// =====================================================================

@Injectable()
export class WilliamsRDirective implements IDirective {
  readonly id = 'williams-r';
  readonly name = 'Williams %R Oscillator';
  readonly description =
    'Williams %R below -80 = oversold bounce. Above -20 = overbought. Derived from MT5 Williams %R indicator.';
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 15;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const wr = williamsR(highs, lows, closes, 14);
    const current = wr[wr.length - 1];
    const prev = wr[wr.length - 2];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'Williams %R unavailable' };
    }

    // Oversold bounce: %R < -80 and curling up
    if (current < -80 && current > prev) {
      const score = clamp(Math.round(60 + Math.abs(current + 80) * 2), 0, this.maxScore);
      return { score, confidence: 0.7, signalClass: 'bullish', reason: `Williams %R ${current.toFixed(1)} — oversold bounce` };
    }

    // Deep oversold
    if (current < -80) {
      return { score: 45, confidence: 0.5, signalClass: 'bullish', reason: `Williams %R ${current.toFixed(1)} — deep oversold` };
    }

    // Overbought
    if (current > -20) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `Williams %R ${current.toFixed(1)} — overbought` };
    }

    return { score: 30, confidence: 0.3, signalClass: 'neutral', reason: `Williams %R ${current.toFixed(1)} — neutral` };
  }
}

// =====================================================================
// 2. Awesome Oscillator — Bill Williams' momentum
// =====================================================================

@Injectable()
export class AwesomeOscillatorDirective implements IDirective {
  readonly id = 'awesome-oscillator';
  readonly name = 'Awesome Oscillator (Bill Williams)';
  readonly description =
    '5-period SMA of midpoints minus 34-period SMA. Green bars and rising = bullish momentum. Derived from MT5 Awesome Oscillator.';
  readonly priority = 40;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const mids = bars.map((b) => (b.high + b.low) / 2);
    const MIN = 40;

    if (mids.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${mids.length}` };
    }

    const sma5 = smaSeries(mids, 5);
    const sma34 = smaSeries(mids, 34);
    const ao: number[] = [];
    for (let i = 34; i < mids.length; i++) {
      ao.push(sma5[i] - sma34[i]);
    }

    const current = ao[ao.length - 1];
    const prev = ao[ao.length - 2];
    const prev2 = ao[ao.length - 3];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'AO unavailable' };
    }

    // Bullish: green bar (higher than prev), above zero, and rising
    if (current > prev && current > 0 && prev > prev2) {
      return { score: 70, confidence: 0.65, signalClass: 'bullish', reason: `AO ${current.toFixed(4)} — green above zero, rising` };
    }

    // Bullish saucer: 3 green bars above zero
    if (current > prev && prev > prev2 && current > 0) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `AO saucer — 3 rising green bars` };
    }

    // Bearish: below zero and falling
    if (current < 0 && current < prev) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `AO ${current.toFixed(4)} — red below zero` };
    }

    // Zero-line cross up
    if (current > 0 && prev <= 0) {
      return { score: 65, confidence: 0.6, signalClass: 'bullish', reason: 'AO crossed above zero line' };
    }

    return { score: 35, confidence: 0.3, signalClass: 'neutral', reason: `AO ${current.toFixed(4)} — neutral` };
  }
}

// =====================================================================
// 3. Force Index — Elder's volume-weighted momentum
// =====================================================================

@Injectable()
export class ForceIndexDirective implements IDirective {
  readonly id = 'force-index';
  readonly name = "Force Index (Elder's)";
  readonly description =
    'Volume × price change, smoothed. Positive and rising = strong buying pressure. Derived from MT5 Force Index.';
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const MIN = 20;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const rawFI: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      rawFI.push((closes[i] - closes[i - 1]) * volumes[i]);
    }

    const fi13 = ema(rawFI, 13);
    const current = fi13[fi13.length - 1];
    const prev = fi13[fi13.length - 2];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'Force Index unavailable' };
    }

    // Strong buying: positive and rising
    if (current > 0 && current > prev) {
      const score = clamp(Math.round(50 + Math.min(current / 100000, 30)), 0, this.maxScore);
      return { score, confidence: 0.65, signalClass: 'bullish', reason: `Force Index +${current.toFixed(0)} — strong buying` };
    }

    // Buying pressure: positive but fading
    if (current > 0) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `Force Index +${current.toFixed(0)} — positive` };
    }

    // Selling pressure
    if (current < 0 && current < prev) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `Force Index ${current.toFixed(0)} — strong selling` };
    }

    return { score: 30, confidence: 0.3, signalClass: 'neutral', reason: `Force Index ${current.toFixed(0)} — neutral` };
  }
}

// =====================================================================
// 4. Chaikin Money Flow — Volume-weighted accumulation/distribution
// =====================================================================

@Injectable()
export class ChaikinMoneyFlowDirective implements IDirective {
  readonly id = 'chaikin-mf';
  readonly name = 'Chaikin Money Flow';
  readonly description =
    'Volume-weighted accumulation/distribution over 21 periods. CMF > 0.1 = accumulation. Derived from MT5 Chaikin Money Flow.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN = 25;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    const period = 21;
    const mfMultipliers: number[] = [];
    const mfVolumes: number[] = [];

    for (let i = 0; i < bars.length; i++) {
      const { high, low, close, volume } = bars[i];
      const range = high - low;
      const mfm = range > 0 ? ((close - low) - (high - close)) / range : 0;
      mfMultipliers.push(mfm);
      mfVolumes.push(mfm * volume);
    }

    // Sum over period
    const cmfValues: number[] = [];
    for (let i = period; i < bars.length; i++) {
      const mfvSum = mfVolumes.slice(i - period, i).reduce((a, b) => a + b, 0);
      const volSum = bars.slice(i - period, i).reduce((a, b) => a + b.volume, 0);
      cmfValues.push(volSum > 0 ? mfvSum / volSum : 0);
    }

    const current = cmfValues[cmfValues.length - 1];
    const prev = cmfValues[cmfValues.length - 2];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'CMF unavailable' };
    }

    // Strong accumulation
    if (current > 0.1 && current > prev) {
      return { score: 80, confidence: 0.75, signalClass: 'bullish', reason: `CMF ${current.toFixed(3)} — strong accumulation` };
    }

    // Mild accumulation
    if (current > 0) {
      return { score: 60, confidence: 0.55, signalClass: 'bullish', reason: `CMF ${current.toFixed(3)} — accumulation` };
    }

    // Distribution
    if (current < -0.1) {
      return { score: 10, confidence: 0.7, signalClass: 'bearish', reason: `CMF ${current.toFixed(3)} — strong distribution` };
    }

    return { score: 30, confidence: 0.35, signalClass: 'neutral', reason: `CMF ${current.toFixed(3)} — neutral` };
  }
}

// =====================================================================
// 5. Donchian Channel Breakout
// =====================================================================

@Injectable()
export class DonchianBreakoutDirective implements IDirective {
  readonly id = 'donchian-breakout';
  readonly name = 'Donchian Channel Breakout';
  readonly description =
    'Price breaking above 20-period high = bullish breakout. Derived from MT5 Donchian Channel.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN = 25;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    const period = 20;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const hh = highest(highs, period);
    const ll = lowest(lows, period);

    const lastClose = closes[closes.length - 1];
    const upperBand = hh[hh.length - 1];
    const lowerBand = ll[ll.length - 1];
    const midBand = (upperBand + lowerBand) / 2;
    const prevClose = closes[closes.length - 2];
    const prevUpper = hh[hh.length - 2];

    // Breakout above upper band
    if (lastClose > upperBand && prevClose <= prevUpper) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `Price ${lastClose} broke above Donchian high ${upperBand.toFixed(2)}` };
    }

    // Near upper band
    if (lastClose > midBand && lastClose >= upperBand * 0.98) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `Price near Donchian upper band` };
    }

    // Below lower band
    if (lastClose < lowerBand) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `Price below Donchian low ${lowerBand.toFixed(2)}` };
    }

    return { score: 35, confidence: 0.3, signalClass: 'neutral', reason: `Price within Donchian channel` };
  }
}

// =====================================================================
// 6. Keltner Channel Squeeze
// =====================================================================

@Injectable()
export class KeltnerChannelDirective implements IDirective {
  readonly id = 'keltner-channel';
  readonly name = 'Keltner Channel Squeeze';
  readonly description =
    'EMA(20) ± 2×ATR(10). Price near upper band = bullish, band squeeze = impending expansion. Derived from MT5 Keltner Channel.';
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const closes = bars.map((b) => b.close);
    const MIN = 30;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const ema20 = ema(closes, 20);
    const atr10 = atr(
      bars.map((b) => b.high),
      bars.map((b) => b.low),
      closes,
      10,
    );

    const lastClose = closes[closes.length - 1];
    const lastEMA = ema20[ema20.length - 1];
    const lastATR = atr10[atr10.length - 1];
    const upper = lastEMA + 2 * lastATR;
    const lower = lastEMA - 2 * lastATR;
    const bandwidth = (upper - lower) / lastEMA;

    // Squeeze detection: narrow bands
    const prevATR = atr10[atr10.length - 2];
    if (bandwidth < 0.05 && lastATR < prevATR) {
      return { score: 50, confidence: 0.55, signalClass: 'bullish', reason: `Keltner squeeze — bandwidth ${(bandwidth * 100).toFixed(1)}%` };
    }

    // Above upper band
    if (lastClose > upper) {
      return { score: 70, confidence: 0.65, signalClass: 'bullish', reason: `Price above Keltner upper band ${upper.toFixed(2)}` };
    }

    // Near upper band
    if (lastClose > lastEMA && lastClose > upper * 0.95) {
      return { score: 60, confidence: 0.55, signalClass: 'bullish', reason: 'Price riding Keltner upper band' };
    }

    // Below lower band
    if (lastClose < lower) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `Price below Keltner lower band` };
    }

    return { score: 35, confidence: 0.3, signalClass: 'neutral', reason: 'Price within Keltner Channel' };
  }
}

// =====================================================================
// 7. SuperTrend — ATR-based trailing stop/trend
// =====================================================================

@Injectable()
export class SuperTrendDirective implements IDirective {
  readonly id = 'supertrend';
  readonly name = 'SuperTrend Indicator';
  readonly description =
    'ATR(10) × 3 multiplier trailing stop. Green (price above) = uptrend. Red = downtrend. Derived from MT5 SuperTrend.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 15;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const period = 10;
    const multiplier = 3;
    const atrVals = atr(highs, lows, closes, period);
    const lastClose = closes[closes.length - 1];
    const lastATR = atrVals[atrVals.length - 1];
    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];

    const basicUpper = (lastHigh + lastLow) / 2 + multiplier * lastATR;
    const basicLower = (lastHigh + lastLow) / 2 - multiplier * lastATR;

    // Above SuperTrend = uptrend
    if (lastClose > basicUpper) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `SuperTrend — strong uptrend (price ${lastClose} > ${basicUpper.toFixed(2)})` };
    }

    if (lastClose > basicLower && lastClose <= basicUpper) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `SuperTrend — moderate uptrend` };
    }

    return { score: 15, confidence: 0.6, signalClass: 'bearish', reason: `SuperTrend — downtrend (price below ${basicLower.toFixed(2)})` };
  }
}

// =====================================================================
// 8. Parabolic SAR — Trend direction
// =====================================================================

@Injectable()
export class ParabolicSARDirective implements IDirective {
  readonly id = 'parabolic-sar';
  readonly name = 'Parabolic SAR Trend';
  readonly description =
    'Price above PSAR = uptrend, below = downtrend. Acceleration factor 0.02, max 0.2. Derived from MT5 Parabolic SAR.';
  readonly priority = 48;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 10;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    // Simple PSAR calculation
    const afStart = 0.02;
    const afStep = 0.02;
    const afMax = 0.2;
    const sar: number[] = [lows[0]];
    let isLong = true;
    let ep = highs[0];
    let af = afStart;

    for (let i = 1; i < bars.length; i++) {
      const prevSar = sar[i - 1];
      let newSar = prevSar + af * (ep - prevSar);

      if (isLong) {
        newSar = Math.min(newSar, lows[i - 1], lows[i - 2] ?? lows[i - 1]);
        if (closes[i] < newSar) {
          isLong = false;
          newSar = ep;
          ep = lows[i];
          af = afStart;
        } else if (highs[i] > ep) {
          ep = highs[i];
          af = Math.min(af + afStep, afMax);
        }
      } else {
        newSar = Math.max(newSar, highs[i - 1], highs[i - 2] ?? highs[i - 1]);
        if (closes[i] > newSar) {
          isLong = true;
          newSar = ep;
          ep = highs[i];
          af = afStart;
        } else if (lows[i] < ep) {
          ep = lows[i];
          af = Math.min(af + afStep, afMax);
        }
      }

      sar.push(newSar);
    }

    const lastClose = closes[closes.length - 1];
    const lastSAR = sar[sar.length - 1];
    const prevClose = closes[closes.length - 2];
    const prevSAR = sar[sar.length - 2];

    // Flip to uptrend (price crossed above SAR)
    if (prevClose <= prevSAR && lastClose > lastSAR) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `PSAR flip to uptrend — price ${lastClose} > SAR ${lastSAR.toFixed(2)}` };
    }

    // Uptrend continuing
    if (lastClose > lastSAR) {
      const dist = (lastClose - lastSAR) / lastClose;
      const score = clamp(Math.round(50 + dist * 200), 0, this.maxScore);
      return { score, confidence: 0.6, signalClass: 'bullish', reason: `PSAR uptrend — ${(dist * 100).toFixed(1)}% above SAR` };
    }

    return { score: 15, confidence: 0.55, signalClass: 'bearish', reason: `PSAR downtrend — price below SAR` };
  }
}

// =====================================================================
// 9. ADX DI Crossover — DI+/DI- crossover signals
// =====================================================================

@Injectable()
export class ADXDICrossoverDirective implements IDirective {
  readonly id = 'adx-di-crossover';
  readonly name = 'ADX DI+/DI- Crossover';
  readonly description =
    '+DI crossing above -DI with ADX > 20 = trend change to bullish. Derived from MT5 ADX crossover strategies.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 30;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const adxResult = adx(highs, lows, closes, 14);
    const plusDI = adxResult.plusDi;
    const minusDI = adxResult.minusDi;
    const adxVals = adxResult.adx;

    const currentPlus = plusDI[plusDI.length - 1];
    const prevPlus = plusDI[plusDI.length - 2];
    const currentMinus = minusDI[minusDI.length - 1];
    const prevMinus = minusDI[minusDI.length - 2];
    const currentADX = adxVals[adxVals.length - 1];

    // +DI crosses above -DI with trend strength
    const crossedUp = prevPlus <= prevMinus && currentPlus > currentMinus;
    if (crossedUp) {
      if (currentADX > 25) {
        return { score: 80, confidence: 0.75, signalClass: 'bullish', reason: `+DI crossed above -DI with ADX ${currentADX.toFixed(1)} — strong trend` };
      }
      return { score: 60, confidence: 0.55, signalClass: 'bullish', reason: `+DI crossed above -DI (ADX ${currentADX.toFixed(1)})` };
    }

    // +DI above -DI already
    if (currentPlus > currentMinus && currentADX > 20) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `+DI > -DI, ADX ${currentADX.toFixed(1)}` };
    }

    return { score: 20, confidence: 0.4, signalClass: 'bearish', reason: `-DI dominates, ADX ${currentADX.toFixed(1)}` };
  }
}

// =====================================================================
// 10. Bollinger %B — Position within bands
// =====================================================================

@Injectable()
export class BollingerPctBDirective implements IDirective {
  readonly id = 'bollinger-pct-b';
  readonly name = 'Bollinger Bands %B';
  readonly description =
    '%B = (price - lower) / (upper - lower). %B > 0.8 = near upper band, %B < 0.2 = near lower band. Derived from MT5 Bollinger %B.';
  readonly priority = 42;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const closes = bars.map((b) => b.close);
    const MIN = 22;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const bb = bollingerBands(closes, 20, 2);
    const lastClose = closes[closes.length - 1];
    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const pctB = (lastClose - lower) / (upper - lower || 1);

    if (pctB > 1.0) {
      return { score: 70, confidence: 0.65, signalClass: 'bullish', reason: `%B ${pctB.toFixed(2)} — breakout above upper band` };
    }

    if (pctB > 0.8) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `%B ${pctB.toFixed(2)} — riding upper band` };
    }

    if (pctB < 0.2) {
      return { score: 45, confidence: 0.45, signalClass: 'bullish', reason: `%B ${pctB.toFixed(2)} — near lower band, potential bounce` };
    }

    if (pctB < 0) {
      return { score: 10, confidence: 0.55, signalClass: 'bearish', reason: `%B ${pctB.toFixed(2)} — breakdown below lower band` };
    }

    return { score: 35, confidence: 0.3, signalClass: 'neutral', reason: `%B ${pctB.toFixed(2)} — mid-range` };
  }
}

// =====================================================================
// 11. ATR Trailing Stop — Volatility-based stop distance
// =====================================================================

@Injectable()
export class ATRTrailingStopDirective implements IDirective {
  readonly id = 'atr-trailing-stop';
  readonly name = 'ATR Trailing Stop Signal';
  readonly description =
    'Price above 3×ATR trailing stop = strong trend. Pullback to stop = potential entry. Derived from MT5 ATR Trailing Stop.';
  readonly priority = 48;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 25;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const atrVals = atr(highs, lows, closes, 14);
    const lastClose = closes[closes.length - 1];
    const lastATR = atrVals[atrVals.length - 1];

    // Long trailing stop: highest high - 3*ATR
    const highestHigh = Math.max(...highs.slice(-20));
    const trailingStop = highestHigh - 3 * lastATR;
    const distance = (lastClose - trailingStop) / lastClose;

    if (distance > 0.1) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `Strong uptrend — ${(distance * 100).toFixed(1)}% above trailing stop` };
    }

    if (distance > 0.03) {
      return { score: 60, confidence: 0.55, signalClass: 'bullish', reason: `Moderate trend — ${(distance * 100).toFixed(1)}% above trailing stop` };
    }

    if (distance < -0.02) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `Price below ATR trailing stop` };
    }

    return { score: 30, confidence: 0.3, signalClass: 'neutral', reason: 'Price near ATR trailing stop — watch for reversal' };
  }
}

// =====================================================================
// 12. Momentum ROC — Rate of Change
// =====================================================================

@Injectable()
export class MomentumROCDirective implements IDirective {
  readonly id = 'momentum-roc';
  readonly name = 'Momentum Rate of Change';
  readonly description =
    'ROC(12) crossing above zero = bullish momentum shift. ROC rising with high value = accelerating trend. Derived from MT5 Momentum/ROC.';
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const closes = bars.map((b) => b.close);
    const MIN = 15;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const rocVals = roc(closes, 12);
    const current = rocVals[rocVals.length - 1];
    const prev = rocVals[rocVals.length - 2];
    const prev2 = rocVals[rocVals.length - 3];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'ROC unavailable' };
    }

    // Zero-line cross up
    if (current > 0 && prev <= 0) {
      return { score: 70, confidence: 0.65, signalClass: 'bullish', reason: `ROC crossed above zero (${current.toFixed(1)}%) — momentum shift` };
    }

    // Strong positive momentum
    if (current > 5 && current > prev) {
      return { score: 80, confidence: 0.7, signalClass: 'bullish', reason: `ROC ${current.toFixed(1)}% — strong accelerating momentum` };
    }

    // Positive
    if (current > 0) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `ROC ${current.toFixed(1)}% — positive momentum` };
    }

    // Negative and worsening
    if (current < -5) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `ROC ${current.toFixed(1)}% — strong negative momentum` };
    }

    return { score: 25, confidence: 0.3, signalClass: 'neutral', reason: `ROC ${current.toFixed(1)}% — weak momentum` };
  }
}

// =====================================================================
// 13. DeMarker Oscillator
// =====================================================================

@Injectable()
export class DeMarkerDirective implements IDirective {
  readonly id = 'demarker';
  readonly name = 'DeMarker Oscillator';
  readonly description =
    'DeMax/DeMin ratio over 14 periods. > 0.7 = overbought, < 0.3 = oversold. Derived from MT5 DeMarker indicator.';
  readonly priority = 42;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const MIN = 18;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    const period = 14;
    const deMax: number[] = [];
    const deMin: number[] = [];

    for (let i = 1; i < bars.length; i++) {
      deMax.push(Math.max(0, highs[i] - highs[i - 1]));
      deMin.push(Math.max(0, lows[i - 1] - lows[i]));
    }

    const smaDeMax = smaSeries(deMax, period);
    const smaDeMin = smaSeries(deMin, period);
    const lastSmaMax = smaDeMax[smaDeMax.length - 1];
    const lastSmaMin = smaDeMin[smaDeMin.length - 1];
    const demarker = lastSmaMax / (lastSmaMax + lastSmaMin || 1);

    if (demarker < 0.3) {
      return { score: 65, confidence: 0.6, signalClass: 'bullish', reason: `DeMarker ${demarker.toFixed(2)} — oversold` };
    }

    if (demarker > 0.7) {
      return { score: 10, confidence: 0.55, signalClass: 'bearish', reason: `DeMarker ${demarker.toFixed(2)} — overbought` };
    }

    return { score: 40, confidence: 0.3, signalClass: 'neutral', reason: `DeMarker ${demarker.toFixed(2)} — neutral` };
  }
}

// =====================================================================
// 14. Accumulation/Distribution Line
// =====================================================================

@Injectable()
export class AccumulationDistDirective implements IDirective {
  readonly id = 'accumulation-dist';
  readonly name = 'Accumulation/Distribution Line';
  readonly description =
    'A/D line divergence from price. Rising A/D + flat price = accumulation. Derived from MT5 A/D indicator.';
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN = 20;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    // Calculate A/D line
    const adLine: number[] = [0];
    for (let i = 0; i < bars.length; i++) {
      const { high, low, close, volume } = bars[i];
      const range = high - low;
      let clv = 0;
      if (range > 0) {
        clv = ((close - low) - (high - close)) / range;
      }
      const moneyFlow = clv * volume;
      adLine.push((adLine[adLine.length - 1] || 0) + moneyFlow);
    }

    // Compare recent A/D trend with price trend
    const recent = adLine.slice(-10);
    const recentPrices = bars.slice(-10).map((b) => b.close);
    const adSlope = (recent[recent.length - 1] - recent[0]) / (Math.abs(recent[0]) || 1);
    const priceSlope = (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0];

    // Divergence: A/D rising but price flat/down = accumulation
    if (adSlope > 0.01 && priceSlope < 0.005) {
      return { score: 70, confidence: 0.65, signalClass: 'bullish', reason: 'A/D line diverging — accumulation with flat price' };
    }

    // Both rising = confirmed uptrend
    if (adSlope > 0.005 && priceSlope > 0) {
      return { score: 60, confidence: 0.55, signalClass: 'bullish', reason: 'A/D line confirming uptrend' };
    }

    // A/D falling = distribution
    if (adSlope < -0.01) {
      return { score: 15, confidence: 0.55, signalClass: 'bearish', reason: 'A/D line declining — distribution' };
    }

    return { score: 35, confidence: 0.3, signalClass: 'neutral', reason: 'A/D line neutral' };
  }
}

// =====================================================================
// 15. Bull Power / Bear Power — Elder's indicator
// =====================================================================

@Injectable()
export class BullsBearsPowerDirective implements IDirective {
  readonly id = 'bulls-bears-power';
  readonly name = 'Bulls Power / Bears Power';
  readonly description =
    "Elder's Bulls Power (High - EMA13) and Bears Power (Low - EMA13). Bulls > 0 and rising = bullish. Derived from MT5 Bulls/Bears Power.";
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 18;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const ema13 = ema(closes, 13);
    const bullPower = highs[highs.length - 1] - ema13[ema13.length - 1];
    const bearPower = lows[lows.length - 1] - ema13[ema13.length - 1];
    const prevBull = highs[highs.length - 2] - ema13[ema13.length - 2];

    // Bulls positive and rising
    if (bullPower > 0 && bullPower > prevBull) {
      return { score: 75, confidence: 0.65, signalClass: 'bullish', reason: `Bulls Power +${bullPower.toFixed(2)}, rising — strong buying` };
    }

    // Bulls positive but fading
    if (bullPower > 0) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `Bulls Power +${bullPower.toFixed(2)}` };
    }

    // Bears dominating (both negative)
    if (bullPower < 0 && bearPower < 0) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: `Bears dominating — Bulls ${bullPower.toFixed(2)}, Bears ${bearPower.toFixed(2)}` };
    }

    return { score: 30, confidence: 0.35, signalClass: 'neutral', reason: `Bulls ${bullPower.toFixed(2)}, Bears ${bearPower.toFixed(2)}` };
  }
}

// =====================================================================
// 16. Ease of Movement — Volume-adjusted price movement
// =====================================================================

@Injectable()
export class EaseOfMovementDirective implements IDirective {
  readonly id = 'ease-of-movement';
  readonly name = 'Ease of Movement (EoM)';
  readonly description =
    'Price change per unit of volume. Positive and rising = easy upward movement. Derived from MT5 Ease of Movement.';
  readonly priority = 40;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN = 20;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    const eomRaw: number[] = [];
    for (let i = 1; i < bars.length; i++) {
      const midMove = (bars[i].high + bars[i].low) / 2 - (bars[i - 1].high + bars[i - 1].low) / 2;
      const boxRatio = bars[i].volume > 0 ? bars[i].volume / (bars[i].high - bars[i].low || 1) : 0;
      eomRaw.push(boxRatio > 0 ? midMove / boxRatio : 0);
    }

    const eomSmooth = ema(eomRaw, 14);
    const current = eomSmooth[eomSmooth.length - 1];
    const prev = eomSmooth[eomSmooth.length - 2];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'EoM unavailable' };
    }

    // Easy upward movement
    if (current > 0 && current > prev) {
      return { score: 65, confidence: 0.6, signalClass: 'bullish', reason: `EoM +${current.toFixed(4)} — easy upward movement` };
    }

    if (current > 0) {
      return { score: 50, confidence: 0.45, signalClass: 'bullish', reason: `EoM +${current.toFixed(4)}` };
    }

    if (current < 0 && current < prev) {
      return { score: 10, confidence: 0.55, signalClass: 'bearish', reason: `EoM ${current.toFixed(4)} — difficult upward movement` };
    }

    return { score: 30, confidence: 0.3, signalClass: 'neutral', reason: `EoM ${current.toFixed(4)} — neutral` };
  }
}

// =====================================================================
// 17. Ichimoku Cloud — Price vs Cloud
// =====================================================================

@Injectable()
export class IchimokuCloudDirective implements IDirective {
  readonly id = 'ichimoku-cloud';
  readonly name = 'Ichimoku Cloud Position';
  readonly description =
    'Price above cloud = bullish, below = bearish, inside = neutral. Cloud color and thickness indicate support/resistance. Derived from MT5 Ichimoku.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 60;

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    // Tenkan-sen (9), Kijun-sen (26), Senkou Span B (52)
    const tenkanPeriod = 9;
    const kijunPeriod = 26;
    const senkouBPeriod = 52;

    const tenkan = (highest(highs, tenkanPeriod)[highs.length - 1] + lowest(lows, tenkanPeriod)[lows.length - 1]) / 2;
    const kijun = (highest(highs, kijunPeriod)[highs.length - 1] + lowest(lows, kijunPeriod)[lows.length - 1]) / 2;
    const senkouA = (tenkan + kijun) / 2;

    // Senkou B needs 52 bars back, projected 26 forward
    const senkouB = (highest(highs, senkouBPeriod)[highs.length - 1] + lowest(lows, senkouBPeriod)[lows.length - 1]) / 2;
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);
    const lastClose = closes[closes.length - 1];

    // TK cross (Tenkan above Kijun = bullish)
    const tkBullish = tenkan > kijun;
    const cloudGreen = senkouA > senkouB;

    if (lastClose > cloudTop && tkBullish && cloudGreen) {
      return { score: 80, confidence: 0.75, signalClass: 'bullish', reason: 'Price above green cloud with TK bullish cross — strong uptrend' };
    }

    if (lastClose > cloudTop) {
      return { score: 65, confidence: 0.6, signalClass: 'bullish', reason: 'Price above Ichimoku cloud' };
    }

    if (lastClose < cloudBottom) {
      return { score: 10, confidence: 0.6, signalClass: 'bearish', reason: 'Price below Ichimoku cloud' };
    }

    return { score: 35, confidence: 0.35, signalClass: 'neutral', reason: 'Price inside Ichimoku cloud — no clear direction' };
  }
}
