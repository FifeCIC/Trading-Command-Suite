/**
 * MT5 Hammer/Shooting Star Directive
 * ===================================
 * Hammer = small body at top, long lower wick (2x+ body), at support
 * Shooting Star = small body at bottom, long upper wick (2x+ body), at resistance
 *
 * Confirmation: RSI(37) < 40 for buy, > 60 for sell
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 14;
const RSI_PERIOD = 37;
const WICK_BODY_RATIO = 2; // Wick must be 2x body size
const BODY_RANGE_RATIO = 0.35; // Body < 35% of total range

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
    key: 'rsiPeriod',
    label: 'RSI confirmation period',
    type: 'number',
    default: RSI_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): RSI is the confirmation filter on top of the candle shape, so its period decides whether a valid hammer is allowed through. The 37 default is this port\'s calibration.',
    source: 'mt5-hammer.directive.ts:15 RSI_PERIOD',
  },
  {
    key: 'wickBodyRatio',
    label: 'Wick / body ratio',
    type: 'number',
    default: WICK_BODY_RATIO,
    min: 1,
    max: 6,
    step: 0.5,
    unit: '×',
    chart: 'threshold',
    why: 'Measured 2026-11-01: 2× is the classic rejection definition; 6× is an extreme. The reversal-hammer fixture has a 3× wick, so 1× accepts it with a higher quality score and 6× rejects it.',
    source: 'mt5-hammer.directive.ts:16 WICK_BODY_RATIO',
  },
  {
    key: 'bodyRangeRatio',
    label: 'Max body / range',
    type: 'number',
    default: BODY_RANGE_RATIO,
    min: 0.1,
    max: 0.8,
    step: 0.05,
    unit: 'fraction of range',
    chart: 'threshold',
    why: 'Measured 2026-11-01: a hammer needs a SMALL body in a long range. At 0.8 a large-bodied candle qualifies and the pattern no longer means rejection; the knob is what keeps the shape meaningful.',
    source: 'mt5-hammer.directive.ts:17 BODY_RANGE_RATIO',
  },
];

@Injectable()
export class Mt5HammerDirective implements IDirective {
  readonly id = 'mt5-hammer';
  readonly name = 'MT5 Hammer/Shooting Star (with RSI confirmation)';
  readonly category = 'pattern' as const;
  readonly description = 'MT5-sourced hammer and shooting star reversal patterns with RSI(37) confirmation.';
  readonly priority = 50;
  // ⚠️ maxScore corrected 100 → 80 (2026-10-20, #1131). MODE 9 measured
  // the highest score this directive's own return arithmetic can produce as 80;
  // the extra 20 points were permanent, unearnable capacity in every
  // protocol denominator. See node nest/scripts/directive-guard.cjs (MODE 9).
  readonly maxScore = 80;
  readonly minScore = 1;
  readonly minBars = { '1d': 14 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const; // Dynamic two-sided evidence (2026-09-08)

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const wickBodyRatio = values.wickBodyRatio as number;
    const bodyRangeRatio = values.bodyRangeRatio as number;

    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, rsiPeriod);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    const curr = bars[bars.length - 1];
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range === 0) return { score: 0, confidence: 0.2, reason: 'No range on current candle.', signalClass: 'neutral' };

    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const bodyRatio = body / range;

    // Must be a small body candle
    if (bodyRatio > bodyRangeRatio) {
      return { score: 0, confidence: 0.2, reason: `MT5: Body too large for hammer at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
    }

    // ─── Hammer (bullish) ─────────────────────────────────
    // Small body at top, long lower wick, at support
    if (lowerWick > body * wickBodyRatio && upperWick < body * 0.5) {
      const confirmed = latestRsi < 40;

      if (confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Hammer at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      return {
        score: 25,
        confidence: 0.25,
        reason: `MT5: Hammer at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
        signalClass: 'neutral',
      };
    }

    // ─── Shooting Star (bearish) ──────────────────────────
    // Small body at bottom, long upper wick, at resistance
    if (upperWick > body * wickBodyRatio && lowerWick < body * 0.5) {
      const confirmed = latestRsi > 60;

      if (confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Shooting Star at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      return {
        score: 25,
        confidence: 0.25,
        reason: `MT5: Shooting Star at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
        signalClass: 'neutral',
      };
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No hammer/shooting star at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
