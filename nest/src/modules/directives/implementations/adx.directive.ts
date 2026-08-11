/**
 * ADX — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ================================================
 * BASE (0–60): Continuous ADX: 0→0, 25→40, 50+→60. Every tick.
 * BONUS: ADX > 40 → +20 (very strong trend), +DI spread > 20 → +15.
 * MAX: 100.
 * Category: oscillator — ADX has bounded 0–100 scale.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { adx } from '../utils/indicators';

const ADX_PERIOD = 14;
const MIN_BARS = ADX_PERIOD + 5;

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class AdxDirective implements IDirective {
  readonly id = 'adx';
  readonly name = 'Average Directional Index';
  readonly description = 'Hybrid: continuous ADX base + trend strength bonuses.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 19 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }
    const { adx: adxValues, plusDi, minusDi } = adx(highs, lows, closes, ADX_PERIOD);
    if (adxValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough ADX values.' };
    }
    const currentAdx = adxValues[adxValues.length - 1];
    const prevAdx = adxValues[adxValues.length - 2];
    const currentPlusDi = plusDi[plusDi.length - 1];
    const currentMinusDi = minusDi[minusDi.length - 1];
    const adxRising = currentAdx > prevAdx;
    const bullishBias = currentPlusDi > currentMinusDi;
    const diSpread = Math.abs(currentPlusDi - currentMinusDi);

    // BASE (0–60): ADX strength → score. Ranging(0-20)→0-20, Trending(25+)→40-60.
    const baseScore = Math.round(mapRange(currentAdx, 0, 50, 0, 60));

    // BONUS tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentAdx > 40) { bonusScore = 20; bonusLabel = 'very strong trend (ADX>40)'; }
    if (diSpread > 20 && bullishBias) { bonusScore += 15; bonusLabel += (bonusLabel ? ' + ' : '') + 'wide DI spread'; }
    if (adxRising && currentAdx > 25) { bonusScore += 5; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const parts = [`base=${baseScore} (ADX ${currentAdx.toFixed(1)})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus`);

    return {
      signalClass: bullishBias && total >= 50 ? 'bullish' : total >= 40 ? 'neutral' : 'bearish',
      score: total,
      confidence: Number((currentAdx > 25 ? 0.5 + (currentAdx / 50) * 0.3 : 0.25 + (currentAdx / 25) * 0.15).toFixed(2)),
      reason: `ADX=${currentAdx.toFixed(1)} ${adxRising ? '↗' : '↘'} +DI=${currentPlusDi.toFixed(1)} -DI=${currentMinusDi.toFixed(1)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, currentAdx, bullishBias, diSpread },
    };
  }
}
