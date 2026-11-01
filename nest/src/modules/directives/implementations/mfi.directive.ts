/**
 * MFI — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ================================================
 * Volume-weighted RSI. BASE: continuous MFI 80→0, MFI 20→50.
 * BONUS: MFI < 20 → +30, MFI < 10 → +50.
 * MAX: 100.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { mfi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MFI_PERIOD = 14;
const OVERSOLD_LEVEL = 20;

/**
 * The deep tier is HALF the oversold level, not a second constant, so the ladder stays ordered when
 * the gate is tuned. At the production level of 20 that resolves to 10 - identical to the pre-parameter
 * scoring.
 */
const DEEP_FRACTION = 1 / 2;

const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'mfiPeriod',
    label: 'MFI period',
    type: 'number',
    default: MFI_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166): MFI-14 vs MFI-7 shared 18.8% of entry events on VIX 1h, and MFI-21/MFI-28 fired NOTHING, so the period decides whether the gate trips at all.',
    source: 'mfi.directive.ts:13 MFI_PERIOD',
  },
  {
    key: 'oversoldLevel',
    label: 'Oversold level',
    type: 'number',
    default: OVERSOLD_LEVEL,
    min: 5,
    max: 40,
    step: 1,
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166): the fixed 20 gate fired ZERO events over 9 months of daily bars on both NVDA and SPY. A dormant gate contributes nothing however well it scores.',
    source: 'mfi.directive.ts:57 oversold gate (was currentMfi < 20)',
  },
];

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class MfiDirective implements IDirective {
  readonly id = 'mfi';
  readonly name = 'Money Flow Index';
  readonly description = 'Hybrid: continuous base + oversold bonuses. Volume-weighted RSI.';
  readonly category = 'oscillator' as const;
  readonly priority = 50;
  readonly maxScore = 105;
  readonly minScore = 1;
  readonly minBars = { '1d': 17 };
  readonly version = '2.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const mfiPeriod = values.mfiPeriod as number;
    const oversoldLevel = values.oversoldLevel as number;
    const deepLevel = oversoldLevel * DEEP_FRACTION;
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume);
    if (closes.length < mfiPeriod + 3) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${mfiPeriod + 3} bars, have ${closes.length}.` };
    }
    const mfiValues = mfi(highs, lows, closes, volumes, mfiPeriod);
    if (mfiValues.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough MFI values.' };
    }
    const currentMfi = mfiValues[mfiValues.length - 1];
    const prevMfi = mfiValues[mfiValues.length - 2];
    const curling = currentMfi > prevMfi;

    // BASE: MFI 80→0, MFI 20→50 (lower MFI = more oversold = higher base)
    const baseScore = Math.round(mapRange(currentMfi, 80, oversoldLevel, 0, 50));

    // BONUS tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentMfi < deepLevel) { bonusScore = 50; bonusLabel = 'deep oversold (<10)'; }
    else if (currentMfi < oversoldLevel) { bonusScore = 30; bonusLabel = 'oversold (<20)'; }

    const curlBonus = curling ? 5 : 0;
    const total = baseScore + bonusScore + curlBonus;
    const parts = [`base=${baseScore}`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    if (curlBonus > 0) parts.push(`+${curlBonus} curl`);

    return {
      signalClass: total >= 60 ? 'bullish' : 'neutral',
      score: total,
      confidence: Number((bonusScore > 0 ? 0.55 + (bonusScore / 50) * 0.3 : 0.3 + (baseScore / 50) * 0.2).toFixed(2)),
      reason: `MFI=${currentMfi.toFixed(1)} ${curling ? '↑' : '↓'}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      metadata: { baseScore, bonusScore, bonusLabel, curlBonus, currentMfi },
    };
  }
}
