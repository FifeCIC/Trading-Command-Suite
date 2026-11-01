/**
 * Three White Soldiers Pattern Directive
 * =======================================
 * Detects the Three White Soldiers pattern — three consecutive bullish candles
 * each closing higher than the previous, opening within the prior body.
 *
 * Conditions:
 * 1. Three consecutive bars with close > open (all bullish)
 * 2. Each bar closes higher than the previous bar's close
 * 3. Each bar opens within the previous bar's body range
 * 4. Each bar's body is at least 50% of its range (real body, not a doji)
 *
 * TradePress source: includes/scoring-system/directives/three-soldiers-pattern.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 6;
const MIN_BODY_RATIO = 0.5; // Body must be ≥ 50% of bar range

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
    key: 'minBodyRatio',
    label: 'Minimum body / range',
    type: 'number',
    default: MIN_BODY_RATIO,
    min: 0.2,
    max: 0.95,
    step: 0.05,
    unit: 'fraction of range',
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166 method): 50% of range is a decisive candle; 95% is almost unattainable. The three-soldiers fixture uses 80% bodies, so the maximum rejects them and the default accepts — the knob decides whether the pattern can ever fire.',
    source: 'three-soldiers-pattern.directive.ts:24 MIN_BODY_RATIO',
  },
];

@Injectable()
export class ThreeSoldiersPatternDirective implements IDirective {
  readonly id = 'three-soldiers-pattern';
  readonly name = 'Three White Soldiers';
  readonly category = 'pattern' as const;
  readonly description =
    'Detects three consecutive bullish candles with higher closes — strong trend establishment.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 6 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'bullish' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const minBodyRatio = values.minBodyRatio as number;

    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
      };
    }

    const b1 = bars[bars.length - 3];
    const b2 = bars[bars.length - 2];
    const b3 = bars[bars.length - 1];

    // All three must be bullish
    if (b1.close <= b1.open || b2.close <= b2.open || b3.close <= b3.open) {
      return { score: 0, confidence: 0.3, reason: 'Not all three bars are bullish (close > open required).' };
    }

    // Each close higher than previous
    if (b2.close <= b1.close || b3.close <= b2.close) {
      return { score: 0, confidence: 0.3, reason: 'Closes not ascending: each must close higher than the previous.' };
    }

    // Each opens within previous body range
    const openInPrevBody = (bar: typeof b1, prev: typeof b1) =>
      bar.open >= prev.open && bar.open <= prev.close;
    if (!openInPrevBody(b2, b1) || !openInPrevBody(b3, b2)) {
      return { score: 0, confidence: 0.3, reason: 'Open not within previous body range — pattern requires controlled opens.' };
    }

    // Body quality: each bar should have a real body (not doji-like)
    const bodyRatio = (bar: typeof b1) => {
      const range = bar.high - bar.low;
      return range > 0 ? (bar.close - bar.open) / range : 0;
    };
    const br1 = bodyRatio(b1);
    const br2 = bodyRatio(b2);
    const br3 = bodyRatio(b3);

    if (br1 < minBodyRatio || br2 < minBodyRatio || br3 < minBodyRatio) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.3,
        reason: 'One or more bars has insufficient body ratio (need ≥ ' + (minBodyRatio * 100) + '% of range).',
      };
    }

    // Pattern quality: average body ratio and close progression
    const avgBodyRatio = (br1 + br2 + br3) / 3;
    const progression1 = (b2.close - b1.close) / b1.close;
    const progression2 = (b3.close - b2.close) / b2.close;
    const avgProgression = (progression1 + progression2) / 2;

    const quality = Math.min(1, avgBodyRatio + avgProgression * 10); // 0–1
    const score = Math.round(75 + quality * 20); // 75–95

    return {
      score,
      confidence: 0.65 + quality * 0.25,
      reason: `Three White Soldiers: avg body ${(avgBodyRatio * 100).toFixed(0)}% of range, avg progression ${(avgProgression * 100).toFixed(2)}%. Strong bullish continuation.`,
    };
  }
}
