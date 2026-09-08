/** Chandelier Exit — highest high - 3× ATR. Long exit signal. MT5 Chandelier.
 *  Category: ratio — distance-based, no bounded scale.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

@Injectable()
export class ChandelierExitDirective implements IDirective {
  readonly id = 'chandelier-exit';
  readonly name = 'Chandelier Exit';
  readonly description = 'Dual Chandelier Exit: long stop = highest high(22) − 3×ATR(22), short stop = lowest low(22) + 3×ATR(22). Price beyond the opposite stop = strong trend. Symmetric bullish/bearish evidence.';
  readonly category = 'ratio' as const;
  readonly priority = 64;
  readonly maxScore = 80;
  readonly minScore = 1;
  readonly minBars = { '1d': 26 };
  readonly version = '1.2.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 26) return { score: 0, confidence: 0.1, reason: `Need 26+ bars`, signalClass: 'neutral' };
    const a = atr(highs, lows, closes, 22);
    const lastAtr = a[a.length - 1];
    const highest22 = Math.max(...highs.slice(-22));
    const lowest22 = Math.min(...lows.slice(-22));
    const longExit = highest22 - 3 * lastAtr;
    const shortExit = lowest22 + 3 * lastAtr;
    const lastClose = closes[closes.length - 1];

    // Strong uptrend: price broke above the SHORT exit (upper channel edge).
    if (lastClose > shortExit) {
      const distance = ((lastClose - shortExit) / lastClose) * 100;
      if (distance > 3) {
        return { score: 65 + Math.min(15, Math.round(distance * 2)), confidence: 0.55, reason: `Chandelier: ${distance.toFixed(1)}% above short exit — strong uptrend`, signalClass: 'bullish' };
      }
      return { score: 55, confidence: 0.5, reason: `Chandelier: above short exit — uptrend`, signalClass: 'bullish' };
    }

    // Strong downtrend: price broke below the LONG exit (lower channel edge).
    if (lastClose < longExit) {
      const distance = ((longExit - lastClose) / lastClose) * 100;
      if (distance > 3) {
        return { score: 65 + Math.min(15, Math.round(distance * 2)), confidence: 0.55, reason: `Chandelier: ${distance.toFixed(1)}% below long exit — strong downtrend`, signalClass: 'bearish' };
      }
      return { score: 55, confidence: 0.5, reason: `Chandelier: below long exit — downtrend`, signalClass: 'bearish' };
    }

    return { score: 45, confidence: 0.3, reason: `Chandelier: inside channel — no clear trend`, signalClass: 'neutral' };
  }
}
