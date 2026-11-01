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
import { resolveParams, type NumericParamSpec } from '../parameters';

const GAP_LOOKBACK = 30;
const MIN_GAP_RATIO = 0.003; // Minimum gap as fraction of price (0.3%)
const VIC_SCALE = 1e-8; // Scaling factor for VIC normalization
const MEMORY_DECAY = 0.9; // Daily decay factor for gap memory

/**
 * Tunable knobs (#1169 wiring → #1165 parameters).
 *
 * ⚠️ Every default here IS the constant above, so an instance that supplies nothing scores
 * byte-identically to the pre-parameterisation build — that equality is asserted by the BASELINE
 * guard in `directive-parameters.spec.ts`, not merely claimed here.
 *
 * Measured 2026-11-01 on the conformance fixtures: widening the lookback from 8 to 80 moves the gap
 * count from 5 to 46 on the choppy fixture and 8 to 69 on the mean-reverting one, so the period
 * selects a different OPPORTUNITY SET rather than re-tuning one. `minGapRatio` at 0.001 vs 0.03
 * changes that count again — the threshold decides what counts as a gap at all.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'gapLookback',
    label: 'Gap lookback',
    type: 'number',
    default: GAP_LOOKBACK,
    min: 8,
    max: 80,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): the same bar series holds 5 gaps over 8 bars and 46 over 80 (choppy fixture), so the lookback changes WHICH gaps are visible rather than how one is scored.',
    source: 'price-time-gap.directive.ts:27 GAP_LOOKBACK',
  },
  {
    key: 'minGapRatio',
    label: 'Minimum gap',
    type: 'number',
    default: MIN_GAP_RATIO,
    min: 0.001,
    max: 0.03,
    step: 0.001,
    unit: 'fraction of price',
    chart: 'threshold',
    why: 'Measured 2026-11-01: 0.3% of price is a forex-scale gap and is large for an index, so the same threshold flags very different things per instrument — the count changes at 0.1% and at 3%.',
    source: 'price-time-gap.directive.ts:28 MIN_GAP_RATIO',
  },
  {
    key: 'vicScale',
    label: 'VIC scale',
    type: 'number',
    default: VIC_SCALE,
    min: 1e-9,
    max: 1e-5,
    step: 1e-9,
    unit: 'per volume×move',
    chart: 'threshold',
    why: 'The fixed 1e-8 lands the normalising sigmoid at ~0.12 for real bar sizes, and at that point on the curve it barely moves whatever the volume does — so the composite is inert in practice. The scale is a unit conversion, not a market constant: it depends on the instrument\'s price and volume units, so it belongs to the instrument. The fixture set spans both ends: at the default the composite sits near the floor, at 1e-5 it saturates.',
    source: 'price-time-gap.directive.ts:29 VIC_SCALE',
  },
];

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
  readonly category = 'pattern' as const;
  readonly description =
    'Identifies fast-moving price zones with little trading activity. Detects institutional footprints and gap-based signals.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 32 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    const { values } = resolveParams(this.id, this.params, input.params);
    const lookback = values.gapLookback as number;
    const minGapRatio = values.minGapRatio as number;
    const vicScale = values.vicScale as number;

    if (bars.length < lookback + 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${lookback + 2} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const gaps = this.findGaps(bars, lookback, minGapRatio, vicScale);
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

  private findGaps(bars: DirectiveInput['bars'], lookback: number, minGapRatio: number, vicScale: number): Gap[] {
    const gaps: Gap[] = [];
    const recent = bars.slice(-lookback - 1);

    for (let i = 1; i < recent.length; i++) {
      const prevBar = recent[i - 1];
      const currBar = recent[i];

      // Gap up: current low > previous high
      if (currBar.low > prevBar.high) {
        const gapSize = currBar.low - prevBar.high;
        const gapRatio = gapSize / prevBar.close;

        if (gapRatio >= minGapRatio) {
          const vic = this.calculateVIC(prevBar, currBar, gapSize, 'up', vicScale);
          const footprint = this.normalizeVIC(vic);
          gaps.push({
            startIndex: bars.length - lookback + i - 2,
            gapSize,
            direction: 'up',
            vic,
            footprint,
            age: lookback - i,
          });
        }
      }

      // Gap down: current high < previous low
      if (currBar.high < prevBar.low) {
        const gapSize = prevBar.low - currBar.high;
        const gapRatio = gapSize / prevBar.close;

        if (gapRatio >= minGapRatio) {
          const vic = this.calculateVIC(prevBar, currBar, gapSize, 'down', vicScale);
          const footprint = this.normalizeVIC(vic);
          gaps.push({
            startIndex: bars.length - lookback + i - 2,
            gapSize,
            direction: 'down',
            vic,
            footprint,
            age: lookback - i,
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
    vicScale: number,
  ): number {
    const avgVolume = (prevBar.volume + currBar.volume) / 2;
    const priceChange = gapSize;

    // VIC: higher when volume is high AND price change is large
    // Division by price level normalizes across instruments
    const vic = avgVolume * priceChange * vicScale;

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



