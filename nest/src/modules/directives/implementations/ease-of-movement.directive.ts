/**
 * Ease of Movement (EoM)
 * ======================
 * EMV = midpoint change / volume ratio. High positive = price moves up easily.
 * Low resistance = strong trend with light volume relative to price movement.
 * Derived from MT5 standard EoM indicator.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { easeOfMovement } from '../utils/indicators';

const PERIOD = 14;
const MIN_BARS = PERIOD + 2;

@Injectable()
export class EaseOfMovementDirective implements IDirective {
  readonly id = 'ease-of-movement';
  readonly name = 'Ease of Movement';
  readonly description = 'EoM measures price/volume efficiency. High positive = easy upward movement. Scores trend quality.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly minBars = { '1d': 16 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const volumes = input.bars.map(b => b.volume);
    if (input.bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const emv = easeOfMovement(highs, lows, volumes, PERIOD);
    if (emv.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Could not calculate EoM.', signalClass: 'neutral' };
    }
    const cur = emv[emv.length - 1];
    const prev = emv[emv.length - 2];
    const rising = cur > prev;
    const absCur = Math.abs(cur);

    if (cur > 0 && rising) {
      const strength = Math.min(1, absCur / 0.5);
      return {
        score: Math.round(40 + strength * 45),
        confidence: 0.5 + strength * 0.3,
        reason: `EoM = ${cur.toFixed(4)} (positive, rising). Price moving up with low resistance.`,
        signalClass: 'bullish',
      };
    }
    if (cur < 0 && !rising) {
      const strength = Math.min(1, absCur / 0.5);
      return {
        score: Math.round(30 + strength * 30),
        confidence: 0.5,
        reason: `EoM = ${cur.toFixed(4)} (negative, declining). Price moving down with ease.`,
        signalClass: 'bearish',
      };
    }
    return { score: 15, confidence: 0.3, reason: `EoM = ${cur.toFixed(4)} — neutral.`, signalClass: 'neutral' };
  }
}
