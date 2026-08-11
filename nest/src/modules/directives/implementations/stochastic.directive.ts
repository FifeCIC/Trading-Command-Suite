/**
 * Stochastic Oscillator — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * BASE (0–50): Continuous: %K 80→0, %K 20→50. Every tick moves.
 * BONUS tiers: %K < 20 → +30, %K < 10 → +50, crossover → +15.
 * MAX: 100.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { stochastic } from '../utils/indicators';

const K_PERIOD = 14;
const D_PERIOD = 3;
const MIN_BARS = K_PERIOD + D_PERIOD + 2;

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class StochasticDirective implements IDirective {
  readonly id = 'stochastic';
  readonly name = 'Stochastic Oscillator';
  readonly description = 'Hybrid: continuous base + oversold bonuses + crossover bonus.';
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
    const { k, d } = stochastic(highs, lows, closes, K_PERIOD, D_PERIOD);
    if (k.length < 4 || d.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough stochastic values.' };
    }
    const currentK = k[k.length - 1];
    const prevK = k[k.length - 2];
    const currentD = d[d.length - 1];
    const prevD = d[d.length - 2];
    const crossUp = prevK <= prevD && currentK > currentD;
    const kRising = currentK > prevK;

    // BASE: %K 80→0, %K 20→50 (lower %K = more oversold = higher base)
    const baseScore = Math.round(mapRange(currentK, 80, 20, 0, 50));

    // BONUS: oversold tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentK < 10) { bonusScore = 50; bonusLabel = 'deep oversold (<10)'; }
    else if (currentK < 20) { bonusScore = 30; bonusLabel = 'oversold (<20)'; }

    // CROSSOVER bonus
    const crossBonus = crossUp ? 15 : (kRising ? 5 : 0);

    const total = baseScore + bonusScore + crossBonus;
    const parts = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (crossBonus > 0) parts.push(`+${crossBonus} ${crossUp ? 'crossover' : 'rising'}`);

    return {
      signalClass: total >= 60 ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((bonusScore > 0 ? 0.55 + (bonusScore / 50) * 0.3 : 0.3 + (baseScore / 50) * 0.2).toFixed(2)),
      reason: `Stoch K=${currentK.toFixed(1)} D=${currentD.toFixed(1)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, crossBonus, currentK, crossUp },
    };
  }
}
