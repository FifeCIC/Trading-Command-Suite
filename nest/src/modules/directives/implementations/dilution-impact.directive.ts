/**
 * Dilution Impact
 * ===============
 * Penalises stocks with significant recent share dilution.
 * Share count increases dilute existing shareholders and typically
 * pressure stock prices.
 *
 * Data source: Finnhub /stock/metric (free tier)
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
import { FinnhubAdapter } from '../../providers/adapters/finnhub.adapter';

const MIN_BARS = 1;

@Injectable()
export class DilutionImpactDirective implements IDirective {
  private readonly logger = new Logger(DilutionImpactDirective.name);
  readonly id = 'dilution-impact';
  readonly name = 'Dilution Impact';
  readonly description =
    'Penalises stocks with recent share dilution. No dilution = full score. Finnhub free tier.';
  readonly priority = 45;
  readonly maxScore = 60; // Risk penalty — lower ceiling
  readonly version = '1.0.0';

  constructor(private readonly finnhub: FinnhubAdapter) {}

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
      const metrics = await this.finnhub.getCompanyMetrics(symbol);
      if (!metrics) {
        return {
          score: 0,
          confidence: 0.5,
          reason: `No company metrics data for ${symbol}. Unable to assess dilution risk.`,
          signalClass: 'neutral',
        };
      }

      // Start from full score and subtract penalties
      let penalty3m = 0;
      let penalty12m = 0;
      let penaltySeverity = 0;

      // 3-month share change — penalty for dilution (shares increasing = bad)
      const change3m = metrics.shareChange3m || 0;
      if (change3m > 0) {
        // 1% dilution = 5pt penalty, capped at 40
        penalty3m = Math.min(40, Math.round(change3m * 5));
      }

      // 12-month share change — penalty for sustained dilution
      const change12m = metrics.shareChange12m || 0;
      if (change12m > 0) {
        penalty12m = Math.min(30, Math.round(change12m * 3));
      }

      // Absolute dilution severity — if shares outstanding is very high
      const shares = metrics.sharesOutstanding || 0;
      if (shares > 1000) { // > 1B shares = mega-cap dilution risk
        penaltySeverity = Math.min(30, Math.round((shares - 1000) / 100));
      }

      const totalPenalty = penalty3m + penalty12m + penaltySeverity;
      const totalScore = Math.max(0, this.maxScore - totalPenalty);

      const riskLabel = totalScore >= 50 ? 'No dilution concern'
        : totalScore >= 30 ? 'Moderate dilution detected'
        : 'Significant dilution — caution';

      return {
        score: totalScore,
        confidence: 0.65,
        reason: `${riskLabel}. 3m change: ${change3m > 0 ? '+' : ''}${change3m.toFixed(1)}%, 12m change: ${change12m > 0 ? '+' : ''}${change12m.toFixed(1)}%, Shares: ${shares}M. Penalty: ${totalPenalty}/${this.maxScore}. Score: ${totalScore}/${this.maxScore}.`,
        signalClass: 'neutral',
      };
    } catch (err) {
      this.logger.warn(`Dilution impact failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0.1,
        reason: `Failed to fetch dilution data: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }
}
