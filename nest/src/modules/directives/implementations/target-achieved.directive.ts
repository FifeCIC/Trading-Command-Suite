/**
 * Target Achieved (Exit Signal)
 * ==============================
 * Binary signal: has price reached a logical take-profit target?
 * Uses ATR-based targets and recent swing high/low.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

const ATR_PERIOD = 14;
const TARGET_MULTIPLE = 1.5; // 1.5x ATR from recent swing = target

@Injectable()
export class TargetAchievedDirective implements IDirective {
  readonly id = 'target-achieved';
  readonly name = 'Target Achieved';
  readonly description = 'Checks if price has reached ATR-based or swing-based profit targets.';
  readonly directionBias = 'bullish' as const;
  readonly priority = 60;
  readonly maxScore = 100;
  readonly minBars = { '1d': 24 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < ATR_PERIOD + 10) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data.`, signalClass: 'neutral' };
    }

    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const currentPrice = closes[closes.length - 1];

    const atrValues = atr(highs, lows, closes, ATR_PERIOD);
    const currentAtr = atrValues[atrValues.length - 1];

    // Find recent swing low (potential entry proxy)
    const recentLows = lows.slice(-20);
    const swingLow = Math.min(...recentLows);

    // Find recent swing high
    const recentHighs = highs.slice(-20);
    const swingHigh = Math.max(...recentHighs);

    // Target from swing low: swingLow + 1.5 × ATR
    const bullTarget = swingLow + currentAtr * TARGET_MULTIPLE;
    const bearTarget = swingHigh - currentAtr * TARGET_MULTIPLE;

    const distToBullTarget = (currentPrice - bullTarget) / currentAtr;
    const distToBearTarget = (bearTarget - currentPrice) / currentAtr;

    let score = 0;
    let reason = '';
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    if (distToBullTarget > 0) {
      // Price exceeded bull target — take profit on longs
      score = 60 + Math.min(40, distToBullTarget * 20);
      signalClass = 'bearish';
      reason = `Price exceeded bull target by ${(distToBullTarget * currentAtr).toFixed(4)} (${distToBullTarget.toFixed(1)} ATR). Consider taking profit on longs.`;
    } else if (distToBearTarget > 0) {
      // Price exceeded bear target — take profit on shorts
      score = 60 + Math.min(40, distToBearTarget * 20);
      signalClass = 'bullish';
      reason = `Price exceeded bear target by ${(distToBearTarget * currentAtr).toFixed(4)} (${distToBearTarget.toFixed(1)} ATR). Consider taking profit on shorts.`;
    } else {
      score = Math.round(Math.max(0, (1 + distToBullTarget) * 20));
      reason = `Price ${distToBullTarget.toFixed(1)} ATR from bull target. Target not yet reached.`;
    }

    return {
      score: Math.round(score),
      confidence: score > 50 ? 0.7 : 0.3,
      reason,
      signalClass,
    };
  }
}
