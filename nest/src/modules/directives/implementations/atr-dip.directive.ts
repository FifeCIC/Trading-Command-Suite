/**
 * ATR Normalized Dip — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ==============================================================
 * BASE (0–60): Continuous mapping of dip depth in ATRs. 0 ATR→15, 1.3 ATR→60.
 * BONUS: Sweet spot 0.8-2.0 ATR → +25. Deep dip 2-3 ATR → +10 (higher risk).
 * MAX: 95.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const ATR_PERIOD = 14;
const LOOKBACK_HIGH = 20;
const MIN_BARS = ATR_PERIOD + LOOKBACK_HIGH;

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ This directive measures a dip as a fraction of ATR, so BOTH numbers are horizons: the ATR period
 * decides what "normal movement" means, and the lookback decides what "the recent high" is. On the
 * `noisy-range` fixture a 20-bar high is a different high from a 10-bar one, and ATR-14 against ATR-7
 * divides the same dip by a different denominator — the depth reading moves on unchanged price.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'atrPeriod',
    label: 'ATR period',
    type: 'number',
    default: ATR_PERIOD,
    min: 3,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): ATR is the denominator of every depth reading, so ATR-7 on a quiet series makes an ordinary dip look deep while ATR-28 makes the same dip look shallow. The tier changes on unchanged price.',
    source: 'atr-dip.directive.ts:13 ATR_PERIOD',
  },
  {
    key: 'lookbackHigh',
    label: 'Recent-high lookback',
    type: 'number',
    default: LOOKBACK_HIGH,
    min: 5,
    max: 120,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: the reference high is taken from this window, so widening it from 20 to 120 can turn "2% off the high" into "12% off the high" without any new bar — a different dip entirely.',
    source: 'atr-dip.directive.ts:14 LOOKBACK_HIGH',
  },
];

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class AtrDipDirective implements IDirective {
  readonly id = 'atr-dip';
  readonly name = 'ATR Normalized Dip';
  readonly description = 'Hybrid: continuous ATR-depth base + sweet-spot bonuses.';
  readonly category = 'ratio' as const;
  readonly priority = 70;
  readonly maxScore = 95;
  readonly minScore = 1;
  readonly minBars = { '1d': 34 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const atrPeriod = values.atrPeriod as number;
    const lookbackHigh = values.lookbackHigh as number;
    const { bars } = input;
    const requiredBars = Math.max(MIN_BARS, atrPeriod + lookbackHigh);
    if (bars.length < requiredBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${requiredBars} bars, have ${bars.length}.`, signalClass: 'neutral' };
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atrValues = atr(highs, lows, closes, atrPeriod);
    if (atrValues.length === 0) {
      return { score: 0, confidence: 0.1, reason: 'Could not compute ATR.', signalClass: 'neutral' };
    }
    const currentAtr = atrValues[atrValues.length - 1];
    const currentPrice = closes[closes.length - 1];
    const lookbackSlice = highs.slice(-lookbackHigh);
    const recentHigh = Math.max(...lookbackSlice);
    const dipAbsolute = recentHigh - currentPrice;

    if (dipAbsolute <= 0) {
      return { score: 15, confidence: 0.3, reason: `No dip: at or near recent high (${recentHigh.toFixed(2)}).` };
    }

    const dipInAtrs = currentAtr > 0 ? dipAbsolute / currentAtr : 0;

    // BASE (0–60): continuous mapping. 0 ATR→15, 1.3 ATR→60 (peak), 4 ATR→5.
    let baseScore: number;
    if (dipInAtrs <= 1.3) {
      baseScore = Math.round(mapRange(dipInAtrs, 0, 1.3, 15, 60));
    } else if (dipInAtrs <= 3) {
      baseScore = Math.round(mapRange(dipInAtrs, 1.3, 3, 60, 25));
    } else {
      baseScore = Math.round(mapRange(dipInAtrs, 3, 5, 25, 5));
    }

    // BONUS: sweet spot
    let bonusScore = 0;
    let bonusLabel = '';
    if (dipInAtrs >= 0.8 && dipInAtrs <= 2.0) { bonusScore = 25; bonusLabel = 'sweet spot (0.8-2.0 ATR)'; }
    else if (dipInAtrs > 2.0 && dipInAtrs <= 3.0) { bonusScore = 10; bonusLabel = 'extended dip (2-3 ATR)'; }

    const total = baseScore + bonusScore;
    const parts = [`base=${baseScore} (${dipInAtrs.toFixed(2)} ATR)`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);

    return {
      score: total,
      confidence: Number((dipInAtrs >= 0.8 && dipInAtrs <= 2.0 ? 0.7 : dipInAtrs > 2.0 ? 0.45 : 0.35).toFixed(2)),
      reason: `Dip: ${dipInAtrs.toFixed(2)} ATR from high ${recentHigh.toFixed(2)}. ${parts.join(' ')}=${total}/${this.maxScore}`,
      signalClass: total >= 60 ? 'bullish' : total >= 35 ? 'neutral' : 'bearish',
      metadata: { baseScore, bonusScore, bonusLabel, dipInAtrs, currentPrice, recentHigh },
    };
  }
}
