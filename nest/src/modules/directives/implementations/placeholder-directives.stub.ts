/**
 * Placeholder Directive Stubs
 * ===========================
 * All directives from TradePress PHP classes and aspirational strategy docs
 * that have established math but not yet been ported to NestJS.
 *
 * Each stub:
 * - Returns score: 0, confidence: 0, reason referencing PHP source
 * - Preserves the directive ID contract
 * - Ready for real implementation when prioritized
 *
 * DO NOT EDIT stubs to add real math — create a new implementation file
 * and remove the stub registration once the real version is active.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { stochastic, cci, mfi, adx, rsi, sma, ema, bollingerBands, obv, macd, atr } from '../utils/indicators';

/** Factory for consistent stub result */
function stubResult(directiveId: string, phpFile?: string): DirectiveResult {
  const src = phpFile
    ? `Math in TradePress includes/scoring-system/directives/${phpFile}`
    : 'Documented in strategy docs — not yet spec\'d as directive';
  return {
      signalClass: 'neutral',
      score: 0,
    confidence: 0,
    reason: `[STUB] ${directiveId}: Not yet implemented. ${src}.`,
    metadata: { performance: 'stub', status: 'underperforming', stubbedAt: '2026-06-10' },
  };
}

// ===========================================================================
// Momentum
// ===========================================================================

@Injectable()
export class StochasticDirective implements IDirective {
  readonly id = 'stochastic';
  readonly name = 'Stochastic Oscillator';
  readonly description = '%K/%D crossover in oversold (<20) region.';
  readonly priority = 74;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { highs, lows, closes } = this.extract(input);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const stoch = stochastic(highs, lows, closes, 14, 3);
    if (!stoch || stoch.k.length < 2) return { score: 0, confidence: 0.1, reason: 'Stochastic calculation failed', signalClass: 'neutral' };
    const k = stoch.k[stoch.k.length - 1];
    const prevK = stoch.k[stoch.k.length - 2];
    const d = stoch.d[stoch.d.length - 1];
    const oversold = k < 20 && d < 20;
    const curling = k > prevK;
    if (oversold && curling) return { score: 85, confidence: 0.65, reason: `Stochastic oversold: K=${k.toFixed(1)} D=${d.toFixed(1)} curling up`, signalClass: 'bullish' };
    if (oversold) return { score: 40, confidence: 0.35, reason: `Stochastic oversold but not curling: K=${k.toFixed(1)}`, signalClass: 'neutral' };
    const depth = Math.max(0, 1 - k / 30);
    return { score: Math.round(depth * 30), confidence: 0.3, reason: `Stochastic at ${k.toFixed(1)} (not oversold)`, signalClass: 'neutral' };
  }
  private extract(input: DirectiveInput) { const bars = input.bars; return { highs: bars.map(b => b.high), lows: bars.map(b => b.low), closes: bars.map(b => b.close) }; }
}

@Injectable()
export class CciDirective implements IDirective {
  readonly id = 'cci';
  readonly name = 'Commodity Channel Index';
  readonly description = 'CCI crossing above -100 from oversold.';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { highs, lows, closes } = this.extract(input);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const cciVals = cci(highs, lows, closes, 20);
    if (!cciVals.length) return { score: 0, confidence: 0.1, reason: 'CCI calculation failed', signalClass: 'neutral' };
    const c = cciVals[cciVals.length - 1];
    const prev = cciVals[cciVals.length - 2];
    const crossingUp = prev <= -100 && c > -100;
    if (c < -200) return { score: 90, confidence: 0.55, reason: `CCI deeply oversold at ${c.toFixed(0)}`, signalClass: 'bullish' };
    if (crossingUp) return { score: 75, confidence: 0.6, reason: `CCI crossing above -100: ${c.toFixed(0)}`, signalClass: 'bullish' };
    if (c < -100) return { score: 40, confidence: 0.3, reason: `CCI oversold at ${c.toFixed(0)}`, signalClass: 'neutral' };
    return { score: Math.max(0, Math.round(30 - c / 10)), confidence: 0.2, reason: `CCI at ${c.toFixed(0)}`, signalClass: 'neutral' };
  }
  private extract(input: DirectiveInput) { const bars = input.bars; return { highs: bars.map(b => b.high), lows: bars.map(b => b.low), closes: bars.map(b => b.close) }; }
}

@Injectable()
export class MfiDirective implements IDirective {
  readonly id = 'mfi';
  readonly name = 'Money Flow Index';
  readonly description = 'Volume-weighted RSI, MFI < 20 accumulation signal.';
  readonly priority = 73;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { highs, lows, closes, volumes } = this.extract(input);
    if (closes.length < 15) return { score: 0, confidence: 0.1, reason: `Need 15+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const mfiVals = mfi(highs, lows, closes, volumes, 14);
    if (!mfiVals.length) return { score: 0, confidence: 0.1, reason: 'MFI calculation failed', signalClass: 'neutral' };
    const m = mfiVals[mfiVals.length - 1];
    const prev = mfiVals[mfiVals.length - 2];
    if (m < 20) return { score: 85, confidence: 0.55, reason: `MFI oversold at ${m.toFixed(1)}`, signalClass: 'bullish' };
    if (m > 80) return { score: 70, confidence: 0.5, reason: `MFI overbought at ${m.toFixed(1)}`, signalClass: 'bearish' };
    const turning = m > prev ? 'rising' : 'falling';
    return { score: Math.round(Math.abs(m - 50) * 0.5), confidence: 0.3, reason: `MFI at ${m.toFixed(1)} (${turning})`, signalClass: m > 50 ? 'bullish' : 'bearish' };
  }
  private extract(input: DirectiveInput) { const bars = input.bars; return { highs: bars.map(b => b.high), lows: bars.map(b => b.low), closes: bars.map(b => b.close), volumes: bars.map(b => b.volume || 0) }; }
}

@Injectable()
export class AdxDirective implements IDirective {
  readonly id = 'adx';
  readonly name = 'Average Directional Index';
  readonly description = 'ADX > 25 confirms trend, +DI > -DI bullish.';
  readonly priority = 76;
  readonly maxScore = 110;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { highs, lows, closes } = this.extract(input);
    if (closes.length < 30) return { score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const adxResult = adx(highs, lows, closes, 14);
    if (!adxResult || !adxResult.adx.length) return { score: 0, confidence: 0.1, reason: 'ADX calculation failed', signalClass: 'neutral' };
    const a = adxResult.adx[adxResult.adx.length - 1];
    const pdi = adxResult.plusDi[adxResult.plusDi.length - 1];
    const ndi = adxResult.minusDi[adxResult.minusDi.length - 1];
    if (a > 25 && pdi > ndi) return { score: 85, confidence: 0.6, reason: `Strong bullish trend: ADX=${a.toFixed(1)} +DI=${pdi.toFixed(1)} > -DI=${ndi.toFixed(1)}`, signalClass: 'bullish' };
    if (a > 25 && ndi > pdi) return { score: 80, confidence: 0.55, reason: `Strong bearish trend: ADX=${a.toFixed(1)} -DI=${ndi.toFixed(1)} > +DI=${pdi.toFixed(1)}`, signalClass: 'bearish' };
    if (a < 20) return { score: 20, confidence: 0.4, reason: `No trend: ADX=${a.toFixed(1)} (ranging market)`, signalClass: 'neutral' };
    return { score: Math.round(Math.min(60, a * 2)), confidence: 0.35, reason: `ADX=${a.toFixed(1)} (weak trend)`, signalClass: pdi > ndi ? 'bullish' : 'bearish' };
  }
  private extract(input: DirectiveInput) { const bars = input.bars; return { highs: bars.map(b => b.high), lows: bars.map(b => b.low), closes: bars.map(b => b.close) }; }
}

@Injectable()
export class RsiOverboughtDirective implements IDirective {
  readonly id = 'rsi-overbought';
  readonly name = 'RSI Overbought Warning';
  readonly description = 'RSI > 70 with downward curl = bearish signal.';
  readonly priority = 78;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 16) return { score: 0, confidence: 0.1, reason: `Need 16+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const rsiVals = rsi(closes, 14);
    if (rsiVals.length < 2) return { score: 0, confidence: 0.1, reason: 'RSI calculation failed', signalClass: 'neutral' };
    const current = rsiVals[rsiVals.length - 1];
    const prev = rsiVals[rsiVals.length - 2];
    const curling = current < prev;
    if (current > 70 && curling) return { score: 90, confidence: 0.65, reason: `RSI overbought at ${current.toFixed(1)} curling down`, signalClass: 'bearish' };
    if (current > 70) return { score: 55, confidence: 0.4, reason: `RSI overbought at ${current.toFixed(1)}`, signalClass: 'bearish' };
    if (current > 60) return { score: Math.round((current - 60) * 1.5), confidence: 0.25, reason: `RSI elevated at ${current.toFixed(1)}`, signalClass: 'neutral' };
    return { score: 0, confidence: 0.3, reason: `RSI normal at ${current.toFixed(1)}`, signalClass: 'neutral' };
  }
}

@Injectable()
export class MomentumContinuationComboDirective implements IDirective {
  readonly id = 'momentum-continuation-combo';
  readonly name = 'Momentum Continuation Combo';
  readonly description = 'Multi-indicator momentum confluence (RSI + MACD + ADX).';
  readonly priority = 74;
  readonly maxScore = 110;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 35) return { score: 0, confidence: 0.1, reason: `Need 35+ bars, have ${closes.length}`, signalClass: 'neutral' };
    let confluence = 0;
    const signals: string[] = [];
    // RSI momentum
    const r = rsi(closes, 14);
    const currentRsi = r[r.length - 1];
    if (currentRsi > 55 && currentRsi < 75) { confluence += 30; signals.push(`RSI ${currentRsi.toFixed(0)}`); }
    else if (currentRsi > 75) { confluence -= 10; signals.push(`RSI overbought ${currentRsi.toFixed(0)}`); }
    else if (currentRsi < 30) { confluence -= 15; signals.push(`RSI oversold ${currentRsi.toFixed(0)}`); }
    // MACD
    const m = macd(closes, 12, 26, 9);
    if (m.macd.length >= 2 && m.signal.length >= 2) {
      const macdLine = m.macd[m.macd.length - 1];
      const sigLine = m.signal[m.signal.length - 1];
      if (macdLine > sigLine && macdLine > 0) { confluence += 30; signals.push('MACD bullish above zero'); }
      else if (macdLine > sigLine) { confluence += 20; signals.push('MACD bullish'); }
      else if (macdLine < 0) { confluence -= 10; signals.push('MACD bearish'); }
    }
    // ADX trend strength
    const a = adx(highs, lows, closes, 14);
    if (a && a.adx.length > 0) {
      const adxVal = a.adx[a.adx.length - 1];
      if (adxVal > 25 && a.plusDi[a.plusDi.length-1] > a.minusDi[a.minusDi.length-1]) { confluence += 30; signals.push(`ADX ${adxVal.toFixed(0)} bullish`); }
      else if (adxVal > 25) { confluence -= 10; signals.push(`ADX ${adxVal.toFixed(0)} bearish`); }
      else { signals.push(`ADX ${adxVal.toFixed(0)} ranging`); }
    }
    const score = Math.round(35 + confluence * 0.7);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = confluence >= 60 ? 'bullish' : confluence < 10 ? 'bearish' : 'neutral';
    return { score: Math.min(110, score), confidence: 0.3 + Math.abs(confluence) * 0.004, reason: `Momentum confluence: ${confluence}/90 (${signals.join(', ')})`, signalClass };
  }
}

// ===========================================================================
// Trend
// ===========================================================================

@Injectable()
export class MovingAveragesDirective implements IDirective {
  readonly id = 'moving-averages';
  readonly name = 'Moving Averages Alignment';
  readonly description = 'Bullish MA alignment (20>50>200).';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 200) return { score: Math.round(20 * closes.length / 200), confidence: 0.15, reason: `Only ${closes.length} bars (need 200 for full alignment check)`, signalClass: 'neutral' };
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const e20 = ema20[ema20.length - 1];
    const e50 = ema50[ema50.length - 1];
    const e200 = ema200[ema200.length - 1];
    const lastPrice = closes[closes.length - 1];
    const fullBullish = lastPrice > e20 && e20 > e50 && e50 > e200;
    const fullBearish = lastPrice < e20 && e20 < e50 && e50 < e200;
    if (fullBullish) return { score: 90, confidence: 0.7, reason: `Full bullish alignment: Price(${lastPrice.toFixed(2)}) > EMA20(${e20.toFixed(2)}) > EMA50(${e50.toFixed(2)}) > EMA200(${e200.toFixed(2)})`, signalClass: 'bullish' };
    if (fullBearish) return { score: 85, confidence: 0.65, reason: `Full bearish alignment: Price < EMA20 < EMA50 < EMA200`, signalClass: 'bearish' };
    const bullCount = (lastPrice > e20 ? 1 : 0) + (e20 > e50 ? 1 : 0) + (e50 > e200 ? 1 : 0);
    const bearCount = 3 - bullCount;
    return { score: bullCount > bearCount ? 50 + bullCount * 10 : 30 + bearCount * 10, confidence: 0.35, reason: `Partial alignment: ${bullCount}/3 bullish, ${bearCount}/3 bearish`, signalClass: bullCount > bearCount ? 'bullish' : 'bearish' };
  }
}

@Injectable()
export class MaCrossoverDirective implements IDirective {
  readonly id = 'ma-crossover';
  readonly name = 'Moving Average Crossover';
  readonly description = 'Fast MA crossing above slow MA.';
  readonly priority = 73;
  readonly maxScore = 95;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 30) return { score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const fast = ema(closes, 10);
    const slow = ema(closes, 30);
    if (fast.length < 2 || slow.length < 2) return { score: 0, confidence: 0.1, reason: 'EMA calculation failed', signalClass: 'neutral' };
    const f = fast[fast.length - 1];
    const s = slow[slow.length - 1];
    const prevF = fast[fast.length - 2];
    const prevS = slow[slow.length - 2];
    const crossedUp = prevF <= prevS && f > s;
    const crossedDown = prevF >= prevS && f < s;
    const separation = Math.abs(f - s) / Math.abs(s || 1);
    if (crossedUp) return { score: 80 + Math.round(separation * 100), confidence: 0.6, reason: `Golden cross: EMA10(${f.toFixed(4)}) crossed above EMA30(${s.toFixed(4)})`, signalClass: 'bullish' };
    if (crossedDown) return { score: 75, confidence: 0.55, reason: `Death cross: EMA10 crossed below EMA30`, signalClass: 'bearish' };
    if (f > s) return { score: 40, confidence: 0.3, reason: `EMA10 above EMA30 (bullish)`, signalClass: 'bullish' };
    return { score: 30, confidence: 0.25, reason: `EMA10 below EMA30`, signalClass: 'bearish' };
  }
}

@Injectable()
export class PriceAboveSma50Directive implements IDirective {
  readonly id = 'price-above-sma-50';
  readonly name = 'Price Above SMA 50';
  readonly description = 'Price sustaining above 50-day SMA.';
  readonly priority = 68;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 60) return { score: 0, confidence: 0.1, reason: `Need 60+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const s50 = sma(closes, 50);
    if (s50 === 0 || isNaN(s50)) return { score: 0, confidence: 0.1, reason: 'SMA calculation failed', signalClass: 'neutral' };
    const lastPrice = closes[closes.length - 1];
    const pctAbove = ((lastPrice - s50) / s50) * 100;
    // Check how many of last 5 closes were above SMA50
    let aboveCount = 0;
    for (let i = closes.length - 5; i < closes.length; i++) {
      if (i >= 0 && closes[i] > s50) aboveCount++;
    }
    if (pctAbove > 5 && aboveCount >= 5) return { score: 80, confidence: 0.6, reason: `Strong above SMA50: +${pctAbove.toFixed(1)}% (${aboveCount}/5 bars)`, signalClass: 'bullish' };
    if (pctAbove > 0 && aboveCount >= 3) return { score: 55, confidence: 0.4, reason: `Above SMA50: +${pctAbove.toFixed(1)}%`, signalClass: 'bullish' };
    if (pctAbove < -5) return { score: 60, confidence: 0.4, reason: `Below SMA50: ${pctAbove.toFixed(1)}%`, signalClass: 'bearish' };
    if (pctAbove < 0) return { score: 30, confidence: 0.3, reason: `Slightly below SMA50`, signalClass: 'bearish' };
    return { score: Math.round(20 + pctAbove * 2), confidence: 0.25, reason: `At SMA50 +${pctAbove.toFixed(1)}%`, signalClass: 'neutral' };
  }
}

// ===========================================================================
// Volatility
// ===========================================================================

@Injectable()
export class BollingerBandSqueezeDirective implements IDirective {
  readonly id = 'bollinger-band-squeeze';
  readonly name = 'Bollinger Band Squeeze';
  readonly description = 'Band width at multi-period low signals expansion.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 50) return { score: 0, confidence: 0.1, reason: `Need 50+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { score: 0, confidence: 0.1, reason: 'BB calculation failed', signalClass: 'neutral' };
    // Compute band width for last 20 periods
    const widths = [];
    for (let i = Math.max(0, bb.lower.length - 20); i < bb.lower.length; i++) {
      widths.push((bb.upper[i] - bb.lower[i]) / bb.middle[i]);
    }
    const currentWidth = widths[widths.length - 1];
    const minWidth = Math.min(...widths.slice(0, -1));
    const avgWidth = widths.slice(0, -1).reduce((a,b) => a+b, 0) / (widths.length - 1);
    const squeezing = currentWidth < avgWidth * 0.85;
    if (squeezing && currentWidth <= minWidth * 1.05) {
      return { score: 80, confidence: 0.5, reason: `BB squeeze at multi-period low: width=${(currentWidth*100).toFixed(2)}% vs avg ${(avgWidth*100).toFixed(2)}%`, signalClass: 'neutral' };
    }
    if (currentWidth < avgWidth * 0.9) {
      return { score: 40, confidence: 0.3, reason: `BB narrowing: width=${(currentWidth*100).toFixed(2)}%`, signalClass: 'neutral' };
    }
    return { score: 10, confidence: 0.2, reason: `BB normal width: ${(currentWidth*100).toFixed(2)}%`, signalClass: 'neutral' };
  }
}

@Injectable()
export class VolatilityToolsDirective implements IDirective {
  readonly id = 'volatility-tools';
  readonly name = 'Volatility Calculator';
  readonly description = 'Historical vol, ATR percentile, beta proxy utility.';
  readonly priority = 66;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { highs, lows, closes } = this.extract(input);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const atrVals = atr(highs, lows, closes, 14);
    if (!atrVals.length) return { score: 0, confidence: 0.1, reason: 'ATR calculation failed', signalClass: 'neutral' };
    const currentAtr = atrVals[atrVals.length - 1];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    const avgAtr = atrVals.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : 1;
    // Higher vol = higher risk, neutral-bearish for conservative strategies
    if (atrPct > 3) return { score: 70, confidence: 0.55, reason: `Very high volatility: ATR=${atrPct.toFixed(2)}% (${atrRatio.toFixed(1)}x avg)`, signalClass: 'neutral' };
    if (atrPct > 1.5) return { score: 45, confidence: 0.4, reason: `Elevated volatility: ATR=${atrPct.toFixed(2)}%`, signalClass: 'neutral' };
    return { score: 20, confidence: 0.35, reason: `Normal volatility: ATR=${atrPct.toFixed(2)}%`, signalClass: 'neutral' };
  }
  private extract(input: DirectiveInput) { const bars = input.bars; return { highs: bars.map(b => b.high), lows: bars.map(b => b.low), closes: bars.map(b => b.close) }; }
}

// ===========================================================================
// Volume
// ===========================================================================

@Injectable()
export class ObvDirective implements IDirective {
  readonly id = 'obv';
  readonly name = 'On-Balance Volume';
  readonly description = 'OBV divergence from price = accumulation/distribution.';
  readonly priority = 68;
  readonly maxScore = 95;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume || 0);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const obvVals = obv(closes, volumes);
    if (!obvVals.length) return { score: 0, confidence: 0.1, reason: 'OBV calculation failed', signalClass: 'neutral' };
    // Compare OBV trend vs price trend over last 10 bars
    const n = obvVals.length;
    const obvChange = obvVals[n - 1] - obvVals[Math.max(0, n - 10)];
    const priceChange = closes[n - 1] - closes[Math.max(0, n - 10)];
    if (priceChange < 0 && obvChange > 0) {
      return { score: 75, confidence: 0.5, reason: 'Bullish divergence: price falling but OBV rising (accumulation)', signalClass: 'bullish' };
    }
    if (priceChange > 0 && obvChange < 0) {
      return { score: 70, confidence: 0.45, reason: 'Bearish divergence: price rising but OBV falling (distribution)', signalClass: 'bearish' };
    }
    const aligned = (priceChange > 0 && obvChange > 0);
    return { score: aligned ? 40 : 20, confidence: 0.3, reason: `OBV ${aligned ? 'confirming' : 'flat with'} price trend`, signalClass: aligned ? 'bullish' : 'neutral' };
  }
}

@Injectable()
export class VolumeSurgeDirective implements IDirective {
  readonly id = 'volume-surge';
  readonly name = 'Volume Surge Detection';
  readonly description = 'Volume > 2x average with price up = institutional interest.';
  readonly priority = 69;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const volumes = bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(-20, -1).reduce((a, b) => a + b, 0) / 19;
    const currentVol = volumes[volumes.length - 1];
    const currentBar = bars[bars.length - 1];
    const priceUp = currentBar.close > currentBar.open;
    const ratio = avgVol > 0 ? currentVol / avgVol : 1;
    if (ratio >= 3 && priceUp) return { score: 85, confidence: 0.6, reason: `Volume surge ${ratio.toFixed(1)}x avg with bullish candle`, signalClass: 'bullish' };
    if (ratio >= 2 && priceUp) return { score: 65, confidence: 0.5, reason: `Volume ${ratio.toFixed(1)}x avg, bullish`, signalClass: 'bullish' };
    if (ratio >= 2) return { score: 40, confidence: 0.35, reason: `Volume ${ratio.toFixed(1)}x avg`, signalClass: 'neutral' };
    return { score: Math.round(Math.min(30, ratio * 15)), confidence: 0.2, reason: `Volume ${ratio.toFixed(1)}x avg (normal)`, signalClass: 'neutral' };
  }
}

@Injectable()
export class VolumeRhythmDirective implements IDirective {
  readonly id = 'volume-rhythm';
  readonly name = 'Volume Rhythm';
  readonly description = 'Day-of-week volume patterns and institutional rhythms.';
  readonly priority = 55;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 30) return { score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${bars.length}`, signalClass: 'neutral' };
    // Analyze current bar volume vs average for same timeframe
    const volumes = bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, volumes.length - 1);
    const currentVol = volumes[volumes.length - 1];
    const ratio = avgVol > 0 ? currentVol / avgVol : 1;
    // Higher confidence if pattern is consistent
    const recentRatios = [];
    for (let i = Math.max(0, volumes.length - 10); i < volumes.length; i++) {
      recentRatios.push(volumes[i] / Math.max(1, avgVol));
    }
    const consistency = 1 - (Math.max(...recentRatios) - Math.min(...recentRatios)) / 3;
    if (ratio > 1.5) return { score: Math.round(50 + consistency * 20), confidence: 0.3 + consistency * 0.2, reason: `Above-avg volume: ${ratio.toFixed(1)}x (${(consistency*100).toFixed(0)}% consistent)`, signalClass: 'neutral' };
    return { score: Math.round(ratio * 20), confidence: 0.2, reason: `Volume ${ratio.toFixed(1)}x avg`, signalClass: 'neutral' };
  }
}

// ===========================================================================
// Candlestick Patterns
// ===========================================================================

@Injectable()
export class DojiPatternDirective implements IDirective {
  readonly id = 'doji-pattern';
  readonly name = 'Doji Pattern';
  readonly description = 'Doji at support = potential reversal.';
  readonly priority = 67;
  readonly maxScore = 95;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 5) return { score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const last = bars[bars.length - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range <= 0) return { score: 0, confidence: 0.1, reason: 'Zero-range bar', signalClass: 'neutral' };
    const bodyRatio = body / range;
    const upperShadow = last.high - Math.max(last.open, last.close);
    const lowerShadow = Math.min(last.open, last.close) - last.low;
    // True doji: body < 5% of range
    if (bodyRatio < 0.05) {
      // Check if near support (lower shadow >= upper shadow)
      if (lowerShadow >= upperShadow * 1.5) {
        return { score: 82, confidence: 0.55, reason: `Dragonfly doji: potential bullish reversal (body ${(bodyRatio*100).toFixed(1)}% of range)`, signalClass: 'bullish' };
      }
      if (upperShadow >= lowerShadow * 1.5) {
        return { score: 75, confidence: 0.5, reason: `Gravestone doji: potential bearish reversal`, signalClass: 'bearish' };
      }
      return { score: 60, confidence: 0.4, reason: `Doji: indecision (body ${(bodyRatio*100).toFixed(1)}% of range)`, signalClass: 'neutral' };
    }
    if (bodyRatio < 0.15) {
      return { score: 30, confidence: 0.25, reason: `Near-doji: small body`, signalClass: 'neutral' };
    }
    return { score: 5, confidence: 0.2, reason: `Normal candle`, signalClass: 'neutral' };
  }
}

@Injectable()
export class HammerPatternDirective implements IDirective {
  readonly id = 'hammer-pattern';
  readonly name = 'Hammer Pattern';
  readonly description = 'Hammer at downtrend low = bullish reversal.';
  readonly priority = 68;
  readonly maxScore = 95;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 10) return { score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range <= 0 || body === 0) return { score: 0, confidence: 0.1, reason: 'Zero body or range', signalClass: 'neutral' };
    const lowerShadow = Math.min(last.open, last.close) - last.low;
    const upperShadow = last.high - Math.max(last.open, last.close);
    const lowerRatio = lowerShadow / body;
    const bodyRatio = body / range;
    // Hammer: lower shadow >= 2x body, small upper shadow, body in upper third
    const isHammer = lowerRatio >= 2 && upperShadow < body * 0.5 && bodyRatio < 0.4;
    // Check downtrend: last 5 bars mostly down
    let downBars = 0;
    for (let i = bars.length - 6; i < bars.length - 1; i++) {
      if (i >= 0 && bars[i].close < bars[i].open) downBars++;
    }
    const inDowntrend = downBars >= 3;
    if (isHammer && inDowntrend) {
      return { score: 85, confidence: 0.6, reason: `Hammer pattern at downtrend low: shadow ${lowerRatio.toFixed(1)}x body`, signalClass: 'bullish' };
    }
    if (isHammer) {
      return { score: 55, confidence: 0.4, reason: `Hammer pattern (no clear downtrend)`, signalClass: 'bullish' };
    }
    // Inverted hammer (shooting star at top)
    const upperRatio = upperShadow / body;
    if (upperRatio >= 2 && lowerShadow < body * 0.5 && bodyRatio < 0.4) {
      return { score: 70, confidence: 0.5, reason: `Shooting star: upper shadow ${upperRatio.toFixed(1)}x body`, signalClass: 'bearish' };
    }
    return { score: 5, confidence: 0.2, reason: 'No hammer pattern', signalClass: 'neutral' };
  }
}

@Injectable()
export class EngulfingPatternDirective implements IDirective {
  readonly id = 'engulfing-pattern';
  readonly name = 'Engulfing Pattern';
  readonly description = 'Bullish engulfing = strong reversal signal.';
  readonly priority = 69;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 2) return { score: 0, confidence: 0.1, reason: `Need 2+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const lastBody = last.close - last.open;
    const prevBody = prev.close - prev.open;
    const lastHigh = Math.max(last.open, last.close);
    const lastLow = Math.min(last.open, last.close);
    const prevHigh = Math.max(prev.open, prev.close);
    const prevLow = Math.min(prev.open, prev.close);
    // Bullish engulfing: prev red, last green, last body > prev body, last engulfs prev body
    const bullish = prevBody < 0 && lastBody > 0 && Math.abs(lastBody) > Math.abs(prevBody) && lastLow <= prevLow && lastHigh >= prevHigh;
    const bearish = prevBody > 0 && lastBody < 0 && Math.abs(lastBody) > Math.abs(prevBody) && lastLow <= prevLow && lastHigh >= prevHigh;
    if (bullish) {
      const strength = Math.round(1 + Math.min(15, (Math.abs(lastBody) / Math.max(0.001, Math.abs(prevBody)) - 1) * 10));
      return { score: 80 + strength, confidence: 0.6, reason: `Bullish engulfing: body ${(Math.abs(lastBody)/Math.max(0.001, Math.abs(prevBody))).toFixed(1)}x prev`, signalClass: 'bullish' };
    }
    if (bearish) {
      const strength = Math.round(1 + Math.min(15, (Math.abs(lastBody) / Math.max(0.001, Math.abs(prevBody)) - 1) * 10));
      return { score: 75 + strength, confidence: 0.55, reason: `Bearish engulfing`, signalClass: 'bearish' };
    }
    return { score: 5, confidence: 0.25, reason: 'No engulfing pattern', signalClass: 'neutral' };
  }
}

@Injectable()
export class PinBarPatternDirective implements IDirective {
  readonly id = 'pin-bar-pattern';
  readonly name = 'Pin Bar Pattern';
  readonly description = 'Pin bar rejecting lower prices = support confirmed.';
  readonly priority = 66;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 10) return { score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const last = bars[bars.length - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range <= 0) return { score: 0, confidence: 0.1, reason: 'Zero-range bar', signalClass: 'neutral' };
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const bodyRatio = body / range;
    // Pin bar: one wick >= 3x body, opposite wick small, body small
    const isBullishPin = lowerWick >= body * 3 && upperWick < body * 0.5 && bodyRatio < 0.3 && last.close > last.open;
    const isBearishPin = upperWick >= body * 3 && lowerWick < body * 0.5 && bodyRatio < 0.3 && last.close < last.open;
    // Check context: where is this pin relative to recent range?
    const recentHighs = bars.slice(-10, -1).map(b => b.high);
    const recentLows = bars.slice(-10, -1).map(b => b.low);
    const avgHigh = recentHighs.reduce((a, b) => a + b, 0) / recentHighs.length;
    const avgLow = recentLows.reduce((a, b) => a + b, 0) / recentLows.length;
    if (isBullishPin && last.low < avgLow) {
      return { score: 80, confidence: 0.55, reason: `Bullish pin bar at new low: rejecting ${last.low.toFixed(2)}`, signalClass: 'bullish' };
    }
    if (isBearishPin && last.high > avgHigh) {
      return { score: 75, confidence: 0.5, reason: `Bearish pin bar at new high: rejecting ${last.high.toFixed(2)}`, signalClass: 'bearish' };
    }
    if (isBullishPin) return { score: 45, confidence: 0.35, reason: 'Bullish pin bar (mid-range)', signalClass: 'bullish' };
    if (isBearishPin) return { score: 40, confidence: 0.3, reason: 'Bearish pin bar (mid-range)', signalClass: 'bearish' };
    return { score: 5, confidence: 0.25, reason: 'No pin bar pattern', signalClass: 'neutral' };
  }
}

@Injectable()
export class ThreeSoldiersPatternDirective implements IDirective {
  readonly id = 'three-soldiers-pattern';
  readonly name = 'Three White Soldiers';
  readonly description = 'Three consecutive strong bullish candles.';
  readonly priority = 65;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 4) return { score: 0, confidence: 0.1, reason: `Need 4+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const b1 = bars[bars.length - 3];
    const b2 = bars[bars.length - 2];
    const b3 = bars[bars.length - 1];
    const green = (b: typeof b1) => b.close > b.open;
    const body = (b: typeof b1) => Math.abs(b.close - b.open);
    const avgBody = (body(b1) + body(b2) + body(b3)) / 3;
    const range = (b: typeof b1) => b.high - b.low;
    const allGreen = green(b1) && green(b2) && green(b3);
    const allRed = !green(b1) && !green(b2) && !green(b3);
    const ascending = b3.close > b2.close && b2.close > b1.close && b3.open > b2.open && b2.open > b1.open;
    const descending = b3.close < b2.close && b2.close < b1.close && b3.open < b2.open && b2.open < b1.open;
    const goodBodies = body(b1) > range(b1) * 0.5 && body(b2) > range(b2) * 0.5 && body(b3) > range(b3) * 0.5;
    if (allGreen && ascending && goodBodies) {
      return { score: 80, confidence: 0.6, reason: 'Three white soldiers: strong bullish continuation', signalClass: 'bullish' };
    }
    if (allRed && descending && goodBodies) {
      return { score: 75, confidence: 0.55, reason: 'Three black crows: strong bearish continuation', signalClass: 'bearish' };
    }
    if (allGreen && ascending) {
      return { score: 45, confidence: 0.35, reason: 'Three advancing green candles (weak soldiers)', signalClass: 'bullish' };
    }
    if (allRed && descending) {
      return { score: 40, confidence: 0.3, reason: 'Three declining red candles', signalClass: 'bearish' };
    }
    return { score: 5, confidence: 0.25, reason: 'No three-soldiers pattern', signalClass: 'neutral' };
  }
}

// ===========================================================================
// Macro / Regime
// ===========================================================================

@Injectable()
export class VixRegimeDirective implements IDirective {
  readonly id = 'vix-regime';
  readonly name = 'VIX Regime';
  readonly description = 'Broad market regime from VIX: fear/complacency scoring.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'vix-regime.php');
  }
}

@Injectable()
export class CadUsdOilCorrelationDirective implements IDirective {
  readonly id = 'cad-usd-oil-correlation';
  readonly name = 'CAD/USD Oil Correlation';
  readonly description = 'CAD petrocurrency vs WTI crude and rate differentials.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'cad-usd-oil-correlation.php');
  }
}

// ===========================================================================
// Temporal / Calendar
// ===========================================================================

@Injectable()
export class MondayEffectDirective implements IDirective {
  readonly id = 'monday-effect';
  readonly name = 'Monday Effect';
  readonly description = 'Monday negative bias — historically worst day for equities.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 2) return { score: 0, confidence: 0.1, reason: 'Need 2+ bars', signalClass: 'neutral' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    if (day === 1) {
      const prev = bars[bars.length - 2];
      const gapDown = prev.close > 0 && lastBar.open < prev.close * 0.998;
      if (gapDown) return { score: 40, confidence: 0.45, reason: 'Monday gap down — bearish opening bias', signalClass: 'bearish' };
      return { score: 25, confidence: 0.35, reason: 'Monday — historically weak session', signalClass: 'bearish' };
    }
    return { score: 5, confidence: 0.25, reason: `Not Monday (day ${day})`, signalClass: 'neutral' };
  }
}

@Injectable()
export class FridayPositioningDirective implements IDirective {
  readonly id = 'friday-positioning';
  readonly name = 'Friday Positioning';
  readonly description = 'End-of-week profit-taking and position squaring.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 2) return { score: 0, confidence: 0.1, reason: 'Need 2+ bars', signalClass: 'neutral' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    if (day === 5) {
      const volumeSurge = (lastBar.volume || 0) > (bars.slice(-11, -1).reduce((s,b) => s + (b.volume||0), 0) / 10) * 1.2;
      if (volumeSurge) return { score: 35, confidence: 0.4, reason: 'Friday with elevated volume — profit-taking rotation', signalClass: 'neutral' };
      return { score: 20, confidence: 0.3, reason: 'Friday — position squaring ahead of weekend', signalClass: 'neutral' };
    }
    return { score: 5, confidence: 0.25, reason: 'Not Friday — no end-of-week positioning effect', signalClass: 'neutral' };
  }
}

@Injectable()
export class MidweekMomentumDirective implements IDirective {
  readonly id = 'midweek-momentum';
  readonly name = 'Midweek Momentum';
  readonly description = 'Tue-Thu historically strongest sessions for trend continuation.';
  readonly priority = 32;
  readonly maxScore = 55;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 2) return { score: 0, confidence: 0.1, reason: 'Need 2+ bars', signalClass: 'neutral' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    if (day >= 2 && day <= 4) {
      const closes = bars.map(b => b.close);
      const lastClose = closes[closes.length - 1];
      const prevClose = closes[Math.max(0, closes.length - 5)];
      const trend = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;
      if (trend > 1) return { score: 45, confidence: 0.4, reason: `Midweek (Tue-Thu) with bullish momentum +${trend.toFixed(1)}%`, signalClass: 'bullish' };
      if (trend > 0) return { score: 30, confidence: 0.3, reason: 'Midweek session — favorable for trend continuation', signalClass: 'bullish' };
      return { score: 15, confidence: 0.25, reason: 'Midweek session — neutral trend', signalClass: 'neutral' };
    }
    return { score: 5, confidence: 0.2, reason: `Not midweek (day ${day})`, signalClass: 'neutral' };
  }
}

@Injectable()
export class AdvancedWeeklyRhythmDirective implements IDirective {
  readonly id = 'advanced-weekly-rhythm';
  readonly name = 'Advanced Weekly Rhythm Composite';
  readonly description = 'Day-of-week composite: Mon bearish, Tue-Thu bullish, Fri neutral.';
  readonly priority = 35;
  readonly maxScore = 60;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 5) return { score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const closes = bars.map(b => b.close);
    const recentReturn = closes.length > 5 ? (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100 : 0;
    // Composite: day bias × trend alignment
    let dayBias = 0;
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (day === 1) { dayBias = -10; signalClass = 'bearish'; }
    else if (day >= 2 && day <= 4) { dayBias = 15; signalClass = 'bullish'; }
    else if (day === 5) { dayBias = 0; signalClass = 'neutral'; }
    else { dayBias = -5; signalClass = 'neutral'; }
    const score = Math.round(25 + dayBias + (day >= 2 && day <= 4 && recentReturn > 0 ? 15 : 0));
    return { score: Math.min(60, Math.max(5, score)), confidence: 0.3, reason: `Weekly rhythm: day ${day}, bias ${dayBias}, recent return ${recentReturn.toFixed(1)}%`, signalClass };
  }
}

@Injectable()
export class SpyOptionsExpiryDirective implements IDirective {
  readonly id = 'spy-options-expiry';
  readonly name = 'SPY Options Expiry Effect';
  readonly description = 'OpEx week detection via date proximity (3rd Friday of month).';
  readonly priority = 28;
  readonly maxScore = 45;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const day = now.getUTCDate();
    const dayOfWeek = now.getUTCDay();
    // 3rd Friday is between 15th and 21st
    const isOpexWeek = day >= 12 && day <= 21;
    const isNearFriday = dayOfWeek === 5 && day >= 15 && day <= 21;
    if (isNearFriday) return { score: 35, confidence: 0.35, reason: 'Options expiry Friday — increased gamma, pin risk', signalClass: 'neutral' };
    if (isOpexWeek) return { score: 20, confidence: 0.25, reason: 'Options expiry week — elevated hedging flows', signalClass: 'neutral' };
    return { score: 5, confidence: 0.2, reason: 'Outside options expiry window', signalClass: 'neutral' };
  }
}

@Injectable()
export class SpyMonthEndRebalancingDirective implements IDirective {
  readonly id = 'spy-month-end-rebalancing';
  readonly name = 'SPY Month-End Rebalancing';
  readonly description = 'Month-end institutional flow proxy (last 3 trading days).';
  readonly priority = 28;
  readonly maxScore = 45;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const day = now.getUTCDate();
    const dayOfWeek = now.getUTCDay();
    // Last 3 trading days of month (rough proxy: day >= 26)
    const isMonthEnd = day >= 26;
    if (isMonthEnd && dayOfWeek <= 5 && dayOfWeek >= 1) {
      const closes = input.bars.map(b => b.close);
      const recentReturn = closes.length > 5 ? (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100 : 0;
      if (recentReturn < -2) return { score: 40, confidence: 0.35, reason: 'Month-end + drawdown — potential rebalancing bounce', signalClass: 'bullish' };
      return { score: 20, confidence: 0.25, reason: 'Month-end — institutional rebalancing flows', signalClass: 'neutral' };
    }
    return { score: 5, confidence: 0.2, reason: 'Not month-end', signalClass: 'neutral' };
  }
}

@Injectable()
export class SpyQqqRelativeStrengthDirective implements IDirective {
  readonly id = 'spy-qqq-relative-strength';
  readonly name = 'SPY/QQQ Relative Strength';
  readonly description = 'Symbol vs broad market momentum as relative strength proxy.';
  readonly priority = 42;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    // Symbols outperforming their own trend = relative strength proxy
    const acceleration = ret5 - (ret20 / 4);
    if (acceleration > 2) return { score: 60, confidence: 0.45, reason: `Strong relative momentum: 5d ${ret5.toFixed(1)}% vs 20d avg ${(ret20/4).toFixed(1)}%`, signalClass: 'bullish' };
    if (acceleration > 0) return { score: 40, confidence: 0.35, reason: `Positive relative strength: +${acceleration.toFixed(1)}% acceleration`, signalClass: 'bullish' };
    if (acceleration < -2) return { score: 35, confidence: 0.3, reason: `Relative weakness: ${acceleration.toFixed(1)}% deceleration`, signalClass: 'bearish' };
    return { score: 25, confidence: 0.25, reason: `Neutral relative strength (SPY/QQQ comparison unavailable, using self-trend proxy)`, signalClass: 'neutral' };
  }
}

// ===========================================================================
// Crypto
// ===========================================================================

@Injectable()
export class CryptoFearGreedDirective implements IDirective {
  readonly id = 'crypto-fear-greed';
  readonly name = 'Crypto Fear and Greed Proxy';
  readonly description = 'BTC momentum/volume/volatility/dominance proxy.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'crypto-fear-greed.php');
  }
}

@Injectable()
export class BtcHalvingCycleDirective implements IDirective {
  readonly id = 'btc-halving-cycle';
  readonly name = 'Bitcoin Halving Cycle';
  readonly description = 'Hardcoded halving dates, 0-180 days post = +15.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'btc-halving-cycle.php');
  }
}

@Injectable()
export class CryptoWeekendEffectDirective implements IDirective {
  readonly id = 'crypto-weekend-effect';
  readonly name = 'Crypto Weekend Effect';
  readonly description = '24/7 crypto weekend volatility patterns.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'crypto-weekend-effect.php');
  }
}

// ===========================================================================
// Equity-Specific
// ===========================================================================

@Injectable()
export class NvdaEarningsMomentumDirective implements IDirective {
  readonly id = 'nvda-earnings-momentum';
  readonly name = 'NVDA Earnings Momentum';
  readonly description = 'NVDA-specific: post-earnings drift and momentum proxy.';
  readonly priority = 38;
  readonly maxScore = 65;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const isNvda = input.symbol.toUpperCase() === 'NVDA';
    if (!isNvda) return { score: 5, confidence: 0.2, reason: `Not NVDA (${input.symbol}) — directive only applies to NVDA`, signalClass: 'neutral' };
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: 'Need 20+ bars', signalClass: 'neutral' };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const bb = bollingerBands(closes, 20, 2);
    const expanding = bb && bb.upper.length >= 5 && (bb.upper[bb.upper.length-1] - bb.lower[bb.lower.length-1]) > (bb.upper[bb.upper.length-5] - bb.lower[bb.lower.length-5]) * 1.2;
    if (ret5 > 3 && !expanding) return { score: 55, confidence: 0.45, reason: `NVDA strong momentum +${ret5.toFixed(1)}% with stable vol — favorable drift`, signalClass: 'bullish' };
    if (Math.abs(ret5) > 5) return { score: 45, confidence: 0.35, reason: `NVDA high magnitude move ${ret5.toFixed(1)}% — potential post-event drift`, signalClass: ret5 > 0 ? 'bullish' : 'bearish' };
    return { score: 25, confidence: 0.25, reason: `NVDA momentum ${ret5.toFixed(1)}% (earnings calendar unavailable)`, signalClass: ret5 > 0 ? 'bullish' : 'neutral' };
  }
}

@Injectable()
export class TslaSentimentAmplifierDirective implements IDirective {
  readonly id = 'tsla-sentiment-amplifier';
  readonly name = 'TSLA Sentiment Amplifier';
  readonly description = 'TSLA-specific: RSI extremes + volume surge detection.';
  readonly priority = 38;
  readonly maxScore = 65;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const isTsla = input.symbol.toUpperCase() === 'TSLA';
    if (!isTsla) return { score: 5, confidence: 0.2, reason: `Not TSLA (${input.symbol})`, signalClass: 'neutral' };
    const closes = input.bars.map(b => b.close);
    if (closes.length < 15) return { score: 0, confidence: 0.1, reason: 'Need 15+ bars', signalClass: 'neutral' };
    const r = rsi(closes, 14);
    const currentRsi = r[r.length - 1];
    const volumes = input.bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, volumes.length - 1);
    const currentVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? currentVol / avgVol : 1;
    if (currentRsi < 35 && volRatio > 1.3) return { score: 55, confidence: 0.5, reason: `TSLA oversold RSI ${currentRsi.toFixed(0)} + volume surge ${volRatio.toFixed(1)}x — contrarian buy`, signalClass: 'bullish' };
    if (currentRsi < 30) return { score: 40, confidence: 0.4, reason: `TSLA deeply oversold RSI ${currentRsi.toFixed(0)} — potential bounce`, signalClass: 'bullish' };
    if (currentRsi > 75 && volRatio > 1.3) return { score: 30, confidence: 0.35, reason: `TSLA overbought RSI ${currentRsi.toFixed(0)} + volume — possible top`, signalClass: 'bearish' };
    return { score: 15, confidence: 0.25, reason: `TSLA RSI ${currentRsi.toFixed(0)} — neutral range`, signalClass: 'neutral' };
  }
}

// ===========================================================================
// Fundamental
// ===========================================================================

@Injectable()
export class DividendYieldAttractiveDirective implements IDirective {
  readonly id = 'dividend-yield-attractive';
  readonly name = 'Attractive Dividend Yield';
  readonly description = 'Low volatility proxy for dividend-paying stability.';
  readonly priority = 36;
  readonly maxScore = 55;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { score: 0, confidence: 0.1, reason: 'BB calculation failed', signalClass: 'neutral' };
    const bandwidth = (bb.upper[bb.upper.length-1] - bb.lower[bb.lower.length-1]) / bb.middle[bb.middle.length-1];
    const ret20 = (closes[closes.length-1] - closes[0]) / Math.max(0.01, closes[0]) * 100;
    // Low vol + steady positive return = dividend stock proxy
    if (bandwidth < 0.05 && ret20 > 0) return { score: 50, confidence: 0.4, reason: `Low vol steady gainer: band ${(bandwidth*100).toFixed(1)}%, +${ret20.toFixed(1)}% 20-bar — yield proxy`, signalClass: 'bullish' };
    if (bandwidth < 0.08) return { score: 30, confidence: 0.3, reason: `Low volatility (${(bandwidth*100).toFixed(1)}% band) — stable proxy`, signalClass: 'neutral' };
    return { score: 10, confidence: 0.2, reason: `Normal volatility (dividend data unavailable, using vol proxy)`, signalClass: 'neutral' };
  }
}

@Injectable()
export class EarningsProximityDirective implements IDirective {
  readonly id = 'earnings-proximity';
  readonly name = 'Earnings Proximity';
  readonly description = 'Distance to next earnings, pre/post drift windows.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'earnings-proximity.php');
  }
}

@Injectable()
export class NewsSentimentPositiveDirective implements IDirective {
  readonly id = 'news-sentiment-positive';
  readonly name = 'Positive News Sentiment';
  readonly description = 'Aggregated news sentiment momentum from provider.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'news-sentiment-positive.php');
  }
}

// ===========================================================================
// Composite
// ===========================================================================

@Injectable()
export class ConfluenceReversalComboDirective implements IDirective {
  readonly id = 'confluence-reversal-combo';
  readonly name = 'Confluence Reversal Combo';
  readonly description = 'RSI divergence + candle + volume + support confluence.';
  readonly priority = 74;
  readonly maxScore = 110;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    const closes = bars.map(b => b.close);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    let confluence = 0;
    const details: string[] = [];
    // 1. RSI check
    const r = rsi(closes, 14);
    const currentRsi = r[r.length - 1];
    const priceRising = closes[closes.length - 1] > closes[closes.length - 10];
    const rsiFalling = currentRsi < r[Math.max(0, r.length - 6)];
    if (currentRsi < 30) { confluence += 35; details.push('RSI oversold'); }
    else if (currentRsi > 70) { confluence += 30; details.push('RSI overbought'); }
    else if (priceRising && rsiFalling) { confluence += 20; details.push('bearish RSI divergence'); }
    // 2. Candle pattern: check last bar for reversal characteristics
    const last = bars[bars.length - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range > 0 && body / range < 0.3) {
      const lowerWick = Math.min(last.open, last.close) - last.low;
      const upperWick = last.high - Math.max(last.open, last.close);
      if (lowerWick > body * 2) { confluence += 25; details.push('long lower wick'); }
      if (upperWick > body * 2) { confluence += 20; details.push('long upper wick'); }
    }
    // 3. Volume surge check
    const volumes = bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / Math.max(1, volumes.length - 1);
    const currentVol = volumes[volumes.length - 1];
    if (avgVol > 0 && currentVol > avgVol * 1.5) { confluence += 25; details.push(`volume ${(currentVol/avgVol).toFixed(1)}x avg`); }
    // 4. Near support/resistance from recent pivot
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const pivotHigh = Math.max(...highs.slice(-20, -3));
    const pivotLow = Math.min(...lows.slice(-20, -3));
    const pivotRange = pivotHigh - pivotLow;
    if (pivotRange > 0) {
      const distFromLow = (last.close - pivotLow) / pivotRange;
      const distFromHigh = (pivotHigh - last.close) / pivotRange;
      if (distFromLow < 0.1) { confluence += 20; details.push('near support'); }
      if (distFromHigh < 0.1) { confluence += 15; details.push('near resistance'); }
    }
    if (confluence >= 60) {
      const signalClass = currentRsi < 30 ? 'bullish' : currentRsi > 70 ? 'bearish' : 'neutral';
      return { score: Math.min(110, confluence + 10), confidence: 0.55, reason: `Reversal confluence (${confluence}): ${details.join(', ')}`, signalClass: signalClass as 'bullish' | 'bearish' | 'neutral' };
    }
    if (confluence >= 30) {
      return { score: confluence, confidence: 0.3, reason: `Partial confluence (${confluence}): ${details.join(', ')}`, signalClass: 'neutral' };
    }
    return { score: Math.round(confluence), confidence: 0.2, reason: confluence > 0 ? `Weak signals (${confluence}): ${details.join(', ')}` : 'No reversal signals', signalClass: 'neutral' };
  }
}

@Injectable()
export class PriceActionDirective implements IDirective {
  readonly id = 'price-action';
  readonly name = 'Price Action';
  readonly description = 'HH/HL, market structure, S/R tests from raw price.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'price-action.php');
  }
}

// ===========================================================================
// Risk / Support-Resistance
// ===========================================================================

@Injectable()
export class SupportResistanceLevelsDirective implements IDirective {
  readonly id = 'support-resistance-levels';
  readonly name = 'Support & Resistance Levels';
  readonly description = 'Key S/R from historical pivots, bounce quality.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'support-resistance-levels.php');
  }
}

@Injectable()
export class OverheadSupplyPressureDirective implements IDirective {
  readonly id = 'overhead-supply-pressure';
  readonly name = 'Overhead Supply Pressure';
  readonly description = 'Trapped overhead supply from recent top, reclaim progress.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'overhead-supply-pressure.php');
  }
}

@Injectable()
export class PanicExhaustionAbsorptionDirective implements IDirective {
  readonly id = 'panic-exhaustion-absorption';
  readonly name = 'Panic Exhaustion & Absorption';
  readonly description = 'Panic → capitulation → exhaustion → stabilization.';
  readonly priority = 0;
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly readiness = 'alpha' as const;

  calculate(_input: DirectiveInput): DirectiveResult {
    return stubResult(this.id, 'panic-exhaustion-absorption.php');
  }
}

@Injectable()
export class TimeBasedSupportDirective implements IDirective {
  readonly id = 'time-based-support';
  readonly name = 'Time-Based Support';
  readonly description = 'VWAP and round-number support/resistance levels.';
  readonly priority = 55;
  readonly maxScore = 80;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 10) return { score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}`, signalClass: 'neutral' };
    // Compute VWAP
    let cumPV = 0, cumVol = 0;
    for (const bar of bars) { const tp = (bar.high + bar.low + bar.close) / 3; const v = bar.volume || 0; cumPV += tp * v; cumVol += v; }
    if (cumVol <= 0) return { score: 0, confidence: 0.1, reason: 'No volume for VWAP', signalClass: 'neutral' };
    const vwap = cumPV / cumVol;
    const lastClose = bars[bars.length - 1].close;
    const deviation = ((lastClose - vwap) / vwap) * 100;
    // Check proximity to round numbers
    const roundLevel = Math.round(lastClose);
    const distFromRound = Math.abs(lastClose - roundLevel) / Math.max(0.01, lastClose) * 100;
    let score = 30;
    const sigs: string[] = [];
    if (Math.abs(deviation) < 0.5) { score += 25; sigs.push(`at VWAP ${vwap.toFixed(2)}`); }
    else if (deviation > 0) { score += 10; sigs.push(`${deviation.toFixed(1)}% above VWAP`); }
    else { sigs.push(`${deviation.toFixed(1)}% below VWAP`); }
    if (distFromRound < 0.3) { score += 20; sigs.push(`near round number ${roundLevel}`); }
    const signalClass: 'bullish' | 'bearish' | 'neutral' = deviation < -1 ? 'bullish' : deviation > 1 ? 'bearish' : 'neutral';
    return { score: Math.min(80, score), confidence: 0.3, reason: sigs.join(', '), signalClass };
  }
}

// ===========================================================================
// ISA / Special
// ===========================================================================

@Injectable()
export class IsaResetDirective implements IDirective {
  readonly id = 'isa-reset';
  readonly name = 'ISA Reset';
  readonly description = 'UK ISA tax-year reset timing (April 6th).';
  readonly priority = 20;
  readonly maxScore = 30;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getUTCMonth(); // 0=Jan, 3=April
    const day = now.getUTCDate();
    // UK ISA resets April 6 — first 2 weeks of April see fresh inflows
    const isIsaWindow = month === 3 && day >= 6 && day <= 20;
    if (isIsaWindow) return { score: 25, confidence: 0.3, reason: 'UK ISA tax-year reset period — potential fresh inflows', signalClass: 'bullish' };
    return { score: 5, confidence: 0.2, reason: 'Outside ISA reset window (UK tax year April 6)', signalClass: 'neutral' };
  }
}

// ===========================================================================
// Additional TradePress Directives (rounding out the full 56)
// ===========================================================================

@Injectable()
export class BollingerBandsDirective implements IDirective {
  readonly id = 'bollinger-bands';
  readonly name = 'Bollinger Bands';
  readonly description = 'Price vs bands, bandwidth, %B indicator.';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 25) return { score: 0, confidence: 0.1, reason: `Need 25+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { score: 0, confidence: 0.1, reason: 'BB calculation failed', signalClass: 'neutral' };
    const lastClose = closes[closes.length - 1];
    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const middle = bb.middle[bb.middle.length - 1];
    const bandRange = upper - lower;
    if (bandRange <= 0) return { score: 0, confidence: 0.1, reason: 'Zero band range', signalClass: 'neutral' };
    // %B = (price - lower) / (upper - lower)
    const pctB = (lastClose - lower) / bandRange;
    // Bandwidth = (upper - lower) / middle
    const bandwidth = bandRange / middle;
    if (pctB > 1) return { score: 80, confidence: 0.55, reason: `Price above upper BB: %B=${pctB.toFixed(2)} (overbought)`, signalClass: 'bearish' };
    if (pctB < 0) return { score: 85, confidence: 0.6, reason: `Price below lower BB: %B=${pctB.toFixed(2)} (oversold)`, signalClass: 'bullish' };
    if (pctB > 0.9) return { score: 55, confidence: 0.4, reason: `Near upper BB: %B=${pctB.toFixed(2)}`, signalClass: 'bearish' };
    if (pctB < 0.1) return { score: 60, confidence: 0.45, reason: `Near lower BB: %B=${pctB.toFixed(2)}`, signalClass: 'bullish' };
    if (pctB > 0.5) return { score: 35, confidence: 0.3, reason: `Above middle BB: %B=${pctB.toFixed(2)}, bw=${(bandwidth*100).toFixed(1)}%`, signalClass: 'bullish' };
    return { score: 25, confidence: 0.25, reason: `Below middle BB: %B=${pctB.toFixed(2)}`, signalClass: 'neutral' };
  }
}

@Injectable()
export class VwapDirective implements IDirective {
  readonly id = 'vwap';
  readonly name = 'VWAP (Volume-Weighted Average Price)';
  readonly description = 'Price relative to VWAP, intraday sentiment.';
  readonly priority = 70;
  readonly maxScore = 95;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 5) return { score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}`, signalClass: 'neutral' };
    // Compute VWAP: sum(typical_price * volume) / sum(volume)
    let cumPV = 0;
    let cumVol = 0;
    for (const bar of bars) {
      const typical = (bar.high + bar.low + bar.close) / 3;
      const vol = bar.volume || 0;
      cumPV += typical * vol;
      cumVol += vol;
    }
    if (cumVol <= 0) return { score: 0, confidence: 0.1, reason: 'No volume data for VWAP', signalClass: 'neutral' };
    const vwap = cumPV / cumVol;
    const lastClose = bars[bars.length - 1].close;
    const lastV = bars[bars.length - 1].volume || 0;
    const avgVol = cumVol / bars.length;
    const deviationPct = ((lastClose - vwap) / vwap) * 100;
    // Above VWAP with high volume = institutional buying
    if (deviationPct > 2 && lastV > avgVol * 1.5) {
      return { score: 80, confidence: 0.55, reason: `Strong above VWAP: +${deviationPct.toFixed(2)}% with above-avg volume`, signalClass: 'bullish' };
    }
    if (deviationPct > 1) return { score: 55, confidence: 0.4, reason: `Above VWAP: +${deviationPct.toFixed(2)}%`, signalClass: 'bullish' };
    if (deviationPct < -2 && lastV > avgVol * 1.5) {
      return { score: 75, confidence: 0.5, reason: `Strong below VWAP: ${deviationPct.toFixed(2)}% with above-avg volume`, signalClass: 'bearish' };
    }
    if (deviationPct < -1) return { score: 50, confidence: 0.35, reason: `Below VWAP: ${deviationPct.toFixed(2)}%`, signalClass: 'bearish' };
    return { score: Math.round(30 + deviationPct * 5), confidence: 0.25, reason: `VWAP: ${vwap.toFixed(2)}, price ${deviationPct.toFixed(2)}% away`, signalClass: deviationPct > 0 ? 'bullish' : 'bearish' };
  }
}

@Injectable()
export class BasicWeeklyRhythmDirective implements IDirective {
  readonly id = 'basic-weekly-rhythm';
  readonly name = 'Basic Weekly Rhythm Composite';
  readonly description = 'Day-of-week + volume pattern composite.';
  readonly priority = 34;
  readonly maxScore = 55;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 5) return { score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const volumes = bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, volumes.length - 1);
    const volRatio = avgVol > 0 ? volumes[volumes.length-1] / avgVol : 1;
    let score = 20;
    if (day >= 2 && day <= 4) score += 20;
    else if (day === 5) score += 5;
    if (volRatio > 1.2) score += 10;
    const signalClass: 'bullish' | 'bearish' | 'neutral' = day >= 2 && day <= 4 && volRatio > 1 ? 'bullish' : 'neutral';
    return { score: Math.min(55, score), confidence: 0.25, reason: `Day ${day} rhythm: vol ${volRatio.toFixed(1)}x avg`, signalClass };
  }
}

@Injectable()
export class IntradayUPatternDirective implements IDirective {
  readonly id = 'intraday-u-pattern';
  readonly name = 'Intraday U-Pattern';
  readonly description = 'U-shaped recovery: early weakness followed by afternoon strength.';
  readonly priority = 40;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 10) return { score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const firstHalf = bars.slice(0, Math.floor(bars.length / 2));
    const secondHalf = bars.slice(Math.floor(bars.length / 2));
    const firstClose = firstHalf[firstHalf.length - 1].close;
    const firstOpen = firstHalf[0].open;
    const firstReturn = firstOpen > 0 ? ((firstClose - firstOpen) / firstOpen) * 100 : 0;
    const secondClose = secondHalf[secondHalf.length - 1].close;
    const secondOpen = secondHalf[0].open;
    const secondReturn = secondOpen > 0 ? ((secondClose - secondOpen) / secondOpen) * 100 : 0;
    // U-pattern: first half declines, second half recovers
    if (firstReturn < -0.5 && secondReturn > 0.5) {
      return { score: 60, confidence: 0.45, reason: `U-pattern detected: ${firstReturn.toFixed(1)}% drop then ${secondReturn.toFixed(1)}% recovery`, signalClass: 'bullish' };
    }
    if (firstReturn < -0.3 && secondReturn > 0) {
      return { score: 35, confidence: 0.3, reason: `Weak U-pattern: ${firstReturn.toFixed(1)}% then +${secondReturn.toFixed(1)}%`, signalClass: 'bullish' };
    }
    return { score: 10, confidence: 0.2, reason: `No U-pattern: first half ${firstReturn.toFixed(1)}%, second ${secondReturn.toFixed(1)}%`, signalClass: 'neutral' };
  }
}

@Injectable()
export class InstitutionalTimingDirective implements IDirective {
  readonly id = 'institutional-timing';
  readonly name = 'Institutional Timing';
  readonly description = 'Quarter-end and month-end institutional rebalancing proxy.';
  readonly priority = 30;
  readonly maxScore = 50;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const month = now.getUTCMonth(); // 0=Jan
    const day = now.getUTCDate();
    const isQuarterEnd = (month === 2 || month === 5 || month === 8 || month === 11) && day >= 25;
    const isMonthEnd = day >= 26;
    if (isQuarterEnd) {
      return { score: 45, confidence: 0.35, reason: 'Quarter-end — institutional rebalancing, increased flows', signalClass: 'neutral' };
    }
    if (isMonthEnd) {
      return { score: 25, confidence: 0.25, reason: 'Month-end — moderate institutional positioning', signalClass: 'neutral' };
    }
    return { score: 5, confidence: 0.2, reason: 'Standard session — no institutional timing catalyst', signalClass: 'neutral' };
  }
}

@Injectable()
export class MacdDirective implements IDirective {
  readonly id = 'macd';
  readonly name = 'MACD (General)';
  readonly description = 'Line/signal relationship, histogram, divergence.';
  readonly priority = 75;
  readonly maxScore = 110;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 35) return { score: 0, confidence: 0.1, reason: `Need 35+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const result = macd(closes, 12, 26, 9);
    if (!result || !result.macd.length) return { score: 0, confidence: 0.1, reason: 'MACD calculation failed', signalClass: 'neutral' };
    const m = result.macd[result.macd.length - 1];
    const s = result.signal[result.signal.length - 1];
    const prevM = result.macd[result.macd.length - 2];
    const prevS = result.signal[result.signal.length - 2];
    const hist = m - s;
    const prevHist = prevM - prevS;
    const crossedUp = prevM <= prevS && m > s;
    const crossedDown = prevM >= prevS && m < s;
    if (crossedUp && m < 0) return { score: 90, confidence: 0.65, reason: `MACD bullish crossover below zero: ${m.toFixed(4)}`, signalClass: 'bullish' };
    if (crossedUp) return { score: 70, confidence: 0.55, reason: `MACD bullish crossover: ${m.toFixed(4)}`, signalClass: 'bullish' };
    if (crossedDown) return { score: 65, confidence: 0.5, reason: `MACD bearish crossover: ${m.toFixed(4)}`, signalClass: 'bearish' };
    if (m > 0 && hist > prevHist) return { score: 55, confidence: 0.4, reason: 'MACD bullish above zero, hist expanding', signalClass: 'bullish' };
    if (m < 0 && hist < prevHist) return { score: 50, confidence: 0.35, reason: 'MACD bearish below zero, hist expanding', signalClass: 'bearish' };
    const trendScore = Math.round(Math.min(40, Math.abs(m) * 1000));
    return { score: trendScore, confidence: 0.25, reason: `MACD at ${m.toFixed(4)}, signal ${s.toFixed(4)}`, signalClass: m > 0 ? 'bullish' : 'bearish' };
  }
}

// ===========================================================================
// Portfolio
// ===========================================================================

@Injectable()
export class PortfolioPerformanceDirective implements IDirective {
  readonly id = 'portfolio-performance';
  readonly name = 'Portfolio Performance';
  readonly description = 'Symbol-level momentum as proxy for portfolio contribution.';
  readonly priority = 58;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 21) return { score: 0, confidence: 0.1, reason: `Need 21+ bars, have ${closes.length}`, signalClass: 'neutral' };
    // 5-day, 10-day, 20-day returns
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret10 = closes.length > 10 ? (closes[closes.length-1] - closes[closes.length-11]) / Math.max(0.01, closes[closes.length-11]) * 100 : ret5;
    const ret20 = closes.length > 20 ? (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100 : ret10;
    const momentum = (ret5 * 0.5 + ret10 * 0.3 + ret20 * 0.2);
    if (momentum > 5) return { score: 80, confidence: 0.55, reason: `Strong momentum: ${ret5.toFixed(1)}% (5d) / ${ret10.toFixed(1)}% (10d) / ${ret20.toFixed(1)}% (20d)`, signalClass: 'bullish' };
    if (momentum > 1) return { score: 55, confidence: 0.4, reason: `Positive momentum: ${momentum.toFixed(1)}% weighted`, signalClass: 'bullish' };
    if (momentum < -5) return { score: 65, confidence: 0.5, reason: `Strong negative momentum: ${ret5.toFixed(1)}% (5d)`, signalClass: 'bearish' };
    if (momentum < -1) return { score: 40, confidence: 0.35, reason: `Negative momentum: ${momentum.toFixed(1)}% weighted`, signalClass: 'bearish' };
    return { score: 30, confidence: 0.25, reason: `Flat momentum: ${momentum.toFixed(1)}% weighted`, signalClass: 'neutral' };
  }
}

// ===========================================================================
// Aspirational (strategy docs — no PHP source yet)
// ===========================================================================

@Injectable()
export class AdaptiveRiskMonitorDirective implements IDirective {
  readonly id = 'adaptive-risk-monitor';
  readonly name = 'Adaptive Risk Monitor';
  readonly description = 'Dynamic position sizing from volatility regime.';
  readonly priority = 64;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    // Use ATR as volatility proxy; compare current vol to recent vol
    const a = atr(highs, lows, closes, 14);
    if (a.length < 14) return { score: 0, confidence: 0.1, reason: 'ATR calculation failed', signalClass: 'neutral' };
    const currentAtr = a[a.length - 1];
    const prevAtr = a[Math.max(0, a.length - 10)];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    const volExpanding = prevAtr > 0 && currentAtr > prevAtr * 1.2;
    const volContracting = prevAtr > 0 && currentAtr < prevAtr * 0.8;
    if (atrPct > 4) return { score: 80, confidence: 0.6, reason: `Extreme volatility: ATR=${atrPct.toFixed(2)}% — reduce position size`, signalClass: 'neutral' };
    if (volExpanding) return { score: 60, confidence: 0.5, reason: `Volatility expanding: ATR ${(currentAtr/prevAtr).toFixed(1)}x recent — caution`, signalClass: 'neutral' };
    if (volContracting) return { score: 35, confidence: 0.4, reason: `Volatility contracting: ATR ${(currentAtr/prevAtr).toFixed(1)}x recent — favorable`, signalClass: 'bullish' };
    if (atrPct < 1) return { score: 25, confidence: 0.35, reason: `Low volatility: ATR=${atrPct.toFixed(2)}% — steady conditions`, signalClass: 'bullish' };
    return { score: 45, confidence: 0.35, reason: `Normal volatility: ATR=${atrPct.toFixed(2)}%`, signalClass: 'neutral' };
  }
}

@Injectable()
export class AnalystAdjustmentsDirective implements IDirective {
  readonly id = 'analyst-adjustments';
  readonly name = 'Analyst Adjustments';
  readonly description = 'Price momentum proxy for sentiment shifts (analyst revisions unavailable).';
  readonly priority = 50;
  readonly maxScore = 80;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 15) return { score: 0, confidence: 0.1, reason: `Need 15+ bars, have ${closes.length}`, signalClass: 'neutral' };
    // Proxy: accelerating price momentum suggests positive revisions
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret5prev = closes.length > 11 ? (closes[closes.length-6] - closes[closes.length-11]) / Math.max(0.01, closes[closes.length-11]) * 100 : 0;
    const accelerating = ret5 - ret5prev;
    const volumeSurge = (input.bars[input.bars.length-1].volume || 0) > (input.bars.slice(-11, -1).reduce((s,b) => s + (b.volume||0), 0) / 10) * 1.3;
    if (accelerating > 2 && volumeSurge) return { score: 70, confidence: 0.5, reason: `Momentum accelerating +${accelerating.toFixed(1)}% with volume surge — bullish sentiment proxy`, signalClass: 'bullish' };
    if (accelerating > 1) return { score: 50, confidence: 0.35, reason: `Momentum accelerating +${accelerating.toFixed(1)}%`, signalClass: 'bullish' };
    if (accelerating < -2) return { score: 45, confidence: 0.3, reason: `Momentum decelerating ${accelerating.toFixed(1)}% — bearish proxy`, signalClass: 'bearish' };
    return { score: Math.round(30 + accelerating * 5), confidence: 0.25, reason: `Momentum change: ${accelerating.toFixed(1)}% (analyst data unavailable, using price proxy)`, signalClass: accelerating > 0 ? 'bullish' : 'bearish' };
  }
}

@Injectable()
export class ConvictionGrowthDirective implements IDirective {
  readonly id = 'conviction-growth';
  readonly name = 'Conviction Growth';
  readonly description = 'Multi-timeframe conviction for position scaling.';
  readonly priority = 66;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 60) return { score: 0, confidence: 0.1, reason: `Need 60+ bars, have ${closes.length}`, signalClass: 'neutral' };
    let signals = 0;
    const details: string[] = [];
    // 1. Short-term trend (EMA10 vs price)
    const ema10 = ema(closes, 10);
    const lastClose = closes[closes.length - 1];
    if (ema10.length > 0 && lastClose > ema10[ema10.length - 1]) { signals++; details.push('EMA10 bullish'); }
    else if (ema10.length > 0) { signals--; details.push('EMA10 bearish'); }
    // 2. Medium-term (EMA50 slope)
    if (closes.length >= 55) {
      const ema50 = ema(closes, 50);
      if (ema50.length >= 5) {
        const slopeEma50 = ema50[ema50.length - 1] - ema50[ema50.length - 5];
        if (slopeEma50 > 0) { signals++; details.push('EMA50 rising'); }
        else { signals--; details.push('EMA50 falling'); }
      }
    }
    // 3. Long-term trend (price vs SMA200)
    const s200 = sma(closes, 200);
    if (s200 > 0) {
      if (lastClose > s200) { signals++; details.push('above SMA200'); }
      else { signals--; details.push('below SMA200'); }
    }
    // 4. Cross-timeframe check (if dayBars available)
    if (input.dayBars && input.dayBars.length >= 10) {
      const dayCloses = input.dayBars.map(b => b.close);
      const dayEma10 = ema(dayCloses, 10);
      if (dayEma10.length >= 2 && dayEma10[dayEma10.length - 1] > dayEma10[dayEma10.length - 2]) {
        signals++; details.push('daily EMA10 rising');
      }
    }
    const score = Math.round(30 + Math.abs(signals) * 15 + (signals > 0 ? 10 : 0));
    const signalClass: 'bullish' | 'bearish' | 'neutral' = signals >= 3 ? 'bullish' : signals <= -2 ? 'bearish' : 'neutral';
    return { score: Math.min(100, score), confidence: 0.25 + Math.abs(signals) * 0.1, reason: `Conviction: ${signals > 0 ? '+' : ''}${signals} signals (${details.join(', ')})`, signalClass };
  }
}

@Injectable()
export class EarningsImplementationDirective implements IDirective {
  readonly id = 'earnings-implementation';
  readonly name = 'Earnings Strategy Implementation';
  readonly description = 'Volatility compression proxy for pre-earnings positioning.';
  readonly priority = 46;
  readonly maxScore = 70;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}`, signalClass: 'neutral' };
    // Proxy: tightening BB width suggests pre-event vol compression
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length || bb.upper.length < 10) return { score: 0, confidence: 0.1, reason: 'BB calculation failed', signalClass: 'neutral' };
    const recentWidths: number[] = [];
    for (let i = Math.max(0, bb.lower.length - 10); i < bb.lower.length; i++) {
      recentWidths.push((bb.upper[i] - bb.lower[i]) / Math.max(0.01, bb.middle[i]));
    }
    const currentWidth = recentWidths[recentWidths.length - 1];
    const avgWidth = recentWidths.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, recentWidths.length - 1);
    const compressing = avgWidth > 0 && currentWidth < avgWidth * 0.8;
    const expanding = avgWidth > 0 && currentWidth > avgWidth * 1.3;
    if (compressing) return { score: 50, confidence: 0.35, reason: `BB compression: width ${(currentWidth*100).toFixed(1)}% vs avg ${(avgWidth*100).toFixed(1)}% — potential vol expansion ahead`, signalClass: 'neutral' };
    if (expanding) return { score: 35, confidence: 0.25, reason: `BB expanding: width ${(currentWidth*100).toFixed(1)}% — post-event vol regime`, signalClass: 'neutral' };
    return { score: 20, confidence: 0.2, reason: `BB width stable at ${(currentWidth*100).toFixed(1)}% (earnings data unavailable, using vol proxy)`, signalClass: 'neutral' };
  }
}

@Injectable()
export class EarningsWhispersDirective implements IDirective {
  readonly id = 'earnings-whispers';
  readonly name = 'Earnings Whispers';
  readonly description = 'Recent price gap as proxy for whisper surprise.';
  readonly priority = 44;
  readonly maxScore = 65;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 5) return { score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}`, signalClass: 'neutral' };
    // Proxy: look for gap between last close and previous bar's high/low
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const gapUp = last.open > prev.high * 1.005;
    const gapDown = last.open < prev.low * 0.995;
    const gapPct = prev.close > 0 ? ((last.open - prev.close) / prev.close) * 100 : 0;
    if (gapUp && gapPct > 1.5) return { score: 55, confidence: 0.4, reason: `Gap up ${gapPct.toFixed(1)}% — possible positive whisper/event`, signalClass: 'bullish' };
    if (gapUp) return { score: 35, confidence: 0.3, reason: `Small gap up ${gapPct.toFixed(1)}%`, signalClass: 'bullish' };
    if (gapDown && gapPct < -1.5) return { score: 50, confidence: 0.35, reason: `Gap down ${gapPct.toFixed(1)}% — possible negative surprise`, signalClass: 'bearish' };
    if (gapDown) return { score: 30, confidence: 0.25, reason: `Small gap down ${gapPct.toFixed(1)}%`, signalClass: 'bearish' };
    return { score: 15, confidence: 0.2, reason: `No significant price gap (earnings whisper data unavailable, using gap proxy)`, signalClass: 'neutral' };
  }
}

@Injectable()
export class LikeZacksDirective implements IDirective {
  readonly id = 'like-zacks';
  readonly name = 'Zacks-Style Rank Proxy';
  readonly description = 'Trend strength ranking from price momentum as earnings revision proxy.';
  readonly priority = 52;
  readonly maxScore = 85;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 50) return { score: Math.round(20 * closes.length / 50), confidence: 0.15, reason: `Need 50+ bars for ranking, have ${closes.length}`, signalClass: 'neutral' };
    // Zacks-style: rank based on multi-period momentum (proxy for estimate revisions)
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret10 = (closes[closes.length-1] - closes[closes.length-11]) / Math.max(0.01, closes[closes.length-11]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const aboveEma20 = ema20.length > 0 && closes[closes.length-1] > ema20[ema20.length-1];
    const aboveEma50 = ema50.length > 0 && closes[closes.length-1] > ema50[ema50.length-1];
    // Rank 1-5 style
    let rankScore = 0;
    if (ret5 > 2) rankScore += 20;
    else if (ret5 > 0) rankScore += 10;
    if (ret10 > 3) rankScore += 20;
    else if (ret10 > 0) rankScore += 10;
    if (ret20 > 5) rankScore += 20;
    else if (ret20 > 0) rankScore += 10;
    if (aboveEma20) rankScore += 15;
    if (aboveEma50) rankScore += 10;
    const signalClass: 'bullish' | 'bearish' | 'neutral' = rankScore >= 60 ? 'bullish' : rankScore < 25 ? 'bearish' : 'neutral';
    return { score: Math.min(85, rankScore + 5), confidence: 0.3 + rankScore * 0.005, reason: `Zacks-style rank proxy: ${rankScore}/85 (earnings revision data unavailable, using momentum proxy)`, signalClass };
  }
}

@Injectable()
export class MeanReversionDirective implements IDirective {
  readonly id = 'mean-reversion';
  readonly name = 'Mean Reversion Strategy';
  readonly description = 'Statistical mean reversion with regime filters.';
  readonly priority = 71;
  readonly maxScore = 105;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 30) return { score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { score: 0, confidence: 0.1, reason: 'BB calculation failed', signalClass: 'neutral' };
    const lastClose = closes[closes.length - 1];
    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const middle = bb.middle[bb.middle.length - 1];
    const bandRange = upper - lower;
    if (bandRange <= 0) return { score: 0, confidence: 0.1, reason: 'Invalid band range', signalClass: 'neutral' };
    // Distance from mean as % of band half-width
    const distance = (lastClose - middle) / (bandRange / 2);
    if (distance <= -1) return { score: 90, confidence: 0.6, reason: `Price at lower BB (${lastClose.toFixed(2)}), strong mean reversion buy`, signalClass: 'bullish' };
    if (distance <= -0.8) return { score: 70, confidence: 0.5, reason: `Price near lower BB (${lastClose.toFixed(2)}), mean reversion`, signalClass: 'bullish' };
    if (distance >= 1) return { score: 85, confidence: 0.55, reason: `Price at upper BB (${lastClose.toFixed(2)}), overbought revert`, signalClass: 'bearish' };
    if (distance >= 0.8) return { score: 60, confidence: 0.45, reason: `Price near upper BB (${lastClose.toFixed(2)}), extended`, signalClass: 'bearish' };
    const reverting = Math.abs(distance) < 0.3;
    return { score: reverting ? 15 : Math.round(Math.abs(distance) * 25), confidence: 0.2, reason: `Price ${distance.toFixed(2)}σ from BB mean`, signalClass: distance < 0 ? 'bullish' : 'bearish' };
  }
}

@Injectable()
export class ResistanceLevelsStrategyDirective implements IDirective {
  readonly id = 'resistance-levels-strategy';
  readonly name = 'Resistance Levels Strategy';
  readonly description = 'Multi-timeframe resistance with breakout/failure scoring.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 30) return { score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const lastClose = bars[bars.length - 1].close;
    // Find recent pivot high and low (last 20 bars)
    const pivotHigh = Math.max(...highs.slice(-20, -1));
    const pivotLow = Math.min(...lows.slice(-20, -1));
    const range = pivotHigh - pivotLow;
    if (range <= 0) return { score: 0, confidence: 0.1, reason: 'No valid pivot range', signalClass: 'neutral' };
    // Distance from pivot points as % of range
    const distFromResistance = ((pivotHigh - lastClose) / range) * 100;
    const distFromSupport = ((lastClose - pivotLow) / range) * 100;
    // Breakout detection
    const brokeResistance = lastClose > pivotHigh * 1.002;
    const brokeSupport = lastClose < pivotLow * 0.998;
    if (brokeResistance) return { score: 85, confidence: 0.6, reason: `Breakout above resistance ${pivotHigh.toFixed(2)}`, signalClass: 'bullish' };
    if (brokeSupport) return { score: 80, confidence: 0.55, reason: `Breakdown below support ${pivotLow.toFixed(2)}`, signalClass: 'bearish' };
    if (distFromResistance < 5) return { score: 60, confidence: 0.4, reason: `Near resistance (${distFromResistance.toFixed(1)}% away)`, signalClass: 'bearish' };
    if (distFromSupport < 5) return { score: 55, confidence: 0.4, reason: `Near support (${distFromSupport.toFixed(1)}% away)`, signalClass: 'bullish' };
    const mid = (distFromSupport - distFromResistance);
    return { score: Math.round(30 + mid * 0.3), confidence: 0.25, reason: `Mid-range: ${distFromSupport.toFixed(0)}% above support`, signalClass: mid > 0 ? 'bullish' : 'bearish' };
  }
}

@Injectable()
export class Sp500RegimeDirective implements IDirective {
  readonly id = 'sp500-regime';
  readonly name = 'S&P 500 Regime Filter';
  readonly description = 'Market regime proxy: bull/correction/bear/recovery from price vs SMA200.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < 200) return { score: Math.round(30 * closes.length / 200), confidence: 0.15, reason: `Need 200+ bars for regime detection, have ${closes.length}`, signalClass: 'neutral' };
    const lastClose = closes[closes.length - 1];
    const s200 = sma(closes, 200);
    if (s200 <= 0) return { score: 0, confidence: 0.1, reason: 'SMA200 calculation failed', signalClass: 'neutral' };
    const devPct = ((lastClose - s200) / s200) * 100;
    // Check SMA200 slope (last 20 bars of SMA200 on rolling windows)
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const s200recent = sma(closes.slice(-21, -1), 20);
    const slope200 = s200recent > 0 ? s200 - s200recent : 0;
    let regime: string;
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (devPct > 10 && slope200 > 0) {
      regime = 'Strong Bull'; score = 90; signalClass = 'bullish';
    } else if (devPct > 0 && slope200 > 0) {
      regime = 'Bull'; score = 75; signalClass = 'bullish';
    } else if (devPct > 0 && slope200 <= 0) {
      regime = 'Weakening'; score = 45; signalClass = 'neutral';
    } else if (devPct > -10 && slope200 < 0) {
      regime = 'Correction'; score = 35; signalClass = 'bearish';
    } else if (devPct > -10) {
      regime = 'Recovery'; score = 55; signalClass = 'neutral';
    } else {
      regime = 'Bear'; score = 20; signalClass = 'bearish';
    }
    return { score, confidence: 0.4 + Math.abs(devPct) * 0.02, reason: `${regime}: ${devPct.toFixed(1)}% vs SMA200(${s200.toFixed(2)})`, signalClass };
  }
}

@Injectable()
export class VixStrategyDirective implements IDirective {
  readonly id = 'vix-strategy';
  readonly name = 'VIX-Based Strategy';
  readonly description = 'ATR percentile as VIX proxy for position sizing.';
  readonly priority = 63;
  readonly maxScore = 90;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 30) return { score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const a = atr(highs, lows, closes, 14);
    if (a.length < 20) return { score: 0, confidence: 0.1, reason: 'ATR calculation failed', signalClass: 'neutral' };
    const currentAtr = a[a.length - 1];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    // Compute ATR percentile over lookback
    const atrVals = a.slice(-20);
    const sorted = [...atrVals].sort((a,b) => a - b);
    const rank = sorted.findIndex(v => v >= currentAtr);
    const percentile = rank >= 0 ? (rank / sorted.length) * 100 : 50;
    // High ATR percentile = high "VIX" = reduce sizing
    if (percentile > 80) return { score: 75, confidence: 0.55, reason: `Volatility in top ${percentile.toFixed(0)}th percentile (ATR=${atrPct.toFixed(2)}%) — reduce position sizing`, signalClass: 'neutral' };
    if (percentile > 60) return { score: 55, confidence: 0.4, reason: `Elevated volatility: ${percentile.toFixed(0)}th percentile`, signalClass: 'neutral' };
    if (percentile < 20) return { score: 30, confidence: 0.35, reason: `Low volatility: ${percentile.toFixed(0)}th percentile — favorable for entry`, signalClass: 'bullish' };
    return { score: Math.round(40 + (percentile - 50) * 0.3), confidence: 0.3, reason: `Volatility: ${percentile.toFixed(0)}th percentile (VIX proxy: ATR=${atrPct.toFixed(2)}%)`, signalClass: percentile < 50 ? 'bullish' : 'neutral' };
  }
}

@Injectable()
export class WeeklyRhythmStrategyDirective implements IDirective {
  readonly id = 'weekly-rhythm-strategy';
  readonly name = 'Weekly Rhythm Strategy';
  readonly description = 'Day-of-week statistical edges for entry/exit timing.';
  readonly priority = 62;
  readonly maxScore = 85;
  readonly version = '2.0.0';
  readonly readiness = 'alpha' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 5) return { score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const lastBar = bars[bars.length - 1];
    if (!lastBar.timestamp) return { score: 30, confidence: 0.2, reason: 'No timestamp data for day-of-week detection', signalClass: 'neutral' };
    const day = new Date(lastBar.timestamp).getUTCDay();
    // Day-of-week edges (based on common market patterns):
    // Monday: often weak/consolidation (weekend gap digestion) - neutral
    // Tuesday: turnaround potential - mildly bullish
    // Wednesday: strong trending day - bullish
    // Thursday: continuation - bullish
    // Friday: profit-taking, position squaring - neutral/bearish
    switch (day) {
      case 0: return { score: 25, confidence: 0.25, reason: 'Sunday — low liquidity, neutral bias', signalClass: 'neutral' };
      case 1: return { score: 35, confidence: 0.3, reason: 'Monday — gap digestion, cautious', signalClass: 'neutral' };
      case 2: return { score: 65, confidence: 0.4, reason: 'Tuesday — turnaround potential, historically bullish edge', signalClass: 'bullish' };
      case 3: return { score: 75, confidence: 0.5, reason: 'Wednesday — strong trending day, historically best performance', signalClass: 'bullish' };
      case 4: return { score: 60, confidence: 0.4, reason: 'Thursday — continuation trend, bullish bias', signalClass: 'bullish' };
      case 5: return { score: 35, confidence: 0.3, reason: 'Friday — profit-taking, position squaring ahead of weekend', signalClass: 'neutral' };
      case 6: return { score: 20, confidence: 0.2, reason: 'Saturday — minimal liquidity', signalClass: 'neutral' };
      default: return { score: 30, confidence: 0.2, reason: 'Unknown day of week', signalClass: 'neutral' };
    }
  }
}
