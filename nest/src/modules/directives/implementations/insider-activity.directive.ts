/**
 * Insider Activity
 * ================
 * Scores based on recent insider buying and selling patterns.
 * Cluster buying by multiple insiders is a strong bullish signal.
 * Heavy selling can be bearish, but insiders sell for many reasons.
 *
 * Data source: Finnhub /stock/insider-transactions (free tier)
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
import { ProvidersService } from '../../providers/providers.service';

const MIN_BARS = 1;
const RECENT_DAYS = 30;

@Injectable()
export class InsiderActivityDirective implements IDirective {
  private readonly logger = new Logger(InsiderActivityDirective.name);
  readonly id = 'insider-activity';
  readonly name = 'Insider Activity';
  readonly description =
    'Scores insider buying/selling clusters. Cluster buying = strong bullish. Finnhub free tier.';
  readonly priority = 50;
  readonly maxScore = 85;
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
      const transactions = await (finnhub as any).getInsiderTransactions(symbol);
      if (!transactions || transactions.length === 0) {
        return {
          score: 0,
          confidence: 0.5,
          reason: `No insider transaction data for ${symbol}.`,
          signalClass: 'neutral',
        };
      }

      // Filter to recent transactions
      const cutoff = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);
      const recent = transactions.filter((t: any) => {
        const d = new Date(t.transactionDate);
        return !isNaN(d.getTime()) && d >= cutoff;
      });

      if (recent.length === 0) {
        return {
          score: 0,
          confidence: 0.5,
          reason: `No insider transactions in last ${RECENT_DAYS} days for ${symbol}.`,
          signalClass: 'neutral',
        };
      }

      // Count buys vs sells
      const buys = recent.filter((t: any) => t.transactionCode === 'P' || t.transactionCode === 'A');
      const sells = recent.filter((t: any) => t.transactionCode === 'S' || t.transactionCode === 'D');
      const total = buys.length + sells.length;

      // 1. Net buy ratio (0-50)
      const buyRatio = total > 0 ? buys.length / total : 0;
      const ratioScore = Math.round(buyRatio * 50);

      // 2. Cluster bonus (0-25) — multiple buyers = strong signal
      const uniqueBuyers = new Set(buys.map((b: any) => b.name)).size;
      const clusterScore = Math.min(25, uniqueBuyers * 5);

      // 3. Volume significance (0-10) — total shares traded
      const totalShares = recent.reduce((s: number, t: any) => s + Math.abs(t.share || 0), 0);
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
        reason: `${label}: ${buys.length}B/${sells.length}S from ${uniqueBuyers} insiders, ${totalSharesK}K shares (${RECENT_DAYS}d). Ratio=${ratioScore}/50, Cluster=${clusterScore}/25, Vol=${volumeScore}/10. Total=${totalScore}/${this.maxScore}.`,
        signalClass,
      };
    } catch (err) {
      this.logger.warn(`Insider activity failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0.1,
        reason: `Failed to fetch insider data: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }
}
