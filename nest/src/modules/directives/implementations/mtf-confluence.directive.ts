/**
 * MTF Confluence Directive
 * ========================
 * Self-contained multi-timeframe confluence — computes EMA/RSI/MACD
 * across 3 timeframes using the bars already on DirectiveInput.
 *
 * TWO VARIANTS (registered as separate directives):
 *
 * 1. CONSERVATIVE (id='mtf-confluence-conservative'):
 *    ALL 3 timeframes must be bullish for a BUY signal.
 *    Macro(1d) AND Meso(1h) AND Micro(15m) all bullish → entry.
 *    ~3-5 signals/month on SPY. Very high accuracy.
 *
 * 2. WEIGHTED (id='mtf-confluence-weighted'):
 *    Uses 50/35/15 macro/meso/micro composite weighting.
 *    composite > 0.3 → bullish, composite < -0.3 → bearish.
 *    ~15-20 signals/month. More opportunities, lower per-signal accuracy.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi, macd, ema } from '../utils/indicators';

// ── Timeframe evaluation (self-contained — no DB access needed) ──

interface TfResult { score: number; label: string; details: string; }

function evaluateMacro(bars: { close: number; high: number; low: number }[]): TfResult {
  if (!bars || bars.length < 200) return { score: 0, label: 'insufficient', details: `need 200 daily bars, have ${bars?.length || 0}` };
  const closes = bars.map(b => b.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  if (!ema20.length || !ema50.length || !ema200.length) return { score: 0, label: 'error', details: 'EMA calc failed' };
  const price = closes[closes.length - 1];
  const e20 = ema20[ema20.length - 1], e50 = ema50[ema50.length - 1], e200 = ema200[ema200.length - 1];
  const above200 = price > e200, emaAligned = e20 > e50;
  if (above200 && emaAligned) return { score: 1, label: 'bullish', details: `price>200EMA, 20>50EMA` };
  if (!above200 && !emaAligned) return { score: -1, label: 'bearish', details: `price<200EMA, 20<50EMA` };
  return { score: 0, label: 'mixed', details: `price${above200 ? '>' : '<'}200EMA, 20${emaAligned ? '>' : '<'}50EMA` };
}

function evaluateMeso(bars: { close: number }[]): TfResult {
  if (!bars || bars.length < 50) return { score: 0, label: 'insufficient', details: `need 50 hourly bars, have ${bars?.length || 0}` };
  const closes = bars.map(b => b.close);
  const ema50Vals = ema(closes, 50);
  const rsiVals = rsi(closes, 14);
  if (!ema50Vals.length || !rsiVals.length) return { score: 0, label: 'error', details: 'indicator calc failed' };
  const price = closes[closes.length - 1], e50 = ema50Vals[ema50Vals.length - 1], r = rsiVals[rsiVals.length - 1];
  const aboveEma = price > e50, rsiOk = r > 50;
  if (aboveEma && rsiOk) return { score: 1, label: 'bullish', details: `price>50EMA, RSI${r.toFixed(0)}>50` };
  if (!aboveEma && !rsiOk) return { score: -1, label: 'bearish', details: `price<50EMA, RSI${r.toFixed(0)}<50` };
  return { score: 0, label: 'mixed', details: `price${aboveEma ? '>' : '<'}50EMA, RSI${r.toFixed(0)}` };
}

function evaluateMicro(bars: { close: number }[]): TfResult {
  if (!bars || bars.length < 30) return { score: 0, label: 'insufficient', details: `need 30 bars, have ${bars?.length || 0}` };
  const closes = bars.map(b => b.close);
  const macdResult = macd(closes, 12, 26, 9);
  if (macdResult.histogram.length < 2) return { score: 0, label: 'error', details: 'MACD calc failed' };
  const hist = macdResult.histogram;
  const current = hist[hist.length - 1], previous = hist[hist.length - 2];
  const aboveZero = current > 0, rising = current > previous;
  if (aboveZero && rising) return { score: 1, label: 'bullish', details: `MACD hist>0 and rising` };
  if (current < 0) return { score: -1, label: 'bearish', details: `MACD hist<0` };
  return { score: 0, label: 'neutral', details: `MACD hist=${current.toFixed(4)}` };
}

// ── Directive Classes ──

@Injectable()
export class MtfConfluenceConservativeDirective implements IDirective {
  readonly id = 'mtf-confluence-conservative';
  readonly name = 'MTF Confluence (Conservative — ALL 3 Aligned)';
  readonly category = 'oscillator' as const;
  readonly description = 'All 3 timeframes (daily, 1h, 15m) must be bullish for BUY. High-accuracy, low-frequency. ~3-5 signals/month on SPY.';
  readonly priority = 88;
  readonly maxScore = 115;
  readonly minScore = 1;
  readonly minBars = { '1d': 200, '1h': 50, '15m': 30 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { dayBars, hourBars, min15Bars, bars } = input;

    const macro = evaluateMacro(dayBars || []);
    const meso = evaluateMeso(hourBars || []);
    const micro = evaluateMicro(min15Bars || bars);

    const allBullish = macro.score > 0 && meso.score > 0 && micro.score > 0;
    const allBearish = macro.score < 0 && meso.score < 0 && micro.score < 0;
    const bullCount = (macro.score > 0 ? 1 : 0) + (meso.score > 0 ? 1 : 0) + (micro.score > 0 ? 1 : 0);

    if (allBullish) {
      return {
        score: Math.round(Math.min(105, this.maxScore)),
        confidence: 0.88,
        reason: `MTF ALL 3 BULLISH (conservative): Macro ${macro.label}, Meso ${meso.label}, Micro ${micro.label}. ${macro.details} | ${meso.details} | ${micro.details}`,
        signalClass: 'bullish',
      };
    }
    if (allBearish) {
      return {
        score: 5, confidence: 0.85,
        reason: `MTF ALL 3 BEARISH (conservative): Macro ${macro.label}, Meso ${meso.label}, Micro ${micro.label}.`,
        signalClass: 'bearish',
      };
    }
    return {
      score: 20 + bullCount * 8, confidence: 0.3,
      reason: `MTF MIXED (${bullCount}/3 bullish, conservative needs 3/3): Macro ${macro.label}, Meso ${meso.label}, Micro ${micro.label}.`,
      signalClass: 'neutral',
    };
  }
}

@Injectable()
export class MtfConfluenceWeightedDirective implements IDirective {
  readonly id = 'mtf-confluence-weighted';
  readonly name = 'MTF Confluence (Weighted — 50/35/15 Composite)';
  readonly description = '50/35/15 macro/meso/micro composite. Composite > 0.3 = bullish. ~15-20 signals/month on SPY.';
  readonly priority = 80;
  readonly maxScore = 110;
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { dayBars, hourBars, min15Bars, bars } = input;

    const macro = evaluateMacro(dayBars || []);
    const meso = evaluateMeso(hourBars || []);
    const micro = evaluateMicro(min15Bars || bars);

    const composite = macro.score * 0.50 + meso.score * 0.35 + micro.score * 0.15;

    const signal: 'bullish' | 'bearish' | 'neutral' =
      composite > 0.3 ? 'bullish' : composite < -0.3 ? 'bearish' : 'neutral';

    const mappedScore = 25 + (composite + 0.3) * 55;
    const conf = Math.min(0.88, 0.45 + Math.abs(composite) * 0.40);

    return {
      score: Math.round(Math.max(0, Math.min(this.maxScore, mappedScore))),
      confidence: Number(conf.toFixed(2)),
      reason: `MTF Weighted: Macro ${macro.label}(${macro.score}), Meso ${meso.label}(${meso.score}), Micro ${micro.label}(${micro.score}). Composite: ${composite.toFixed(2)} (50/35/15). ${macro.details} | ${meso.details} | ${micro.details}`,
      signalClass: signal,
    };
  }
}
