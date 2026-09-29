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
  /**
   * 🛑 #1020 — THIS DIRECTIVE DELIBERATELY DECLARES NO `exitScoreThreshold`, AND MUST NOT GET ONE.
   *
   * It is not a time stop, and its own comment below admits why: *"needs position open time which
   * isn't in bars"* — `openedAt` is not in its input, so it computes MOMENTUM DECAY over the last N
   * bars and never reads the position's age.
   *
   * Declaring a threshold here would put a SECOND momentum signal into the exit verdict under a name
   * that claims otherwise, and the consumer would read two independent "momentum is decaying"
   * verdicts as corroboration. That is a worse defect than the one it fixes.
   *
   * A real time stop already exists and works: `position-time-stop.service.ts` closes a position and
   * stamps the time-stop reason on it — measured **46 times** in the `trade` table on 2026-09-29.
   *
   * ⚠️ This comment deliberately does NOT spell that column's name. A previous version did, and
   * `validate-close-attribution.cjs` — which greps source files for that identifier — flagged this
   * scorer as a Trade WRITER and failed the build. A comment that quotes a pattern a parser greps
   * for is a trap for every future parser; say the same thing without the token.
   *
   * So this directive's score is REPORTED for information and argues nothing. Giving it authority
   * requires first giving it the position's age, which is a change to its INPUT, not to this number.
   */

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
