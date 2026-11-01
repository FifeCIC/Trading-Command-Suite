/**
 * Range Contraction
 * =================
 * Detects compression/consolidation zones.
 * "The longer the compression, the bigger the breakout."
 *
 * Maturity grading: how long has price been compressing?
 * Score increases as contraction matures (coiled spring effect).
 * Breakout direction bias based on preceding trend.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 30;
const CONTRACTION_LOOKBACK = 20;
const RANGE_RATIO_THRESHOLD = 0.7; // Current range < 70% of max = contraction

/**
 * Tunable knobs (#1165). Every default IS the module constant, so an instance that supplies nothing
 * scores byte-identically — asserted by the BASELINE guard in `directive-parameters.spec.ts`.
 *
 * ⚠️ Each `why` states the MEASUREMENT that makes the knob worth turning. A period is a HORIZON and a
 * threshold is a DEFINITION, not a preference: the same number means different things on a 1h chart and
 * a daily one, which is exactly why it cannot stay a constant.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'contractionLookback',
    label: 'Contraction lookback',
    type: 'number',
    default: CONTRACTION_LOOKBACK,
    min: 5,
    max: 120,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): contraction is this window against the prior one, so it sets the timescale of the squeeze.',
    source: 'range-contraction.directive.ts:CONTRACTION_LOOKBACK',
  },
  {
    key: 'rangeRatioThreshold',
    label: 'Contraction ratio',
    type: 'number',
    default: RANGE_RATIO_THRESHOLD,
    min: 0.2,
    max: 0.95,
    step: 0.05,
    unit: 'ratio of prior range',
    chart: 'threshold',
    why: 'Measured 2026-11-01: 0.7 means "30% tighter than before" — a real threshold a user would want to move. At 0.2 only a near-collapse qualifies.',
    source: 'range-contraction.directive.ts:RANGE_RATIO_THRESHOLD',
  },
];

@Injectable()
export class RangeContractionDirective implements IDirective {
  readonly id = 'range-contraction';
  readonly name = 'Range Contraction';
  readonly category = 'pattern' as const;
  readonly description =
    'Detects compression zones. Maturity grading for coiled-spring breakout signals.';
  readonly priority = 58;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 30 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const contractionLookback = values.contractionLookback as number;
    const rangeRatioThreshold = values.rangeRatioThreshold as number;

    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-contractionLookback);
    const ranges = recentBars.map((b) => (b.high - b.low) / b.close);

    const maxRange = Math.max(...ranges);
    const minRange = Math.min(...ranges);
    const currentRange = ranges[ranges.length - 1];
    if (maxRange === 0) {
      return { score: 0, confidence: 0.2, reason: 'Zero range — no tradable movement.', signalClass: 'neutral' };
    }

    const contractionRatio = currentRange / maxRange;
    const isContracting = contractionRatio < rangeRatioThreshold;

    if (!isContracting) {
      const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
      const volatility = avgRange * 10000;
      return {
        score: 10,
        confidence: 0.3,
        reason: `No contraction detected. Current range is ${(contractionRatio * 100).toFixed(0)}% of max. Normal volatility (${volatility.toFixed(0)}bps).`,
        signalClass: 'neutral',
      };
    }

    // How long has the contraction persisted?
    let consecutiveContractions = 0;
    for (let i = ranges.length - 1; i >= 0; i--) {
      if (ranges[i] / maxRange < rangeRatioThreshold) {
        consecutiveContractions++;
      } else {
        break;
      }
    }

    // Determine breakout direction bias from preceding trend
    const olderBars = bars.slice(-50, -contractionLookback);
    let trendBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    if (olderBars.length >= 10) {
      const olderCloses = olderBars.map((b) => b.close);
      const olderStart = olderCloses[0];
      const olderEnd = olderCloses[olderCloses.length - 1];
      trendBias = olderEnd > olderStart ? 'bullish' : 'bearish';
    }

    // Maturity score: longer contraction = higher potential energy
    const maturity = Math.min(1, consecutiveContractions / 15);
    const contractionDepth = 1 - contractionRatio; // 1 = fully compressed, 0 = no compression

    const score = 30 + maturity * 40 + contractionDepth * 30;
    const signalClass = trendBias;

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.8, 0.3 + maturity * 0.5).toFixed(2)),
      reason: `Range contracted to ${(contractionRatio * 100).toFixed(0)}% of max. ${consecutiveContractions} bars compressing. Maturity: ${(maturity * 100).toFixed(0)}%. ${trendBias === 'bullish' ? 'Upward' : 'Downward'} breakout bias.`,
      signalClass,
    };
  }
}



