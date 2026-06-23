/**
 * Earnings Momentum
 * =================
 * Scores stocks based on recent earnings surprise magnitude and
 * post-earnings estimate revision trend.
 *
 * Data source: Finnhub /calendar/earnings (free tier)
 *
 * Scoring:
 * - Surprise magnitude: actual vs estimate % (0-40)
 * - Revision trend: quarter-over-quarter EPS growth direction (0-30)
 * - Recency weight: how recent the earnings report was (0-30)
 *
 * Weights toward positive earnings momentum — stocks that beat
 * estimates and have upward revisions tend to outperform.
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
export class EarningsMomentumDirective implements IDirective {
  private readonly logger = new Logger(EarningsMomentumDirective.name);
  readonly id = 'earnings-momentum';
  readonly name = 'Earnings Momentum';
  readonly description =
    'Scores earnings surprise magnitude and post-earnings estimate revision trends. Finnhub free tier.';
  readonly priority = 55;
  readonly maxScore = 90;
  readonly version = '1.0.0';

  constructor(private readonly finnhub: FinnhubAdapter) {}

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
      const events = await this.finnhub.getEarningsCalendar(symbol, 3);
      if (!events || events.length === 0) {
        return {
          score: 0,
          confidence: 0.5,
          reason: `No earnings data available for ${symbol}.`,
          signalClass: 'neutral',
        };
      }

      // Find the most recent reported earnings
      const reported = events
        .filter(e => e.epsActual !== null && e.epsActual !== undefined)
        .sort((a, b) => new Date(b.reportDate).getTime() - new Date(a.reportDate).getTime());

      if (reported.length === 0) {
        return {
          score: 0,
          confidence: 0.5,
          reason: `No reported earnings found for ${symbol} in last 3 months.`,
          signalClass: 'neutral',
        };
      }

      const latest = reported[0];
      const estimate = latest.epsEstimate ?? 0;
      const actual = latest.epsActual ?? 0;

      // 1. Surprise score (0-40)
      let surpriseScore = 20; // neutral baseline
      if (estimate !== 0 && actual !== 0) {
        const surprisePct = ((actual - estimate) / Math.abs(estimate)) * 100;
        // Scale: -20% surprise = 0, 0% = 20, +20% = 40
        surpriseScore = Math.max(0, Math.min(40, 20 + surprisePct));
      }

      // 2. Revision trend (0-30) — compare this quarter to prior
      let revisionScore = 15;
      if (reported.length >= 2) {
        const prior = reported[1];
        if (prior.epsActual && prior.epsActual !== 0 && actual !== 0) {
          const qoqGrowth = ((actual - prior.epsActual) / Math.abs(prior.epsActual)) * 100;
          // -20% decline = 0, flat = 15, +20% growth = 30
          revisionScore = Math.max(0, Math.min(30, 15 + qoqGrowth * 0.75));
        }
      }

      // 3. Recency (0-30) — newer earnings = higher weight
      const daysSinceEarnings = Math.max(0,
        (Date.now() - new Date(latest.reportDate).getTime()) / (24 * 60 * 60 * 1000)
      );
      const recencyScore = Math.max(0, Math.min(30, 30 - daysSinceEarnings * 0.3));

      const totalScore = Math.round(surpriseScore + revisionScore + recencyScore);
      const signalClass = totalScore >= 60 ? 'bullish' : totalScore >= 45 ? 'neutral' : 'neutral';

      return {
        score: totalScore,
        confidence: 0.6,
        reason: `${symbol} earnings: surprise=${surpriseScore.toFixed(0)}/40 (${actual > estimate ? '+' : ''}${((actual - estimate) / Math.abs(estimate || 1) * 100).toFixed(1)}%), revision=${revisionScore.toFixed(0)}/30, recency=${recencyScore.toFixed(0)}/30 (${daysSinceEarnings.toFixed(0)}d ago). Total=${totalScore}/${this.maxScore}.`,
        signalClass,
      };
    } catch (err) {
      this.logger.warn(`Earnings momentum failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0.1,
        reason: `Failed to fetch earnings data: ${(err as Error).message}`,
        signalClass: 'neutral',
      };
    }
  }
}
