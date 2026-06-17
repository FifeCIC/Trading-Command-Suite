/**
 * Analyst Adjustments Directive
 * ==============================
 * Scores based on analyst recommendation consensus.
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

@Injectable()
export class AnalystAdjustmentsDirective implements IDirective {
  readonly id = 'analyst-adjustments';
  readonly name = 'Analyst Adjustments';
  readonly description = 'Scores based on analyst consensus. Strong bullish consensus = positive. High sell ratings or weak consensus = negative.';
  readonly priority = 45;
  readonly maxScore = 100;
  readonly version = '1.0.0';

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

    const { strongBuy, buy, hold, sell, strongSell, total, bullishPct, bearishPct, strongBuyPct, trendPct } = data;
    let score = 50;
    const reasons: string[] = [];

    // Strong consensus
    if (bullishPct >= 90) {
      score += 15;
      reasons.push(`${bullishPct.toFixed(0)}% bullish (${strongBuy + buy}/${total})`);
    } else if (bullishPct >= 80) {
      score += 10;
      reasons.push(`${bullishPct.toFixed(0)}% bullish`);
    } else if (bullishPct >= 70) {
      score += 5;
      reasons.push(`${bullishPct.toFixed(0)}% bullish`);
    } else if (bullishPct < 60) {
      score -= 10;
      reasons.push(`Only ${bullishPct.toFixed(0)}% bullish`);
    }

    // Strong Buy premium
    if (strongBuyPct >= 35) {
      score += 5;
      reasons.push(`${strongBuy} strong buys`);
    }

    // Bearish penalty
    if (bearishPct > 10) {
      score -= 15;
      reasons.push(`${sell + strongSell} bearish ratings (${bearishPct.toFixed(0)}%)`);
    } else if (sell > 0 || strongSell > 0) {
      score -= 5;
      reasons.push(`${sell + strongSell} analysts bearish`);
    }

    // Coverage depth
    if (total >= 40) {
      score += 5;
      reasons.push(`${total} analysts covering`);
    } else if (total < 10) {
      score -= 5;
      reasons.push(`Only ${total} analysts`);
    }

    // Trend
    if (trendPct !== undefined) {
      if (trendPct > 5) {
        score += 5;
        reasons.push(`Improving: +${trendPct.toFixed(0)}% 3mo trend`);
      } else if (trendPct < -5) {
        score -= 5;
        reasons.push(`Deteriorating: ${trendPct.toFixed(0)}% 3mo trend`);
      }
    }

    const signalClass = score >= 65 ? 'bullish' : score <= 35 ? 'bearish' : 'neutral';

    return {
      signalClass,
      score: Math.max(0, Math.min(100, score)),
      confidence: total >= 20 ? 0.7 : total >= 10 ? 0.5 : 0.3,
      reason: reasons.join('. ') || 'Analyst consensus evaluated',
    };
  }
}
