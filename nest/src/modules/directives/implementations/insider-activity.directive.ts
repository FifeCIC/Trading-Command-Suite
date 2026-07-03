/**
 * Insider Activity
 * ================
 * Scores based on recent insider buying and selling patterns.
 * Cluster buying by multiple insiders is a strong bullish signal.
 * Heavy selling can be bearish, but insiders sell for many reasons.
 *
 * Data source: InsiderTransaction DB table (populated by ResearchImportService cron).
 * Previously called Finnhub /stock/insider-transactions directly on every scoring run.
 *
 * Scoring:
 * - Net buy ratio: percentage of purchases vs sales (0-50)
 * - Cluster detection: multiple insiders buying = bonus (0-25)
 * - Recency: recent transactions weighted higher (0-25)
 *
 * Insider clusters are one of the strongest non-price signals.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { PrismaService } from '../../../database/prisma.service';

const MIN_BARS = 1;
const RECENT_DAYS = 30;

@Injectable()
export class InsiderActivityDirective implements IDirective {
  private readonly logger = new Logger(InsiderActivityDirective.name);
  readonly id = 'insider-activity';
  readonly name = 'Insider Activity';
  readonly description =
    'Scores insider buying/selling clusters. Cluster buying = strong bullish. Reads from InsiderTransaction DB table.';
  readonly priority = 50;
  readonly maxScore = 85;
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
      // Query insider transactions from DB (last 30 days)
      const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
      const recent = await this.prisma.insiderTransaction.findMany({
        where: {
          symbol: symbol.toUpperCase(),
          transactionDate: { gte: cutoff },
        },
        orderBy: { transactionDate: 'desc' },
      });

      if (!recent || recent.length === 0) {
        return {
          score: 0,
          confidence: 0,
          reason: `No insider transaction data for ${symbol}. Import job may not have run yet.`,
          signalClass: 'neutral',
        };
      }

      // Count buys vs sells
      const buys = recent.filter((t) => t.transactionCode === 'P' || t.transactionCode === 'A');
      const sells = recent.filter((t) => t.transactionCode === 'S' || t.transactionCode === 'D');
      const total = buys.length + sells.length;

      // 1. Net buy ratio (0-50)
      const buyRatio = total > 0 ? buys.length / total : 0;
      const ratioScore = Math.round(buyRatio * 50);

      // 2. Cluster bonus (0-25) — multiple buyers = strong signal
      const uniqueBuyers = new Set(buys.map((b) => b.name)).size;
      const clusterScore = Math.min(25, uniqueBuyers * 5);

      // 3. Volume significance (0-10) — total shares traded
      const totalShares = recent.reduce((s, t) => s + Math.abs(t.share || 0), 0);
      const volumeScore = Math.min(10, Math.round(totalShares / 10000));

      const totalScore = Math.min(this.maxScore, ratioScore + clusterScore + volumeScore);

      const signalClass = totalScore >= 50
        ? 'bullish'
        : totalScore >= 25 && buyRatio > 0.5
          ? 'neutral'
          : 'neutral';

      const label = buyRatio > 0.7 ? 'Strong insider buying'
        : buyRatio > 0.5 ? 'Moderate insider buying'
        : buyRatio > 0.3 ? 'Mixed insider activity'
        : 'Insider selling';
      const totalSharesK = Math.round(totalShares / 1000);

      return {
        score: totalScore,
        confidence: Math.min(0.8, recent.length / 10),
        reason: `${label}: ${buys.length}B/${sells.length}S from ${uniqueBuyers} insiders, ${totalSharesK}K shares (${RECENT_DAYS}d, DB). Ratio=${ratioScore}/50, Cluster=${clusterScore}/25, Vol=${volumeScore}/10. Total=${totalScore}/${this.maxScore}.`,
        signalClass,
      };
    } catch (err) {
      this.logger.warn(`Insider activity failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0,
        reason: `Failed to query insider data from DB: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }
}
