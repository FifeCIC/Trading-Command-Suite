/**
 * Price Time Gap
 * ==============
 * Scans recent bars for time gaps — zones where price moved so fast
 * there was virtually no trading at intermediate levels.
 *
 * Algorithm (from MQL5 Article #18592):
 * - VIC = volume × priceChange × liquidity × session / time²
 * - Identifies gaps between bars where price jumped without trading
 * - Calculates institutional footprint (0-1) from VIC magnitude
 * - Gap memory decays exponentially with daily cycle
 *
 * Signal types:
 * - Rebound from gap boundary (bullish if bouncing off lower gap edge)
 * - Gap closure (continuation in direction of gap fill)
 * - False breakout (strong reversal from gap edge)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const GAP_LOOKBACK = 30;
const MIN_GAP_RATIO = 0.003; // Minimum gap as fraction of price (0.3%)
const VIC_SCALE = 1e-8; // Scaling factor for VIC normalization
const MEMORY_DECAY = 0.9; // Daily decay factor for gap memory

interface Gap {
  startIndex: number; // Index of bar before gap
  gapSize: number; // Absolute price gap
  direction: 'up' | 'down'; // Direction of the gap
  vic: number; // Volume-Intensity Composite
  footprint: number; // Institutional footprint (0-1)
  age: number; // Bars since gap formed
}

@Injectable()
export class PriceTimeGapDirective implements IDirective {
  readonly id = 'price-time-gap';
  readonly name = 'Price Time Gap';
  readonly description =
    'Identifies fast-moving price zones with little trading activity. Detects institutional footprints and gap-based signals.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minBars = { '1d': 32 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;

    if (bars.length < GAP_LOOKBACK + 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${GAP_LOOKBACK + 2} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const gaps = this.findGaps(bars);
    if (gaps.length === 0) {
      return {
        score: 0,
        confidence: 0.5,
        reason: 'No price-time gaps detected in recent bars.',
        signalClass: 'neutral',
      };
    }

    // Score based on most recent gaps
    const currentPrice = bars[bars.length - 1].close;

    // Check for active gap signals
    const activeGaps = gaps.filter((g) => g.age < 5); // Gaps within last 5 bars
    if (activeGaps.length === 0) {
      // Older gaps provide weaker signals
      const oldestActive = gaps.reduce((best, g) =>
        g.footprint > best.footprint ? g : best, gaps[0]);

      const memoryStrength = Math.pow(MEMORY_DECAY, oldestActive.age);
      const score = Math.round(oldestActive.footprint * memoryStrength * 20);

      return {
        score,
        confidence: Number((0.3 * memoryStrength).toFixed(2)),
        reason: `Fading gap memory (age ${oldestActive.age} bars, footprint ${oldestActive.footprint.toFixed(2)}).`,
        signalClass: 'neutral',
      };
    }

    // Score recent gaps
    const maxFootprint = Math.max(...activeGaps.map((g) => g.footprint));
    const recentGapDirections = activeGaps.filter((g) => g.footprint > 0.5);
    const bullishGaps = recentGapDirections.filter((g) => g.direction === 'up').length;
    const bearishGaps = recentGapDirections.filter((g) => g.direction === 'down').length;

    // Determine gap signal
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    let score = 0;
    let reason = '';

    // Check if price is near a gap boundary (within 0.5%)
    const nearestGap = activeGaps[activeGaps.length - 1];
    const gapPrice = bars[nearestGap.startIndex].close;
    const proximityToGap = Math.abs(currentPrice - gapPrice) / gapPrice;

    if (proximityToGap < 0.005 && maxFootprint > 0.6) {
      // Price near a gap boundary — potential rebound or breakout
      if (nearestGap.direction === 'up' && currentPrice < gapPrice) {
        // Price below upward gap — potential support rebound
        signalClass = 'bullish';
        score = Math.round(40 + maxFootprint * 40);
        reason = `Price near upward gap boundary (support). Gap footprint ${maxFootprint.toFixed(2)}. Potential rebound.`;
      } else if (nearestGap.direction === 'down' && currentPrice > gapPrice) {
        // Price above downward gap — potential resistance
        signalClass = 'bearish';
        score = Math.round(40 + maxFootprint * 40);
        reason = `Price near downward gap boundary (resistance). Gap footprint ${maxFootprint.toFixed(2)}. Potential reversal.`;
      }
    }

    if (score === 0) {
      // General gap activity scoring
      const directionScore = bullishGaps > bearishGaps ? 1 : bearishGaps > bullishGaps ? -1 : 0;
      signalClass = directionScore > 0 ? 'bullish' : directionScore < 0 ? 'bearish' : 'neutral';
      score = Math.round(maxFootprint * 30 + activeGaps.length * 5);
      reason = `${activeGaps.length} recent gaps (max footprint ${maxFootprint.toFixed(2)}). ${
        bullishGaps > bearishGaps ? 'Bullish bias.' : bearishGaps > bullishGaps ? 'Bearish bias.' : 'Neutral bias.'
      }`;
    }

    return {
      score: Math.min(this.maxScore, score),
      confidence: Number(Math.min(0.85, 0.4 + maxFootprint * 0.45).toFixed(2)),
      reason,
      signalClass,
    };
  }

  private findGaps(bars: DirectiveInput['bars']): Gap[] {
    const gaps: Gap[] = [];
    const recent = bars.slice(-GAP_LOOKBACK - 1);

    for (let i = 1; i < recent.length; i++) {
      const prevBar = recent[i - 1];
      const currBar = recent[i];

      // Gap up: current low > previous high
      if (currBar.low > prevBar.high) {
        const gapSize = currBar.low - prevBar.high;
        const gapRatio = gapSize / prevBar.close;

        if (gapRatio >= MIN_GAP_RATIO) {
          const vic = this.calculateVIC(prevBar, currBar, gapSize, 'up');
          const footprint = this.normalizeVIC(vic);
          gaps.push({
            startIndex: bars.length - GAP_LOOKBACK + i - 2,
            gapSize,
            direction: 'up',
            vic,
            footprint,
            age: GAP_LOOKBACK - i,
          });
        }
      }

      // Gap down: current high < previous low
      if (currBar.high < prevBar.low) {
        const gapSize = prevBar.low - currBar.high;
        const gapRatio = gapSize / prevBar.close;

        if (gapRatio >= MIN_GAP_RATIO) {
          const vic = this.calculateVIC(prevBar, currBar, gapSize, 'down');
          const footprint = this.normalizeVIC(vic);
          gaps.push({
            startIndex: bars.length - GAP_LOOKBACK + i - 2,
            gapSize,
            direction: 'down',
            vic,
            footprint,
            age: GAP_LOOKBACK - i,
          });
        }
      }
    }

    return gaps;
  }

  /**
   * VIC = Volume × Intensity × Composite
   * Simplified from MQL5 article:
   *   VIC = volume × priceChange × (avgVolume / sessionVolume) / time²
   */
  private calculateVIC(
    prevBar: { volume: number; close: number },
    currBar: { volume: number; open: number },
    gapSize: number,
    _direction: 'up' | 'down',
  ): number {
    const avgVolume = (prevBar.volume + currBar.volume) / 2;
    const priceChange = gapSize;

    // VIC: higher when volume is high AND price change is large
    // Division by price level normalizes across instruments
    const vic = avgVolume * priceChange * VIC_SCALE;

    return vic;
  }

  /**
   * Normalize VIC to institutional footprint (0-1).
   * Values above 0.7 suggest institutional activity.
   * Values above 0.85 = highly likely institutional.
   */
  private normalizeVIC(vic: number): number {
    // Sigmoid-like normalization
    const normalized = 1 / (1 + Math.exp(-vic * 5 + 2));
    return Number(Math.min(1, Math.max(0, normalized)).toFixed(2));
  }
}



