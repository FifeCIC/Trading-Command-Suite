/**
 * ADX (Average Directional Index) Directive
 * =========================================
 * Measures trend strength without indicating direction.
 * +DI > -DI = bullish bias. -DI > +DI = bearish bias.
 *
 * ADX > 25 = strong trend (scores higher)
 * ADX 20–25 = moderate trend
 * ADX < 20 = ranging/choppy (scores lower)
 *
 * TradePress source: includes/scoring-system/directives/adx.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { adx } from '../utils/indicators';

const ADX_PERIOD = 14;
const STRONG_TREND = 25;
const WEAK_TREND = 20;
const MIN_BARS = ADX_PERIOD + 5;

@Injectable()
export class AdxDirective implements IDirective {
  readonly id = 'adx';
  readonly name = 'Average Directional Index';
  readonly description =
    'Measures trend strength. ADX > 25 = trending. +DI > -DI = bullish bias. Scores trend conviction.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 19 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);

    if (closes.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
      };
    }

    const { adx: adxValues, plusDi, minusDi } = adx(highs, lows, closes, ADX_PERIOD);
    if (adxValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough ADX values.' };
    }

    const currentAdx = adxValues[adxValues.length - 1];
    const prevAdx = adxValues[adxValues.length - 2];
    const currentPlusDi = plusDi[plusDi.length - 1];
    const currentMinusDi = minusDi[minusDi.length - 1];

    const adxRising = currentAdx > prevAdx;
    const bullishBias = currentPlusDi > currentMinusDi;
    const diSpread = Math.abs(currentPlusDi - currentMinusDi);

    if (currentAdx >= STRONG_TREND) {
      // Strong trend: score high if bullish bias, moderate if bearish
      const trendQuality = Math.min(1, (currentAdx - STRONG_TREND) / 25); // 25–50 → 0–1
      if (bullishBias) {
        const score = Math.round(65 + trendQuality * 25 + (adxRising ? 10 : 0)); // 65–100
        return {
          score,
          confidence: 0.6 + trendQuality * 0.3,
          reason: `Strong bullish trend (ADX ${currentAdx.toFixed(1)}${adxRising ? ' ↗' : ''}, +DI ${currentPlusDi.toFixed(1)} > -DI ${currentMinusDi.toFixed(1)}). High trend conviction.`,
        };
      } else {
        const score = Math.round(25 - trendQuality * 15); // 10–25
        return {
          score,
          confidence: 0.55 + trendQuality * 0.2,
          reason: `Strong bearish trend (ADX ${currentAdx.toFixed(1)}, -DI ${currentMinusDi.toFixed(1)} > +DI ${currentPlusDi.toFixed(1)}). Anti-long — reduced score.`,
        };
      }
    }

    if (currentAdx >= WEAK_TREND) {
      // Moderate trend
      if (bullishBias) {
        const score = Math.round(45 + (adxRising ? 10 : 0) + diSpread * 0.3);
        return {
          score,
          confidence: 0.4 + (adxRising ? 0.15 : 0),
          reason: `Moderate bullish trend (ADX ${currentAdx.toFixed(1)}${adxRising ? ' ↗' : ''}, +DI ${currentPlusDi.toFixed(1)} > -DI ${currentMinusDi.toFixed(1)}).`,
        };
      } else {
        return {
      signalClass: 'neutral',
      score: 30,
          confidence: 0.4,
          reason: `Moderate bearish trend (ADX ${currentAdx.toFixed(1)}, -DI > +DI). Limited long opportunity.`,
        };
      }
    }

    // Ranging / weak trend
    if (bullishBias) {
      return {
      signalClass: 'neutral',
      score: 35,
        confidence: 0.25,
        reason: `Weak/ranging market (ADX ${currentAdx.toFixed(1)} < ${WEAK_TREND}). Bullish DI bias but low trend conviction — cautious score.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 25,
      confidence: 0.25,
      reason: `Ranging market (ADX ${currentAdx.toFixed(1)}). No directional conviction — neutral score.`,
    };
  }
}
