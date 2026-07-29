/**
 * Bollinger Bands Directive
 * =========================
 * Scores based on price position within Bollinger Bands (20,2).
 *
 * Near lower band (%B < 0.2) = oversold, potential bounce (bullish).
 * Near upper band (%B > 0.8) = overbought, caution (bearish for longs).
 * Bandwidth included in reason for squeeze detection.
 *
 * TradePress source: includes/scoring-system/directives/bollinger-bands.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { bollingerBands } from '../utils/indicators';

const BB_PERIOD = 20;
const MIN_BARS = BB_PERIOD + 2;

@Injectable()
export class BollingerBandsDirective implements IDirective {
  readonly id = 'bollinger-bands';
  readonly name = 'Bollinger Bands';
  readonly description = 'Scores price position relative to Bollinger Bands (20,2). Near lower band = bullish, near upper = bearish.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 22 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const { percentB, bandwidth } = bollingerBands(closes, BB_PERIOD);
    if (percentB.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough Bollinger Band values.' };
    }

    const currentB = percentB[percentB.length - 1];
    const prevB = percentB[percentB.length - 2];
    const currentBW = bandwidth[bandwidth.length - 1];
    const turning = currentB > prevB; // moving away from lower band

    if (currentB <= 0.2) {
      const depth = (0.2 - currentB) / 0.2;
      const score = Math.round(60 + depth * 25 + (turning ? 10 : 0));
      return {
      signalClass: 'neutral',
      score: Math.min(this.maxScore, score),
        confidence: 0.55 + depth * 0.25,
        reason: `Price near lower Bollinger Band (%B=${currentB.toFixed(2)}${turning ? ', turning up' : ''}). Bandwidth ${currentBW.toFixed(1)}%. Oversold bounce potential.`,
      };
    }

    if (currentB >= 0.8) {
      const height = (currentB - 0.8) / 0.2;
      return {
      signalClass: 'neutral',
      score: Math.round(20 - height * 10),
        confidence: 0.5 + height * 0.15,
        reason: `Price near upper Bollinger Band (%B=${currentB.toFixed(2)}). Bandwidth ${currentBW.toFixed(1)}%. Overbought — reduced long score.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 40,
      confidence: 0.3,
      reason: `Price mid-Bollinger Bands (%B=${currentB.toFixed(2)}). Bandwidth ${currentBW.toFixed(1)}%. No extreme signal.`,
    };
  }
}
