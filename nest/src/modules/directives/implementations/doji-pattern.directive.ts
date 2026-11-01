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
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 6; // Need context bars for trend detection
const DOJI_BODY_RATIO = 0.10; // Body must be < 10% of total range
const TREND_LOOKBACK = 5; // Bars to determine prior trend

/**
 * Tunable knobs (#1165). Every default IS the module constant of the same value, so an instance that
 * supplies nothing scores byte-identically — asserted by the BASELINE guard, not merely stated here.
 *
 * ⚠️ A candlestick parameter is a THRESHOLD ON GEOMETRY. It is only provable against a candle that
 * sits near the boundary, which is why 'directive-fixtures.ts' carries explicitly shaped bars
 * (doji-bar, engulfing-bar, harami-bar, three-soldiers, reversal-hammer) rather than more smooth
 * series: on a uniform-geometry fixture every threshold value gives the same answer.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'dojiBodyRatio',
    label: 'Max body / range',
    type: 'number',
    default: DOJI_BODY_RATIO,
    min: 0.02,
    max: 0.5,
    step: 0.01,
    unit: 'fraction of range',
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166 method): 10% of range is a textbook doji on a daily chart and almost never happens on 1m bars, where noise alone exceeds it. The doji-bar fixture sits on the boundary, so the threshold decides whether the pattern is detected at all.',
    source: 'doji-pattern.directive.ts:21 DOJI_BODY_RATIO',
  },
  {
    key: 'trendLookback',
    label: 'Trend lookback',
    type: 'number',
    default: TREND_LOOKBACK,
    min: 2,
    max: 30,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: the prior trend decides whether a doji is read as indecision or exhaustion, and this window IS that trend. On the doji-bar fixture a 2-bar lookback reads the run-up while 20 reads the decline.',
    source: 'doji-pattern.directive.ts:22 TREND_LOOKBACK',
  },
];

@Injectable()
export class DojiPatternDirective implements IDirective {
  readonly id = 'doji-pattern';
  readonly name = 'Doji Pattern';
  readonly description =
    'Detects indecision candles where open and close are nearly equal. Scores bullish at support, bearish at resistance.';

  readonly priority = 50;
  readonly maxScore = 85;
  readonly minScore = 1;
  readonly minBars = { '1d': 6 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly category = 'pattern' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const dojiBodyRatio = values.dojiBodyRatio as number;
    const trendLookback = values.trendLookback as number;

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
    if (bodyRatio >= dojiBodyRatio) {
      return { score: 0, confidence: 0.2, reason: 'No Doji pattern: body is ' + (bodyRatio * 100).toFixed(1) + '% of range (threshold <10%).' };
    }

    // Determine prior trend using lookback closes
    const lookbackStart = bars[bars.length - 1 - trendLookback];
    const recentCloses = bars.slice(-trendLookback).map(b => b.close);
    const avgClose = recentCloses.reduce((a, b) => a + b, 0) / recentCloses.length;
    const priorTrend = current.close - lookbackStart.close;
    const inDowntrend = priorTrend < 0;

    // Doji quality: smaller body = stronger signal
    const quality = 1 - (bodyRatio / dojiBodyRatio); // 0 to 1

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
