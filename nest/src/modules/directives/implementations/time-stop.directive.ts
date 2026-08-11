/**
 * Time Stop (Exit Signal)
 * =======================
 * Position age vs optimal hold period. The longer a position has been open,
 * the more likely it has exhausted its potential.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class TimeStopDirective implements IDirective {
  readonly id = 'time-stop';
  readonly name = 'Time Stop';
  readonly description = 'Position age exit signal. Longer hold = higher exit urgency.';
  readonly category = 'structural' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 5 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    // Time stop is contextual — needs position open time which isn't in bars
    // Returns a moderate base score that scaling algo can adjust per position
    const bars = input.bars;
    if (bars.length < 5) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data.`, signalClass: 'neutral' };
    }

    // Check if recent bars show declining momentum correlating with age
    const closes = bars.map((b) => b.close);
    const half = Math.floor(closes.length / 2);
    const firstHalfAvg = closes.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondHalfAvg = closes.slice(half).reduce((a, b) => a + b, 0) / (closes.length - half);
    const momentumDecay = (firstHalfAvg - secondHalfAvg) / Math.max(0.0001, firstHalfAvg);

    let score: number;
    let reason: string;

    if (momentumDecay > 0.02) {
      score = 40 + Math.min(40, momentumDecay * 500);
      reason = `Momentum declining (${(momentumDecay * 100).toFixed(1)}% decay). Position may be aging past optimal hold.`;
    } else if (momentumDecay < -0.02) {
      score = 15;
      reason = `Momentum still accelerating. Position age not a concern.`;
    } else {
      score = 25;
      reason = `Stable momentum. No time-based exit urgency.`;
    }

    return {
      score: Math.round(score),
      confidence: 0.4,
      reason,
      signalClass: 'neutral',
    };
  }
}
