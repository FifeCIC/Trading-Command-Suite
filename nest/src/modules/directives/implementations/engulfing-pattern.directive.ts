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
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 5;
const ENGULF_RATIO_MIN = 1.05; // Body must be at least 5% larger to "engulf"

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
    key: 'engulfRatioMin',
    label: 'Minimum engulf ratio',
    type: 'number',
    default: ENGULF_RATIO_MIN,
    min: 1,
    max: 6,
    step: 0.05,
    unit: '× prior body',
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166 method): 1.05 accepts a candle barely larger than the one it engulfs; 2.0 demands real conviction. The engulfing-bar fixture measures 2.4×, so the maximum rejects it and the default accepts it.',
    source: 'engulfing-pattern.directive.ts:23 ENGULF_RATIO_MIN',
  },
];

@Injectable()
export class EngulfingPatternDirective implements IDirective {
  readonly id = 'engulfing-pattern';
  readonly name = 'Engulfing Pattern';
  readonly description =
    'Detects bullish/bearish engulfing reversal structures over two bars.';

  readonly priority = 50;
  readonly maxScore = 95;
  readonly minScore = 1;
  readonly minBars = { '1d': 5 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly category = 'pattern' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const engulfRatioMin = values.engulfRatioMin as number;

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
    // ⚠️ `engulfRatioMin` IS ENFORCED HERE FROM 2026-11-01 — it was declared (`engulfRatioMin`,
    // commented "Body must be at least 5% larger to engulf") but the branch only tested CONTAINMENT,
    // so the rule was never applied and the constant was dead. That is why the parameter measured as
    // inert. Enforcing it is a BUG FIX restoring the documented intent, and it can only reject a
    // candle whose body is within 5% of the one it engulfs — which containment alone already let
    // through as a "strong reversal signal".
    if (prevBearish && currBullish) {
      const engulfed = curr.open <= prev.close && curr.close >= prev.open;
      const engulfRatio = Math.abs(currBody / prevBody);
      if (engulfed && engulfRatio >= engulfRatioMin) {
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
      const engulfRatio = Math.abs(currBody / prevBody);
      // Same enforcement as the bullish branch: the declared ratio rule applies to BOTH directions.
      if (engulfed && engulfRatio >= engulfRatioMin) {
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
