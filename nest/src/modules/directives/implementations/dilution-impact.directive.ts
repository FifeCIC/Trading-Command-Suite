/**
 * Dilution Impact
 * ===============
 * Penalises stocks with significant recent share dilution.
 * Share count increases dilute existing shareholders and typically
 * pressure stock prices.
 *
 * Data source: CompanyMetric DB table (populated by ResearchImportService cron).
 * Previously called Finnhub /stock/metric directly on every scoring run.
 *
 * Scoring:
 * - 3-month share change: penalty for dilution (0-40)
 * - 12-month share change: penalty for long-term trend (0-30)
 * - Absolute dilution severity: >5% dilution = max penalty (0-30)
 *
 * This is a PENALTY directive — high scores only when there's
 * no dilution concern. Significant dilution drives score to 0.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { PrismaService } from '../../../database/prisma.service';
import { ResearchImportService } from '../../research/research-import.service';

const MIN_BARS = 1;
const STALE_DAYS = 7;

@Injectable()
export class DilutionImpactDirective implements IDirective {
  private readonly logger = new Logger(DilutionImpactDirective.name);
  readonly id = 'dilution-impact';
  readonly name = 'Dilution Impact';
  readonly description =
    'Penalises stocks with recent share dilution. No dilution = full score. On-demand import + DB read.';
  readonly priority = 45;
  readonly maxScore = 60; // Risk penalty — lower ceiling
  readonly version = '1.2.0';

  constructor(
    private readonly prisma: PrismaService,
    private readonly researchImport: ResearchImportService,
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
      // Query company metrics from DB
      const metrics = await this.prisma.companyMetric.findUnique({
        where: { symbol: symbol.toUpperCase() },
      });

      if (!metrics) {
        // Trigger on-demand import, then retry DB query once
        this.logger.log(`No company metrics for ${symbol} — triggering on-demand import`);
        await this.researchImport.importCompanyMetricsForSymbol(symbol);

        // Retry DB query after import
        const retryMetrics = await this.prisma.companyMetric.findUnique({
          where: { symbol: symbol.toUpperCase() },
        });

        if (!retryMetrics) {
          return {
            score: 0,
            confidence: 0,
            reason: `No company metrics data for ${symbol}. On-demand import returned no data.`,
            signalClass: 'neutral',
          };
        }
        return this.scoreMetrics(retryMetrics);
      }

      return this.scoreMetrics(metrics);
    } catch (err) {
      this.logger.warn(`Dilution impact failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0,
        reason: `Failed to query/import dilution data: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }

  private scoreMetrics(metrics: any): DirectiveResult {
    let penalty3m = 0;
    let penalty12m = 0;
    let penaltySeverity = 0;

    const change3m = metrics.shareChange3m || 0;
    if (change3m > 0) {
      penalty3m = Math.min(40, Math.round(change3m * 5));
    }

    const change12m = metrics.shareChange12m || 0;
    if (change12m > 0) {
      penalty12m = Math.min(30, Math.round(change12m * 3));
    }

    const shares = metrics.sharesOutstanding || 0;
    if (shares > 1000) {
      penaltySeverity = Math.min(30, Math.round((shares - 1000) / 100));
    }

    const totalPenalty = penalty3m + penalty12m + penaltySeverity;
    const totalScore = Math.max(0, this.maxScore - totalPenalty);

    const riskLabel = totalScore >= 50 ? 'No dilution concern'
      : totalScore >= 30 ? 'Moderate dilution detected' : 'Significant dilution — caution';

    return {
      score: totalScore,
      confidence: 0.65,
      reason: `${riskLabel} (on-demand). 3m change: ${change3m > 0 ? '+' : ''}${change3m.toFixed(1)}%, 12m change: ${change12m > 0 ? '+' : ''}${change12m.toFixed(1)}%, Shares: ${shares}M. Penalty: ${totalPenalty}/${this.maxScore}. Score: ${totalScore}/${this.maxScore}.`,
      signalClass: 'neutral',
    };
  }
}
