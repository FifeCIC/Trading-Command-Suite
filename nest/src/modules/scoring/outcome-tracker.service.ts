import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

// ── Configuration ────────────────────────────────────────────
// Set OUTCOME_TRACKING_ENABLED=false to disable all outcome recording.
// OUTCOME_TRACKING_DEDUP_WINDOW_MS controls the dedup window (default 5 min).
// These can be overridden via environment variables for production tuning.

const OUTCOME_TRACKING_ENABLED =
  process.env.OUTCOME_TRACKING_ENABLED !== 'false'; // default true
const OUTCOME_TRACKING_DEDUP_WINDOW_MS = process.env.OUTCOME_TRACKING_DEDUP_WINDOW_MS
  ? parseInt(process.env.OUTCOME_TRACKING_DEDUP_WINDOW_MS, 10)
  : 300_000; // 5 minutes

type DedupKey = string; // `${directiveId}::${symbol}`

@Injectable()
export class OutcomeTrackerService {
  private readonly logger = new Logger(OutcomeTrackerService.name);

  /** Tracks last recorded timestamp per directive+symbol for dedup. */
  private readonly lastRecorded = new Map<DedupKey, number>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Store DirectiveOutcome records after a scoring run.
   * Called from the scoring pipeline after directives produce scores.
   *
   * Deduplication: directive+symbol combos are only recorded once per
   * OUTCOME_TRACKING_DEDUP_WINDOW_MS (default 5 min). Zero/null scores
   * are skipped since they carry no signal to track.
   */
  async recordOutcomes(
    outcomes: {
      directiveId: string;
      symbol: string;
      strategyId?: string;
      timeframe: string;
      score: number;
      signalClass: string;
      confidence: number;
      predictedAt: Date;
      priceAtPredict: number;
    }[],
  ): Promise<number> {
    if (!OUTCOME_TRACKING_ENABLED) {
      this.logger.debug('Outcome tracking disabled — skipping');
      return 0;
    }

    if (!this.prisma.isAvailable || outcomes.length === 0) return 0;

    const now = Date.now();
    const windowMs = OUTCOME_TRACKING_DEDUP_WINDOW_MS;

    // Filter: skip zero/null scores + deduplicate within time window
    const deduped = outcomes.filter((o) => {
      // Skip zero/null scores — no signal to track
      if (o.score == null || o.score === 0) return false;

      const key: DedupKey = `${o.directiveId}::${o.symbol}`;
      const lastTs = this.lastRecorded.get(key);

      // If recorded within dedup window, skip
      if (lastTs !== undefined && (now - lastTs) < windowMs) {
        return false;
      }

      // Mark as recorded (will be updated after successful DB write)
      this.lastRecorded.set(key, now);
      return true;
    });

    if (deduped.length === 0) {
      this.logger.debug(`All ${outcomes.length} outcomes filtered (dedup/zero-score)`);
      return 0;
    }

    const skipped = outcomes.length - deduped.length;
    if (skipped > 0) {
      this.logger.debug(`Dedup: ${skipped}/${outcomes.length} outcomes skipped (within ${windowMs / 1000}s window or zero-score)`);
    }

    try {
      const created = await this.prisma.directiveOutcome.createMany({
        data: deduped.map((o) => ({
          directiveId: o.directiveId,
          symbol: o.symbol,
          strategyId: o.strategyId ?? null,
          timeframe: o.timeframe,
          score: o.score,
          signalClass: o.signalClass,
          confidence: o.confidence,
          predictedAt: o.predictedAt,
          priceAtPredict: o.priceAtPredict,
        })),
        skipDuplicates: true,
      });
      this.logger.log(`Recorded ${created.count} directive outcomes (${skipped} deduped)`);
      return created.count;
    } catch (err) {
      this.logger.error(`Failed to record outcomes: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Compute outcomes for matured predictions.
   * Finds records where outcomeComputedAt is null and predictedAt is old enough,
   * then fills T+15m, T+1h, T+4h, T+24h prices from MarketBar.
   */
  async computeOutcomes(): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    const now = new Date();
    const computed = { count: 0 };

    // Find uncomputed outcomes with enough elapsed time
    const pending = await this.prisma.directiveOutcome.findMany({
      where: {
        outcomeComputedAt: null,
        // This schema has one completion marker for all four horizons. Wait for
        // the final horizon so early runs cannot permanently null T+1h/T+4h/T+24h.
        predictedAt: { lte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      take: 500,
      orderBy: { predictedAt: 'asc' },
    });

    for (const rec of pending) {
      try {
        // Look up prices at future timestamps from MarketBar
        const priceT15m = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 15 * 60 * 1000));
        const priceT1h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 60 * 60 * 1000));
        const priceT4h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 4 * 60 * 60 * 1000));
        const priceT24h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 24 * 60 * 60 * 1000));

        // Compute directionCorrect based on T+1h
        let directionCorrect: boolean | null = null;
        if (priceT1h != null && rec.signalClass !== 'neutral') {
          directionCorrect = rec.signalClass === 'bullish'
            ? priceT1h > rec.priceAtPredict
            : priceT1h < rec.priceAtPredict;
        }

        await this.prisma.directiveOutcome.update({
          where: { id: rec.id },
          data: {
            priceT15m,
            priceT1h,
            priceT4h,
            priceT24h,
            directionCorrect,
            outcomeComputedAt: new Date(),
          },
        });
        computed.count++;
      } catch (err) {
        this.logger.warn(`Failed to compute outcome ${rec.id}: ${(err as Error).message}`);
      }
    }

    if (computed.count > 0) {
      this.logger.log(`Computed ${computed.count} outcomes`);
    }
    return computed.count;
  }

  /**
   * Get the first close at/after the horizon in a bounded freshness window.
   * `symbol` is a ticker; MarketBar.symbolId is a UUID foreign key.
   */
  private async getPriceAt(symbol: string, timeframe: string, targetTime: Date): Promise<number | null> {
    try {
      const resolved = await this.prisma.symbol.findFirst({
        where: { ticker: symbol.toUpperCase() },
        select: { id: true },
      });
      if (!resolved) return null;
      const toleranceMs = Math.max(15 * 60_000, timeframeToMilliseconds(timeframe) * 2);
      const bar = await this.prisma.marketBar.findFirst({
        where: {
          symbolId: resolved.id,
          timeframe,
          timestamp: {
            gte: targetTime,
            lte: new Date(targetTime.getTime() + toleranceMs),
          },
        },
        orderBy: { timestamp: 'asc' },
        select: { close: true },
      });
      return bar?.close ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Get accuracy aggregation for a directive.
   */
  async getAccuracy(params: {
    directiveId?: string;
    symbol?: string;
    timeframe?: string;
    days?: number;
  }) {
    if (!this.prisma.isAvailable) return { accuracy: 0, totalPredictions: 0 };

    const days = params.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const where: any = {
      predictedAt: { gte: since },
      directionCorrect: { not: null },
    };
    if (params.directiveId) where.directiveId = params.directiveId;
    if (params.symbol) where.symbol = params.symbol;
    if (params.timeframe) where.timeframe = params.timeframe;

    const records = await this.prisma.directiveOutcome.findMany({
      where,
      select: {
        directiveId: true,
        symbol: true,
        timeframe: true,
        directionCorrect: true,
        signalClass: true,
      },
    });

    const total = records.length;
    const correct = records.filter((r) => r.directionCorrect).length;

    // Group by timeframe
    const byTimeframe: Record<string, { accuracy: number; count: number }> = {};
    const bySymbol: Record<string, { accuracy: number; count: number }> = {};
    for (const r of records) {
      if (!byTimeframe[r.timeframe]) byTimeframe[r.timeframe] = { accuracy: 0, count: 0 };
      byTimeframe[r.timeframe].count++;
      if (r.directionCorrect) byTimeframe[r.timeframe].accuracy++;

      if (!bySymbol[r.symbol]) bySymbol[r.symbol] = { accuracy: 0, count: 0 };
      bySymbol[r.symbol].count++;
      if (r.directionCorrect) bySymbol[r.symbol].accuracy++;
    }

    // Normalize
    for (const k of Object.keys(byTimeframe)) {
      byTimeframe[k].accuracy = byTimeframe[k].count > 0
        ? Math.round((byTimeframe[k].accuracy / byTimeframe[k].count) * 1000) / 1000
        : 0;
    }
    for (const k of Object.keys(bySymbol)) {
      bySymbol[k].accuracy = bySymbol[k].count > 0
        ? Math.round((bySymbol[k].accuracy / bySymbol[k].count) * 1000) / 1000
        : 0;
    }

    return {
      directiveId: params.directiveId ?? 'all',
      period: `${days}d`,
      totalPredictions: total,
      correctPredictions: correct,
      accuracy: total > 0 ? Math.round((correct / total) * 1000) / 1000 : 0,
      byTimeframe,
      bySymbol,
    };
  }

  /**
   * Trim raw outcomes older than retentionDays.
   */
  async trimOldOutcomes(retentionDays = 90): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.directiveOutcome.deleteMany({
      where: { predictedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Trimmed ${result.count} old outcomes (older than ${retentionDays}d)`);
    }
    return result.count;
  }
}

function timeframeToMilliseconds(timeframe: string): number {
  const match = /^(\d+)(m|h|d)$/i.exec(timeframe);
  if (!match) return 60 * 60_000;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  return value * (unit === 'm' ? 60_000 : unit === 'h' ? 60 * 60_000 : 24 * 60 * 60_000);
}
