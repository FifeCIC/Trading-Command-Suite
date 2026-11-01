/**
 * Falling Risk Pyramid
 * ====================
 * Detects whether price is trending favorably from a recent swing low,
 * indicating it may be a good time to add to a winning position.
 *
 * The "falling risk" concept: each add-on uses less capital than the
 * previous, so total portfolio risk decreases as the position grows.
 *
 * This directive evaluates trend favorability for pyramiding:
 * - Price distance from recent swing low (proxy for entry)
 * - Trend strength (ADX-like via consecutive directional closes)
 * - Pullback depth (ideal add-on at shallow pullback to moving average)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const SWING_LOOKBACK = 20;
const TREND_LOOKBACK = 10;
const EMA_PERIOD = 20;

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
    key: 'swingLookback',
    label: 'Swing lookback',
    type: 'number',
    default: SWING_LOOKBACK,
    min: 2,
    max: 30,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): swing points are the evidence that a pyramid position is still valid, and this window decides how large a swing must be to count.',
    source: 'falling-risk-pyramid.directive.ts:SWING_LOOKBACK',
  },
  {
    key: 'trendLookback',
    label: 'Trend lookback',
    type: 'number',
    default: TREND_LOOKBACK,
    min: 3,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: the trend direction gates whether the pyramid is held or reduced, so the window changes the decision rather than the size of it.',
    source: 'falling-risk-pyramid.directive.ts:TREND_LOOKBACK',
  },
  {
    key: 'emaPeriod',
    label: 'EMA period',
    type: 'number',
    default: EMA_PERIOD,
    min: 5,
    max: 100,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01: the EMA is the trend reference the pyramid is judged against — 13 on a 1h chart is half a day, 13 on a daily chart is a fortnight.',
    source: 'falling-risk-pyramid.directive.ts:EMA_PERIOD',
  },
];

@Injectable()
export class FallingRiskPyramidDirective implements IDirective {
  readonly id = 'falling-risk-pyramid';
  readonly name = 'Falling Risk Pyramid';
  readonly description =
    'Detects favorable trending conditions for scaling into winners with decreasing position sizes.';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 30 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly category = 'structural' as const;
  readonly directionBias = 'bullish' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const swingLookback = values.swingLookback as number;
    const trendLookback = values.trendLookback as number;
    const emaPeriod = values.emaPeriod as number;

    const bars = input.bars;
    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);

    if (closes.length < swingLookback + trendLookback) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${swingLookback + trendLookback} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    // Find the lowest low in the swing window as proxy for "entry"
    const recentWindow = bars.slice(-swingLookback);
    const swingLow = Math.min(...recentWindow.map((b) => b.low));
    const swingHigh = Math.max(...recentWindow.map((b) => b.high));
    const range = swingHigh - swingLow;
    if (range === 0) {
      return {
        score: 0,
        confidence: 0.2,
        reason: 'Zero range in swing window — no trend detectable.',
        signalClass: 'neutral',
      };
    }

    const currentPrice = closes[closes.length - 1];
    const pricePosition = (currentPrice - swingLow) / range; // 0 = at low, 1 = at high

    // Trend strength: count consecutive closes above EMA
    const emaValues = ema(closes, emaPeriod);
    const currentEma = emaValues[emaValues.length - 1];
    const priceAboveEma = currentPrice > currentEma;

    // Count how many of the last trendLookback closes are above EMA
    const trendBars = bars.slice(-trendLookback);
    let aboveCount = 0;
    for (let i = 0; i < trendBars.length; i++) {
      const barIdx = closes.length - trendLookback + i;
      const emaIdx = emaValues.length - trendLookback + i;
      if (emaIdx >= 0 && closes[barIdx] > emaValues[emaIdx]) {
        aboveCount++;
      }
    }
    const trendStrength = aboveCount / trendLookback; // 0-1

    // Pullback depth: how far below recent high (ideal add-on is on shallow pullback)
    const recentHigh = Math.max(...recentWindow.map((b) => b.high));
    const drawdownFromHigh = (recentHigh - currentPrice) / recentHigh;
    // Optimal add-on zone: 2-8% below high (shallow pullback)
    const pullbackScore =
      drawdownFromHigh <= 0.02 ? 0.5 : // too close to high — might be topping
      drawdownFromHigh <= 0.08 ? 1.0 : // optimal shallow pullback
      drawdownFromHigh <= 0.15 ? 0.5 : // deeper pullback — less ideal
      0.1; // strong pullback — avoid adding

    // Price distance from swing low — want to have some profit already
    const profitFactor = Math.min(1, pricePosition * 1.5); // 0-1, caps at position > 0.67

    // Composite score
    const trendScore = trendStrength * 40; // max 40
    const pullbackAddScore = pullbackScore * 30; // max 30
    const profitAddScore = profitFactor * 30; // max 30

    const score = Math.round(trendScore + pullbackAddScore + profitAddScore);
    const confidence = trendStrength > 0.6 && pullbackScore > 0.5
      ? Math.min(0.9, 0.5 + trendStrength * 0.4)
      : 0.3 + trendStrength * 0.3;

    const reason = priceAboveEma
      ? `Price $${currentPrice.toFixed(4)} above EMA(${emaPeriod}), trend strength ${(trendStrength * 100).toFixed(0)}%, pullback ${(drawdownFromHigh * 100).toFixed(1)}% from high.`
      : `Price below EMA(${emaPeriod}) — trend not favorable for pyramiding.`;

    return {
      score,
      confidence: Number(confidence.toFixed(2)),
      reason,
      signalClass: priceAboveEma && trendStrength > 0.5 ? 'bullish' : 'neutral',
    };
  }
}



