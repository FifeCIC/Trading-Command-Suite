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
import { checkFidelity, lookaheadResult } from '../lookahead';
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
  readonly maxScore = 60;
  readonly minScore = 1;
  readonly minBars = { '1d': 1 }; // Risk penalty — lower ceiling
  readonly version = '1.4.0'; // #1139 — refuses to score a historical bar from a current snapshot
  readonly readiness = 'ready' as const;
  readonly category = 'structural' as const;
  readonly directionBias = 'neutral' as const;

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
        unmeasured: true,
      };
    }

    try {
      // Query company metrics from DB
      const metrics = await this.prisma.companyMetric.findUnique({
        where: { symbol: symbol.toUpperCase() },
      });

      if (!metrics) {
        // Request the on-demand import, then retry the DB read once.
        // ⚠️ #887 — the import carries a negative cache, so a symbol the provider
        // has no metrics for is asked about once per TTL, not once per tick.
        // Logged at debug: this is a per-tick diagnostic, not news.
        this.logger.debug(`No company metrics for ${symbol} — requesting on-demand import`);
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
            unmeasured: true,
          };
        }
        return this.scoreMetrics(retryMetrics, input);
      }

      return this.scoreMetrics(metrics, input);
    } catch (err) {
      this.logger.warn(`Dilution impact failed for ${symbol}: ${(err as Error).message}`);
      return {
        score: 0,
        confidence: 0,
        reason: `Failed to query/import dilution data: ${(err as Error).message}`,
        signalClass: 'neutral',
        unmeasured: true,
      };
    }
  }

  private scoreMetrics(metrics: any, input: DirectiveInput): DirectiveResult {
    /**
     * ── LOOKAHEAD GUARD (#1139 item 2) ────────────────────────────────────────────────────────────
     * `companyMetric` holds ONE current row per symbol, with no date predicate on the read, so every
     * historical bar was scored against today's share count. `fetchedAt` exists on the table (checked
     * with `db-schema.cjs`), which makes the test exact rather than a guess: if the snapshot was
     * observed after the bar — plus that bar's own duration as the arrival allowance — the row did not
     * exist yet and using it is lookahead.
     *
     * Live is unaffected: there the snapshot is refreshed during the bar it scores.
     */
    const fidelity = checkFidelity(metrics?.fetchedAt, input.asOf, input.timeframe);
    if (fidelity !== 'ok') {
      return lookaheadResult(
        'the company metrics snapshot',
        metrics?.fetchedAt,
        input.asOf,
        'companyMetric keeps one current row per symbol with no history, so the share count at this bar cannot be recovered.',
      );
    }
    /**
     * ── ZERO SHARES IS A MISSING READING, NOT "NO DILUTION" (measured 2026-11-01) ────────────────
     * MEASURED: **all 194 rows** in `companyMetric` hold `sharesOutstanding = 0` with
     * `shareChange3m = 0` and `shareChange12m = 0`, so every symbol scored the full
     * **60/60 — "No dilution concern"**. The directive was a constant `+60` in every composite that
     * carried it: an empty import read as a clean bill of health, which is the "silence looks like
     * information" failure in its purest form.
     *
     * A company has no zero share count. Zero therefore means the provider returned nothing, and the
     * honest answer is UNMEASURED — never full marks. This is checked BEFORE the penalty maths so a
     * partial import (real share count, zero changes) still scores: that case is a genuine reading.
     */
    const sharesOutstanding = Number(metrics?.sharesOutstanding);
    if (!Number.isFinite(sharesOutstanding) || sharesOutstanding <= 0) {
      return {
        score: 0,
        confidence: 0,
        signalClass: 'neutral',
        unmeasured: true,
        reason:
          `UNMEASURED — the provider returned no share count for ${input.symbol} (shares outstanding `
          + `${metrics?.sharesOutstanding ?? 'missing'}). A zero here is a MISSING reading, not "no dilution": `
          + `scoring it would award the full ${this.maxScore}/${this.maxScore} to every bar, which is a `
          + `verdict no data supports.`,
      };
    }

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
