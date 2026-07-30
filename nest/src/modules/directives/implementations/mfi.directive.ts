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

const MFI_PERIOD = 14;
const MIN_BARS = MFI_PERIOD + 3;

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class MfiDirective implements IDirective {
  readonly id = 'mfi';
  readonly name = 'Money Flow Index';
  readonly description = 'Hybrid: continuous base + oversold bonuses. Volume-weighted RSI.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 17 };
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume);
    if (closes.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }
    const mfiValues = mfi(highs, lows, closes, volumes, MFI_PERIOD);
    if (mfiValues.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough MFI values.' };
    }
    const currentMfi = mfiValues[mfiValues.length - 1];
    const prevMfi = mfiValues[mfiValues.length - 2];
    const curling = currentMfi > prevMfi;

    // BASE: MFI 80→0, MFI 20→50 (lower MFI = more oversold = higher base)
    const baseScore = Math.round(mapRange(currentMfi, 80, 20, 0, 50));

    // BONUS tiers
    let bonusScore = 0;
    let bonusLabel = '';
    if (currentMfi < 10) { bonusScore = 50; bonusLabel = 'deep oversold (<10)'; }
    else if (currentMfi < 20) { bonusScore = 30; bonusLabel = 'oversold (<20)'; }

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
