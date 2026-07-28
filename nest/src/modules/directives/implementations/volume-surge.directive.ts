/**
 * Volume Surge Directive
 * ======================
 * Detects extreme volume spikes (>3x 20-period average).
 * Differs from volume-confirmation (moderate elevation) — this catches outliers.
 *
 * Surge on up day = institutional accumulation spike.
 * Surge on down day = capitulation or distribution.
 *
 * TradePress source: includes/scoring-system/directives/volume-surge.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';

const AVG_PERIOD = 20;
const SURGE_THRESHOLD = 3.0;
const MIN_BARS = AVG_PERIOD + 2;

@Injectable()
export class VolumeSurgeDirective implements IDirective {
  readonly id = 'volume-surge';
  readonly name = 'Volume Surge Detection';
  readonly description = 'Detects extreme volume spikes (>3x average). Surge on up day = accumulation, on down day = capitulation.';
  readonly directionBias = 'bullish' as const;

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 22 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const volumes = input.bars.map(b => b.volume);
    const closes = input.bars.map(b => b.close);
    const opens = input.bars.map(b => b.open);

    if (volumes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${volumes.length}.` };
    }

    const recentVol = volumes[volumes.length - 1];
    const avgVol = sma(volumes.slice(0, -1), AVG_PERIOD);
    if (avgVol <= 0) {
      return { score: 0, confidence: 0, reason: 'Could not calculate average volume.' };
    }

    const surgeRatio = recentVol / avgVol;

    if (surgeRatio < SURGE_THRESHOLD) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.3,
        reason: `No volume surge. Current volume ${surgeRatio.toFixed(1)}x average (threshold ${SURGE_THRESHOLD}x).`,
      };
    }

    const magnitude = Math.min(1, (surgeRatio - SURGE_THRESHOLD) / 5); // 3x–8x → 0–1
    const isUpDay = closes[closes.length - 1] > opens[opens.length - 1];

    if (isUpDay) {
      const score = Math.round(65 + magnitude * 30);
      return {
      signalClass: 'neutral',
      score: Math.min(this.maxScore, score),
        confidence: 0.55 + magnitude * 0.3,
        reason: `Bullish volume surge: ${surgeRatio.toFixed(1)}x average on up day. Potential institutional accumulation.`,
      };
    }

    // Down day surge = capitulation/distribution
    return {
      signalClass: 'neutral',
      score: Math.round(20 - magnitude * 10),
      confidence: 0.5 + magnitude * 0.15,
      reason: `Bearish volume surge: ${surgeRatio.toFixed(1)}x average on down day. Capitulation or distribution — reduced long score.`,
    };
  }
}
