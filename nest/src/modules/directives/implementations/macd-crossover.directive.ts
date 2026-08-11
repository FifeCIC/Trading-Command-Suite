/**
 * MACD Bullish Crossover — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * BASE (0–60): Continuous from histogram strength. Every tick.
 * BONUS: Fresh crossover → +30. Strong acceleration → +15.
 * MAX: 110.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { macd } from '../utils/indicators';

const FAST = 12;
const SLOW = 26;
const SIGNAL = 9;
const MIN_BARS = SLOW + SIGNAL + 1;

@Injectable()
export class MacdCrossoverDirective implements IDirective {
  readonly id = 'macd-crossover';
  readonly name = 'MACD Bullish Crossover';
  readonly description = 'Hybrid: continuous histogram base + crossover/acceleration bonuses.';
  readonly category = 'oscillator' as const;
  readonly priority = 80;
  readonly maxScore = 90;
  readonly minScore = 1;
  readonly minBars = { '1d': 36 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`, signalClass: 'neutral' };
    }
    const { histogram } = macd(closes, FAST, SLOW, SIGNAL);
    if (histogram.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough MACD data.', signalClass: 'neutral' };
    }

    const currentHist = histogram[histogram.length - 1];
    const previousHist = histogram[histogram.length - 2];
    const freshCrossover = previousHist <= 0 && currentHist > 0;
    const bullishMomentum = currentHist > 0 && currentHist > previousHist;
    const narrowing = currentHist < 0 && currentHist > previousHist;

    // BASE (0–60): histogram magnitude. Scale by typical MACD range.
    const absHist = Math.abs(currentHist);
    const baseScore = Math.round(Math.min(60, absHist * 3 + 20)); // hist 0→20, hist 10→50, hist 15+→60

    // BONUS
    let bonusScore = 0;
    let bonusLabel = '';
    if (freshCrossover) { bonusScore = 30; bonusLabel = 'fresh crossover'; }
    else if (bullishMomentum) {
      const accel = Math.min(1, (currentHist - previousHist) / (Math.abs(currentHist) + 0.001));
      if (accel > 0.3) { bonusScore = 15; bonusLabel = `accelerating (${(accel*100).toFixed(0)}%)`; }
    } else if (narrowing) { bonusScore = 5; bonusLabel = 'narrowing'; }

    const total = baseScore + bonusScore;
    const parts = [`base=${baseScore} (hist ${currentHist.toFixed(3)})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);

    return {
      score: total,
      confidence: Number((bonusScore >= 30 ? 0.75 : bonusScore > 0 ? 0.55 : 0.3 + (baseScore / 60) * 0.2).toFixed(2)),
      reason: `MACD histogram ${currentHist.toFixed(3)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      signalClass: total >= 50 ? 'bullish' : currentHist < 0 ? 'bearish' : 'neutral',
      metadata: { baseScore, bonusScore, bonusLabel, currentHist, freshCrossover },
    };
  }
}
