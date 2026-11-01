/**
 * On-Balance Volume (OBV) Directive
 * =================================
 * Cumulative volume indicator: adds volume on up days, subtracts on down days.
 *
 * Bullish: OBV rising with price = trend confirmation (accumulation).
 * Bearish: OBV falling while price rises = bearish divergence (distribution).
 *
 * TradePress source: includes/scoring-system/directives/obv.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { obv, sma } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 12;
const TREND_LOOKBACK = 5; // Bars to compare OBV vs price trend

/**
 * Tunable knob (#1165). The default IS the constant above — BASELINE proves the equality.
 *
 * ⚠️ OBV has no scale of its own — every reading here is a CHANGE compared over this window — so the
 * lookback IS the measurement. At 3 bars it reports noise; at 20 it reports the trend. Measured on the
 * `noisy-uptrend` fixture: the OBV/price agreement (and therefore the reported direction) differs
 * between the minimum and the maximum.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'trendLookback',
    label: 'OBV trend lookback',
    type: 'number',
    default: TREND_LOOKBACK,
    min: 3,
    max: 40,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): the divergence strength is |OBV change| / (avgVolume × lookback), so the window divides the result as well as defining it. At 3 bars ordinary noise reads as a strong divergence; at 40 only a sustained one does.',
    source: 'obv.directive.ts:21 TREND_LOOKBACK',
  },
];

@Injectable()
export class ObvDirective implements IDirective {
  readonly id = 'obv';
  readonly name = 'On-Balance Volume';
  readonly category = 'oscillator' as const;
  readonly description =
    'Cumulative volume indicator. OBV confirming price = accumulation. OBV diverging = potential reversal.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 12 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const trendLookback = values.trendLookback as number;

    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume);

    if (closes.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
      };
    }

    const obvValues = obv(closes, volumes);
    if (obvValues.length < trendLookback + 1) {
      return { score: 0, confidence: 0.1, reason: 'Not enough OBV values.' };
    }

    // Compare OBV trend vs price trend over lookback
    const recentObv = obvValues.slice(-trendLookback);
    const recentPrice = closes.slice(-trendLookback);

    const obvStart = recentObv[0];
    const obvEnd = recentObv[recentObv.length - 1];
    const priceStart = recentPrice[0];
    const priceEnd = recentPrice[recentPrice.length - 1];

    const obvChange = obvEnd - obvStart;
    const priceChange = priceEnd - priceStart;

    // OBV signal strength
    const avgVolume = sma(volumes, trendLookback);
    const obvMomentum = avgVolume > 0 ? Math.abs(obvChange) / (avgVolume * trendLookback) : 0;

    if (priceChange > 0 && obvChange > 0) {
      // OBV confirming uptrend = accumulation
      const score = Math.round(55 + Math.min(1, obvMomentum * 5) * 35); // 55–90
      return {
        score,
        confidence: 0.6 + Math.min(1, obvMomentum * 3) * 0.3,
        reason: `OBV confirming uptrend: volume supporting price rise. OBV momentum: ${(obvMomentum * 100).toFixed(1)}%. Accumulation signal.`,
      };
    }

    if (priceChange > 0 && obvChange < 0) {
      // Bearish divergence: price up, OBV down = distribution
      const divergenceStrength = Math.min(1, Math.abs(obvChange) / (avgVolume * trendLookback));
      return {
      signalClass: 'neutral',
      score: 20,
        confidence: 0.55 + divergenceStrength * 0.2,
        reason: `Bearish OBV divergence: price rising but volume flow negative. Potential distribution — reduced long score.`,
      };
    }

    if (priceChange < 0 && obvChange > 0) {
      // Bullish divergence: price down, OBV up = accumulation on weakness
      const divergenceStrength = Math.min(1, obvChange / (avgVolume * trendLookback));
      const score = Math.round(45 + divergenceStrength * 25); // 45–70
      return {
        score,
        confidence: 0.5 + divergenceStrength * 0.3,
        reason: `Bullish OBV divergence: price falling but volume accumulating. Smart money may be buying the dip.`,
      };
    }

    // Both declining
    if (priceChange < 0 && obvChange < 0) {
      return {
      signalClass: 'neutral',
      score: 15,
        confidence: 0.5,
        reason: 'OBV confirming downtrend: volume supporting price decline. Distribution in progress.',
      };
    }

    return { score: 0, confidence: 0.3, reason: 'OBV and price flat — no clear signal.' };
  }
}
