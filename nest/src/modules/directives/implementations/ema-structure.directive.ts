/**
 * Price Above EMA Structure
 * =========================
 * Stronger when price > EMA20 > EMA50.
 * Score based on alignment quality and separation between levels.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';

const EMA_SHORT = 20;
const EMA_LONG = 50;
const MIN_BARS = EMA_LONG + 1;

@Injectable()
export class EmaStructureDirective implements IDirective {
  readonly id = 'ema-structure';
  readonly name = 'Price Above EMA Structure';
  readonly description =
    'Scores symbols where price sits above EMA20 which sits above EMA50.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minBars = { '1d': 51 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const ema20 = ema(closes, EMA_SHORT);
    const ema50 = ema(closes, EMA_LONG);

    const currentPrice = closes[closes.length - 1];
    // EMA20 starts at index EMA_SHORT, EMA50 starts at index EMA_LONG
    // Align: ema50 has (closes.length - EMA_LONG) values, ema20 has (closes.length - EMA_SHORT) values
    const currentEma20 = ema20[ema20.length - 1];
    const currentEma50 = ema50[ema50.length - 1];

    const priceAboveEma20 = currentPrice > currentEma20;
    const ema20AboveEma50 = currentEma20 > currentEma50;
    const fullAlignment = priceAboveEma20 && ema20AboveEma50;

    if (fullAlignment) {
      // Score based on separation quality
      const priceSep = (currentPrice - currentEma20) / currentEma20; // % above EMA20
      const emaSep = (currentEma20 - currentEma50) / currentEma50; // % EMA20 above EMA50
      const sepFactor = Math.min(1, (priceSep + emaSep) * 20); // normalize to 0-1
      const score = 65 + sepFactor * 35;
      const confidence = Math.min(0.95, 0.7 + sepFactor * 0.2);
      return {
        score: Math.round(score),
        confidence: Number(confidence.toFixed(2)),
        reason: `Full alignment: price (${currentPrice.toFixed(2)}) > EMA20 (${currentEma20.toFixed(2)}) > EMA50 (${currentEma50.toFixed(2)}).`,
        signalClass: 'bullish',
      };
    }

    if (priceAboveEma20 && !ema20AboveEma50) {
      // Price above short-term but EMAs not aligned — weaker
      return {
        score: 35,
        confidence: 0.45,
        reason: `Price above EMA20 but EMA20 (${currentEma20.toFixed(2)}) below EMA50 (${currentEma50.toFixed(2)}).`,
        signalClass: 'neutral',
      };
    }

    if (!priceAboveEma20 && ema20AboveEma50) {
      // EMAs aligned but price dipped below — potential pullback
      return {
        score: 25,
        confidence: 0.4,
        reason: `EMA structure intact but price (${currentPrice.toFixed(2)}) below EMA20 (${currentEma20.toFixed(2)}).`,
        signalClass: 'bullish',
      };
    }

    // No alignment
    return {
      score: 10,
      confidence: 0.3,
      reason: `No EMA alignment: price (${currentPrice.toFixed(2)}), EMA20 (${currentEma20.toFixed(2)}), EMA50 (${currentEma50.toFixed(2)}).`,
      signalClass: 'bearish',
    };
  }
}
