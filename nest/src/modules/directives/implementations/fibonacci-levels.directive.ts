/**
 * Fibonacci Retracements Directive
 * ================================
 * Identifies price position relative to Fibonacci retracement levels
 * drawn from the most recent significant swing high to swing low.
 *
 * Levels: 23.6%, 38.2%, 50%, 61.8% (golden pocket), 78.6%
 *
 * Scoring:
 *   - Within 0.5% of a key level: +30
 *   - Bouncing off a level: +60
 *   - At 61.8% zone (golden pocket): +20 bonus
 *   - Multiple levels clustered with S/R: +10
 *
 * Signal classes:
 *   - At 38.2%/50% + bounce → bullish (trend continuation)
 *   - At 61.8%/78.6% → strong reversal zone
 *   - Breaking 61.8% with momentum → bearish (trend failure)
 *
 * maxScore: 120
 *
 * @see #284 — ZigZag Swing Detector (provides swing points)
 * @see #278 — Fibonacci Retracements
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const FIB_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.786];
const PROXIMITY_THRESHOLD = 0.005;  // 0.5% — "near" a level
const BOUNCE_THRESHOLD = 0.002;     // 0.2% — min move to count as bounce
const SWING_LOOKBACK = 5;           // Bars for swing detection
const SWING_LOOKAHEAD = 5;

@Injectable()
export class FibonacciLevelsDirective implements IDirective {
  readonly id = 'fibonacci-levels';
  readonly name = 'Fibonacci Retracements';
  readonly description =
    'Detects price position relative to Fibonacci retracement levels (23.6-78.6%) from recent swing points. Scores bounce/reversal signals for trend continuation or failure.';
  readonly priority = 72;
  readonly maxScore = 120;
  readonly minBars = { '1d': 12 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    const MIN_BARS = SWING_LOOKBACK + SWING_LOOKAHEAD + 2;

    if (!bars || bars.length < MIN_BARS) {
      return {
        score: 0, confidence: 0,
        reason: `Need ${MIN_BARS}+ bars, have ${bars?.length ?? 0}.`,
        signalClass: 'neutral',
      };
    }

    const { swingHigh, swingLow } = this.findRecentSwing(bars);
    if (!swingHigh || !swingLow || swingHigh.price <= swingLow.price) {
      return {
        score: 0, confidence: 0.1,
        reason: 'No valid swing high/low pair found.',
        signalClass: 'neutral',
        metadata: { swingHigh: swingHigh?.price, swingLow: swingLow?.price },
      };
    }

    const currentPrice = bars[bars.length - 1].close;
    const range = swingHigh.price - swingLow.price;

    // Calculate Fibonacci levels (retracing from high toward low)
    const levels = FIB_LEVELS.map((ratio) => ({
      ratio,
      price: swingHigh.price - range * ratio,
    }));

    let score = 0;
    const reasons: string[] = [];
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    // ── Find closest level ──
    let closestDist = Infinity;
    let closestLevel: typeof levels[0] | null = null;

    for (const level of levels) {
      const distPct = Math.abs(currentPrice - level.price) / currentPrice;
      if (distPct < closestDist) {
        closestDist = distPct;
        closestLevel = level;
      }
    }

    if (!closestLevel) {
      return { score: 0, confidence: 0.1, reason: 'No Fib level found.', signalClass: 'neutral' };
    }

    reasons.push(`Nearest: ${(closestLevel.ratio * 100).toFixed(1)}% at ${closestLevel.price.toFixed(2)}`);

    // ── Proximity score ──
    if (closestDist <= PROXIMITY_THRESHOLD) {
      score += 30;
      reasons.push(`Within 0.5% of ${(closestLevel.ratio * 100).toFixed(1)}% level`);
    }

    // ── Golden pocket bonus (61.8%) ──
    if (closestLevel.ratio === 0.618 && closestDist <= PROXIMITY_THRESHOLD) {
      score += 20;
      reasons.push('Golden pocket (61.8%) — key reversal zone');
    } else if (closestLevel.ratio === 0.786 && closestDist <= PROXIMITY_THRESHOLD) {
      score += 15;
      reasons.push('Deep retracement (78.6%) — strong reversal potential');
    }

    // ── Bounce detection ──
    if (bars.length >= 3) {
      const prevBar = bars[bars.length - 2];
      const prevDist = Math.abs(prevBar.close - closestLevel.price) / closestLevel.price;
      const move = Math.abs(currentPrice - prevBar.close) / prevBar.close;

      if (prevDist <= PROXIMITY_THRESHOLD && move >= BOUNCE_THRESHOLD) {
        score += 60;
        const direction = currentPrice > prevBar.close ? 'up' : 'down';
        reasons.push(`Bounce ${direction} from ${(closestLevel.ratio * 100).toFixed(1)}% (+60)`);
      }
    }

    // ── Signal class ──
    if (closestLevel.ratio <= 0.5) {
      // Shallow retracement (23.6%, 38.2%, 50%) — trend continuation zone
      signalClass = 'bullish';
      reasons.push('Shallow retracement — trend continuation zone');
    } else if (closestLevel.ratio >= 0.618) {
      // Deep retracement (61.8%, 78.6%) — reversal/pullback zone
      signalClass = score >= 60 ? 'bearish' : 'bullish';
      reasons.push('Deep retracement — potential reversal zone');
    }

    score = Math.min(score, this.maxScore);

    return {
      score,
      confidence: Math.min(0.9, 0.4 + score / 150),
      reason: reasons.join('. ') + '.',
      signalClass,
      metadata: {
        swingHigh: swingHigh.price,
        swingLow: swingLow.price,
        range,
        currentPrice,
        levels: levels.map((l) => ({
          ratio: l.ratio,
          price: Math.round(l.price * 100) / 100,
        })),
        closestLevel: {
          ratio: closestLevel.ratio,
          price: closestLevel.price,
          distancePct: Math.round(closestDist * 10000) / 100,
        },
      },
    };
  }

  /**
   * Find the most recent significant swing high and low.
   * Uses same algorithm as ZigZag swing detector (#284).
   */
  private findRecentSwing(bars: any[]): { swingHigh: { price: number; index: number } | null; swingLow: { price: number; index: number } | null } {
    const lookback = SWING_LOOKBACK;
    const lookahead = SWING_LOOKAHEAD;
    const highs: { price: number; index: number }[] = [];
    const lows: { price: number; index: number }[] = [];

    for (let i = lookback; i < bars.length - lookahead; i++) {
      let isHigh = true;
      let isLow = true;
      for (let j = i - lookback; j <= i + lookahead; j++) {
        if (j === i) continue;
        if (bars[j].high >= bars[i].high) isHigh = false;
        if (bars[j].low <= bars[i].low) isLow = false;
      }
      if (isHigh) highs.push({ price: bars[i].high, index: i });
      if (isLow) lows.push({ price: bars[i].low, index: i });
    }

    const lastHigh = highs.length > 0 ? highs[highs.length - 1] : null;
    const lastLow = lows.length > 0 ? lows[lows.length - 1] : null;

    return { swingHigh: lastHigh, swingLow: lastLow };
  }
}
