/**
 * Institutional Footprint
 * =======================
 * Simplified version of the Price Time Gap directive.
 * Focuses exclusively on detecting institutional-level volume and
 * price movement that indicates large player activity.
 *
 * Uses the same VIC (Volume-Intensity Composite) calculation as
 * Price Time Gap, but thresholds it directly into a simple
 * footprint score without gap memory or edge detection.
 *
 * Signal:
 * - Footprint > 0.7: likely institutional activity
 * - Footprint > 0.85: highly likely — strong signal
 * - Direction derived from recent price movement relative to footprint
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const LOOKBACK = 15;
const VIC_SCALE = 1e-8;

@Injectable()
export class InstitutionalFootprintDirective implements IDirective {
  readonly id = 'institutional-footprint';
  readonly name = 'Institutional Footprint';
  readonly description =
    'Detects institutional-level volume and price activity patterns. Simplified footprint-only version of price-time-gap.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;

    if (bars.length < LOOKBACK + 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${LOOKBACK + 2} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-LOOKBACK);
    const closes = recentBars.map((b) => b.close);
    const volumes = recentBars.map((b) => b.volume);

    // Calculate average volume and range
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const avgRange = recentBars.reduce(
      (sum, b) => sum + (b.high - b.low), 0,
    ) / recentBars.length;

    // Find bars with anomalous volume and range
    let totalFootprint = 0;
    let footprintBars = 0;
    let directionSum = 0;

    for (let i = 0; i < recentBars.length; i++) {
      const bar = recentBars[i];
      const barRange = bar.high - bar.low;

      // Volume anomaly
      const volumeRatio = bar.volume / Math.max(avgVolume, 1);
      // Range anomaly
      const rangeRatio = barRange / Math.max(avgRange, 0.0001);

      // VIC for this individual bar
      const vic = bar.volume * barRange * VIC_SCALE;

      // Footprint: combines volume anomaly and range anomaly
      const footprint = this.calculateFootprint(vic, volumeRatio, rangeRatio);

      if (footprint > 0.4) {
        totalFootprint += footprint;
        footprintBars++;
        // Direction: bullish if close > open
        directionSum += bar.close > bar.open ? 1 : bar.close < bar.open ? -1 : 0;
      }
    }

    if (footprintBars === 0) {
      return {
        score: 0,
        confidence: 0.5,
        reason: 'No institutional footprint detected in recent bars.',
        signalClass: 'neutral',
      };
    }

    const avgFootprint = totalFootprint / footprintBars;

    // Score based on average footprint
    let score: number;
    let confidence: number;
    let reason: string;

    if (avgFootprint >= 0.85) {
      score = 85;
      confidence = 0.9;
      reason = `High institutional footprint (${avgFootprint.toFixed(2)}) across ${footprintBars} bars. Strong institutional activity detected.`;
    } else if (avgFootprint >= 0.7) {
      score = 65;
      confidence = 0.75;
      reason = `Moderate institutional footprint (${avgFootprint.toFixed(2)}) across ${footprintBars} bars. Likely institutional activity.`;
    } else if (avgFootprint >= 0.5) {
      score = 40;
      confidence = 0.55;
      reason = `Weak institutional footprint (${avgFootprint.toFixed(2)}) across ${footprintBars} bars. Possible institutional activity.`;
    } else {
      score = 20;
      confidence = 0.35;
      reason = `Marginal footprint (${avgFootprint.toFixed(2)}) — unlikely institutional.`;
    }

    // Determine signal direction from net bar direction
    const signalClass: 'bullish' | 'bearish' | 'neutral' =
      directionSum > 0 ? 'bullish' : directionSum < 0 ? 'bearish' : 'neutral';

    return {
      score: Math.round(score),
      confidence: Number(confidence.toFixed(2)),
      reason,
      signalClass,
    };
  }

  private calculateFootprint(
    vic: number,
    volumeRatio: number,
    rangeRatio: number,
  ): number {
    // Composite footprint from VIC and anomaly ratios
    const vicNorm = Math.min(1, vic * 3);
    const volScore = Math.min(1, (volumeRatio - 1) / 2); // > 3x volume = max score
    const rangeScore = Math.min(1, (rangeRatio - 1) / 1.5); // > 2.5x range = max score

    const footprint = vicNorm * 0.4 + volScore * 0.35 + rangeScore * 0.25;
    return Number(Math.min(1, Math.max(0, footprint)).toFixed(2));
  }
}



