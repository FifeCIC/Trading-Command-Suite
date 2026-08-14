/**
 * Volume Confirmation
 * ===================
 * Bullish setups score higher with volume support.
 * Compares recent volume to the 20-period average.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';

const VOLUME_MA_PERIOD = 20;
const MIN_BARS = VOLUME_MA_PERIOD + 1;

@Injectable()
export class VolumeConfirmationDirective implements IDirective {
  readonly id = 'volume-confirmation';
  readonly name = 'Volume Confirmation';
  readonly category = 'ratio' as const;
  readonly description =
    'Scores symbols where recent volume exceeds the average.';
  readonly priority = 60;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 21 }; // Raised from 85 — the bonus structure in calculate() can reach 100
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const volumes = bars.map((b) => b.volume);
    const avgVolume = sma(volumes.slice(0, -1), VOLUME_MA_PERIOD); // Average of prior bars
    const currentVolume = volumes[volumes.length - 1];

    if (avgVolume <= 0) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Average volume is zero — no reference for comparison.',
        signalClass: 'neutral',
      };
    }

    const ratio = currentVolume / avgVolume;

    let score: number;
    let reason: string;

    if (ratio >= 2.0) {
      // Very high volume — strong confirmation
      score = 85 + Math.min(15, (ratio - 2) * 10);
      reason = `Strong volume surge: ${ratio.toFixed(2)}x average (${currentVolume.toLocaleString()} vs avg ${Math.round(avgVolume).toLocaleString()}).`;
    } else if (ratio >= 1.3) {
      // Above-average volume — good confirmation
      score = 55 + (ratio - 1.3) * 43;
      reason = `Above-average volume: ${ratio.toFixed(2)}x (${currentVolume.toLocaleString()} vs avg ${Math.round(avgVolume).toLocaleString()}).`;
    } else if (ratio >= 0.8) {
      // Normal volume — neutral
      score = 30 + (ratio - 0.8) * 50;
      reason = `Normal volume: ${ratio.toFixed(2)}x average. No strong confirmation.`;
    } else {
      // Below-average volume — weak
      score = ratio * 37;
      reason = `Below-average volume: ${ratio.toFixed(2)}x average. Weak participation.`;
    }

    const confidence =
      ratio >= 1.3 ? Math.min(0.85, 0.5 + (ratio - 1) * 0.3) : 0.4;

    return {
      score: Math.max(0, Math.min(this.maxScore, Math.round(score))),
      confidence: Number(confidence.toFixed(2)),
      reason,
      // 2026-08-14: volume magnitude is direction-neutral — this directive does NOT
      // check bar direction (close vs open), so high volume ≠ bullish and low volume ≠ bearish.
      // Declared directionBias='neutral'; signalClass must match.
      signalClass: 'neutral',
    };
  }
}
