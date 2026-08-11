/**
 * CCI — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ==================================================
 * BASE (0–50): Continuous: CCI +100→0, CCI -100→50. Every tick.
 * BONUS: CCI < -200 → +30, CCI < -300 → +50. Crossover -100 → +15.
 * MAX: 100.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { cci } from '../utils/indicators';

const CCI_PERIOD = 20;
const MIN_BARS = CCI_PERIOD + 3;

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class CciDirective implements IDirective {
  readonly id = 'cci';
  readonly name = 'Commodity Channel Index';
  readonly category = 'oscillator' as const;
  readonly description = 'Hybrid: continuous base + deep oversold bonuses + crossover bonus.';
  readonly directionBias = 'bearish' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 23 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }
    const cciValues = cci(highs, lows, closes, CCI_PERIOD);
    if (cciValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough CCI values.' };
    }
    const current = cciValues[cciValues.length - 1];
    const previous = cciValues[cciValues.length - 2];
    const crossingUp = previous <= -100 && current > -100;
    const rising = current > previous;

    // BASE: CCI +100→0, CCI -100→50 (lower CCI = more oversold = higher base)
    const baseScore = Math.round(mapRange(current, 100, -100, 0, 50));

    // BONUS tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (current < -300) { bonusScore = 50; bonusLabel = 'deep oversold (<-300)'; }
    else if (current < -200) { bonusScore = 30; bonusLabel = 'oversold (<-200)'; }

    // CROSSOVER bonus
    const crossBonus = crossingUp ? 15 : (rising && current < 0 ? 5 : 0);

    const total = baseScore + bonusScore + crossBonus;
    const parts = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (crossBonus > 0) parts.push(`+${crossBonus} ${crossingUp ? 'crossover' : 'rising'}`);

    return {
      signalClass: total >= 60 ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((bonusScore > 0 ? 0.55 + (bonusScore / 50) * 0.3 : 0.3 + (baseScore / 50) * 0.2).toFixed(2)),
      reason: `CCI=${current.toFixed(1)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, crossBonus, current, crossingUp },
    };
  }
}
