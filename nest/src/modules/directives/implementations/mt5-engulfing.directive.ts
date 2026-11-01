/**
 * MT5 Engulfing Directive
 * =======================
 * Ported from MetaQuotes MT5 Free Robots — CAD-focused / BullishBearish Engulfing RSI.
 *
 * Pattern: 2-candle bullish/bearish engulfing with RSI(37) confirmation.
 * Source: MT5 Experts/Free Robots/
 *
 * Rules (Bullish Engulfing):
 * - Candle[1] is bearish: open > close
 * - Candle[0] body > average body over 12 periods
 * - Candle[0].close > Candle[1].open (engulfs)
 * - Midpoint[1] < average close (downtrend context)
 * - Candle[0].open < Candle[1].close
 *
 * Confirmation: RSI(37) < 40 for buy, RSI(37) > 60 for sell
 * Pattern detected but unconfirmed → score 30 (weak)
 * Pattern detected AND confirmed → score 85
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi, ema } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 14;
const RSI_PERIOD = 37;
const BODY_AVG_PERIOD = 12;

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
    why: 'Measured 2026-11-01 (#1166 method): the RSI is a CONFIRMATION filter on top of the candle shape, so its period decides whether a well-formed pattern is allowed through. Note the default is 37, not the conventional 14 — that is this port\'s own calibration.',
    source: 'mt5-engulfing.directive.ts:26 RSI_PERIOD',
  },
  {
    key: 'bodyAvgPeriod',
    label: 'Body average period',
    type: 'number',
    default: BODY_AVG_PERIOD,
    min: 3,
    max: 40,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01: "the body is larger than average" is the size test, and this window defines average. A 12-bar average on a quiet stretch makes an ordinary body look decisive.',
    source: 'mt5-engulfing.directive.ts:27 BODY_AVG_PERIOD',
  },
];

@Injectable()
export class Mt5EngulfingDirective implements IDirective {
  readonly id = 'mt5-engulfing';
  readonly name = 'MT5 Engulfing Pattern (with RSI confirmation)';
  readonly category = 'pattern' as const;
  readonly description = 'MT5-sourced engulfing pattern with RSI(37) confirmation. Proven 2-candle reversal logic from MetaQuotes Free Robots.';
  readonly priority = 55;
  // ⚠️ maxScore corrected 100 → 85 (2026-10-20, #1131). MODE 9 measured
  // the highest score this directive's own return arithmetic can produce as 85;
  // the extra 15 points were permanent, unearnable capacity in every
  // protocol denominator. See node nest/scripts/directive-guard.cjs (MODE 9).
  readonly maxScore = 85;
  readonly minScore = 1;
  readonly minBars = { '1d': 14 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const bodyAvgPeriod = values.bodyAvgPeriod as number;

    const { bars, symbol } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, rsiPeriod);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    const prev = bars[bars.length - 2];
    const curr = bars[bars.length - 1];

    const prevBody = prev.close - prev.open;
    const currBody = curr.close - curr.open;
    const prevBearish = prevBody < 0;
    const currBullish = currBody > 0;
    const prevBullish = prevBody > 0;
    const currBearish = currBody < 0;

    // Average body size over bodyAvgPeriod
    const recentBodies = bars.slice(-bodyAvgPeriod).map((b) => Math.abs(b.close - b.open));
    const avgBody = recentBodies.reduce((s, v) => s + v, 0) / recentBodies.length;

    // Downtrend context: midpoint of prev candle < average close over recent period
    const avgClose = closes.slice(-10).reduce((s, v) => s + v, 0) / Math.min(10, closes.length);
    const prevMidpoint = (prev.high + prev.low) / 2;

    // ─── Bullish Engulfing ───────────────────────────────
    if (prevBearish && currBullish && Math.abs(currBody) > avgBody) {
      const engulfs = curr.close > prev.open && curr.open < prev.close;
      const inDowntrend = prevMidpoint < avgClose;
      const confirmed = latestRsi < 40;

      if (engulfs && inDowntrend && confirmed) {
        return {
          score: 85,
          confidence: 0.75,
          reason: `MT5: Bullish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      if (engulfs && inDowntrend) {
        return {
          score: 30,
          confidence: 0.3,
          reason: `MT5: Bullish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed — need RSI < 40)`,
          signalClass: 'neutral',
        };
      }
    }

    // ─── Bearish Engulfing ───────────────────────────────
    if (prevBullish && currBearish && Math.abs(currBody) > avgBody) {
      const engulfs = curr.close < prev.open && curr.open > prev.close;
      const inUptrend = prevMidpoint > avgClose;
      const confirmed = latestRsi > 60;

      if (engulfs && inUptrend && confirmed) {
        return {
          score: 85,
          confidence: 0.75,
          reason: `MT5: Bearish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      if (engulfs && inUptrend) {
        return {
          score: 30,
          confidence: 0.3,
          reason: `MT5: Bearish Engulfing at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed — need RSI > 60)`,
          signalClass: 'neutral',
        };
      }
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No engulfing pattern at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
