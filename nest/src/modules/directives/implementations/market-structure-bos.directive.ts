/**
 * Market Structure — Break of Structure (BOS)
 * ===========================================
 * Detects swing points and classifies market structure.
 * BOS = price breaks beyond a prior swing point (trend continuation).
 * CHOCH = Change of Character (trend reversal signal).
 *
 * Dashboard output: bullish, bearish, or ranging.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const SWING_LOOKBACK = 5;
const MIN_BARS = 30;

interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
}

@Injectable()
export class MarketStructureBosDirective implements IDirective {
  readonly id = 'market-structure-bos';
  readonly name = 'Market Structure — Break of Structure';
  readonly description =
    'Detects BOS (Break of Structure) and CHOCH (Change of Character) via swing points.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly minBars = { '1d': 30 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

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

    const swings = this.findSwingPoints(bars);
    if (swings.length < 4) {
      return {
        score: 0,
        confidence: 0.2,
        reason: `Too few swing points (${swings.length}) for structure analysis.`,
        signalClass: 'neutral',
      };
    }

    const currentPrice = bars[bars.length - 1].close;
    const recentSwings = swings.slice(-6);

    // Check for BOS or CHOCH
    const lastHigh = [...recentSwings].reverse().find((s) => s.type === 'high');
    const lastLow = [...recentSwings].reverse().find((s) => s.type === 'low');

    const highs = recentSwings.filter((s) => s.type === 'high').map((s) => s.price);
    const lows = recentSwings.filter((s) => s.type === 'low').map((s) => s.price);

    // Determine structure
    const higherHighs = this.countHigherSequence(highs);
    const higherLows = this.countHigherSequence(lows);
    const lowerHighs = this.countLowerSequence(highs);
    const lowerLows = this.countLowerSequence(lows);

    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (higherHighs >= 2 && higherLows >= 2) {
      // Bullish structure: HH + HL
      if (lastHigh && currentPrice > lastHigh.price) {
        score = 75;
        reason = `Bullish BOS: price broke above last swing high (${lastHigh.price.toFixed(4)}). HH+HL structure intact.`;
      } else {
        score = 55;
        reason = `Bullish structure (HH+HL). ${higherHighs} higher highs, ${higherLows} higher lows.`;
      }
      signalClass = 'bullish';
    } else if (lowerHighs >= 2 && lowerLows >= 2) {
      // Bearish structure: LH + LL
      if (lastLow && currentPrice < lastLow.price) {
        score = 75;
        reason = `Bearish BOS: price broke below last swing low (${lastLow.price.toFixed(4)}). LH+LL structure intact.`;
      } else {
        score = 55;
        reason = `Bearish structure (LH+LL). ${lowerHighs} lower highs, ${lowerLows} lower lows.`;
      }
      signalClass = 'bearish';
    } else {
      // Ranging / transitional
      score = 25;
      signalClass = 'neutral';
      reason = `Ranging structure. Higher highs: ${higherHighs}, higher lows: ${higherLows}. No clear trend.`;
    }

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.85, 0.4 + (Math.abs(higherHighs - lowerHighs) + Math.abs(higherLows - lowerLows)) * 0.1).toFixed(2)),
      reason,
      signalClass,
    };
  }

  private findSwingPoints(bars: DirectiveInput['bars']): SwingPoint[] {
    const swings: SwingPoint[] = [];

    for (let i = SWING_LOOKBACK; i < bars.length - SWING_LOOKBACK; i++) {
      const currHigh = bars[i].high;
      const currLow = bars[i].low;

      // Check if this is a swing high
      let isSwingHigh = true;
      let isSwingLow = true;
      for (let j = i - SWING_LOOKBACK; j <= i + SWING_LOOKBACK; j++) {
        if (j === i) continue;
        if (bars[j].high >= currHigh) isSwingHigh = false;
        if (bars[j].low <= currLow) isSwingLow = false;
      }

      if (isSwingHigh) swings.push({ index: i, price: currHigh, type: 'high' });
      if (isSwingLow) swings.push({ index: i, price: currLow, type: 'low' });
    }

    return swings;
  }

  private countHigherSequence(values: number[]): number {
    let count = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) count++;
    }
    return count;
  }

  private countLowerSequence(values: number[]): number {
    let count = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] < values[i - 1]) count++;
    }
    return count;
  }
}



