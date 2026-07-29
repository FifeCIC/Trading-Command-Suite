/**
 * VWAP (Volume-Weighted Average Price) Directive
 * ==============================================
 * Institutional benchmark — price above VWAP = bullish, below = bearish.
 *
 * TradePress source: includes/scoring-system/directives/vwap.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { vwap } from '../utils/indicators';

const MIN_BARS = 5;

@Injectable()
export class VwapDirective implements IDirective {
  readonly id = 'vwap';
  readonly name = 'VWAP';
  readonly description = 'Price relative to VWAP. Above = bullish intraday sentiment, below = bearish.';
  readonly directionBias = 'bullish' as const;

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 5 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume);

    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const vwapValues = vwap(highs, lows, closes, volumes);
    const currentPrice = closes[closes.length - 1];
    const currentVwap = vwapValues[vwapValues.length - 1];

    if (currentVwap <= 0) {
      return { score: 0, confidence: 0, reason: 'Could not calculate VWAP.' };
    }

    const distancePct = ((currentPrice - currentVwap) / currentVwap) * 100;

    if (distancePct > 0) {
      const strength = Math.min(1, distancePct / 3); // 0–3% → 0–1
      const score = Math.round(55 + strength * 30);
      return {
        score,
        confidence: 0.5 + strength * 0.2,
        reason: `Price ${currentPrice.toFixed(2)} is ${distancePct.toFixed(2)}% above VWAP ${currentVwap.toFixed(2)}. Bullish intraday sentiment.`,
      };
    }

    const strength = Math.min(1, Math.abs(distancePct) / 3);
    const score = Math.round(25 - strength * 15);
    return {
      score,
      confidence: 0.45 + strength * 0.15,
      reason: `Price ${currentPrice.toFixed(2)} is ${Math.abs(distancePct).toFixed(2)}% below VWAP ${currentVwap.toFixed(2)}. Bearish — reduced long score.`,
    };
  }
}
