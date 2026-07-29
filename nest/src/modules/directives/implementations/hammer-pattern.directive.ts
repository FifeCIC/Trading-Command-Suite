/**
 * Hammer Pattern Directive
 * ========================
 * Detects Hammer and Hanging Man candlestick patterns.
 *
 * A Hammer has:
 * - Small body near the top of the range
 * - Long lower wick (≥ 2× body)
 * - Little or no upper wick
 *
 * At support after a downtrend = Hammer (bullish reversal).
 * At resistance after an uptrend = Hanging Man (bearish — scores low for longs).
 *
 * TradePress source: includes/scoring-system/directives/hammer-pattern.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 6;
const MIN_WICK_BODY_RATIO = 2.0; // Lower wick must be ≥ 2× body
const MAX_UPPER_WICK_RATIO = 0.3; // Upper wick < 30% of body
const TREND_LOOKBACK = 5;

@Injectable()
export class HammerPatternDirective implements IDirective {
  readonly id = 'hammer-pattern';
  readonly name = 'Hammer Pattern';
  readonly description =
    'Detects hammer-style reversal candles — small body with long lower wick rejecting lower prices.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 6 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

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

    const curr = bars[bars.length - 1];
    const body = Math.abs(curr.close - curr.open);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);

    if (body === 0) {
      return { score: 0, confidence: 0, reason: 'Zero-body candle — not a Hammer (would be a Doji variant).' };
    }

    const wickBodyRatio = lowerWick / body;
    const upperWickRatio = upperWick / body;

    // Not a hammer: lower wick too short or upper wick too long
    if (wickBodyRatio < MIN_WICK_BODY_RATIO) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.2,
        reason: `No Hammer: lower wick/body ratio ${wickBodyRatio.toFixed(1)} (need ≥ ${MIN_WICK_BODY_RATIO}).`,
      };
    }

    if (upperWickRatio > MAX_UPPER_WICK_RATIO) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.2,
        reason: `No Hammer: upper wick too large (${(upperWickRatio * 100).toFixed(0)}% of body).`,
      };
    }

    // Determine trend context
    const lookbackStart = bars[bars.length - 1 - TREND_LOOKBACK];
    const priorTrend = curr.close - lookbackStart.close;
    const inDowntrend = priorTrend < 0;

    // Hammer quality: stronger wick/body ratio = better signal
    const quality = Math.min(1, (wickBodyRatio - MIN_WICK_BODY_RATIO) / 4); // 2x–6x → 0–1

    if (inDowntrend) {
      // Hammer at support = bullish reversal
      const score = Math.round(65 + quality * 25); // 65–90
      return {
        score,
        confidence: 0.6 + quality * 0.3,
        reason: `Hammer at support: wick ${wickBodyRatio.toFixed(1)}× body after ${Math.abs(priorTrend).toFixed(2)} decline. Buyers rejected lower prices.`,
      };
    } else {
      // Hanging Man at resistance = bearish for longs
      const score = Math.round(15 + quality * 10); // 15–25
      return {
        score,
        confidence: 0.5,
        reason: `Hanging Man at resistance: wick ${wickBodyRatio.toFixed(1)}× body after uptrend. Potential topping signal — reduced long score.`,
      };
    }
  }
}
