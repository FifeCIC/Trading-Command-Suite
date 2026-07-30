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

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };

    const sma20 = sma(closes, 20);
    const sma50 = closes.length >= 50 ? sma(closes, 50) : sma20;
    const sma200 = closes.length >= 200 ? sma(closes, 200) : (closes.length >= 50 ? sma50 : sma20);
    const lastClose = closes[closes.length - 1];

    // BASE (15-85): trend strength from price position relative to SMAs
    const dist20 = sma20 > 0 ? ((lastClose - sma20) / sma20) * 100 : 0;
    const dist50 = sma50 > 0 ? ((lastClose - sma50) / sma50) * 100 : dist20;
    const avgDist = (dist20 + dist50) / 2;
    const baseScore = Math.round(mapRange(avgDist, -5, 5, 15, 85));

    // BONUS: full bullish/bearish alignment
    let bonusScore = 0;
    let bonusLabel = '';
    const fullBullish = lastClose > sma20 && sma20 > sma50 && sma50 > sma200;
    const fullBearish = lastClose < sma20 && sma20 < sma50 && sma50 < sma200;
    if (fullBullish) { bonusScore = 15; bonusLabel = 'full bullish alignment'; }
    else if (fullBearish) { bonusScore = 15; bonusLabel = 'full bearish alignment'; }
    else {
      const bullCount = (lastClose > sma20 ? 1 : 0) + (sma20 > sma50 ? 1 : 0) + (sma50 > sma200 ? 1 : 0);
      if (bullCount >= 2) { bonusScore = 8; bonusLabel = 'partial bullish (2/3)'; }
    }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = avgDist > 1 ? 'bullish' : avgDist < -1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(avgDist) * 0.08).toFixed(2)),
      reason: `MA alignment: price ${avgDist.toFixed(1)}% vs SMAs, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, avgDist, sma20, sma50, sma200 },
    };

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };

    const atrVals = atr(highs, lows, closes, 14);
    if (!atrVals.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'ATR calculation failed' };
    const currentAtr = atrVals[atrVals.length - 1];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;

    // BASE (15-70): ATR percentile in recent range
    const sortedAtr = [...atrVals.slice(-20)].sort((a, b) => a - b);
    const rank = sortedAtr.findIndex(v => v >= currentAtr);
    const percentile = rank >= 0 ? (rank / sortedAtr.length) * 100 : 50;
    const baseScore = Math.round(mapRange(percentile, 0, 100, 15, 70));

    // BONUS: extreme ATR
    let bonusScore = 0;
    let bonusLabel = '';
    if (atrPct > 3) { bonusScore = 20; bonusLabel = 'extreme volatility (ATR>3%)'; }
    else if (atrPct > 1.5) { bonusScore = 10; bonusLabel = 'elevated volatility'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: atrPct > 2 ? 'neutral' : 'bullish',
      score: total,
      confidence: Number((0.3 + Math.min(0.3, atrPct * 0.08)).toFixed(2)),
      reason: `Vol: ATR=${atrPct.toFixed(2)}% (p${percentile.toFixed(0)}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, atrPct, percentile },
    };

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}` };

    const last = bars[bars.length - 1];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Zero-range bar' };
    const upperWick = last.high - Math.max(last.open, last.close);
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const maxWick = Math.max(upperWick, lowerWick);
    const wickBodyRatio = body > 0 ? maxWick / body : 10;

    // BASE (15-60): wick-to-body ratio
    const baseScore = Math.round(mapRange(wickBodyRatio, 1, 5, 15, 60));

    // BONUS: extreme ratios + context
    let bonusScore = 0;
    let bonusLabel = '';
    if (wickBodyRatio >= 5) { bonusScore = 20; bonusLabel = 'extreme wick ratio (' + wickBodyRatio.toFixed(1) + 'x)'; }
    else if (wickBodyRatio >= 3) { bonusScore = 10; bonusLabel = 'strong pin bar'; }

    // Context bonus: at new extreme
    const recentHighs = bars.slice(-10, -1).map(b => b.high);
    const recentLows = bars.slice(-10, -1).map(b => b.low);
    const avgHigh = recentHighs.reduce((a, b) => a + b, 0) / recentHighs.length;
    const avgLow = recentLows.reduce((a, b) => a + b, 0) / recentLows.length;
    if (lowerWick > upperWick && last.low < avgLow) { bonusScore += 10; bonusLabel += (bonusLabel ? ' + ' : '') + 'at new low'; }
    if (upperWick > lowerWick && last.high > avgHigh) { bonusScore += 10; bonusLabel += (bonusLabel ? ' + ' : '') + 'at new high'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const isBullish = lowerWick > upperWick && last.close > last.open;
    const signalClass: 'bullish' | 'bearish' | 'neutral' = isBullish ? 'bullish' : (!isBullish && maxWick > body * 2) ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.min(0.35, wickBodyRatio * 0.06)).toFixed(2)),
      reason: `Pin bar: wick/body=${wickBodyRatio.toFixed(1)}x, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, wickBodyRatio, upperWick, lowerWick },
    };

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'alpha' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 2) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 2+ bars' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();

    // BASE (10-30): day-of-week scoring
    const dayScore: Record<number, number> = { 0: 8, 1: 12, 2: 15, 3: 18, 4: 20, 5: 30, 6: 8 };
    const baseScore = dayScore[day] || 15;

    // BONUS: Friday + elevated volume
    let bonusScore = 0;
    let bonusLabel = '';
    if (day === 5) {
      const volumes = bars.map(b => b.volume || 0);
      const avgVol = volumes.slice(-11, -1).reduce((a, b) => a + b, 0) / Math.max(1, volumes.length - 2);
      const currentVol = volumes[volumes.length - 1];
      const volRatio = avgVol > 0 ? currentVol / avgVol : 1;
      if (volRatio > 1.3) { bonusScore = 20; bonusLabel = 'Friday afternoon volume surge'; }
      else if (volRatio > 1.1) { bonusScore = 10; bonusLabel = 'Friday elevated volume'; }
    }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: 'neutral',
      score: total,
      confidence: Number((0.2 + (day === 5 ? 0.15 : 0) + (bonusScore > 0 ? 0.1 : 0)).toFixed(2)),
      reason: `Friday positioning: day ${day}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 5+ bars' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const closes = bars.map(b => b.close);
    const lastClose = closes[closes.length - 1];
    const prevClose = closes[Math.max(0, closes.length - 5)];
    const recentReturn = prevClose > 0 ? ((lastClose - prevClose) / prevClose) * 100 : 0;

    // BASE (10-35): midweek bias
    const isMidweek = day >= 2 && day <= 4;
    const baseScore = isMidweek ? Math.round(mapRange(recentReturn, -2, 3, 10, 35)) : 10;

    // BONUS: strong midweek trend
    let bonusScore = 0;
    let bonusLabel = '';
    if (isMidweek && recentReturn > 1.5) { bonusScore = 20; bonusLabel = 'strong midweek momentum (+' + recentReturn.toFixed(1) + '%)'; }
    else if (isMidweek && recentReturn > 0.5) { bonusScore = 10; bonusLabel = 'positive midweek bias'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = isMidweek && recentReturn > 0 ? 'bullish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + (isMidweek ? 0.1 : 0) + (Math.abs(recentReturn) > 1 ? 0.15 : 0)).toFixed(2)),
      reason: `Midweek momentum: day ${day}, ${recentReturn.toFixed(1)}% recent, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day, recentReturn },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 5+ bars' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const closes = bars.map(b => b.close);
    const recentReturn = closes.length > 5 ? (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100 : 0;

    // BASE (15-40): multi-session composite
    const dayBias: Record<number, number> = { 0: -8, 1: -5, 2: 10, 3: 15, 4: 10, 5: 0, 6: -5 };
    const bias = dayBias[day] || 0;
    const trendAlignment = recentReturn * (bias >= 0 ? 1 : -1);
    const baseScore = Math.round(mapRange(bias + trendAlignment, -15, 25, 15, 40));

    // BONUS: confluence (day bias + trend aligned)
    let bonusScore = 0;
    let bonusLabel = '';
    if (bias > 0 && recentReturn > 1) { bonusScore = 20; bonusLabel = 'bullish confluence (midweek + uptrend)'; }
    else if (bias < 0 && recentReturn < -1) { bonusScore = 15; bonusLabel = 'bearish confluence'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = bias > 0 && recentReturn > 0 ? 'bullish' : bias < 0 && recentReturn < 0 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(bias) * 0.01 + Math.abs(recentReturn) * 0.03).toFixed(2)),
      reason: `Weekly rhythm: day ${day} bias=${bias}, ${recentReturn.toFixed(1)}% recent, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day, bias, recentReturn },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const now = new Date();
    const day = now.getUTCDate();
    const dow = now.getUTCDay();
    const isOpexWeek = day >= 12 && day <= 21;
    const isOpexFriday = dow === 5 && day >= 15 && day <= 21;
    const daysToOpex = isOpexWeek ? (dow <= 5 ? 5 - dow : 0) : 99;

    // BASE (10-30): proximity to expiry
    let baseScore = 10;
    if (isOpexFriday) baseScore = 30;
    else if (isOpexWeek && daysToOpex <= 3) baseScore = 25;
    else if (isOpexWeek) baseScore = 18;

    // BONUS: expiry week
    let bonusScore = 0;
    let bonusLabel = '';
    if (isOpexFriday) { bonusScore = 15; bonusLabel = 'OpEx Friday — max gamma'; }
    else if (isOpexWeek) { bonusScore = 10; bonusLabel = 'expiry week hedging flows'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: 'neutral',
      score: total,
      confidence: Number((0.15 + (isOpexWeek ? 0.2 : 0)).toFixed(2)),
      reason: `SPY OpEx: ${isOpexFriday ? 'expiry Friday' : isOpexWeek ? 'expiry week' : 'outside window'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, isOpexWeek, isOpexFriday, daysToOpex },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const now = new Date();
    const day = now.getUTCDate();
    const dow = now.getUTCDay();
    const isMonthEnd = day >= 26;
    const daysToMonthEnd = Math.max(0, 30 - day);
    const closes = input.bars.map(b => b.close);
    const recentReturn = closes.length > 5 ? (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100 : 0;

    // BASE (10-30): proximity to month end
    let baseScore = 10;
    if (isMonthEnd && daysToMonthEnd <= 2) baseScore = 30;
    else if (isMonthEnd) baseScore = 22;
    else if (day >= 20) baseScore = 15;

    // BONUS: last 2 days + drawdown bounce
    let bonusScore = 0;
    let bonusLabel = '';
    if (isMonthEnd && daysToMonthEnd <= 2 && recentReturn < -2) { bonusScore = 15; bonusLabel = 'month-end drawdown bounce setup'; }
    else if (isMonthEnd && daysToMonthEnd <= 2) { bonusScore = 10; bonusLabel = 'last 2 trading days'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: recentReturn < -2 && isMonthEnd ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((0.15 + (isMonthEnd ? 0.2 : 0)).toFixed(2)),
      reason: `Month-end rebal: ${isMonthEnd ? 'month-end (d' + daysToMonthEnd + ' left)' : day + 'th of month'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, isMonthEnd, daysToMonthEnd, recentReturn },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    const acceleration = ret5 - (ret20 / 4);
    const momentumRatio = ret5 / Math.max(0.01, Math.abs(ret20));

    // BASE (15-50): self-trend relative strength
    const baseScore = Math.round(mapRange(acceleration, -3, 3, 15, 50));

    // BONUS: divergence / strong ratio
    let bonusScore = 0;
    let bonusLabel = '';
    if (acceleration > 2) { bonusScore = 20; bonusLabel = 'strong relative acceleration'; }
    else if (acceleration < -2) { bonusScore = 15; bonusLabel = 'strong relative deceleration'; }
    if (Math.abs(momentumRatio) > 3) { bonusScore += 5; bonusLabel += (bonusLabel ? ' + ' : '') + 'momentum divergence'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = acceleration > 0.5 ? 'bullish' : acceleration < -0.5 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(acceleration) * 0.06).toFixed(2)),
      reason: `SPY/QQQ RS proxy: 5d ${ret5.toFixed(1)}% vs 20d ${ret20.toFixed(1)}%, accel=${acceleration.toFixed(1)}%, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, ret5, ret20, acceleration },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const isNvda = input.symbol.toUpperCase() === 'NVDA';
    if (!isNvda) return { signalClass: 'neutral', score: 5, confidence: 0.1, reason: 'Not NVDA — directive only applies to NVDA' };
    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 20+ bars' };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const bb = bollingerBands(closes, 20, 2);
    const expanding = bb && bb.upper.length >= 5 && (bb.upper[bb.upper.length-1] - bb.lower[bb.lower.length-1]) > (bb.upper[bb.upper.length-5] - bb.lower[bb.lower.length-5]) * 1.2;

    // BASE (15-45): NVDA momentum strength
    const baseScore = Math.round(mapRange(ret5, -5, 5, 15, 45));

    // BONUS: post-earnings drift patterns
    let bonusScore = 0;
    let bonusLabel = '';
    if (ret5 > 3 && !expanding) { bonusScore = 20; bonusLabel = 'strong momentum + stable vol (post-earnings drift)'; }
    else if (Math.abs(ret5) > 5) { bonusScore = 15; bonusLabel = 'high magnitude move (potential earnings event)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = ret5 > 1 ? 'bullish' : ret5 < -1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + Math.abs(ret5) * 0.06).toFixed(2)),
      reason: `NVDA earnings momentum: ${ret5.toFixed(1)}% 5d, vol ${expanding ? 'expanding' : 'stable'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, ret5, volExpanding: expanding },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const isTsla = input.symbol.toUpperCase() === 'TSLA';
    if (!isTsla) return { signalClass: 'neutral', score: 5, confidence: 0.1, reason: 'Not TSLA — directive only applies to TSLA' };
    const closes = input.bars.map(b => b.close);
    if (closes.length < 15) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 15+ bars' };
    const r = rsi(closes, 14);
    const currentRsi = r[r.length - 1];
    const volumes = input.bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, volumes.length - 1);
    const currentVol = volumes[volumes.length - 1];
    const volRatio = avgVol > 0 ? currentVol / avgVol : 1;

    // BASE (15-50): volatility regime + RSI
    const volScore = mapRange(volRatio, 0.5, 2.5, 0, 25);
    const rsiExtreme = currentRsi < 30 || currentRsi > 70 ? 25 : mapRange(Math.abs(currentRsi - 50), 0, 20, 0, 25);
    const baseScore = Math.round(15 + volScore + rsiExtreme);

    // BONUS: extreme contrarian setups
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentRsi < 30 && volRatio > 1.3) { bonusScore = 15; bonusLabel = 'oversold + vol surge (contrarian buy)'; }
    else if (currentRsi > 75 && volRatio > 1.3) { bonusScore = 15; bonusLabel = 'overbought + vol surge (top signal)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = currentRsi < 35 ? 'bullish' : currentRsi > 70 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.min(0.3, (volRatio - 1) * 0.2)).toFixed(2)),
      reason: `TSLA sentiment: RSI ${currentRsi.toFixed(0)}, vol ${volRatio.toFixed(1)}x, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, currentRsi, volRatio },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'BB calculation failed' };
    const bandwidth = (bb.upper[bb.upper.length-1] - bb.lower[bb.lower.length-1]) / bb.middle[bb.middle.length-1];
    const ret20 = (closes[closes.length-1] - closes[0]) / Math.max(0.01, closes[0]) * 100;

    // BASE (10-40): price stability (low vol = dividend stock proxy)
    const stabilityScore = mapRange(bandwidth, 0.02, 0.15, 40, 10);
    const returnScore = ret20 > 0 ? mapRange(ret20, 0, 10, 0, 15) : 0;
    const baseScore = Math.round(10 + stabilityScore * 0.6 + returnScore * 0.4);

    // BONUS: ex-div proximity proxy
    let bonusScore = 0;
    let bonusLabel = '';
    if (bandwidth < 0.05 && ret20 > 0 && ret20 < 5) { bonusScore = 15; bonusLabel = 'low-vol steady gainer (dividend proxy)'; }
    else if (bandwidth < 0.08) { bonusScore = 8; bonusLabel = 'low volatility stability'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: ret20 > 0 && bandwidth < 0.08 ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((0.2 + (bandwidth < 0.08 ? 0.15 : 0)).toFixed(2)),
      reason: `Dividend proxy: bandwidth ${(bandwidth*100).toFixed(1)}%, 20d ${ret20.toFixed(1)}%, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, bandwidth, ret20 },
    };

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}` };

    let cumPV = 0, cumVol = 0;
    for (const bar of bars) { const tp = (bar.high + bar.low + bar.close) / 3; const v = bar.volume || 0; cumPV += tp * v; cumVol += v; }
    if (cumVol <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'No volume for VWAP' };
    const vwap = cumPV / cumVol;
    const lastClose = bars[bars.length - 1].close;
    const deviation = ((lastClose - vwap) / vwap) * 100;
    const roundLevel = Math.round(lastClose);
    const distFromRound = Math.abs(lastClose - roundLevel) / Math.max(0.01, lastClose) * 100;

    // BASE (15-60): proximity to VWAP and round numbers
    const vwapProximity = Math.max(0, 1 - Math.abs(deviation) / 3);
    const roundProximity = Math.max(0, 1 - distFromRound / 1.5);
    const baseScore = Math.round(mapRange(vwapProximity * 0.6 + roundProximity * 0.4, 0, 1, 15, 60));

    // BONUS: at key levels
    let bonusScore = 0;
    let bonusLabel = '';
    if (Math.abs(deviation) < 0.5) { bonusScore += 15; bonusLabel = 'at VWAP'; }
    if (distFromRound < 0.3) { bonusScore += 10; bonusLabel += (bonusLabel ? ' + ' : '') + 'near round number ' + roundLevel; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = deviation < -1 ? 'bullish' : deviation > 1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + (bonusScore > 0 ? 0.2 : 0)).toFixed(2)),
      reason: `Time support: ${deviation.toFixed(2)}% vs VWAP ${vwap.toFixed(2)}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, deviation, vwap, distFromRound },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const now = new Date();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    const isIsaWindow = month === 3 && day >= 6 && day <= 20;
    const daysIntoTaxYear = month === 3 && day >= 6 ? day - 6 : -1;

    // BASE (5-20): proximity to ISA reset
    let baseScore = 5;
    if (isIsaWindow && daysIntoTaxYear <= 3) baseScore = 20;
    else if (isIsaWindow && daysIntoTaxYear <= 7) baseScore = 15;
    else if (isIsaWindow) baseScore = 12;

    // BONUS: new tax year
    let bonusScore = 0;
    let bonusLabel = '';
    if (isIsaWindow && daysIntoTaxYear <= 3) { bonusScore = 10; bonusLabel = 'new ISA tax year (first 3 days)'; }
    else if (isIsaWindow) { bonusScore = 5; bonusLabel = 'ISA reset window'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: isIsaWindow ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((0.1 + (isIsaWindow ? 0.2 : 0)).toFixed(2)),
      reason: `ISA reset: ${isIsaWindow ? 'within ISA window (Apr ' + day + ')' : 'outside window'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, isIsaWindow, daysIntoTaxYear },
    };

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 5+ bars' };
    const lastBar = bars[bars.length - 1];
    const day = lastBar.timestamp ? new Date(lastBar.timestamp).getUTCDay() : new Date().getUTCDay();
    const volumes = bars.map(b => b.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, volumes.length - 1);
    const volRatio = avgVol > 0 ? volumes[volumes.length-1] / avgVol : 1;

    // BASE (10-35): day-of-week + volume
    const dayBase: Record<number, number> = { 0: 8, 1: 12, 2: 18, 3: 22, 4: 18, 5: 14, 6: 8 };
    const baseScore = Math.round(mapRange((dayBase[day] || 15) + volRatio * 5, 5, 35, 10, 35));

    // BONUS: volume confirmation
    let bonusScore = 0;
    let bonusLabel = '';
    if (volRatio > 1.5 && day >= 2 && day <= 4) { bonusScore = 20; bonusLabel = 'midweek vol surge'; }
    else if (volRatio > 1.3) { bonusScore = 10; bonusLabel = 'above-avg volume'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = day >= 2 && day <= 4 && volRatio > 1 ? 'bullish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + (volRatio > 1.2 ? 0.1 : 0) + (day >= 2 && day <= 4 ? 0.05 : 0)).toFixed(2)),
      reason: `Basic rhythm: day ${day}, vol ${volRatio.toFixed(1)}x avg, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day, volRatio },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 10+ bars, have ${bars.length}` };

    const mid = Math.floor(bars.length / 2);
    const firstHalf = bars.slice(0, mid);
    const secondHalf = bars.slice(mid);
    const firstOpen = firstHalf[0].open;
    const firstClose = firstHalf[firstHalf.length - 1].close;
    const firstReturn = firstOpen > 0 ? ((firstClose - firstOpen) / firstOpen) * 100 : 0;
    const secondOpen = secondHalf[0].open;
    const secondClose = secondHalf[secondHalf.length - 1].close;
    const secondReturn = secondOpen > 0 ? ((secondClose - secondOpen) / secondOpen) * 100 : 0;

    // BASE (15-55): U-pattern strength = magnitude of recovery
    const recoveryMagnitude = Math.max(0, secondReturn - Math.min(0, firstReturn));
    const baseScore = Math.round(mapRange(recoveryMagnitude, 0, 3, 15, 55));

    // BONUS: pronounced U-pattern
    let bonusScore = 0;
    let bonusLabel = '';
    if (firstReturn < -0.5 && secondReturn > 0.5) { bonusScore = 15; bonusLabel = 'classic U-pattern'; }
    else if (firstReturn < -0.3 && secondReturn > 0.3) { bonusScore = 8; bonusLabel = 'weak U-pattern'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = secondReturn > 0 && firstReturn < 0 ? 'bullish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + (firstReturn < 0 && secondReturn > 0 ? 0.25 : 0)).toFixed(2)),
      reason: `U-pattern: 1st half ${firstReturn.toFixed(1)}%, 2nd half +${secondReturn.toFixed(1)}%, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, firstReturn, secondReturn, recoveryMagnitude },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const now = new Date();
    const month = now.getUTCMonth();
    const day = now.getUTCDate();
    const dow = now.getUTCDay();
    const isQuarterEnd = (month === 2 || month === 5 || month === 8 || month === 11) && day >= 25;
    const isMonthEnd = day >= 26;
    const isLONNYOverlap = dow >= 1 && dow <= 5; // weekday proxy for session overlap

    // BASE (10-35): session timing score
    let baseScore = 10;
    if (isQuarterEnd) baseScore = 35;
    else if (isMonthEnd) baseScore = 25;
    else if (isLONNYOverlap) baseScore = 20;

    // BONUS: key windows
    let bonusScore = 0;
    let bonusLabel = '';
    if (isQuarterEnd) { bonusScore = 15; bonusLabel = 'quarter-end rebalancing'; }
    else if (isMonthEnd && dow === 5) { bonusScore = 10; bonusLabel = 'month-end Friday'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: 'neutral',
      score: total,
      confidence: Number((0.2 + (isQuarterEnd ? 0.2 : isMonthEnd ? 0.1 : 0)).toFixed(2)),
      reason: `Institutional timing: ${isQuarterEnd ? 'quarter-end' : isMonthEnd ? 'month-end' : 'standard'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, isQuarterEnd, isMonthEnd, month, day },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 35) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 35+ bars, have ${closes.length}` };

    const result = macd(closes, 12, 26, 9);
    if (!result || !result.macd.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'MACD calculation failed' };
    const m = result.macd[result.macd.length - 1];
    const s = result.signal[result.signal.length - 1];
    const prevM = result.macd[result.macd.length - 2];
    const prevS = result.signal[result.signal.length - 2];
    const hist = m - s;
    const prevHist = prevM - prevS;

    // BASE (15-75): MACD histogram strength
    const maxHist = Math.max(...result.macd.map((v, i) => Math.abs(v - (result.signal[i] || 0))).slice(-50));
    const histNorm = maxHist > 0 ? Math.abs(hist) / maxHist : 0;
    const baseScore = Math.round(mapRange(histNorm, 0, 1, 15, 60) + (m > 0 ? 15 : 0));

    // BONUS: crossover events
    let bonusScore = 0;
    let bonusLabel = '';
    const crossedUp = prevM <= prevS && m > s;
    const crossedDown = prevM >= prevS && m < s;
    if (crossedUp) { bonusScore = 25; bonusLabel = 'bullish crossover' + (m < 0 ? ' below zero' : ''); }
    else if (crossedDown) { bonusScore = 20; bonusLabel = 'bearish crossover'; }
    else if (m > 0 && hist > prevHist && hist > 0) { bonusScore = 10; bonusLabel = 'histogram expanding bullish'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = crossedUp || (m > 0 && hist > 0) ? 'bullish' : crossedDown || (m < 0 && hist < 0) ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(histNorm) * 0.4 + (bonusScore > 0 ? 0.1 : 0)).toFixed(2)),
      reason: `MACD=${m.toFixed(4)} sig=${s.toFixed(4)} hist=${hist.toFixed(4)}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, macdLine: m, signalLine: s, histogram: hist },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 21) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 21+ bars, have ${closes.length}` };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret10 = (closes[closes.length-1] - closes[closes.length-11]) / Math.max(0.01, closes[closes.length-11]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    const momentum = (ret5 * 0.5 + ret10 * 0.3 + ret20 * 0.2);

    // BASE (15-70): weighted multi-period return
    const baseScore = Math.round(mapRange(momentum, -8, 8, 15, 70));

    // BONUS: outlier performance
    let bonusScore = 0;
    let bonusLabel = '';
    if (momentum > 5) { bonusScore = 20; bonusLabel = 'exceptional momentum (>5%)'; }
    else if (momentum > 3) { bonusScore = 10; bonusLabel = 'strong momentum'; }
    if (momentum < -5) { bonusScore = 15; bonusLabel = 'significant drawdown'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = momentum > 1 ? 'bullish' : momentum < -1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.25 + Math.abs(momentum) * 0.05).toFixed(2)),
      reason: `Portfolio perf: ${momentum.toFixed(1)}% weighted (5d:${ret5.toFixed(1)} 10d:${ret10.toFixed(1)} 20d:${ret20.toFixed(1)}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, momentum, ret5, ret10, ret20 },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const a = atr(highs, lows, closes, 14);
    if (a.length < 14) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'ATR calculation failed' };
    const currentAtr = a[a.length - 1];
    const prevAtr = a[Math.max(0, a.length - 10)];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    const volRatio = prevAtr > 0 ? currentAtr / prevAtr : 1;

    // BASE (15-65): volatility regime
    const volPctScore = mapRange(atrPct, 0.5, 5, 15, 65);
    const trendScore = volRatio > 1 ? mapRange(volRatio, 1, 2, 0, 15) : 0;
    const baseScore = Math.round(volPctScore * 0.8 + trendScore * 0.2);

    // BONUS: high-risk periods
    let bonusScore = 0;
    let bonusLabel = '';
    if (atrPct > 4) { bonusScore = 25; bonusLabel = 'extreme vol — reduce sizing'; }
    else if (atrPct > 2.5 && volRatio > 1.3) { bonusScore = 15; bonusLabel = 'vol expanding — caution'; }
    else if (volRatio < 0.7) { bonusScore = 10; bonusLabel = 'vol contracting — favorable'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = atrPct < 1.5 ? 'bullish' : atrPct > 3 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.min(0.3, atrPct * 0.06)).toFixed(2)),
      reason: `Risk monitor: ATR=${atrPct.toFixed(2)}%, vol ${volRatio > 1.1 ? 'expanding' : volRatio < 0.9 ? 'contracting' : 'stable'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, atrPct, volRatio },
    };

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
  readonly readiness = 'beta' as const;

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 60) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 60+ bars, have ${closes.length}` };
    let signals = 0;
    const details: string[] = [];
    const ema10 = ema(closes, 10);
    const lastClose = closes[closes.length - 1];
    if (ema10.length > 0 && lastClose > ema10[ema10.length - 1]) { signals++; details.push('EMA10 bullish'); }
    else if (ema10.length > 0) { signals--; details.push('EMA10 bearish'); }
    if (closes.length >= 55) {
      const ema50 = ema(closes, 50);
      if (ema50.length >= 5) {
        const slopeEma50 = ema50[ema50.length - 1] - ema50[ema50.length - 5];
        if (slopeEma50 > 0) { signals++; details.push('EMA50 rising'); }
        else { signals--; details.push('EMA50 falling'); }
      }
    }
    const s200 = sma(closes, 200);
    if (s200 > 0) {
      if (lastClose > s200) { signals++; details.push('above SMA200'); }
      else { signals--; details.push('below SMA200'); }
    }
    if (input.dayBars && input.dayBars.length >= 10) {
      const dayCloses = input.dayBars.map(b => b.close);
      const dayEma10 = ema(dayCloses, 10);
      if (dayEma10.length >= 2 && dayEma10[dayEma10.length - 1] > dayEma10[dayEma10.length - 2]) {
        signals++; details.push('daily EMA10 rising');
      }
    }

    // BASE (20-70): signal count mapped to score
    const baseScore = Math.round(mapRange(signals, -3, 4, 20, 70));

    // BONUS: accelerating conviction
    let bonusScore = 0;
    let bonusLabel = '';
    if (signals >= 3) { bonusScore = 30; bonusLabel = 'high conviction (' + signals + ' aligned signals)'; }
    else if (signals >= 2) { bonusScore = 15; bonusLabel = 'growing conviction'; }
    else if (signals <= -2) { bonusScore = 10; bonusLabel = 'strong bearish conviction'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = signals >= 2 ? 'bullish' : signals <= -2 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + Math.abs(signals) * 0.12).toFixed(2)),
      reason: `Conviction: ${signals} signals (${details.join(', ')}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, signalCount: signals, details },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 20+ bars, have ${closes.length}` };
    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length || bb.upper.length < 10) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'BB calculation failed' };
    const recentWidths: number[] = [];
    for (let i = Math.max(0, bb.lower.length - 10); i < bb.lower.length; i++) {
      recentWidths.push((bb.upper[i] - bb.lower[i]) / Math.max(0.01, bb.middle[i]));
    }
    const currentWidth = recentWidths[recentWidths.length - 1];
    const avgWidth = recentWidths.slice(0, -1).reduce((a,b) => a+b, 0) / Math.max(1, recentWidths.length - 1);
    const widthRatio = avgWidth > 0 ? currentWidth / avgWidth : 1;
    const compressing = widthRatio < 0.8;
    const expanding = widthRatio > 1.3;

    // BASE (10-50): proximity to earnings via vol compression
    const baseScore = Math.round(mapRange(widthRatio, 0.5, 1.5, 50, 10));

    // BONUS: report week proximity
    let bonusScore = 0;
    let bonusLabel = '';
    if (compressing) { bonusScore = 20; bonusLabel = 'pre-earnings vol compression'; }
    else if (expanding) { bonusScore = 10; bonusLabel = 'post-earnings vol expansion'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    return {
      signalClass: 'neutral',
      score: total,
      confidence: Number((0.15 + (compressing ? 0.2 : 0.1)).toFixed(2)),
      reason: `Earnings implementation: BB width ${(currentWidth*100).toFixed(1)}% (${compressing ? 'compressing' : expanding ? 'expanding' : 'stable'}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, currentWidth: currentWidth*100, widthRatio, compressing },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 5+ bars, have ${bars.length}` };
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const gapPct = prev.close > 0 ? ((last.open - prev.close) / prev.close) * 100 : 0;
    const gapUp = last.open > prev.high * 1.005;
    const gapDown = last.open < prev.low * 0.995;
    const gapMagnitude = Math.abs(gapPct);

    // BASE (10-45): gap magnitude
    const baseScore = Math.round(mapRange(gapMagnitude, 0, 5, 10, 45));

    // BONUS: large drift
    let bonusScore = 0;
    let bonusLabel = '';
    if (gapUp && gapPct > 2) { bonusScore = 20; bonusLabel = 'large gap up (positive whisper)'; }
    else if (gapUp && gapPct > 1) { bonusScore = 10; bonusLabel = 'gap up'; }
    else if (gapDown && gapPct < -2) { bonusScore = 15; bonusLabel = 'large gap down (negative surprise)'; }
    else if (gapDown) { bonusScore = 8; bonusLabel = 'gap down'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = gapUp ? 'bullish' : gapDown ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.15 + Math.min(0.25, gapMagnitude * 0.06)).toFixed(2)),
      reason: `Earnings whispers: gap ${gapPct.toFixed(1)}% (${gapUp ? 'up' : gapDown ? 'down' : 'none'}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, gapPct, gapUp, gapDown },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 50) return { signalClass: 'neutral', score: Math.round(10 * closes.length / 50), confidence: 0.1, reason: `Need 50+ bars, have ${closes.length}` };
    const ret5 = (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100;
    const ret10 = (closes[closes.length-1] - closes[closes.length-11]) / Math.max(0.01, closes[closes.length-11]) * 100;
    const ret20 = (closes[closes.length-1] - closes[closes.length-21]) / Math.max(0.01, closes[closes.length-21]) * 100;
    const ema20Vals = ema(closes, 20);
    const ema50Vals = ema(closes, 50);
    const aboveEma20 = ema20Vals.length > 0 && closes[closes.length-1] > ema20Vals[ema20Vals.length-1];
    const aboveEma50 = ema50Vals.length > 0 && closes[closes.length-1] > ema50Vals[ema50Vals.length-1];

    // BASE (5-60): multi-period momentum composite
    let rankScore = 0;
    if (ret5 > 2) rankScore += 20; else if (ret5 > 0) rankScore += 10;
    if (ret10 > 3) rankScore += 20; else if (ret10 > 0) rankScore += 10;
    if (ret20 > 5) rankScore += 20; else if (ret20 > 0) rankScore += 10;
    if (aboveEma20) rankScore += 10;
    if (aboveEma50) rankScore += 5;
    const baseScore = Math.round(mapRange(rankScore, 0, 85, 5, 60));

    // BONUS: strong Zacks-style rank
    let bonusScore = 0;
    let bonusLabel = '';
    if (rankScore >= 65) { bonusScore = 25; bonusLabel = 'strong buy proxy (rank ' + rankScore + '/85)'; }
    else if (rankScore >= 45) { bonusScore = 15; bonusLabel = 'buy proxy'; }
    else if (rankScore < 15) { bonusScore = 10; bonusLabel = 'weak rank (sell proxy)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = rankScore >= 45 ? 'bullish' : rankScore < 15 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + rankScore * 0.005).toFixed(2)),
      reason: `Zacks proxy: rank ${rankScore}/85 (5d:${ret5.toFixed(1)}% 10d:${ret10.toFixed(1)}% 20d:${ret20.toFixed(1)}%), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, rankScore, ret5, ret10, ret20 },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 30) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}` };

    const bb = bollingerBands(closes, 20, 2);
    if (!bb || !bb.upper.length) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'BB calculation failed' };
    const lastClose = closes[closes.length - 1];
    const upper = bb.upper[bb.upper.length - 1];
    const lower = bb.lower[bb.lower.length - 1];
    const middle = bb.middle[bb.middle.length - 1];
    const bandRange = upper - lower;
    if (bandRange <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Invalid band range' };

    // Distance from mean in sigma units (-1=lowerBB, 0=middle, 1=upperBB)
    const sigmaDist = (lastClose - middle) / (bandRange / 2);

    // BASE (15-75): continuous from sigma distance
    const baseScore = Math.round(mapRange(Math.abs(sigmaDist), 0, 1.2, 15, 75));

    // BONUS: extreme mean deviation
    let bonusScore = 0;
    let bonusLabel = '';
    if (sigmaDist <= -1) { bonusScore = 25; bonusLabel = 'at lower BB (oversold)'; }
    else if (sigmaDist <= -0.8) { bonusScore = 15; bonusLabel = 'near lower BB'; }
    else if (sigmaDist >= 1) { bonusScore = 25; bonusLabel = 'at upper BB (overbought)'; }
    else if (sigmaDist >= 0.8) { bonusScore = 15; bonusLabel = 'near upper BB'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = sigmaDist <= -0.5 ? 'bullish' : sigmaDist >= 0.5 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.2 + Math.abs(sigmaDist) * 0.4).toFixed(2)),
      reason: `Mean reversion: ${sigmaDist.toFixed(2)}σ from BB mean, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, sigmaDist, lastClose, middle },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 30) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${bars.length}` };

    const highs = bars.map(b => b.high);
    const lows = bars.map(b => b.low);
    const lastClose = bars[bars.length - 1].close;
    const pivotHigh = Math.max(...highs.slice(-20, -1));
    const pivotLow = Math.min(...lows.slice(-20, -1));
    const range = pivotHigh - pivotLow;
    if (range <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'No valid pivot range' };

    // Distance from resistance as % of range
    const distFromResistance = ((pivotHigh - lastClose) / range) * 100;
    const distFromSupport = ((lastClose - pivotLow) / range) * 100;

    // BASE (15-75): proximity to resistance (closer = higher base)
    const baseScore = Math.round(mapRange(distFromResistance, 0, 50, 75, 15));

    // BONUS: breakout/breakdown
    let bonusScore = 0;
    let bonusLabel = '';
    const brokeResistance = lastClose > pivotHigh * 1.002;
    const brokeSupport = lastClose < pivotLow * 0.998;
    if (brokeResistance) { bonusScore = 25; bonusLabel = 'breakout above resistance'; }
    else if (brokeSupport) { bonusScore = 20; bonusLabel = 'breakdown below support'; }
    else if (distFromResistance < 5) { bonusScore = 15; bonusLabel = 'at resistance'; }
    else if (distFromSupport < 5) { bonusScore = 15; bonusLabel = 'at support'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = brokeResistance ? 'bullish' : brokeSupport ? 'bearish' : distFromSupport < 30 ? 'bullish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + (brokeResistance || brokeSupport ? 0.25 : 0)).toFixed(2)),
      reason: `S/R: ${distFromResistance.toFixed(0)}% below resistance, ${distFromSupport.toFixed(0)}% above support, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, distFromResistance, distFromSupport, pivotHigh, pivotLow },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    if (closes.length < 200) return { signalClass: 'neutral', score: Math.round(15 * closes.length / 200), confidence: 0.1, reason: `Need 200+ bars, have ${closes.length}` };
    const lastClose = closes[closes.length - 1];
    const s200 = sma(closes, 200);
    if (s200 <= 0) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'SMA200 calculation failed' };
    const devPct = ((lastClose - s200) / s200) * 100;
    const s200recent = sma(closes.slice(-21, -1), 20);
    const slope200 = s200recent > 0 ? s200 - s200recent : 0;
    const slopeDir = slope200 > 0;

    // BASE (15-70): trend strength from SMA200 position
    const baseScore = Math.round(mapRange(devPct, -15, 15, 15, 70));

    // BONUS: breakout/breakdown
    let bonusScore = 0;
    let bonusLabel = '';
    if (devPct > 10 && slopeDir) { bonusScore = 30; bonusLabel = 'strong bull regime'; }
    else if (devPct > 5 && slopeDir) { bonusScore = 20; bonusLabel = 'bull regime'; }
    else if (devPct < -10 && !slopeDir) { bonusScore = 20; bonusLabel = 'bear regime'; }
    else if (devPct < -5) { bonusScore = 10; bonusLabel = 'correction'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = devPct > 0 && slopeDir ? 'bullish' : devPct < -5 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.abs(devPct) * 0.03).toFixed(2)),
      reason: `SP500 regime: ${devPct.toFixed(1)}% vs SMA200, SMA200 ${slopeDir ? 'rising' : 'falling'}, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, devPct, slope200, slopeDir },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const closes = input.bars.map(b => b.close);
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    if (closes.length < 30) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Need 30+ bars, have ${closes.length}` };
    const a = atr(highs, lows, closes, 14);
    if (a.length < 20) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'ATR calculation failed' };
    const currentAtr = a[a.length - 1];
    const lastClose = closes[closes.length - 1];
    const atrPct = (currentAtr / lastClose) * 100;
    const atrVals = a.slice(-20);
    const sorted = [...atrVals].sort((a, b) => a - b);
    const rank = sorted.findIndex(v => v >= currentAtr);
    const percentile = rank >= 0 ? (rank / sorted.length) * 100 : 50;

    // BASE (15-60): ATR percentile as VIX proxy
    const baseScore = Math.round(mapRange(percentile, 0, 100, 15, 60));

    // BONUS: high vol regime
    let bonusScore = 0;
    let bonusLabel = '';
    if (percentile > 85) { bonusScore = 30; bonusLabel = 'extreme vol (VIX spike proxy)'; }
    else if (percentile > 70) { bonusScore = 20; bonusLabel = 'elevated vol regime'; }
    else if (percentile < 15) { bonusScore = 15; bonusLabel = 'low vol (complacency)'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = percentile < 30 ? 'bullish' : percentile > 70 ? 'neutral' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.min(0.3, Math.abs(percentile - 50) * 0.006)).toFixed(2)),
      reason: `VIX strategy: ATR ${atrPct.toFixed(2)}% (p${percentile.toFixed(0)}), base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, atrPct, percentile },
    };

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
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {

    const bars = input.bars;
    if (bars.length < 5) return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Need 5+ bars' };
    const lastBar = bars[bars.length - 1];
    if (!lastBar.timestamp) return { signalClass: 'neutral', score: 15, confidence: 0.15, reason: 'No timestamp data' };
    const day = new Date(lastBar.timestamp).getUTCDay();
    const closes = bars.map(b => b.close);
    const recentReturn = closes.length > 5 ? (closes[closes.length-1] - closes[closes.length-6]) / Math.max(0.01, closes[closes.length-6]) * 100 : 0;

    // BASE (15-55): day-of-week statistical edge
    const dayEdges: Record<number, { base: number; label: string }> = {
      0: { base: 15, label: 'Sunday low liquidity' },
      1: { base: 20, label: 'Monday gap digestion' },
      2: { base: 45, label: 'Tuesday turnaround' },
      3: { base: 55, label: 'Wednesday strongest day' },
      4: { base: 45, label: 'Thursday continuation' },
      5: { base: 25, label: 'Friday profit-taking' },
      6: { base: 12, label: 'Saturday minimal' },
    };
    const edge = dayEdges[day] || { base: 20, label: 'unknown' };
    const baseScore = edge.base;

    // BONUS: strong pattern alignment
    let bonusScore = 0;
    let bonusLabel = '';
    if ((day === 2 || day === 3 || day === 4) && recentReturn > 1.5) { bonusScore = 30; bonusLabel = 'strong bullish midweek pattern'; }
    else if ((day === 2 || day === 3 || day === 4) && recentReturn > 0.5) { bonusScore = 15; bonusLabel = 'midweek bullish bias confirmed'; }
    else if (day === 1 && recentReturn < -1) { bonusScore = 20; bonusLabel = 'Monday bearish pattern active'; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const signalClass: 'bullish' | 'bearish' | 'neutral' = (day >= 2 && day <= 4) ? 'bullish' : day === 1 ? 'bearish' : 'neutral';
    return {
      signalClass,
      score: total,
      confidence: Number((0.3 + Math.abs(recentReturn) * 0.04).toFixed(2)),
      reason: `Weekly rhythm strategy: ${edge.label}, ${recentReturn.toFixed(1)}% recent, base=${baseScore}${bonusScore ? ' +' + bonusScore + ' bonus (' + bonusLabel + ')' : ''}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, dayOfWeek: day, recentReturn },
    };

  }
}
