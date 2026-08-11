/**
 * Earnings Momentum
 * =================
 * Scores stocks based on recent earnings surprise magnitude and
 * post-earnings estimate revision trend.
 *
 * Data source: EarningsEvent table (populated by Alpha Vantage + Finnhub imports)
 * NEVER calls external APIs directly — reads from stored database records.
 *
 * Scoring:
 * - Surprise magnitude: actual vs estimate % (0-40)
 * - Revision trend: quarter-over-quarter EPS growth direction (0-30)
 * - Recency weight: how recent the earnings report was (0-30)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { PrismaService } from '../../../database/prisma.service';

const MIN_BARS = 1;

@Injectable()
export class EarningsMomentumDirective implements IDirective {
  private readonly logger = new Logger(EarningsMomentumDirective.name);
  readonly id = 'earnings-momentum';
  readonly name = 'Earnings Momentum';
  readonly description =
    'Scores earnings surprise magnitude and post-earnings estimate revision trends from stored EarningsEvent records.';
  readonly priority = 55;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 1 };
  readonly version = '1.1.0';
  readonly requiredDataFeeds = ['earnings'];
  readonly readiness = 'ready' as const;
  readonly category = 'ratio' as const;
  readonly directionBias = 'bullish' as const;

  constructor(private readonly prisma: PrismaService) {}

  async calculate(input: DirectiveInput): Promise<DirectiveResult> {
    const symbol = input.symbol;
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars.`,
        signalClass: 'neutral',
      };
    }

    try {
      // Query stored earnings events — no external API call
      const events = await this.prisma.earningsEvent.findMany({
        where: {
          symbol: symbol.toUpperCase(),
          epsActual: { not: null },
          reportDate: { lte: new Date() },
        },
        orderBy: { reportDate: 'desc' },
        take: 4,
      });

      if (!events || events.length === 0) {
        return {
          score: 0,
          confidence: 0.3,
          reason: `No stored earnings data for ${symbol}. Data will be available after the next earnings import.`,
          signalClass: 'neutral',
        };
      }

      const latest = events[0];
      const estimate = latest.epsEstimate ?? 0;
      const actual = latest.epsActual ?? 0;

      // 1. Surprise score (0-40)
      let surpriseScore = 20;
      if (estimate !== 0 && actual !== 0) {
        const surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
        surpriseScore = Math.max(0, Math.min(40, 20 + surprisePct));
      }

      // 2. Revision trend (0-30)
      let revisionScore = 15;
      if (events.length >= 2) {
        const prior = events[1];
        if (prior.epsActual && prior.epsActual !== 0 && actual !== 0) {
          const qoqGrowth = ((actual - prior.epsActual) / Math.abs(prior.epsActual)) * 100;
          revisionScore = Math.max(0, Math.min(30, 15 + qoqGrowth * 0.75));
        }
      }

      // 3. Recency (0-30)
      const daysSinceEarnings = Math.max(0,
        (Date.now() - new Date(latest.reportDate).getTime()) / (24 * 60 * 60 * 1000)
      );
      const recencyScore = Math.max(0, Math.min(30, 30 - daysSinceEarnings * 0.3));

      const totalScore = Math.round(surpriseScore + revisionScore + recencyScore);
      const signalClass = totalScore >= 60 ? 'bullish' : 'neutral';

      // Reason string: use same math as scoring (guard estimate !== 0)
      const surpriseDisplay = (estimate !== 0 && actual !== 0)
        ? `${actual > estimate ? '+' : ''}${((actual - estimate) / Math.abs(estimate) * 100).toFixed(1)}%`
        : 'N/A';

      return {
        score: totalScore,
        confidence: 0.6,
        reason: `${symbol} earnings: surprise=${surpriseScore.toFixed(0)}/40 (${surpriseDisplay}), revision=${revisionScore.toFixed(0)}/30, recency=${recencyScore.toFixed(0)}/30 (${daysSinceEarnings.toFixed(0)}d ago). Total=${totalScore}/${this.maxScore}.`,
        signalClass,
      };
    } catch (err) {
      this.logger.warn(`Earnings momentum DB query failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0,
        signalClass: 'neutral',
        reason: `Earnings momentum unavailable for ${symbol}: ${(err as Error).message}`,
      };
    }
  }
}
