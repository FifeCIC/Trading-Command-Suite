/**
 * Price Above EMA Structure — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * =====================================================================
 * BASE (0–60): Continuous from EMA separation %. Every tick.
 * BONUS: Full alignment (price>EMA20>EMA50) → +30. Strong separation → +10.
 * MAX: 100.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';

const EMA_SHORT = 20;
const EMA_LONG = 50;
const MIN_BARS = EMA_LONG + 1;

@Injectable()
export class EmaStructureDirective implements IDirective {
  readonly id = 'ema-structure';
  readonly name = 'Price Above EMA Structure';
  readonly description = 'Hybrid: continuous separation base + alignment bonus.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minBars = { '1d': 51 };
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`, signalClass: 'neutral' };
    }
    const ema20 = ema(closes, EMA_SHORT);
    const ema50 = ema(closes, EMA_LONG);
    const currentPrice = closes[closes.length - 1];
    const currentEma20 = ema20[ema20.length - 1];
    const currentEma50 = ema50[ema50.length - 1];
    const priceAboveEma20 = currentPrice > currentEma20;
    const ema20AboveEma50 = currentEma20 > currentEma50;
    const fullAlignment = priceAboveEma20 && ema20AboveEma50;

    // BASE (0–60): price separation from EMA20 as % → continuous score
    const priceSep = (currentPrice - currentEma20) / currentEma20;
    const baseScore = Math.round(Math.min(60, Math.max(0, 30 + priceSep * 100)));

    // BONUS
    let bonusScore = 0;
    let bonusLabel = '';
    if (fullAlignment) {
      bonusScore = 30;
      const emaSep = (currentEma20 - currentEma50) / currentEma50;
      if (emaSep > 0.02) { bonusScore += 10; bonusLabel = 'full alignment + strong separation'; }
      else { bonusLabel = 'full alignment'; }
    } else if (priceAboveEma20) { bonusScore = 10; bonusLabel = 'price above EMA20'; }
    else if (ema20AboveEma50) { bonusScore = 5; bonusLabel = 'EMAs aligned (price dipped)'; }

    const total = baseScore + bonusScore;
    const parts = [`base=${baseScore} (${(priceSep*100).toFixed(1)}% above EMA20)`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);

    return {
      score: total,
      confidence: Number((fullAlignment ? 0.7 : priceAboveEma20 ? 0.45 : 0.35).toFixed(2)),
      reason: `Price ${currentPrice.toFixed(2)} vs EMA20 ${currentEma20.toFixed(2)} vs EMA50 ${currentEma50.toFixed(2)}: ${parts.join(' ')}=${total}/${this.maxScore}`,
      signalClass: fullAlignment ? 'bullish' : 'neutral',
      metadata: { baseScore, bonusScore, bonusLabel, priceSep, fullAlignment },
    };
  }
}
