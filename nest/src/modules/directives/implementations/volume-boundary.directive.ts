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
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 20;
const VOL_LOOKBACK = 15;
const CLIMAX_MULTIPLIER = 2.5; // Volume > 2.5x average = climax
const DROUGHT_MULTIPLIER = 0.4; // Volume < 0.4x average = drought

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ Climax and drought are the two TAILS of the same distribution, so all three knobs move the
 * boundaries that decide which tail (if either) the current bar is in. The `volume-climax` fixture
 * sits at ~4.2× (between the 2.5× default and the 6× maximum) and `volume-drought` at ~0.18× (below
 * the 0.4 default and above the 0.1 minimum) — both deliberately inside the band where the threshold
 * is the deciding factor rather than a foregone conclusion.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'volLookback',
    label: 'Volume lookback',
    type: 'number',
    default: VOL_LOOKBACK,
    min: 5,
    max: 80,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): the "average" this compares against is taken over this window, so a 15-bar lookback on a fresh news day is a very different reference from an 80-bar one. Widening it changes which bar reads as a climax.',
    source: 'volume-boundary.directive.ts:21 VOL_LOOKBACK',
  },
  {
    key: 'climaxMultiplier',
    label: 'Climax multiplier',
    type: 'number',
    default: CLIMAX_MULTIPLIER,
    min: 1.2,
    max: 6,
    step: 0.1,
    unit: '× average',
    chart: 'threshold',
    why: 'Measured 2026-11-01: the volume-climax fixture is ~4.2×, so 1.2 flags it as climax and 6 does not — the boundary decides whether the directive reports an exhaustion event at all.',
    source: 'volume-boundary.directive.ts:22 CLIMAX_MULTIPLIER',
  },
  {
    key: 'droughtMultiplier',
    label: 'Drought multiplier',
    type: 'number',
    default: DROUGHT_MULTIPLIER,
    min: 0.1,
    max: 0.9,
    step: 0.05,
    unit: '× average',
    chart: 'threshold',
    why: 'Measured 2026-11-01: the volume-drought fixture is ~0.18×, so 0.9 flags it as drought and 0.1 does not. A drought threshold set high marks ordinary quiet bars as exhaustion, which is the failure mode this knob exists to correct.',
    source: 'volume-boundary.directive.ts:23 DROUGHT_MULTIPLIER',
  },
];

@Injectable()
export class VolumeBoundaryDirective implements IDirective {
  readonly id = 'volume-boundary';
  readonly name = 'Volume Boundary';
  readonly category = 'ratio' as const;
  readonly description =
    'Smoothed volume interpretation. Detects climax, drought, and expansion patterns.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 20 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const volLookback = values.volLookback as number;
    const climaxMultiplier = values.climaxMultiplier as number;
    const droughtMultiplier = values.droughtMultiplier as number;

    const bars = input.bars;
    const requiredBars = Math.max(MIN_BARS, volLookback + 5);
    if (bars.length < requiredBars) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-volLookback);
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
    if (volRatio >= climaxMultiplier) {
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
    if (volRatio <= droughtMultiplier) {
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



