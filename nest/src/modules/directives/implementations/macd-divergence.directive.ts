/**
 * MACD Divergence Scanner
 * ========================
 * Detects bullish divergence (price lower low, MACD histogram higher low)
 * and bearish divergence (price higher high, MACD histogram lower high).
 *
 * The swing and divergence ALGORITHM is imported from ../utils/divergence — ONE copy,
 * shared with obv- and rsi-divergence. Only the strength CALIBRATION stays local,
 * because the three indicators live on different scales.
 *
 * ⚠️ Before 2026-09-21 this file held its own copy of the algorithm while its header
 * claimed it used the shared utilities from rsi-divergence. It did not. Three copies
 * of a scoring path is how a fix lands in one of them.
 *
 * MACD divergence is considered stronger than RSI divergence because
 * MACD incorporates both trend and momentum.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { macd } from '../utils/indicators';
import {
  checkBearishDivergence,
  checkBullishDivergence,
  computeDivergenceStrength,
  findSwingHighs,
  findSwingLows,
  type StrengthModel,
} from '../utils/divergence';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const SWING_LOOKBACK = 5;
const MIN_BARS = MACD_SLOW + MACD_SIGNAL + SWING_LOOKBACK * 3 + 2;

/**
 * MACD histogram runs ~1e-3 to 1e-2, so the indicator denominator needs a floor far
 * below that or the ratio explodes and every divergence reads as maximum strength.
 * Carried across UNCHANGED from the local copy this file used to hold: an extraction
 * that also recalibrates the formula would be a scoring change wearing a refactor's
 * clothes.
 */
const STRENGTH_MODEL: StrengthModel = {
  priceWeight: 3,
  indWeight: 1.5,
  indDenominator: (ind1) => Math.max(Math.abs(ind1), 0.0001),
};

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
    key: 'swingLookback',
    label: 'Swing lookback',
    type: 'number',
    default: SWING_LOOKBACK,
    min: 2,
    max: 20,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): a divergence compares TWO swings, so this decides which swings exist. 2 counts minor pullbacks; 20 only major turns.',
    source: 'macd-divergence.directive.ts:SWING_LOOKBACK',
  },
];

@Injectable()
export class MacdDivergenceDirective implements IDirective {
  readonly id = 'macd-divergence';
  readonly name = 'MACD Divergence Scanner';
  readonly category = 'oscillator' as const;
  readonly description =
    'Detects bullish/bearish MACD histogram divergence — price making new extremes while MACD momentum fails to confirm. Stronger than RSI divergence.';
  readonly priority = 84;
  readonly maxScore = 105;
  readonly minScore = 1;
  readonly minBars = { '1d': 52 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const swingLookback = values.swingLookback as number;

    const closes = input.bars.map((b) => b.close);
    const lows = input.bars.map((b) => b.low);
    const highs = input.bars.map((b) => b.high);

    if (closes.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const macdResult = macd(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
    if (macdResult.histogram.length < swingLookback * 2 + 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Not enough MACD histogram values.',
        signalClass: 'neutral',
      };
    }

    // Align histogram with price bars
    const histOffset = closes.length - macdResult.histogram.length;
    const getHist = (barIdx: number): number => {
      const hIdx = barIdx - histOffset;
      if (hIdx < 0 || hIdx >= macdResult.histogram.length) return 0;
      return macdResult.histogram[hIdx];
    };

    const swingLows = findSwingLows(lows, swingLookback, getHist);
    const swingHighs = findSwingHighs(highs, swingLookback, getHist);

    const bullDiv = checkBullishDivergence(swingLows);
    const bearDiv = checkBearishDivergence(swingHighs);

    if (bullDiv) {
      const strength = computeDivergenceStrength(bullDiv, STRENGTH_MODEL);
      const score = 65 + strength * 40;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.94, 0.6 + strength * 0.28),
        reason: `Bullish MACD divergence: price lower low (${bullDiv.price1.toFixed(2)}→${bullDiv.price2.toFixed(2)}) but MACD histogram higher low (${bullDiv.ind1.toFixed(4)}→${bullDiv.ind2.toFixed(4)}). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    }

    if (bearDiv) {
      const strength = computeDivergenceStrength(bearDiv, STRENGTH_MODEL);
      const score = 12 - strength * 10;
      return {
        score: Math.round(Math.max(score, 0)),
        confidence: Math.min(0.94, 0.6 + strength * 0.28),
        reason: `Bearish MACD divergence: price higher high (${bearDiv.price1.toFixed(2)}→${bearDiv.price2.toFixed(2)}) but MACD histogram lower high (${bearDiv.ind1.toFixed(4)}→${bearDiv.ind2.toFixed(4)}). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bearish',
      };
    }

    const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
    return {
      score: lastHist > 0 ? 30 : 20,
      confidence: 0.3,
      reason: `No MACD divergence. Histogram: ${lastHist.toFixed(4)}.`,
      signalClass: 'neutral',
    };
  }
}

// The swing/divergence algorithm that used to live here is now ONE copy in
// ../utils/divergence, imported above. It was byte-identical to obv- and
// rsi-divergence's copies apart from identifier names and brace placement, and it is
// the kind of code where a fix in one copy silently misses the other two.
