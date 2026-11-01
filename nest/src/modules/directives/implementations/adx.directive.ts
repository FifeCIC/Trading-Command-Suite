/**
 * ADX — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ================================================
 * BASE (0–60): Continuous ADX: 0→0, 25→40, 50+→60. Every tick.
 * BONUS: ADX > 40 → +20 (very strong trend), +DI spread > 20 → +15.
 * MAX: 100.
 * Category: oscillator — ADX has bounded 0–100 scale.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { adx } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const ADX_PERIOD = 14;
const TREND_LEVEL = 25;

/**
 * The strong-trend tier is a FRACTION of the trend level, not a second constant, so the ladder stays
 * ordered under a tunable gate. At the production level of 25 it resolves to 40 (25 × 8/5) — identical
 * to the pre-parameter scoring, pinned by `directive-parameters.spec.ts`.
 */
const STRONG_FRACTION = 8 / 5;

const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'adxPeriod',
    label: 'ADX period',
    type: 'number',
    default: ADX_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166): ADX-14 and ADX-7 shared ZERO entry triggers on VIX 1h, SPY 1h, VIX 1d, NVDA 1d and SPY 1d — 18 vs 40 events on VIX 1h, none coincident. The highest-value period knob in the library.',
    source: 'adx.directive.ts:14 ADX_PERIOD',
  },
  {
    key: 'trendLevel',
    label: 'Trending level',
    type: 'number',
    default: TREND_LEVEL,
    min: 10,
    max: 50,
    step: 1,
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166): the fixed 25 gate fired 1-2 times over 9 months of daily bars. A trend gate calibrated for one instrument leaves a directive dormant on another.',
    source: 'adx.directive.ts:103 trend gate (was `currentAdx > 25`)',
  },
];

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class AdxDirective implements IDirective {
  readonly id = 'adx';
  readonly name = 'Average Directional Index';
  readonly description = 'Hybrid: continuous ADX base + trend strength bonuses.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 19 };
  readonly version = '2.0.1';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const adxPeriod = values.adxPeriod as number;
    const trendLevel = values.trendLevel as number;
    const strongLevel = trendLevel * STRONG_FRACTION;
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    if (closes.length < adxPeriod + 5) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${adxPeriod + 5} bars, have ${closes.length}.` };
    }
    const { adx: adxValues, plusDi, minusDi } = adx(highs, lows, closes, adxPeriod);
    if (adxValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough ADX values.' };
    }
    const currentAdx = adxValues[adxValues.length - 1];
    const prevAdx = adxValues[adxValues.length - 2];
    const currentPlusDi = plusDi[plusDi.length - 1];
    const currentMinusDi = minusDi[minusDi.length - 1];
    const adxRising = currentAdx > prevAdx;
    const bullishBias = currentPlusDi > currentMinusDi;
    const diSpread = Math.abs(currentPlusDi - currentMinusDi);

    // BASE (0–60): ADX strength → score. Ranging(0-20)→0-20, Trending(25+)→40-60.
    const baseScore = Math.round(mapRange(currentAdx, 0, 50, 0, 60));

    // BONUS tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentAdx > strongLevel) { bonusScore = 20; bonusLabel = 'very strong trend (ADX>40)'; }
    if (diSpread > 20 && bullishBias) { bonusScore += 15; bonusLabel += (bonusLabel ? ' + ' : '') + 'wide DI spread'; }
    if (adxRising && currentAdx > trendLevel) { bonusScore += 5; }

    const total = Math.min(this.maxScore, baseScore + bonusScore);
    const parts = [`base=${baseScore} (ADX ${currentAdx.toFixed(1)})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus`);

    return {
      signalClass: bullishBias && total >= 50 ? 'bullish' : total >= 40 ? 'neutral' : 'bearish',
      score: total,
      confidence: Number((currentAdx > trendLevel ? 0.5 + (currentAdx / 50) * 0.3 : 0.25 + (currentAdx / trendLevel) * 0.15).toFixed(2)),
      reason: `ADX=${currentAdx.toFixed(1)} ${adxRising ? '↗' : '↘'} +DI=${currentPlusDi.toFixed(1)} -DI=${currentMinusDi.toFixed(1)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, currentAdx, bullishBias, diSpread },
    };
  }
}
