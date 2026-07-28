/**
 * Engulfing Pattern Directive
 * ===========================
 * Detects bullish and bearish engulfing candlestick patterns.
 *
 * Bullish Engulfing: after a downtrend, a large bullish candle (close > open)
 * completely engulfs the previous bearish candle (open < prev.close AND close > prev.open).
 *
 * Bearish Engulfing: after an uptrend, a large bearish candle engulfs the previous bullish one.
 * (Scores low for long-only strategies.)
 *
 * TradePress source: includes/scoring-system/directives/engulfing-pattern.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 5;
const ENGULF_RATIO_MIN = 1.05; // Body must be at least 5% larger to "engulf"

@Injectable()
export class EngulfingPatternDirective implements IDirective {
  readonly id = 'engulfing-pattern';
  readonly name = 'Engulfing Pattern';
  readonly description =
    'Detects bullish/bearish engulfing reversal structures over two bars.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 5 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
      };
    }

    const prev = bars[bars.length - 2];
    const curr = bars[bars.length - 1];

    const prevBody = prev.close - prev.open;
    const currBody = curr.close - curr.open;
    const prevBearish = prevBody < 0;
    const currBullish = currBody > 0;

    // Bullish engulfing: prev bearish, curr bullish, curr body engulfs prev
    if (prevBearish && currBullish) {
      const engulfed = curr.open <= prev.close && curr.close >= prev.open;
      if (engulfed) {
        const engulfRatio = Math.abs(currBody / prevBody);
        const quality = Math.min(1, (engulfRatio - 1) / 2); // scale 1.0-3.0x → 0-1
        const score = Math.round(70 + quality * 25); // 70–95
        return {
          score,
          confidence: 0.6 + quality * 0.3,
          reason: `Bullish engulfing detected: body ${engulfRatio.toFixed(1)}x previous. Strong reversal signal.`,
        };
      }
    }

    // Bearish engulfing: prev bullish, curr bearish, curr body engulfs prev
    const prevBullish = prevBody > 0;
    const currBearish = currBody < 0;
    if (prevBullish && currBearish) {
      const engulfed = curr.open >= prev.close && curr.close <= prev.open;
      if (engulfed) {
        const engulfRatio = Math.abs(currBody / prevBody);
        return {
      signalClass: 'neutral',
      score: 15,
          confidence: 0.55,
          reason: `Bearish engulfing detected: body ${engulfRatio.toFixed(1)}x previous. Anti-long signal — low score.`,
        };
      }
    }

    return { score: 0, confidence: 0.2, reason: 'No engulfing pattern detected in last two bars.' };
  }
}
