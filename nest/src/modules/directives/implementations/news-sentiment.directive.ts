/**
 * News Sentiment Directive — HYBRID BASE+BONUS (Layer C, 2026-07-29)
 * ===================================================================
 * Evaluates news sentiment when available. Mock-first — returns neutral
 * score when no sentiment data is connected.
 *
 * ── Hybrid Scoring ─────────────────────────────────────────
 * BASE (15–85):  Continuous sentiment interpolation: -0.5→15, +0.5→85.
 *                Linear mapping of average sentiment score.
 * BONUS tiers:   avgSentiment > 0.5 → +15 (extreme positive).
 *                avgSentiment < -0.5 → signal reversal (score=0).
 * MAX:           100 (85 base + 15 bonus).
 *
 * When sentiment data present: scores based on positive/negative ratio.
 * Aligned with price direction = higher confidence.
 *
 * TradePress source: includes/scoring-system/directives/news-sentiment-positive.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

/** Linear interpolation: map value from [inMin,inMax] to [outMin,outMax], clamped. */
function mapRange(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = Math.max(0, Math.min(1, (v - inMin) / (inMax - inMin)));
  return outMin + t * (outMax - outMin);
}

@Injectable()
export class NewsSentimentPositiveDirective implements IDirective {
  readonly id = 'news-sentiment-positive';
  readonly name = 'Positive News Sentiment';
  readonly description = 'Hybrid: continuous news-sentiment base + extreme-sentiment bonuses.';
  readonly priority = 50;
  readonly maxScore = 100; // 85 base + 15 bonus
  readonly minBars = { '1d': 1 };
  readonly version = '2.0.0'; // Hybrid scoring
  readonly requiredDataFeeds = ['news'];
  readonly readiness = 'beta' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    // Check for sentiment data on bars (would come from news API in production)
    const bars = input.bars;
    const hasSentiment = bars.some(b => (b as any).sentiment !== undefined);
    const hasSentimentScore = bars.some(b => (b as any).sentimentScore !== undefined);

    if (!hasSentiment && !hasSentimentScore) {
      // Mock mode — no sentiment data available
      return {
        signalClass: 'neutral',
        score: 45,
        confidence: 0.15,
        reason: `No news sentiment data connected for ${input.symbol}. Mock-neutral score. Connect Alpha Vantage NEWS_SENTIMENT or Finnhub news API for real data.`,
      };
    }

    // Real sentiment evaluation
    const recentBars = bars.slice(-5);
    let totalSentiment = 0;
    let count = 0;

    for (const bar of recentBars) {
      const s = (bar as any).sentimentScore;
      if (s !== undefined) {
        totalSentiment += s;
        count++;
      }
    }

    if (count === 0) {
      return {
        signalClass: 'neutral',
        score: 45,
        confidence: 0.15,
        reason: 'Sentiment data present but no recent scores available.',
      };
    }

    const avgSentiment = totalSentiment / count; // Assuming -1 to +1 range

    // ── Signal reversal: extreme negative ────────────────
    if (avgSentiment < -0.5) {
      return {
        signalClass: 'bearish',
        score: 0,
        confidence: 0.45,
        reason: `${input.symbol}: Extreme negative sentiment (${avgSentiment.toFixed(2)}). Signal reversal — score bottoms at 0.`,
        metadata: { baseScore: 0, bonusScore: 0, bonusLabel: 'extreme negative', avgSentiment },
      };
    }

    // ── BASE (continuous, 15–85) ──────────────────────────
    // avgSentiment -0.5 → base 15 (bearish)
    // avgSentiment +0.5 → base 85 (bullish)
    const baseScore = Math.round(mapRange(avgSentiment, -0.5, 0.5, 15, 85));

    // ── BONUS (threshold-gated) ───────────────────────────
    let bonusScore = 0;
    let bonusLabel = '';

    if (avgSentiment > 0.5) {
      bonusScore = 15;
      bonusLabel = 'extreme positive';
    }

    // ── Total ─────────────────────────────────────────────
    const totalScore = Math.min(this.maxScore, baseScore + bonusScore);

    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (totalScore >= 65) signalClass = 'bullish';
    else if (totalScore <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    const confidence = bonusScore > 0
      ? 0.55
      : 0.25 + (baseScore / 85) * 0.3;

    const parts: string[] = [`base=${baseScore} (sentiment=${avgSentiment.toFixed(2)})`];
    if (bonusScore > 0) parts.push(`+${bonusScore} bonus (${bonusLabel})`);
    parts.push(`= ${totalScore}/${this.maxScore}`);

    return {
      signalClass,
      score: totalScore,
      confidence: Number(confidence.toFixed(2)),
      reason: `${input.symbol}: ${parts.join(' ')}`,
      metadata: { baseScore, bonusScore, bonusLabel, avgSentiment },
    };
  }
}
