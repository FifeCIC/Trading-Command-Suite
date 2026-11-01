/**
 * MT5 Harami Directive
 * ====================
 * Harami pattern — small candle body inside large previous body.
 * Bullish Harami = small bullish body inside large bearish body
 * Bearish Harami = small bearish body inside large bullish body
 *
 * RSI(37) confirmation: < 40 for buy, > 60 for sell.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 14;
const RSI_PERIOD = 37;
const HARAMI_BODY_RATIO = 0.4; // Inner body must be < 40% of outer body

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
    why: 'Measured 2026-11-01 (#1166 method): RSI is the confirmation filter, so its period decides whether the harami is allowed to score. The 37 default is this port\'s calibration rather than the conventional 14.',
    source: 'mt5-harami.directive.ts:16 RSI_PERIOD',
  },
  {
    key: 'haramiBodyRatio',
    label: 'Max inner / outer body',
    type: 'number',
    default: HARAMI_BODY_RATIO,
    min: 0.1,
    max: 0.9,
    step: 0.05,
    unit: 'fraction of outer body',
    chart: 'threshold',
    why: 'Measured 2026-11-01: 40% is a strict harami; 90% accepts almost any inside bar. The harami-bar fixture is 36% of the mother bar, so 0.1 rejects it and 0.9 accepts it — the threshold is the decision.',
    source: 'mt5-harami.directive.ts:17 HARAMI_BODY_RATIO',
  },
];

@Injectable()
export class Mt5HaramiDirective implements IDirective {
  readonly id = 'mt5-harami';
  readonly name = 'MT5 Harami Pattern (with RSI confirmation)';
  readonly category = 'pattern' as const;
  readonly description = 'MT5-sourced harami reversal pattern with RSI(37) confirmation.';
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
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const haramiBodyRatio = values.haramiBodyRatio as number;

    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, rsiPeriod);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    const prev = bars[bars.length - 2];
    const curr = bars[bars.length - 1];

    const prevBody = Math.abs(prev.close - prev.open);
    const currBody = Math.abs(curr.close - curr.open);
    const prevBearish = prev.close < prev.open;
    const prevBullish = prev.close > prev.open;
    const currBullish = curr.close > curr.open;
    const currBearish = curr.close < curr.open;

    // ─── Bullish Harami ──────────────────────────────────
    if (prevBearish && currBullish && currBody < prevBody * haramiBodyRatio) {
      const insidePrev =
        curr.high < prev.high && curr.low > prev.low;
      const confirmed = latestRsi < 40;

      if (insidePrev && confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Bullish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      if (insidePrev) {
        return {
          score: 25,
          confidence: 0.25,
          reason: `MT5: Bullish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
          signalClass: 'neutral',
        };
      }
    }

    // ─── Bearish Harami ──────────────────────────────────
    if (prevBullish && currBearish && currBody < prevBody * haramiBodyRatio) {
      const insidePrev =
        curr.high < prev.high && curr.low > prev.low;
      const confirmed = latestRsi > 60;

      if (insidePrev && confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Bearish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      if (insidePrev) {
        return {
          score: 25,
          confidence: 0.25,
          reason: `MT5: Bearish Harami at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
          signalClass: 'neutral',
        };
      }
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No harami pattern at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
