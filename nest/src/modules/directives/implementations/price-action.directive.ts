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

const MA_PERIODS = [20, 50, 200];
const MA_BONUSES = [20, 30, 50]; // Base contribution per MA
const MIN_BARS = 200;

@Injectable()
export class PriceActionDirective implements IDirective {
  readonly id = 'price-action';
  readonly name = 'Price Action';
  readonly description = 'Scores price position relative to MA(20), MA(50), MA(200). Above all = bullish structure.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const currentPrice = closes[closes.length - 1];
    let totalScore = 0;
    let aboveCount = 0;
    const details: string[] = [];

    for (let i = 0; i < MA_PERIODS.length; i++) {
      const period = MA_PERIODS[i];
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
      reason: `${aboveCount}/${MA_PERIODS.length} MAs above price. ${details.join(', ')}.`,
    };
  }
}
