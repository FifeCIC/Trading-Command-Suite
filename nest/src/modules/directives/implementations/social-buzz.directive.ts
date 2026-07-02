/**
 * Social Buzz
 * ===========
 * Scores stocks based on social media mention volume and sentiment
 * ratio from Reddit and Twitter.
 *
 * Data source: Finnhub /stock/social-sentiment (free tier)
 *
 * Scoring:
 * - Mention volume: normalized against typical volume (0-40)
 * - Sentiment ratio: bullish vs bearish mentions (0-40)
 * - Momentum: whether sentiment is improving (0-20)
 *
 * High buzz + positive sentiment = potential short-term catalyst.
 * High buzz + negative sentiment = potential contrarian or risk signal.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { ProvidersService } from '../../providers/providers.service';

const MIN_BARS = 1;
const HIGH_BUZZ_THRESHOLD = 50; // mentions to be considered "buzzing"

@Injectable()
export class SocialBuzzDirective implements IDirective {
  private readonly logger = new Logger(SocialBuzzDirective.name);
  readonly id = 'social-buzz';
  readonly name = 'Social Buzz';
  readonly description =
    'Scores social media sentiment and mention volume from Reddit/Twitter via Finnhub free tier.';
  readonly priority = 40;
  readonly maxScore = 70; // Supplementary signal — not primary
  readonly version = '1.0.0';

  constructor(private readonly providers: ProvidersService) {}

  async calculate(input: DirectiveInput): Promise<DirectiveResult> {
    const symbol = input.symbol;
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data.`,
        signalClass: 'neutral',
      };
    }

    try {
      const finnhub = this.providers.getAdapter('finnhub');
      if (!finnhub) return { score: 0, confidence: 0, signalClass: 'neutral', reason: 'Finnhub not available' };
      const data = await (finnhub as any).getSocialSentiment(symbol);
      if (!data) {
        return {
          score: 0,
          confidence: 0.5,
          reason: `No social sentiment data for ${symbol}. Low discussion volume.`,
          signalClass: 'neutral',
        };
      }

      // 1. Mention volume (0-40)
      const totalMentions = data.totalMentions;
      const volumeScore = Math.min(40, Math.round((totalMentions / HIGH_BUZZ_THRESHOLD) * 40));

      // 2. Sentiment ratio (0-40)
      const sentiment = data.avgSentiment; // -1 to 1
      const sentimentScore = Math.round((sentiment + 1) * 20); // -1→0, 0→20, 1→40

      // 3. Platform diversity bonus (0-10) — both Reddit AND Twitter active
      const hasReddit = data.redditMentions > 5;
      const hasTwitter = data.twitterMentions > 5;
      const diversityBonus = (hasReddit ? 5 : 0) + (hasTwitter ? 5 : 0);

      const totalScore = Math.min(this.maxScore, volumeScore + sentimentScore + diversityBonus);

      const signalClass = totalScore >= 50 && sentiment > 0
        ? 'bullish'
        : totalScore >= 50 && sentiment < -0.3
          ? 'bearish'
          : 'neutral';

      const sentimentLabel = sentiment > 0.3 ? 'positive'
        : sentiment < -0.3 ? 'negative'
        : 'neutral';

      return {
        score: totalScore,
        confidence: Math.min(0.7, totalMentions / 100),
        reason: `${symbol} social: ${totalMentions} mentions, ${sentimentLabel} sentiment (${sentiment.toFixed(2)}). Vol=${volumeScore}/40, Sent=${sentimentScore}/40, Div=${diversityBonus}/10. Total=${totalScore}/${this.maxScore}.`,
        signalClass,
      };
    } catch (err) {
      this.logger.warn(`Social buzz failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0.1,
        reason: `Failed to fetch social data: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }
}
