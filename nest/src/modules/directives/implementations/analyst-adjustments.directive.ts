/**
 * Analyst Adjustments Directive — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ========================================================================
 * Scores based on analyst recommendation consensus.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (0–80):   Continuous bullish% interpolation: 40%→0, 95%→80.
 *                Every percentage point of analyst consensus counts.
 * BONUS tiers:   strongBuyPct > 35% → +15 (strong conviction).
 *                trendPct > 5% → +10 (improving sentiment).
 * MAX:           105 (80 base + 25 bonus).
 *
 * Data is expected to be pre-fetched by the scoring pipeline and attached
 * to the input as `(input as any).analystRecommendation`.
 *
 * When no analyst data is available, returns neutral with a note.
 * Future: wire FMP for price targets (low/median/high) to add deviation scoring.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

interface AnalystData {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  total: number;
  bullishPct: number;
  bearishPct: number;
  strongBuyPct: number;
  trendPct?: number; // 3-month change in bullish%
}

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class AnalystAdjustmentsDirective implements IDirective {
  readonly id = 'analyst-adjustments';
  readonly name = 'Analyst Adjustments';
  readonly description = 'Hybrid: continuous analyst-consensus base + strong-buy/trend bonuses.';
  readonly category = 'structural' as const;
  readonly priority = 45;
  readonly maxScore = 105; // 80 base + 25 bonus
  readonly minScore = 1;
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.1'; // category + bias + minScore
  readonly readiness = 'beta' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const data: AnalystData | undefined = (input as any).analystRecommendation;

    if (!data || data.total === 0) {
      return {
        signalClass: 'neutral',
        score: 45,
        confidence: 0.1,
        reason: `No analyst recommendation data for ${input.symbol}. Connect Finnhub (free) for real data.`,
      };
    }

    const { bullishPct, strongBuyPct, trendPct } = data;

    // ── BASE (continuous, 0–80) ──────────────────────────
    // bullishPct 40% → base 0 (weak consensus)
    // bullishPct 95% → base 80 (overwhelming bullish)
    const baseScore = Math.round(mapRange(bullishPct, 40, 95, 0, 80));

    // ── BONUS (threshold-gated) ───────────────────────────
    let bonusScore = 0;
    const bonusParts: string[] = [];

    if (strongBuyPct > 35) {
      bonusScore += 15;
      bonusParts.push(`strong buys ${strongBuyPct.toFixed(0)}%`);
    }

    if (trendPct !== undefined && trendPct > 5) {
      bonusScore += 10;
      bonusParts.push(`+${trendPct.toFixed(0)}% 3mo trend`);
    }

    const bonusLabel = bonusParts.join(' + ');

    // ── Total ─────────────────────────────────────────────
    const totalScore = Math.max(0, Math.min(this.maxScore, baseScore + bonusScore));

    const signalClass = totalScore >= 65 ? 'bullish' : totalScore <= 35 ? 'bearish' : 'neutral';
    const confidence = data.total >= 20 ? 0.7 : data.total >= 10 ? 0.5 : 0.3;

    const parts: string[] = [`base=${baseScore} (${bullishPct.toFixed(0)}% bullish)`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence,
      reason: `${input.symbol}: ${parts.join(' ')}`,
      metadata: { baseScore, bonusScore, bonusLabel, bullishPct, strongBuyPct, trendPct },
    };
  }
}
