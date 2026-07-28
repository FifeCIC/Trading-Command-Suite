/**
 * Volume Boundary
 * ===============
 * Smoothed volume interpretation for clearer signal generation.
 * Detects:
 * - Volume climax (potential reversal)
 * - Volume drought (potential breakout)
 * - Volume expansion (trend confirmation)
 *
 * Uses normalized volume with smoothing — not raw volume spikes.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 20;
const VOL_LOOKBACK = 15;
const CLIMAX_MULTIPLIER = 2.5; // Volume > 2.5x average = climax
const DROUGHT_MULTIPLIER = 0.4; // Volume < 0.4x average = drought

@Injectable()
export class VolumeBoundaryDirective implements IDirective {
  readonly id = 'volume-boundary';
  readonly name = 'Volume Boundary';
  readonly description =
    'Smoothed volume interpretation. Detects climax, drought, and expansion patterns.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 20 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-VOL_LOOKBACK);
    const volumes = recentBars.map((b) => b.volume);

    // Smooth volumes with a simple 3-bar moving average
    const smoothedVolumes: number[] = [];
    for (let i = 2; i < volumes.length; i++) {
      smoothedVolumes.push((volumes[i - 2] + volumes[i - 1] + volumes[i]) / 3);
    }

    const avgSmoothed = smoothedVolumes.reduce((a, b) => a + b, 0) / smoothedVolumes.length;
    const latestVol = smoothedVolumes[smoothedVolumes.length - 1];
    const volRatio = latestVol / Math.max(1, avgSmoothed);

    // Check for climax
    if (volRatio >= CLIMAX_MULTIPLIER) {
      const currentBar = recentBars[recentBars.length - 1];
      const isUpBar = currentBar.close > currentBar.open;
      return {
        score: 60,
        confidence: 0.75,
        reason: `Volume climax (${volRatio.toFixed(1)}x avg). ${isUpBar ? 'Bullish' : 'Bearish'} bar — potential ${isUpBar ? 'exhaustion top' : 'selling climax'}.`,
        signalClass: isUpBar ? 'bearish' : 'bullish', // Climax often precedes reversal
      };
    }

    // Check for drought
    if (volRatio <= DROUGHT_MULTIPLIER) {
      return {
        score: 50,
        confidence: 0.6,
        reason: `Volume drought (${volRatio.toFixed(2)}x avg). Low participation — breakout may be imminent.`,
        signalClass: 'neutral',
      };
    }

    // Check volume expansion trend
    const firstHalf = smoothedVolumes.slice(0, Math.floor(smoothedVolumes.length / 2));
    const secondHalf = smoothedVolumes.slice(Math.floor(smoothedVolumes.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const expansionRatio = secondAvg / Math.max(1, firstAvg);

    if (expansionRatio > 1.3) {
      // Volume expanding — trend continuation
      const closes = recentBars.map((b) => b.close);
      const trend = closes[closes.length - 1] > closes[0] ? 'bullish' : 'bearish';
      return {
        score: 45,
        confidence: 0.55,
        reason: `Volume expanding (${expansionRatio.toFixed(2)}x). Confirms ${trend} trend.`,
        signalClass: trend,
      };
    }

    // Normal volume
    return {
      score: Math.round(Math.min(30, volRatio * 25)),
      confidence: 0.35,
      reason: `Normal volume (${volRatio.toFixed(2)}x avg). No anomaly detected.`,
      signalClass: 'neutral',
    };
  }
}



