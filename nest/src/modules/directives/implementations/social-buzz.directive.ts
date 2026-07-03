/**
 * Social Buzz
 * ===========
 * Scores stocks based on social media mention volume and sentiment
 * ratio from Reddit and Twitter.
 *
 * Data source: SocialMention DB table (populated by ResearchImportService cron).
 * Previously called Finnhub /stock/social-sentiment directly on every scoring run.
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
import { PrismaService } from '../../../database/prisma.service';

const MIN_BARS = 1;
const HIGH_BUZZ_THRESHOLD = 50;

@Injectable()
export class SocialBuzzDirective implements IDirective {
  private readonly logger = new Logger(SocialBuzzDirective.name);
  readonly id = 'social-buzz';
  readonly name = 'Social Buzz';
  readonly description =
    'Scores social media sentiment and mention volume from Reddit/Twitter. Reads from SocialMention DB table (populated by cron).';
  readonly priority = 40;
  readonly maxScore = 70;
  readonly version = '1.1.0';

  constructor(
    private readonly prisma: PrismaService,
  ) {}

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
      // Query the most recent social mention from DB (within last 24h)
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const mention = await this.prisma.socialMention.findFirst({
        where: {
          symbol: symbol.toUpperCase(),
          fetchedAt: { gte: cutoff },
        },
        orderBy: { fetchedAt: 'desc' },
      });

      if (!mention) {
        return {
          score: 0,
          confidence: 0,
          reason: `No recent social sentiment data for ${symbol}. Import job may not have run yet.`,
          signalClass: 'neutral',
        };
      }

      // 1. Mention volume (0-40)
      const totalMentions = mention.totalMentions;
      const volumeScore = Math.min(40, Math.round((totalMentions / HIGH_BUZZ_THRESHOLD) * 40));

      // 2. Sentiment ratio (0-40)
      const sentiment = mention.avgSentiment; // -1 to 1
      const sentimentScore = Math.round((sentiment + 1) * 20); // -1→0, 0→20, 1→40

      // 3. Platform diversity bonus (0-10) — both Reddit AND Twitter active
      const hasReddit = mention.redditMentions > 5;
      const hasTwitter = mention.twitterMentions > 5;
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
        reason: `${symbol} social (DB): ${totalMentions} mentions, ${sentimentLabel} sentiment (${sentiment.toFixed(2)}). Vol=${volumeScore}/40, Sent=${sentimentScore}/40, Div=${diversityBonus}/10. Total=${totalScore}/${this.maxScore}.`,
        signalClass,
      };
    } catch (err) {
      this.logger.warn(`Social buzz failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0,
        reason: `Failed to query social data from DB: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }
}
