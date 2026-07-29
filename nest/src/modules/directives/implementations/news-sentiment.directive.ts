/**
 * News Sentiment Directive
 * ========================
 * Evaluates news sentiment when available. Mock-first — returns neutral
 * score when no sentiment data is connected.
 *
 * When sentiment data present: scores based on positive/negative ratio.
 * Aligned with price direction = higher confidence.
 *
 * TradePress source: includes/scoring-system/directives/news-sentiment-positive.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class NewsSentimentPositiveDirective implements IDirective {
  readonly id = 'news-sentiment-positive';
  readonly name = 'Positive News Sentiment';
  readonly description = 'Evaluates news sentiment. Mock-first — neutral when no API connected.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';
  readonly requiredDataFeeds = ['news'];
  readonly readiness = 'bravo' as const;

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
      return { signalClass: 'neutral', score: 45, confidence: 0.15, reason: 'Sentiment data present but no recent scores available.' };
    }

    const avgSentiment = totalSentiment / count; // Assuming -1 to +1 range
    const normalizedScore = (avgSentiment + 1) / 2; // Map to 0–1, then to score

    if (avgSentiment > 0.3) {
      const score = Math.round(55 + normalizedScore * 40);
      return {
        signalClass: 'bullish',
        score,
        confidence: 0.4 + normalizedScore * 0.3,
        reason: `Positive news sentiment (${avgSentiment.toFixed(2)}) over last ${count} bars. Bullish news backdrop.`,
      };
    }

    if (avgSentiment < -0.3) {
      return {
        signalClass: 'bearish',
        score: Math.round(20 - Math.abs(avgSentiment) * 15),
        confidence: 0.35 + Math.abs(avgSentiment) * 0.2,
        reason: `Negative news sentiment (${avgSentiment.toFixed(2)}). Bearish news backdrop — reduced long score.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 45,
      confidence: 0.25,
      reason: `Neutral news sentiment (${avgSentiment.toFixed(2)}). No strong directional bias from news.`,
    };
  }
}
