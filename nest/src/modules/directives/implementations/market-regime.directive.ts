/**
 * Market Regime Directive (Q303)
 * ==============================
 * Scores based on the current market regime's clarity and alignment.
 * - Trending regime: high score for trend-following, low for mean-reversion
 * - Ranging regime: high score for mean-reversion, low for trend-following
 * - Chaotic regime: muted (score 0) — too uncertain
 *
 * Ensemble components: Hurst (0.40), ADX (0.35), Volatility (0.25)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

@Injectable()
export class MarketRegimeDirective implements IDirective {
  readonly id = 'market-regime';
  readonly name = 'Market Regime Detection';
  readonly description =
    'Ensemble regime classifier: Hurst + ADX + volatility. Scores based on regime clarity and alignment.';
  readonly maxScore = 100;
  readonly version = '1.0.0';
  readonly priority = 70;
  readonly suitability = {
    regimeType: 'any' as const,
    volatilityLevel: 'any' as const,
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'] as const,
    minTimeframe: 'H1',
    preferredSessions: ['US', 'London', 'Asian'] as const,
  };

  calculate(input: DirectiveInput): DirectiveResult {
    if (input.bars.length < 20) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Insufficient data for regime detection (need 20+ bars).',
        signalClass: 'neutral',
      };
    }

    const closes = input.bars.map((b) => b.close);
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);

    const hurst = this.computeHurst(closes.slice(-50));
    const adx = this.computeADX(highs, lows, closes, 14);
    const adxNorm = Math.min(1, adx / 50);
    const volPct = this.computeVolPercentile(highs, lows, closes);

    // Ensemble score
    const ensemble = 0.40 * hurst + 0.35 * adxNorm + 0.25 * (1 - Math.abs(volPct - 0.5) * 2);

    // Score = clarity of regime × 100
    const clarity = Math.abs(ensemble - 0.5) * 2; // 0–1 (0.5 = max uncertainty)
    const score = Math.round(clarity * 100);

    // Signal class based on regime + recent direction
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (ensemble > 0.65) {
      // Trending — check recent direction
      const recent = closes.slice(-5);
      const direction = recent[recent.length - 1] - recent[0];
      signalClass = direction > 0 ? 'bullish' : 'bearish';
    }

    let regimeLabel = 'ranging';
    if (ensemble > 0.65) regimeLabel = 'trending';
    else if (ensemble < 0.35) regimeLabel = 'chaotic';

    return {
      score,
      confidence: Math.round(clarity * 100) / 100,
      reason: `Regime: ${regimeLabel} (ensemble=${ensemble.toFixed(2)}, hurst=${hurst.toFixed(2)}, adx=${adx.toFixed(1)})`,
      signalClass,
    };
  }

  // ── Simplified indicator calcs (matches ConditionDetectorService) ──

  private computeHurst(closes: number[]): number {
    if (closes.length < 30) return 0.5;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0) returns.push(closes[i] / closes[i - 1] - 1);
    }
    if (returns.length < 20) return 0.5;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    let num = 0, den = 0;
    for (let i = 0; i < returns.length; i++) {
      den += (returns[i] - mean) ** 2;
      if (i > 0) num += (returns[i] - mean) * (returns[i - 1] - mean);
    }
    if (den === 0) return 0.5;
    return Math.max(0, Math.min(1, 0.5 + (num / den) / 2));
  }

  private computeADX(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 20;
    const tr: number[] = [], plusDM: number[] = [], minusDM: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      const trVal = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]));
      tr.push(trVal);
      plusDM.push(highs[i] - highs[i - 1] > lows[i - 1] - lows[i] && highs[i] - highs[i - 1] > 0 ? highs[i] - highs[i - 1] : 0);
      minusDM.push(lows[i - 1] - lows[i] > highs[i] - highs[i - 1] && lows[i - 1] - lows[i] > 0 ? lows[i - 1] - lows[i] : 0);
    }
    const smooth = (v: number[]) => { let s = v.slice(0, period).reduce((a, b) => a + b, 0) / period; const r = [s]; for (let j = period; j < v.length; j++) r.push(r[r.length - 1] + (v[j] - r[r.length - 1]) / period); return r; };
    const atrS = smooth(tr), pdiS = smooth(plusDM), mdiS = smooth(minusDM);
    const dx = pdiS.map((_, i) => atrS[i] > 0 ? (Math.abs(pdiS[i] - mdiS[i]) / (pdiS[i] + mdiS[i])) * 100 : 0);
    return dx.slice(-period).reduce((a, b) => a + b, 0) / period;
  }

  private computeVolPercentile(highs: number[], lows: number[], closes: number[]): number {
    if (closes.length < 15) return 0.5;
    const atr14 = this.computeATR(highs, lows, closes, 14);
    const atrs: number[] = [];
    for (let i = 14; i < closes.length; i++) {
      const h = highs.slice(i - 14, i + 1), l = lows.slice(i - 14, i + 1), c = closes.slice(i - 14, i + 1);
      const trSum = h.reduce((s, _, j) => s + Math.max(h[j] - l[j], Math.abs(h[j] - (c[j - 1] ?? c[j])), Math.abs(l[j] - (c[j - 1] ?? c[j]))), 0);
      atrs.push(trSum / 14);
    }
    if (atrs.length < 5) return 0.5;
    return atrs.filter((v) => v < atr14).length / atrs.length;
  }

  private computeATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) return 0;
    const tr: number[] = [];
    for (let i = 1; i < highs.length; i++) {
      tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    let sum = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < tr.length; i++) sum = sum + (tr[i] - sum) / period;
    return sum;
  }
}
