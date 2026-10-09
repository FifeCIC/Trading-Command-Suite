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
  awesomeOscillator,
  chaikinMoneyFlow,
  adx,
  bollingerBands,
  macd,
  rsi,
} from '../utils/indicators';
// #1077 (owner ruling "B", 2026-10-09) — the canonical ratcheting SuperTrend, ONE home.
import { computeSuperTrend } from '../utils/supertrend';

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
    '5-period SMA of midpoints minus 34-period SMA. Rising green above zero = bullish, falling red below zero = bearish. Symmetric. Derived from MT5 Awesome Oscillator.';
  readonly priority = 40;
  readonly maxScore = 100;
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const MIN = 40;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    // Shared primitive — the old inline loop read fastSma[i] vs slowSma[i],
    // which are DIFFERENT bars (34-5=29 offset), a displacement misalignment.
    const ao = awesomeOscillator(highs, lows);
    const current = ao[ao.length - 1];
    const prev = ao[ao.length - 2];
    const prev2 = ao[ao.length - 3];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'AO unavailable' };
    }

    // Symmetric: rising green above zero = bullish, falling red below zero = bearish.
    if (current > 0 && prev <= 0) {
      return { score: 65, confidence: 0.6, signalClass: 'bullish', reason: 'AO crossed above zero line' };
    }
    if (current < 0 && prev >= 0) {
      return { score: 65, confidence: 0.6, signalClass: 'bearish', reason: 'AO crossed below zero line' };
    }
    if (current > prev && prev > prev2 && current > 0) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `AO ${current.toFixed(4)} — rising green above zero` };
    }
    if (current < prev && prev < prev2 && current < 0) {
      return { score: 75, confidence: 0.7, signalClass: 'bearish', reason: `AO ${current.toFixed(4)} — falling red below zero` };
    }
    if (current > prev && current > 0) {
      return { score: 70, confidence: 0.65, signalClass: 'bullish', reason: `AO ${current.toFixed(4)} — green above zero, rising` };
    }
    if (current < prev && current < 0) {
      return { score: 70, confidence: 0.65, signalClass: 'bearish', reason: `AO ${current.toFixed(4)} — red below zero, falling` };
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
    'Volume-weighted accumulation/distribution over 21 periods. CMF > 0.1 = accumulation, < -0.1 = distribution. Symmetric. Derived from MT5 Chaikin Money Flow.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN = 25;

    if (bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars.length}` };
    }

    // Shared primitive — the old inline loop summed slice(i-period, i), which
    // EXCLUDES the current bar (off-by-one candle index).
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const cmfValues = chaikinMoneyFlow(highs, lows, closes, volumes, 21);

    const current = cmfValues[cmfValues.length - 1];
    const prev = cmfValues[cmfValues.length - 2];

    if (current == null) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'CMF unavailable' };
    }

    // Strong accumulation
    if (current > 0.1 && current > prev) {
      return { score: 80, confidence: 0.75, signalClass: 'bullish', reason: `CMF ${current.toFixed(3)} — strong accumulation` };
    }

    // Accumulation
    if (current > 0) {
      return { score: 60, confidence: 0.55, signalClass: 'bullish', reason: `CMF ${current.toFixed(3)} — accumulation` };
    }

    // Strong distribution
    if (current < -0.1 && current < prev) {
      return { score: 80, confidence: 0.75, signalClass: 'bearish', reason: `CMF ${current.toFixed(3)} — strong distribution` };
    }

    // Distribution
    if (current < 0) {
      return { score: 60, confidence: 0.55, signalClass: 'bearish', reason: `CMF ${current.toFixed(3)} — distribution` };
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
    '20-bar high/low channel. Break above the prior high = bullish breakout, break below the prior low = bearish. Symmetric. Derived from MT5 Donchian Channel.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;


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
    // Channel from PRIOR bars only — exclude the active candle so a breakout is
    // measured against the prior 20-bar high/low, not the current bar's own range.
    const upperBand = hh[hh.length - 2];
    const lowerBand = ll[ll.length - 2];

    if (lastClose > upperBand) {
      return { score: 75, confidence: 0.7, signalClass: 'bullish', reason: `Price ${lastClose} broke above prior Donchian high ${upperBand.toFixed(2)}` };
    }

    if (lastClose < lowerBand) {
      return { score: 75, confidence: 0.7, signalClass: 'bearish', reason: `Price ${lastClose} broke below prior Donchian low ${lowerBand.toFixed(2)}` };
    }

    const midBand = (upperBand + lowerBand) / 2;
    if (lastClose > midBand) {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `Price in upper half of Donchian channel` };
    }

    if (lastClose < midBand) {
      return { score: 55, confidence: 0.5, signalClass: 'bearish', reason: `Price in lower half of Donchian channel` };
    }

    return { score: 35, confidence: 0.3, signalClass: 'neutral', reason: `Price at Donchian channel midline` };
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
// 7. SuperTrend — ATR-based trailing stop/trend (CANONICAL RATCHET since 2026-10-09)
// =====================================================================

/**
 * ── DECISION (2026-10-09, primary — owner ruling "B" on #1077 / review-queue R50) ──
 * WHAT:      Bands come from `computeSuperTrend()` (utils/supertrend.ts) — a canonical
 *            RATCHETING SuperTrend. Direction maps to bullish/bearish at a flat score 55.
 *            The old `score 75` "strong" branches are REMOVED, not re-invented — the measured
 *            comparison assumed a flat 55, and a new strength threshold would be tuning.
 * WHY:       The one-bar formula decided ±55 by ~0.9 of a pip on XAUUSD and its 75-grade
 *            branches were unreachable by construction (midline ± 3×ATR exceeds the bar).
 * INSTEAD OF: Keeping the one-bar formula shadowed (#1077 option A — 2 days measured: 475
 *            gate-crosses, 9 real stop-moves, none reached by later price).
 * REVERSE BY: Restore the one-bar midpoint formula (recorded verbatim in #1077; git history).
 * REGISTER:  docs/SETTLED-DECISIONS.md row 75
 * GUARD:     supertrend.directive.spec.ts (canaried both directions)
 */
@Injectable()
export class SuperTrendDirective implements IDirective {
  readonly id = 'supertrend';
  readonly name = 'SuperTrend Indicator';
  readonly description =
    'ATR(10) × 3 ratcheting SuperTrend. Direction comes from the canonical trailing band (the trend flips only when price closes through the ratified line); an unestablished trend is neutral, never guessed. Symmetric bullish/bearish evidence at equal magnitude. Derived from MT5 SuperTrend.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.2.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN = 15;

    if (!bars || bars.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${bars?.length ?? 0}` };
    }

    const { direction, trendLine, atr: lastATR } = computeSuperTrend(bars, 10, 3);

    if (direction === null || trendLine === null) {
      // A THIRD state, reported rather than folded into a direction — the old code had none
      // (#1077: every tick became a coin-flip call).
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'SuperTrend — trend not established in this window' };
    }

    const lastClose = bars[bars.length - 1].close;
    const line = trendLine.toFixed(5);
    const atrText = lastATR == null ? '' : `, ATR ${lastATR.toFixed(5)}`;
    if (direction === 'up') {
      return { score: 55, confidence: 0.5, signalClass: 'bullish', reason: `SuperTrend — uptrend (close ${lastClose} holds above the ratified line ${line}${atrText})` };
    }
    return { score: 55, confidence: 0.5, signalClass: 'bearish', reason: `SuperTrend — downtrend (close ${lastClose} holds below the ratified line ${line}${atrText})` };
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
// 11. ATR Trailing Stop — Volatility-based stop distance (ATR-UNIT GAPS since 2026-10-09)
// =====================================================================

/**
 * ── DECISION (2026-10-09, primary — owner ruling "B" on #1075) ──
 * WHAT:      The gap between price and each trailing stop is expressed in ATR UNITS:
 *            longGap = (close − longStop)/ATR, shortGap = (close − shortStop)/ATR.
 *            Grades: ≥ 2 ATR beyond the stop = strong (75); ≥ 0.5 ATR = moderate (60);
 *            else neutral (30). When both gaps fire (bands overlap — common), the side
 *            with the LARGER gap wins; ties resolve to the long side.
 * WHY:       The fraction thresholds (0.03 / 0.1 of price) were unreachable BY CONSTRUCTION:
 *            (close − longStop) ≤ 3×ATR, so the bullish branch needed ATR > 1% of price
 *            while 5m ATR measures 0.02–0.07% — 0 contributions in every measured window.
 * INSTEAD OF: Recalibrating the fractions (issue option A) — re-fits per instrument and
 *            keeps the units trap; ATR units are scale-free and match the directive's name.
 * REVERSE BY: Restore the fraction thresholds (recorded verbatim in #1075).
 * REGISTER:  docs/SETTLED-DECISIONS.md row 77
 * GUARD:     atr-trailing-stop.directive.spec.ts (canaried both directions)
 */
@Injectable()
export class ATRTrailingStopDirective implements IDirective {
  readonly id = 'atr-trailing-stop';
  readonly name = 'ATR Trailing Stop Signal';
  readonly description =
    'Dual ATR trailing stop: long stop = highest high(20) − 3×ATR, short stop = lowest low(20) + 3×ATR. The gap between price and each stop is graded in ATR units (≥2 ATR beyond = strong, ≥0.5 = moderate) — symmetric bullish/bearish evidence. Derived from MT5 ATR Trailing Stop.';
  readonly priority = 48;
  readonly maxScore = 100;
  readonly version = '1.2.0';
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

    if (!(lastATR > 0)) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: 'ATR unavailable — cannot judge the trailing-stop gaps' };
    }

    // Two trailing stops: long = highest high − 3×ATR, short = lowest low + 3×ATR.
    const highestHigh = Math.max(...highs.slice(-20));
    const lowestLow = Math.min(...lows.slice(-20));
    const longStop = highestHigh - 3 * lastATR;
    const shortStop = lowestLow + 3 * lastATR;

    // ⚠️ ATR UNITS, not fractions of price (#1075 ruling B). Positive = beyond the stop in
    // that side's direction. longGap is capped at 3 by construction (close ≤ hh20); the
    // short side is symmetric.
    const longGap = (lastClose - longStop) / lastATR;
    const shortGap = (lastClose - shortStop) / lastATR;

    const STRONG_ATR = 2;
    const MODERATE_ATR = 0.5;
    const longGraded = longGap >= MODERATE_ATR ? (longGap >= STRONG_ATR ? 'strong' : 'moderate') : null;
    const shortGraded = -shortGap >= MODERATE_ATR ? (-shortGap >= STRONG_ATR ? 'strong' : 'moderate') : null;

    const longText = `${longGap.toFixed(2)}×ATR above long stop`;
    const shortText = `${(-shortGap).toFixed(2)}×ATR below short stop`;

    // ── Overlap rule: both stops can fire when range(20) < 6×ATR — the side with the LARGER
    // gap beyond its stop wins; ties resolve to the LONG side (documented in the DECISION
    // marker above). ONE pick path, so every geometry exercises the same code.
    const graded: Array<{ gap: number; side: 'long' | 'short'; grade: 'strong' | 'moderate' }> = [];
    if (longGraded) graded.push({ gap: longGap, side: 'long', grade: longGraded });
    if (shortGraded) graded.push({ gap: -shortGap, side: 'short', grade: shortGraded });
    if (graded.length === 0) {
      return { score: 30, confidence: 0.3, signalClass: 'neutral', reason: `Price inside ATR trailing-stop channel (long ${longText}, short ${shortText}) — no clear trend` };
    }
    // Array.prototype.sort is STABLE — equal gaps keep insertion order, i.e. the long side wins ties.
    graded.sort((a, b) => b.gap - a.gap);
    const pick = graded[0];
    const strong = pick.grade === 'strong';
    const overlap = graded.length > 1 ? ' (overlap: larger gap wins)' : '';
    const text = pick.side === 'long' ? longText : shortText;
    return pick.side === 'long'
      ? { score: strong ? 75 : 60, confidence: strong ? 0.7 : 0.55, signalClass: 'bullish', reason: `${strong ? 'Strong' : 'Moderate'} uptrend — close ${text}${overlap}` }
      : { score: strong ? 75 : 60, confidence: strong ? 0.7 : 0.55, signalClass: 'bearish', reason: `${strong ? 'Strong' : 'Moderate'} downtrend — close ${text}${overlap}` };
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
    'Price above cloud = bullish, below = bearish, inside = neutral. Senkou spans are displaced 26 bars forward. Derived from MT5 Ichimoku.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;


  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const MIN = 78; // 52 (Senkou B) + 26 (cloud forward displacement)

    if (closes.length < MIN) {
      return { score: 0, confidence: 0.1, signalClass: 'neutral', reason: `Need ${MIN} bars, have ${closes.length}` };
    }

    const mid = (h: number[], l: number[], period: number, idx: number) =>
      (Math.max(...h.slice(idx - period + 1, idx + 1)) + Math.min(...l.slice(idx - period + 1, idx + 1))) / 2;

    const last = closes.length - 1;

    // Tenkan-sen (9) and Kijun-sen (26) at the CURRENT bar.
    const tenkan = mid(highs, lows, 9, last);
    const kijun = mid(highs, lows, 26, last);
    const tkBullish = tenkan > kijun;

    // Senkou spans are plotted 26 bars FORWARD — the cloud live under the
    // current price was computed 26 bars ago (displacement).
    const cloudIdx = last - 26;
    const senkouA = (mid(highs, lows, 9, cloudIdx) + mid(highs, lows, 26, cloudIdx)) / 2;
    const senkouB = mid(highs, lows, 52, cloudIdx);
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);
    const cloudGreen = senkouA > senkouB;
    const lastClose = closes[last];

    if (lastClose > cloudTop && tkBullish && cloudGreen) {
      return { score: 80, confidence: 0.75, signalClass: 'bullish', reason: 'Price above green cloud with TK bullish cross — strong uptrend' };
    }

    if (lastClose < cloudBottom && !tkBullish && !cloudGreen) {
      return { score: 80, confidence: 0.75, signalClass: 'bearish', reason: 'Price below red cloud with TK bearish cross — strong downtrend' };
    }

    if (lastClose > cloudTop) {
      return { score: 65, confidence: 0.6, signalClass: 'bullish', reason: 'Price above Ichimoku cloud' };
    }

    if (lastClose < cloudBottom) {
      return { score: 65, confidence: 0.6, signalClass: 'bearish', reason: 'Price below Ichimoku cloud' };
    }

    return { score: 35, confidence: 0.35, signalClass: 'neutral', reason: 'Price inside Ichimoku cloud — no clear direction' };
  }
}
