/**
 * Price Action Directive
 * ======================
 * Scores based on price position relative to MA(20), MA(50), MA(200).
 *
 * Above all MAs = strong bullish structure.
 * Below all MAs = bearish for longs.
 * Distance from each MA scales the contribution.
 *
 * TradePress source: includes/scoring-system/directives/price-action.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MA_PERIODS = [20, 50, 200];
const MA_BONUSES = [20, 30, 50]; // Base contribution per MA
const MIN_BARS = 200;

/**
 * Tunable knobs (#1165). The default IS MA_PERIODS[2] — BASELINE proves the equality.
 *
 * ⚠️ ONE knob for three periods, derived as longest/10, longest/4, longest. Exposing all three
 * independently would let the set invert (fast slower than slow), which is not a tuning choice but
 * a broken indicator. `MA_BONUSES` stays positional and deliberately: the bonus belongs to the ROLE
 * (fast / mid / slow), not to the period, so widening the horizon does not silently re-weight the
 * score by a number nobody chose.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'longestMa',
    label: 'Longest MA period',
    type: 'number',
    default: MA_PERIODS[MA_PERIODS.length - 1],
    min: 30,
    max: 400,
    step: 10,
    unit: 'bars',
    chart: 'series',
    why: 'MA(200) is a daily-chart convention applied here to whatever bar size arrives. On 1h bars 200 hours is eight days, not ten months, so "above MA200 = long-term bull" is measuring something else entirely. The derived trio moves together, and the distance term makes the difference visible: in a trend the longer MA sits further below price, so the same bar scores higher against a 400-bar average than a 200-bar one.',
    source: 'price-action.directive.ts:17 MA_PERIODS',
  },
];

@Injectable()
export class PriceActionDirective implements IDirective {
  readonly id = 'price-action';
  readonly name = 'Price Action';
  readonly description = 'Scores price position relative to MA(20), MA(50), MA(200). Above all = bullish structure.';
  readonly category = 'pattern' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 200 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const longest = values.longestMa as number;
    const periods = [Math.max(2, Math.round(longest / 10)), Math.max(3, Math.round(longest / 4)), longest];
    const closes = input.bars.map(b => b.close);
    const requiredBars = Math.max(MIN_BARS, longest);
    if (closes.length < requiredBars) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${requiredBars} bars, have ${closes.length}.` };
    }

    const currentPrice = closes[closes.length - 1];
    let totalScore = 0;
    let aboveCount = 0;
    const details: string[] = [];

    for (let i = 0; i < periods.length; i++) {
      const period = periods[i];
      const ma = sma(closes, period);
      if (ma <= 0) continue;

      const distancePct = ((currentPrice - ma) / ma) * 100;
      if (distancePct > 0) {
        aboveCount++;
        const strength = Math.min(1, distancePct / 5); // 0–5% → 0–1
        totalScore += MA_BONUSES[i] * (0.5 + strength * 0.5);
        details.push(`MA(${period})=${ma.toFixed(2)} (+${distancePct.toFixed(1)}%)`);
      } else {
        details.push(`MA(${period})=${ma.toFixed(2)} (${distancePct.toFixed(1)}%)`);
      }
    }

    const score = Math.round(20 + totalScore); // Base 20 + MA bonuses
    const signalClass = aboveCount >= 2 ? 'bullish' : aboveCount === 0 ? 'bearish' : 'neutral';

    return {
      signalClass,
      score: Math.min(this.maxScore, score),
      confidence: 0.3 + aboveCount * 0.15,
      reason: `${aboveCount}/${periods.length} MAs above price. ${details.join(', ')}.`,
    };
  }
}
