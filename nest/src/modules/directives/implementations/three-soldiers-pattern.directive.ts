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

const MIN_BARS = 6;
const MIN_BODY_RATIO = 0.5; // Body must be ≥ 50% of bar range

@Injectable()
export class ThreeSoldiersPatternDirective implements IDirective {
  readonly id = 'three-soldiers-pattern';
  readonly name = 'Three White Soldiers';
  readonly description =
    'Detects three consecutive bullish candles with higher closes — strong trend establishment.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 6 };
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

    if (br1 < MIN_BODY_RATIO || br2 < MIN_BODY_RATIO || br3 < MIN_BODY_RATIO) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.3,
        reason: 'One or more bars has insufficient body ratio (need ≥ ' + (MIN_BODY_RATIO * 100) + '% of range).',
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
