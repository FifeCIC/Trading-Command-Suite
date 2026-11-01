/**
 * Bollinger Bands Directive
 * =========================
 * Scores based on price position within Bollinger Bands (20,2).
 *
 * Near lower band (%B < 0.2) = oversold, potential bounce (bullish).
 * Near upper band (%B > 0.8) = overbought, caution (bearish for longs).
 * Bandwidth included in reason for squeeze detection.
 *
 * TradePress source: includes/scoring-system/directives/bollinger-bands.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { bollingerBands } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const BB_PERIOD = 20;
const MIN_BARS = BB_PERIOD + 2;

/**
 * Tunable knobs (#1165). The default IS the constant above — BASELINE proves the equality.
 *
 * ⚠️ `%B` is a POSITION WITHIN STANDARD DEVIATION BANDS, so the period decides what "the band" means:
 * a 20-bar band on a 1h chart tracks a day, a 50-bar band tracks two. On the `noisy-range` fixture the
 * same close sits outside the 20-bar lower band and inside the 50-bar one, which is the difference
 * between an oversold reading and no signal at all.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'bbPeriod',
    label: 'Band period',
    type: 'number',
    default: BB_PERIOD,
    min: 5,
    max: 80,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): 20 is the convention on a DAILY chart, but 20 hours intraday is a completely different horizon. The same close is outside the 20-bar band and inside the 50-bar band on the noisy-range fixture.',
    source: 'bollinger-bands.directive.ts:17 BB_PERIOD',
  },
];

@Injectable()
export class BollingerBandsDirective implements IDirective {
  readonly id = 'bollinger-bands';
  readonly name = 'Bollinger Bands';
  readonly description = 'Scores price position relative to Bollinger Bands (20,2). Near lower band = bullish, near upper = bearish.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 95;
  readonly minScore = 1;
  readonly minBars = { '1d': 22 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const bbPeriod = values.bbPeriod as number;
    const closes = input.bars.map(b => b.close);
    const minBars = Math.max(MIN_BARS, bbPeriod + 2);
    if (closes.length < minBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${closes.length}.` };
    }

    const { percentB, bandwidth } = bollingerBands(closes, bbPeriod);
    if (percentB.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough Bollinger Band values.' };
    }

    const currentB = percentB[percentB.length - 1];
    const prevB = percentB[percentB.length - 2];
    const currentBW = bandwidth[bandwidth.length - 1];
    const turning = currentB > prevB; // moving away from lower band

    if (currentB <= 0.2) {
      const depth = (0.2 - currentB) / 0.2;
      const score = Math.round(60 + depth * 25 + (turning ? 10 : 0));
      return {
      signalClass: 'neutral',
      score: Math.min(this.maxScore, score),
        confidence: 0.55 + depth * 0.25,
        reason: `Price near lower Bollinger Band (%B=${currentB.toFixed(2)}${turning ? ', turning up' : ''}). Bandwidth ${currentBW.toFixed(1)}%. Oversold bounce potential.`,
      };
    }

    if (currentB >= 0.8) {
      // ⚠️ CLAMPED 2026-11-01 (#1165). `height` is UNBOUNDED — it is (currentB − 0.8)/0.2 — so a bar
      // whose close sits far above the upper band (a breakout on a very tight band) drives
      // `20 − height × 10` NEGATIVE. Measured on the `long-wick` fixture: score **−10** against a
      // declared 0..95 contract. Nothing caught it before because no fixture carried a bar outside its
      // own bands; the clamp only affects values the contract already forbade, so no valid score moves.
      const height = (currentB - 0.8) / 0.2;
      return {
      signalClass: 'neutral',
      score: Math.max(0, Math.min(this.maxScore, Math.round(20 - height * 10))),
        confidence: 0.5 + height * 0.15,
        reason: `Price near upper Bollinger Band (%B=${currentB.toFixed(2)}). Bandwidth ${currentBW.toFixed(1)}%. Overbought — reduced long score.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 40,
      confidence: 0.3,
      reason: `Price mid-Bollinger Bands (%B=${currentB.toFixed(2)}). Bandwidth ${currentBW.toFixed(1)}%. No extreme signal.`,
    };
  }
}
