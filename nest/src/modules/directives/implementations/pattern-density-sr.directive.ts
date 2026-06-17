/**
 * Pattern Density S/R
 * ====================
 * Aggregates repeated candlestick pattern detections into support/resistance zones.
 *
 * Uses fixed price bins with density scoring. Higher density = stronger S/R.
 * Optional recency weighting gives more importance to recent patterns.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 40;
const BIN_COUNT = 20;
const PATTERN_LOOKBACK = 30;

@Injectable()
export class PatternDensitySrDirective implements IDirective {
  readonly id = 'pattern-density-sr';
  readonly name = 'Pattern Density S/R';
  readonly description =
    'Aggregates repeated pattern detections into support/resistance zones via price bin density scoring.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-PATTERN_LOOKBACK);
    const currentPrice = bars[bars.length - 1].close;

    // Find reversal points (local highs and lows)
    const reversals: { price: number; type: 'high' | 'low'; recency: number }[] = [];

    for (let i = 2; i < recentBars.length - 2; i++) {
      const bar = recentBars[i];
      const prev1 = recentBars[i - 1];
      const prev2 = recentBars[i - 2];
      const next1 = recentBars[i + 1];
      const next2 = recentBars[i + 2];

      // Local high
      if (bar.high > prev1.high && bar.high > prev2.high && bar.high > next1.high && bar.high > next2.high) {
        reversals.push({ price: bar.high, type: 'high', recency: recentBars.length - i });
      }

      // Local low
      if (bar.low < prev1.low && bar.low < prev2.low && bar.low < next1.low && bar.low < next2.low) {
        reversals.push({ price: bar.low, type: 'low', recency: recentBars.length - i });
      }
    }

    if (reversals.length < 4) {
      return {
        score: 0,
        confidence: 0.3,
        reason: `Too few reversal points (${reversals.length}) for density analysis.`,
        signalClass: 'neutral',
      };
    }

    // Bin prices and calculate density
    const allPrices = [...bars.map((b) => b.high), ...bars.map((b) => b.low)];
    const priceMin = Math.min(...allPrices);
    const priceMax = Math.max(...allPrices);
    const binSize = (priceMax - priceMin) / BIN_COUNT;

    const bins = new Array<{ count: number; recentWeight: number; types: string[] }>(BIN_COUNT);
    for (let i = 0; i < BIN_COUNT; i++) {
      bins[i] = { count: 0, recentWeight: 0, types: [] };
    }

    for (const rev of reversals) {
      const binIdx = Math.min(BIN_COUNT - 1, Math.floor((rev.price - priceMin) / binSize));
      bins[binIdx].count++;
      bins[binIdx].recentWeight += Math.exp(-rev.recency / PATTERN_LOOKBACK); // Recency decay
      bins[binIdx].types.push(rev.type);
    }

    // Find current price bin and nearby bins
    const currentBin = Math.min(BIN_COUNT - 1, Math.floor((currentPrice - priceMin) / binSize));
    const binPrice = (binIdx: number) => priceMin + (binIdx + 0.5) * binSize;

    // Check bins above and below
    let supportScore = 0;
    let resistanceScore = 0;

    for (let i = 0; i < BIN_COUNT; i++) {
      const binPriceVal = binPrice(i);
      const density = bins[i].count / Math.max(1, reversals.length);
      const highCount = bins[i].types.filter((t) => t === 'high').length;
      const lowCount = bins[i].types.filter((t) => t === 'low').length;

      if (binPriceVal < currentPrice) {
        supportScore += density * 100 * (lowCount > highCount ? 1.3 : 0.7);
      } else if (binPriceVal > currentPrice) {
        resistanceScore += density * 100 * (highCount > lowCount ? 1.3 : 0.7);
      }
    }

    // Normalize
    supportScore = Math.min(1, supportScore / 4);
    resistanceScore = Math.min(1, resistanceScore / 4);

    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (supportScore > 0.6 && supportScore > resistanceScore) {
      score = 40 + supportScore * 50;
      signalClass = 'bullish';
      reason = `Strong pattern support below (density ${(supportScore * 100).toFixed(0)}%). Price likely to hold.`;
    } else if (resistanceScore > 0.6 && resistanceScore > supportScore) {
      score = 40 + resistanceScore * 50;
      signalClass = 'bearish';
      reason = `Strong pattern resistance above (density ${(resistanceScore * 100).toFixed(0)}%). Price likely to stall.`;
    } else {
      score = Math.round(Math.max(supportScore, resistanceScore) * 50);
      signalClass = 'neutral';
      reason = `Pattern density balanced. Support: ${(supportScore * 100).toFixed(0)}%, Resistance: ${(resistanceScore * 100).toFixed(0)}%.`;
    }

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.75, 0.2 + Math.max(supportScore, resistanceScore)).toFixed(2)),
      reason,
      signalClass,
    };
  }
}



