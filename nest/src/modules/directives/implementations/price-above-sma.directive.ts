/**
 * Price Above SMA Directive
 * =========================
 * Scores based on price position relative to SMA(50).
 *
 * Above SMA(50) = bullish intermediate uptrend.
 * Below SMA(50) = bearish for longs.
 * Within 1% of SMA = whipsaw zone penalty.
 *
 * Differs from ema-structure: uses SMA not EMA, single MA not dual.
 *
 * TradePress source: includes/scoring-system/directives/price-above-sma-50.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const SMA_PERIOD = 50;
const MIN_BARS = SMA_PERIOD + 2;

/**
 * Tunable knobs (#1165). Every default IS the module constant, so an instance that supplies nothing
 * scores byte-identically — asserted by the BASELINE guard in `directive-parameters.spec.ts`.
 *
 * ⚠️ Each `why` states the MEASUREMENT that makes the knob worth turning. A period is a HORIZON and a
 * threshold is a DEFINITION, not a preference: the same number means different things on a 1h chart and
 * a daily one, which is exactly why it cannot stay a constant.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'smaPeriod',
    label: 'SMA period',
    type: 'number',
    default: SMA_PERIOD,
    min: 5,
    max: 200,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): price above the 50-day is a medium-term statement; above the 200-day it is a regime statement. The period IS the claim.',
    source: 'price-above-sma.directive.ts:SMA_PERIOD',
  },
];

@Injectable()
export class PriceAboveSmaDirective implements IDirective {
  readonly id = 'price-above-sma';
  readonly name = 'Price Above SMA 50';
  readonly category = 'oscillator' as const;
  readonly description =
    'Scores price position relative to 50-period SMA. Above = bullish trend. Below = bearish.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 52 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const smaPeriod = values.smaPeriod as number;

    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
      };
    }

    const currentPrice = closes[closes.length - 1];
    const sma50 = sma(closes, smaPeriod);
    if (sma50 === 0) {
      return { score: 0, confidence: 0, reason: 'Could not calculate SMA(50).' };
    }

    const distancePct = ((currentPrice - sma50) / sma50) * 100;

    if (Math.abs(distancePct) < 1) {
      // Whipsaw zone: within 1% of SMA
      return {
      signalClass: 'neutral',
      score: 35,
        confidence: 0.2,
        reason: `Price ${currentPrice.toFixed(2)} within 1% of SMA(50) ${sma50.toFixed(2)}. Whipsaw risk — neutral score.`,
      };
    }

    if (distancePct > 0) {
      // Above SMA: bullish, scale with distance (up to ~10% out = max score)
      const strength = Math.min(1, distancePct / 10); // 0–1
      const score = Math.round(55 + strength * 35); // 55–90
      return {
        score,
        confidence: 0.5 + strength * 0.3,
        reason: `Price ${currentPrice.toFixed(2)} is ${distancePct.toFixed(1)}% above SMA(50) ${sma50.toFixed(2)}. Bullish intermediate trend.`,
      };
    }

    // Below SMA: bearish for longs
    const strength = Math.min(1, Math.abs(distancePct) / 10);
    const score = Math.round(25 - strength * 15); // 10–25
    return {
      score,
      confidence: 0.45 + strength * 0.15,
      reason: `Price ${currentPrice.toFixed(2)} is ${Math.abs(distancePct).toFixed(1)}% below SMA(50) ${sma50.toFixed(2)}. Bearish trend — reduced long score.`,
    };
  }
}
