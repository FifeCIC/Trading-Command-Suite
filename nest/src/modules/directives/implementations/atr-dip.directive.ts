/**
 * ATR Normalized Dip
 * ==================
 * Favors dips that are significant but not breakdown-level.
 * Score based on pullback depth relative to ATR — sweet spot is 1-2 ATR.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

const ATR_PERIOD = 14;
const LOOKBACK_HIGH = 20; // Look for recent high over this many bars
const MIN_BARS = ATR_PERIOD + LOOKBACK_HIGH;

@Injectable()
export class AtrDipDirective implements IDirective {
  readonly id = 'atr-dip';
  readonly name = 'ATR Normalized Dip';
  readonly description =
    'Scores pullback quality using ATR-normalized distance from recent high.';
  readonly priority = 70;
  readonly maxScore = 95;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);

    const atrValues = atr(highs, lows, closes, ATR_PERIOD);
    if (atrValues.length === 0) {
      return { score: 0, confidence: 0.1, reason: 'Could not compute ATR.', signalClass: 'neutral' };
    }

    const currentAtr = atrValues[atrValues.length - 1];
    const currentPrice = closes[closes.length - 1];

    // Find recent high in the lookback window
    const lookbackSlice = highs.slice(-LOOKBACK_HIGH);
    const recentHigh = Math.max(...lookbackSlice);

    const dipAbsolute = recentHigh - currentPrice;
    if (dipAbsolute <= 0) {
      // At or above the recent high — no dip
      return {
        score: 15,
        confidence: 0.3,
        reason: `No dip: price at or near recent high (${recentHigh.toFixed(2)}).`,
      };
    }

    const dipInAtrs = currentAtr > 0 ? dipAbsolute / currentAtr : 0;

    // Sweet spot: 1-2 ATR dip = best score. <0.5 ATR = too shallow. >3 ATR = potential breakdown.
    let score: number;
    let reason: string;

    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'bullish';

    if (dipInAtrs < 0.5) {
      score = 20 + dipInAtrs * 30;
      reason = `Shallow dip: ${dipInAtrs.toFixed(2)} ATR from high. May not offer meaningful entry.`;
      signalClass = 'neutral';
    } else if (dipInAtrs <= 2) {
      // Ideal zone — score peaks around 1.2-1.5 ATR
      const ideal = 1.3;
      const proximity = 1 - Math.abs(dipInAtrs - ideal) / ideal;
      score = 65 + proximity * 35;
      reason = `Quality dip: ${dipInAtrs.toFixed(2)} ATR from high (${recentHigh.toFixed(2)}). Healthy consolidation.`;
      signalClass = 'bullish';
    } else if (dipInAtrs <= 3) {
      // Extended — still tradeable but higher risk
      score = 40 - (dipInAtrs - 2) * 15;
      reason = `Extended dip: ${dipInAtrs.toFixed(2)} ATR from high. Approaching breakdown territory.`;
      signalClass = 'neutral';
    } else {
      // Likely breakdown
      score = 5;
      reason = `Deep drop: ${dipInAtrs.toFixed(2)} ATR from high. Likely breakdown, not a dip.`;
      signalClass = 'bearish';
    }

    const confidence = dipInAtrs >= 0.5 && dipInAtrs <= 2.5 ? 0.7 : 0.35;

    return {
      score: Math.max(0, Math.round(score)),
      confidence,
      reason,
      signalClass,
    };
  }
}
