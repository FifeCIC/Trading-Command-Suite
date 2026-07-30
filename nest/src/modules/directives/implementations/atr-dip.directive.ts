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

const ATR_PERIOD = 14;
const LOOKBACK_HIGH = 20;
const MIN_BARS = ATR_PERIOD + LOOKBACK_HIGH;

function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class AtrDipDirective implements IDirective {
  readonly id = 'atr-dip';
  readonly name = 'ATR Normalized Dip';
  readonly description = 'Hybrid: continuous ATR-depth base + sweet-spot bonuses.';
  readonly priority = 70;
  readonly maxScore = 95;
  readonly minBars = { '1d': 34 };
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`, signalClass: 'neutral' };
    }
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const atrValues = atr(highs, lows, closes, ATR_PERIOD);
    if (atrValues.length === 0) {
      return { score: 0, confidence: 0.1, reason: 'Could not compute ATR.', signalClass: 'neutral' };
    }
    const currentAtr = atrValues[atrValues.length - 1];
    const currentPrice = closes[closes.length - 1];
    const lookbackSlice = highs.slice(-LOOKBACK_HIGH);
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
