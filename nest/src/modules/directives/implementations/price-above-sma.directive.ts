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

const SMA_PERIOD = 50;
const MIN_BARS = SMA_PERIOD + 2;

@Injectable()
export class PriceAboveSmaDirective implements IDirective {
  readonly id = 'price-above-sma';
  readonly name = 'Price Above SMA 50';
  readonly description =
    'Scores price position relative to 50-period SMA. Above = bullish trend. Below = bearish.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 52 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
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
    const sma50 = sma(closes, SMA_PERIOD);
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
