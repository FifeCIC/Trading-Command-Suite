/**
 * Doji Pattern Directive
 * ======================
 * Detects Doji candlestick patterns — indecision candles where open ≈ close.
 *
 * A Doji has a very small body relative to its total range (body < 10% of range).
 * At support after a downtrend = bullish reversal signal.
 * At resistance after an uptrend = bearish reversal signal.
 *
 * TradePress source: includes/scoring-system/directives/doji-pattern.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 6; // Need context bars for trend detection
const DOJI_BODY_RATIO = 0.10; // Body must be < 10% of total range
const TREND_LOOKBACK = 5; // Bars to determine prior trend

@Injectable()
export class DojiPatternDirective implements IDirective {
  readonly id = 'doji-pattern';
  readonly name = 'Doji Pattern';
  readonly description =
    'Detects indecision candles where open and close are nearly equal. Scores bullish at support, bearish at resistance.';

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

    const current = bars[bars.length - 1];
    const body = Math.abs(current.close - current.open);
    const range = current.high - current.low;

    if (range === 0) {
      return { score: 0, confidence: 0, reason: 'Zero-range bar — not a valid Doji.' };
    }

    const bodyRatio = body / range;

    // Not a Doji — body too large relative to range
    if (bodyRatio >= DOJI_BODY_RATIO) {
      return { score: 0, confidence: 0.2, reason: 'No Doji pattern: body is ' + (bodyRatio * 100).toFixed(1) + '% of range (threshold <10%).' };
    }

    // Determine prior trend using lookback closes
    const lookbackStart = bars[bars.length - 1 - TREND_LOOKBACK];
    const recentCloses = bars.slice(-TREND_LOOKBACK).map(b => b.close);
    const avgClose = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    const priorTrend = current.close - lookbackStart.close;
    const inDowntrend = priorTrend < 0;

    // Doji quality: smaller body = stronger signal
    const quality = 1 - (bodyRatio / DOJI_BODY_RATIO); // 0 to 1

    if (inDowntrend) {
      // Doji at support after decline = bullish reversal
      const score = Math.round(60 + quality * 25); // 60–85
      return {
        score,
        confidence: 0.55 + quality * 0.3,
        reason: `Doji detected at support (body ${(bodyRatio * 100).toFixed(1)}% of range) after downtrend of ${Math.abs(priorTrend).toFixed(2)}. Bullish reversal signal.`,
      };
    } else {
      // Doji at resistance after rise = bearish (anti-long)
      const score = Math.round(15 + quality * 15); // 15–30
      return {
        score,
        confidence: 0.5 + quality * 0.2,
        reason: `Doji detected at resistance (body ${(bodyRatio * 100).toFixed(1)}% of range) after uptrend. Indecision — reduced long score.`,
      };
    }
  }
}
