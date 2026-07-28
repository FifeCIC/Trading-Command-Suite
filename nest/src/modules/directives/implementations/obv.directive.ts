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

const MIN_BARS = 12;
const TREND_LOOKBACK = 5; // Bars to compare OBV vs price trend

@Injectable()
export class ObvDirective implements IDirective {
  readonly id = 'obv';
  readonly name = 'On-Balance Volume';
  readonly description =
    'Cumulative volume indicator. OBV confirming price = accumulation. OBV diverging = potential reversal.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 12 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
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
    if (obvValues.length < TREND_LOOKBACK + 1) {
      return { score: 0, confidence: 0.1, reason: 'Not enough OBV values.' };
    }

    // Compare OBV trend vs price trend over lookback
    const recentObv = obvValues.slice(-TREND_LOOKBACK);
    const recentPrice = closes.slice(-TREND_LOOKBACK);

    const obvStart = recentObv[0];
    const obvEnd = recentObv[recentObv.length - 1];
    const priceStart = recentPrice[0];
    const priceEnd = recentPrice[recentPrice.length - 1];

    const obvChange = obvEnd - obvStart;
    const priceChange = priceEnd - priceStart;

    // OBV signal strength
    const avgVolume = sma(volumes, TREND_LOOKBACK);
    const obvMomentum = avgVolume > 0 ? Math.abs(obvChange) / (avgVolume * TREND_LOOKBACK) : 0;

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
      const divergenceStrength = Math.min(1, Math.abs(obvChange) / (avgVolume * TREND_LOOKBACK));
      return {
      signalClass: 'neutral',
      score: 20,
        confidence: 0.55 + divergenceStrength * 0.2,
        reason: `Bearish OBV divergence: price rising but volume flow negative. Potential distribution — reduced long score.`,
      };
    }

    if (priceChange < 0 && obvChange > 0) {
      // Bullish divergence: price down, OBV up = accumulation on weakness
      const divergenceStrength = Math.min(1, obvChange / (avgVolume * TREND_LOOKBACK));
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

    return { score: 30, confidence: 0.3, reason: 'OBV and price flat — no clear signal.' };
  }
}
