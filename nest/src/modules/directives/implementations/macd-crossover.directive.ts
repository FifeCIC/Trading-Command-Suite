/**
 * MACD Bullish Crossover
 * ======================
 * Bullish when MACD line crosses above signal line.
 * Score scales with crossover strength and histogram momentum.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { macd } from '../utils/indicators';

const FAST = 12;
const SLOW = 26;
const SIGNAL = 9;
const MIN_BARS = SLOW + SIGNAL + 1;

@Injectable()
export class MacdCrossoverDirective implements IDirective {
  readonly id = 'macd-crossover';
  readonly name = 'MACD Bullish Crossover';
  readonly description =
    'Scores symbols where MACD line crosses above the signal line.';
  readonly priority = 80;
  readonly maxScore = 110;
  readonly minBars = { '1d': 36 };
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

    const { histogram } = macd(closes, FAST, SLOW, SIGNAL);

    if (histogram.length < 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Not enough MACD data for crossover detection.',
        signalClass: 'neutral',
      };
    }

    const currentHist = histogram[histogram.length - 1];
    const previousHist = histogram[histogram.length - 2];

    // Bullish crossover: histogram went from negative to positive
    const freshCrossover = previousHist <= 0 && currentHist > 0;
    // Already bullish and accelerating
    const bullishMomentum = currentHist > 0 && currentHist > previousHist;
    // Bearish
    const bearish = currentHist < 0;

    if (freshCrossover) {
      const strength = Math.min(
        1,
        Math.abs(currentHist) / (Math.abs(previousHist) + 0.001),
      );
      const score = 70 + strength * 30;
      return {
        score: Math.round(score),
        confidence: Math.min(0.95, 0.7 + strength * 0.2),
        reason: `Fresh bullish crossover. Histogram: ${previousHist.toFixed(3)} → ${currentHist.toFixed(3)}.`,
        signalClass: 'bullish',
      };
    }

    if (bullishMomentum) {
      const accel = Math.min(
        1,
        (currentHist - previousHist) / (Math.abs(currentHist) + 0.001),
      );
      const score = 45 + accel * 25;
      return {
        score: Math.round(score),
        confidence: 0.55,
        reason: `MACD bullish and accelerating. Histogram: ${currentHist.toFixed(3)}.`,
        signalClass: 'bullish',
      };
    }

    if (bearish) {
      // Approaching crossover from below?
      const narrowing = currentHist > previousHist;
      const score = narrowing ? 20 : 5;
      return {
        score,
        confidence: 0.3,
        reason: `MACD bearish${narrowing ? ' but narrowing' : ''}. Histogram: ${currentHist.toFixed(3)}.`,
        signalClass: 'bearish',
      };
    }

    return {
      score: 30,
      confidence: 0.4,
      reason: `MACD neutral. Histogram: ${currentHist.toFixed(3)}.`,
      signalClass: 'neutral',
    };
  }
}
