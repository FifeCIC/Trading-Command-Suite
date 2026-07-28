/**
 * Bollinger %B
 * ============
 * %B = (price - lower) / (upper - lower). %B > 0.8 = overbought, < 0.2 = oversold.
 * Uses existing bollingerBands() utility from indicators.ts.
 * Derived from MT5 Bollinger Bands %B indicator.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { bollingerBands } from '../utils/indicators';

const PERIOD = 20;
const MULTIPLIER = 2;
const MIN_BARS = PERIOD + 2;

@Injectable()
export class BollingerPercentBDirective implements IDirective {
  readonly id = 'bollinger-percent-b';
  readonly name = 'Bollinger %B';
  readonly description = '%B > 0.8 = overbought (bearish). %B < 0.2 = oversold (bullish). Scores reversal probability at extremes.';
  readonly priority = 60;
  readonly maxScore = 100;
  readonly minBars = { '1d': 22 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const bb = bollingerBands(closes, PERIOD, MULTIPLIER);
    if (bb.percentB.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Could not calculate %B.', signalClass: 'neutral' };
    }
    const curB = bb.percentB[bb.percentB.length - 1];
    const prevB = bb.percentB[bb.percentB.length - 2];
    const bandwidth = bb.bandwidth[bb.bandwidth.length - 1];
    const squeezing = bandwidth < 10; // Narrow bands indicate squeeze

    if (curB < 0.2) {
      const depth = Math.min(1, (0.2 - curB) / 0.2);
      const squeezeBonus = squeezing ? 15 : 0;
      const score = Math.round(45 + depth * 30 + squeezeBonus);
      return {
        score: Math.min(this.maxScore, score),
        confidence: curB < prevB ? 0.45 : 0.7,
        reason: `%B = ${curB.toFixed(3)} (< 0.2 oversold). ${squeezing ? 'Bands squeezing — breakout imminent. ' : ''}Reversal potential.`,
        signalClass: 'bullish',
      };
    }
    if (curB > 0.8) {
      const depth = Math.min(1, (curB - 0.8) / 0.2);
      const score = Math.round(40 + depth * 25);
      return {
        score: Math.min(this.maxScore, score),
        confidence: 0.55,
        reason: `%B = ${curB.toFixed(3)} (> 0.8 overbought). Pullback risk.`,
        signalClass: 'bearish',
      };
    }
    return { score: 10, confidence: 0.25, reason: `%B = ${curB.toFixed(3)} (bandwidth: ${bandwidth.toFixed(1)}%) — neutral.`, signalClass: 'neutral' };
  }
}
