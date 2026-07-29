/**
 * ZigZag Swing Detector
 * =====================
 * Identifies swing highs and lows in price data — the foundational directive
 * for Fibonacci retracement/extension levels and dynamic support/resistance.
 *
 * Algorithm:
 *   1. Scan every bar — a bar is a swing high if its high is the highest
 *      in a window of `lookback` bars before and `lookahead` bars after.
 *   2. A bar is a swing low if its low is the lowest in the same window.
 *   3. Filter out minor swings using a minimum % price deviation threshold.
 *   4. Score the most recent swing structure:
 *      - Higher High + Higher Low = bullish continuation (strong buy)
 *      - HH only = bullish but weakening
 *      - Lower Low + Lower High = bearish continuation (strong sell)
 *      - LL only = bearish but weakening
 *   5. Provide swing points in metadata for Fibonacci, S/R, and Wyckoff directives.
 *
 * maxScore: 100 — strong bullish swing structure + proximity to support.
 *
 * @see #284 — ZigZag Swing Detector
 * @see #285 — Wyckoff Accumulation/Distribution (consumer)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: Date;
}

const DEFAULT_LOOKBACK = 5;     // Bars to look back for swing detection
const DEFAULT_LOOKAHEAD = 5;    // Bars to look forward
const MIN_DEVIATION_PCT = 0.4;  // Min 0.4% price move to count as a swing
const PROXIMITY_PCT = 0.3;      // Within 0.3% of a swing level = active zone

@Injectable()
export class ZigZagSwingDetectorDirective implements IDirective {
  readonly id = 'zigzag-swing-detector';
  readonly name = 'ZigZag Swing Detector';
  readonly description =
    'Detects swing highs and lows using a 5-bar window with 0.4% minimum deviation. Scores bullish/bearish swing structure and proximity to recent swing levels. Foundation for Fibonacci retracement and dynamic S/R directives.';
  readonly priority = 78;
  readonly maxScore = 100;
  readonly minBars = { '1d': 5 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;

    if (!bars || bars.length < DEFAULT_LOOKBACK + DEFAULT_LOOKAHEAD + 2) {
      return {
        score: 0,
        confidence: 0,
        reason: `Need ${DEFAULT_LOOKBACK + DEFAULT_LOOKAHEAD + 2}+ bars, have ${bars?.length ?? 0}.`,
        signalClass: 'neutral',
      };
    }

    const currentPrice = bars[bars.length - 1].close;
    const swings = this.findSwings(bars);

    if (swings.length < 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `No significant swing points detected in ${bars.length} bars (min deviation: ${MIN_DEVIATION_PCT}%).`,
        signalClass: 'neutral',
        metadata: { swings: [], swingCount: 0 },
      };
    }

    // ── Analyze most recent 4 swings for structure ──
    const recentSwings = swings.slice(-4);
    const lastSwing = recentSwings[recentSwings.length - 1];
    const prevSwing = recentSwings.length >= 2 ? recentSwings[recentSwings.length - 2] : null;

    let score = 0;
    const reasons: string[] = [];
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    // ── Swing Structure Analysis ──
    if (recentSwings.length >= 4) {
      const [s1, s2, s3, s4] = recentSwings; // oldest → newest

      // Higher High check: compare swing highs
      const highs = [s1, s2, s3, s4].filter(s => s.type === 'high');
      const lows = [s1, s2, s3, s4].filter(s => s.type === 'low');

      const hasHigherHigh = highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price;
      const hasHigherLow = lows.length >= 2 && lows[lows.length - 1].price > lows[lows.length - 2].price;
      const hasLowerLow = lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price;
      const hasLowerHigh = highs.length >= 2 && highs[highs.length - 1].price < highs[highs.length - 2].price;

      if (hasHigherHigh && hasHigherLow) {
        // Bullish: uptrend structure
        score += 60;
        signalClass = 'bullish';
        reasons.push('HH+HL uptrend structure');
      } else if (hasLowerLow && hasLowerHigh) {
        // Bearish: downtrend structure
        score += 60;
        signalClass = 'bearish';
        reasons.push('LL+LH downtrend structure');
      } else if (hasHigherHigh) {
        score += 30;
        signalClass = 'bullish';
        reasons.push('Higher high (bullish, no HL confirmation)');
      } else if (hasLowerLow) {
        score += 30;
        signalClass = 'bearish';
        reasons.push('Lower low (bearish, no LH confirmation)');
      } else {
        reasons.push('Consolidation — no clear swing structure');
      }
    }

    // ── Proximity to nearest swing level ──
    let closestDist = Infinity;
    let closestLevel: SwingPoint | null = null;

    for (const sw of swings) {
      const distPct = Math.abs(currentPrice - sw.price) / currentPrice * 100;
      if (distPct < closestDist) {
        closestDist = distPct;
        closestLevel = sw;
      }
    }

    if (closestLevel && closestDist <= PROXIMITY_PCT) {
      score += 25;
      reasons.push(
        `Price within ${PROXIMITY_PCT}% of ${closestLevel.type === 'high' ? 'resistance' : 'support'} at ${closestLevel.price.toFixed(2)}`
      );
    } else if (closestLevel) {
      reasons.push(
        `Nearest swing: ${closestLevel.type === 'high' ? 'high' : 'low'} at ${closestLevel.price.toFixed(2)} (${closestDist.toFixed(1)}% away)`
      );
    }

    // ── Swing count quality ──
    if (swings.length >= 6) {
      score += 10;
      reasons.push(`${swings.length} swing points — well-established structure`);
    }

    score = Math.min(score, this.maxScore);

    return {
      score,
      confidence: Math.min(0.95, 0.5 + swings.length * 0.05),
      reason: reasons.join('. ') + '.',
      signalClass,
      metadata: {
        swings: swings.map(s => ({
          index: s.index,
          price: s.price,
          type: s.type,
        })),
        swingCount: swings.length,
        lastSwingType: lastSwing.type,
        lastSwingPrice: lastSwing.price,
        nearestLevel: closestLevel ? {
          price: closestLevel.price,
          type: closestLevel.type,
          distancePct: closestDist,
        } : null,
      },
    };
  }

  /**
   * Find swing highs and lows in price bars.
   *
   * A swing high: bar i's high > all highs in [i-lookback, i-1] and [i+1, i+lookahead]
   * A swing low:  bar i's low  < all lows  in the same windows.
   * Filtered by minimum % deviation from the previous swing.
   */
  private findSwings(bars: any[]): SwingPoint[] {
    const lookback = DEFAULT_LOOKBACK;
    const lookahead = DEFAULT_LOOKAHEAD;
    const rawSwings: SwingPoint[] = [];

    for (let i = lookback; i < bars.length - lookahead; i++) {
      const bar = bars[i];

      // Check if this is a swing high
      let isSwingHigh = true;
      for (let j = i - lookback; j <= i + lookahead; j++) {
        if (j === i) continue;
        if (bars[j].high >= bar.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        rawSwings.push({
          index: i,
          price: bar.high,
          type: 'high',
          timestamp: bar.timestamp,
        });
      }

      // Check if this is a swing low
      let isSwingLow = true;
      for (let j = i - lookback; j <= i + lookahead; j++) {
        if (j === i) continue;
        if (bars[j].low <= bar.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        rawSwings.push({
          index: i,
          price: bar.low,
          type: 'low',
          timestamp: bar.timestamp,
        });
      }
    }

    // Sort by index (time order)
    rawSwings.sort((a, b) => a.index - b.index);

    // ── Filter by minimum deviation ──
    // A swing must differ from the PREVIOUS swing (of any type) by at least MIN_DEVIATION_PCT
    const filtered: SwingPoint[] = [];
    for (const sw of rawSwings) {
      if (filtered.length === 0) {
        filtered.push(sw);
        continue;
      }
      const prev = filtered[filtered.length - 1];
      const deviation = Math.abs(sw.price - prev.price) / prev.price * 100;

      // Always allow alternating high/low swings (the ZigZag pattern)
      if (sw.type !== prev.type) {
        filtered.push(sw);
      } else if (deviation >= MIN_DEVIATION_PCT) {
        // Same-type swing but significant enough to keep
        // Replace the previous if this one is more extreme
        if ((sw.type === 'high' && sw.price > prev.price) ||
            (sw.type === 'low' && sw.price < prev.price)) {
          filtered[filtered.length - 1] = sw;
        }
      }
    }

    return filtered;
  }
}
