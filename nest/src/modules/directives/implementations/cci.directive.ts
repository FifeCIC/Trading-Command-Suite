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
import { resolveParams, type NumericParamSpec } from '../parameters';

const CCI_PERIOD = 20;
const MIN_BARS = CCI_PERIOD + 3;

/**
 * Tunable knobs (#1165). The default IS the constant above — BASELINE proves the equality.
 *
 * ⚠️ The period is the highest-leverage knob on any oscillator, and it is measurable: CCI-20 and
 * CCI-10 disagree on the `noisy-range` fixture because the two windows normalise by different
 * mean-deviations, so the same bar reads -120 on one and -60 on the other — one clears the deep
 * oversold tier, the other does not.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'cciPeriod',
    label: 'CCI period',
    type: 'number',
    default: CCI_PERIOD,
    min: 5,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): the fixed 20 is a 20-bar normalisation, so on a 1h chart a 10-bar move barely registers and on a daily chart 20 days is a month. The same bar scores in different tiers at period 10 vs 20 on the noisy-range fixture.',
    source: 'cci.directive.ts:13 CCI_PERIOD',
  },
];

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
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const cciPeriod = values.cciPeriod as number;
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    const minBars = Math.max(MIN_BARS, cciPeriod + 3);
    if (closes.length < minBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${closes.length}.` };
    }
    const cciValues = cci(highs, lows, closes, cciPeriod);
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
