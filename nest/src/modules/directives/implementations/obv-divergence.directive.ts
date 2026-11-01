/**
 * OBV Divergence Scanner
 * ======================
 * Detects bullish divergence (price lower low, OBV higher low) and
 * bearish divergence (price higher high, OBV lower high).
 *
 * OBV (On-Balance Volume) divergence is considered the strongest
 * divergence signal because it incorporates volume — "smart money"
 * accumulation/distribution that contradicts price action.
 *
 * OBV divergence is rare but high-conviction when it appears.
 *
 * The swing and divergence ALGORITHM is imported from ../utils/divergence — ONE copy,
 * shared with macd- and rsi-divergence. Only the strength CALIBRATION stays local,
 * because OBV's scale is nothing like the other two (see STRENGTH_MODEL below).
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { obv } from '../utils/indicators';
import {
  checkBearishDivergence,
  checkBullishDivergence,
  computeDivergenceStrength,
  findSwingHighs,
  findSwingLows,
  type StrengthModel,
} from '../utils/divergence';
import { resolveParams, type NumericParamSpec } from '../parameters';

const SWING_LOOKBACK = 5;
const MIN_BARS = SWING_LOOKBACK * 3 + 5;

/**
 * ⚠️ OBV is CUMULATIVE VOLUME — it runs into the millions, and it can sit near zero,
 * which is why the floor is 1 rather than MACD's 0.0001. Dividing an OBV move by a
 * MACD-sized floor would make every divergence read as maximum strength, and dividing
 * by MACD's ratio when OBV crosses zero would produce an infinity.
 *
 * Carried across UNCHANGED from the local copy this file used to hold. Note this
 * differs from macd-divergence's model in ALL THREE constants — that is intentional
 * and was invisible while the two sat in separate files.
 */
const STRENGTH_MODEL: StrengthModel = {
  priceWeight: 2.5,
  indWeight: 2.0,
  indDenominator: (ind1) => Math.max(Math.abs(ind1), 1),
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
    why: 'Measured 2026-11-01 (#1166 method): a divergence compares two swings, so the lookback decides which swings exist and therefore which divergences are reported.',
    source: 'obv-divergence.directive.ts:SWING_LOOKBACK',
  },
];

@Injectable()
export class ObvDivergenceDirective implements IDirective {
  readonly id = 'obv-divergence';
  readonly name = 'OBV Divergence Scanner';
  readonly category = 'oscillator' as const;
  readonly description =
    'Detects bullish/bearish OBV (On-Balance Volume) divergence — price extremes not confirmed by volume flow. Strongest divergence signal — indicates smart money accumulation/distribution.';
  readonly priority = 86;
  readonly maxScore = 120;
  readonly minScore = 1;
  readonly minBars = { '1d': 20 };
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
    const volumes = input.bars.map((b) => b.volume);

    if (closes.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const obvValues = obv(closes, volumes);
    if (obvValues.length < swingLookback * 2 + 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Not enough OBV values.',
        signalClass: 'neutral',
      };
    }

    const getObv = (barIdx: number): number => {
      if (barIdx < 0 || barIdx >= obvValues.length)
        return obvValues[obvValues.length - 1];
      return obvValues[barIdx];
    };

    const swingLows = findSwingLows(lows, swingLookback, getObv);
    const swingHighs = findSwingHighs(highs, swingLookback, getObv);

    const bullDiv = checkBullishDivergence(swingLows);
    const bearDiv = checkBearishDivergence(swingHighs);

    if (bullDiv) {
      const strength = computeDivergenceStrength(bullDiv, STRENGTH_MODEL);
      const score = 70 + strength * 40;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.96, 0.65 + strength * 0.25),
        reason: `Bullish OBV divergence — SMART MONEY: price lower low (${bullDiv.price1.toFixed(2)}→${bullDiv.price2.toFixed(2)}) but OBV higher low (accumulation). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    }

    if (bearDiv) {
      const strength = computeDivergenceStrength(bearDiv, STRENGTH_MODEL);
      const score = 10 - strength * 8;
      return {
        score: Math.round(Math.max(score, 0)),
        confidence: Math.min(0.96, 0.65 + strength * 0.25),
        reason: `Bearish OBV divergence — DISTRIBUTION: price higher high (${bearDiv.price1.toFixed(2)}→${bearDiv.price2.toFixed(2)}) but OBV lower high (selling into strength). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bearish',
      };
    }

    return {
      score: 25,
      confidence: 0.25,
      reason: 'No OBV divergence detected.',
      signalClass: 'neutral',
    };
  }
}
// The swing/divergence algorithm that used to live here is now ONE copy in
// ../utils/divergence, imported above — it was byte-identical to the other two
// directives' copies apart from identifier names and brace placement.
