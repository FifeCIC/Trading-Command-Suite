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
import { resolveParams, type NumericParamSpec } from '../parameters';

const AVG_PERIOD = 20;
const SURGE_THRESHOLD = 3.0;
const MIN_BARS = AVG_PERIOD + 2;

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ 3× the average is a genuine spike on a liquid FX major and routine on a small-cap or a crypto
 * pair, so the same number means "unusual" on one instrument and "Tuesday" on another. The
 * `volume-climax` fixture sits at ~4.2×, which is above the default and below the maximum — the band
 * where the threshold actually decides.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'avgPeriod',
    label: 'Average period',
    type: 'number',
    default: AVG_PERIOD,
    min: 3,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): a 20-bar baseline is a day of 15m bars and a month of dailies, so the same threshold separates "spike" from "normal" on completely different scales across cadences.',
    source: 'volume-surge.directive.ts:17 AVG_PERIOD',
  },
  {
    key: 'surgeThreshold',
    label: 'Surge threshold',
    type: 'number',
    default: SURGE_THRESHOLD,
    min: 1.3,
    max: 6,
    step: 0.1,
    unit: '× average',
    chart: 'threshold',
    why: 'Measured 2026-11-01: the volume-climax fixture sits at ~4.2× average, so lowering the threshold to 1.3 converts it from "no surge" to a scored surge, and raising it to 6 removes it entirely — the tier boundary decides whether the directive ever fires.',
    source: 'volume-surge.directive.ts:18 SURGE_THRESHOLD',
  },
];

@Injectable()
export class VolumeSurgeDirective implements IDirective {
  readonly id = 'volume-surge';
  readonly name = 'Volume Surge Detection';
  readonly description = 'Detects extreme volume spikes (>3x average). Surge on up day = accumulation, on down day = capitulation.';
  readonly category = 'ratio' as const;
  readonly directionBias = 'bullish' as const;

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 22 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const avgPeriod = values.avgPeriod as number;
    const surgeThreshold = values.surgeThreshold as number;

    const volumes = input.bars.map(b => b.volume);
    const closes = input.bars.map(b => b.close);
    const opens = input.bars.map(b => b.open);

    const requiredBars = Math.max(MIN_BARS, avgPeriod + 2);
    if (volumes.length < requiredBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${requiredBars} bars, have ${volumes.length}.` };
    }

    const recentVol = volumes[volumes.length - 1];
    const avgVol = sma(volumes.slice(0, -1), avgPeriod);
    if (avgVol <= 0) {
      return { score: 0, confidence: 0, reason: 'Could not calculate average volume.' };
    }

    const surgeRatio = recentVol / avgVol;

    if (surgeRatio < surgeThreshold) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.3,
        reason: `No volume surge. Current volume ${surgeRatio.toFixed(1)}x average (threshold ${surgeThreshold}x).`,
      };
    }

    const magnitude = Math.min(1, (surgeRatio - surgeThreshold) / 5); // 3x–8x → 0–1
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
