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
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 1;
const HIGH_BUZZ_THRESHOLD = 50;

/**
 * Tunable knobs (#1165). The default IS `HIGH_BUZZ_THRESHOLD` — BASELINE proves the equality.
 *
 * ⚠️ This knob was UNPROVABLE until the harness seeded `socialMention.findFirst` (2026-11-01): the
 * proxy stub made the query throw, the directive took its catch branch, and the threshold was never
 * reached on any fixture. It is provable now only because the seeded row reports 60 mentions, which
 * sits ABOVE the 50 default — so raising the threshold visibly lowers the volume term instead of
 * leaving it saturated at both ends.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'highBuzzThreshold',
    label: 'High-buzz mention count',
    type: 'number',
    default: HIGH_BUZZ_THRESHOLD,
    min: 10,
    max: 200,
    step: 5,
    unit: 'mentions / 24h',
    chart: 'threshold',
    why: 'Fifty mentions in a day is a mega-cap number. For a small-cap it is a takeover rumour; for AAPL it is a quiet Tuesday — so a fixed 50 saturates the volume term for one and never fills it for the other. The seeded row (60 mentions) sits just above the default, which makes the trade-off visible: at 200 the same row contributes a fifth of the volume term.',
    source: 'social-buzz.directive.ts:HIGH_BUZZ_THRESHOLD',
  },
];

@Injectable()
export class SocialBuzzDirective implements IDirective {
  private readonly logger = new Logger(SocialBuzzDirective.name);
  readonly id = 'social-buzz';
  readonly name = 'Social Buzz';
  readonly category = 'structural' as const;
  readonly description =
    'Scores social media sentiment and mention volume from Reddit/Twitter. Reads from SocialMention DB table (populated by cron).';
  readonly priority = 40;
  readonly maxScore = 70;
  readonly minScore = 1;
  readonly minBars = { '1d': 1 };
  readonly version = '1.1.0';
  readonly requiredDataFeeds = ['social'];
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async calculate(input: DirectiveInput): Promise<DirectiveResult> {
    const { values } = resolveParams(this.id, this.params, input.params);
    const highBuzzThreshold = values.highBuzzThreshold as number;
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
      const cutoff = new Date((input.asOf?.getTime() ?? Date.now()) - 24 * 60 * 60 * 1000);
      const mention = await this.prisma.socialMention.findFirst({
        where: {
          symbol: symbol.toUpperCase(),
          fetchedAt: { gte: cutoff },
        },
        orderBy: { fetchedAt: 'desc' },
      });

      if (!mention) {
        // ⚠️ MEASURED 2026-11-01: `socialmention` holds **0 rows for every symbol** — the import job
        // has never run, so this branch fires for EVERY scoring call, not occasionally. The live
        // breakdown reports it `inSignal: false`, so the zero is currently excluded from the composite
        // and does not pollute a score. That is an OBSERVATION about today's gate, not a property to
        // rely on: if the feed is ever populated, this branch's semantics (a measured zero, versus
        // `unmeasured: true` for a feed that has never produced a row) must be re-decided here.
        return {
          score: 0,
          confidence: 0,
          reason: `No recent social sentiment data for ${symbol}. Import job may not have run yet.`,
          signalClass: 'neutral',
        };
      }

      // 1. Mention volume (0-40)
      const totalMentions = mention.totalMentions;
      const volumeScore = Math.min(40, Math.round((totalMentions / highBuzzThreshold) * 40));

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
      // ⚠️ `unmeasured: true` — a FAILED QUERY IS NOT A MEASURED ZERO. Without it this branch is
      // indistinguishable from "the feed was read and found no buzz", so a database outage would
      // read as a confident neutral score and be averaged into the composite as if it were data.
      return {
        score: 0,
        confidence: 0,
        reason: `Failed to query social data from DB: ${(err as Error).message}`,
        signalClass: 'neutral',
        unmeasured: true,
      };
    }
  }
}
