import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class OutcomeTrackerService {
  private readonly logger = new Logger(OutcomeTrackerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Store DirectiveOutcome records after a scoring run.
   * Called from the scoring pipeline after directives produce scores.
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
    if (!this.prisma.isAvailable || outcomes.length === 0) return 0;

    try {
      const created = await this.prisma.directiveOutcome.createMany({
        data: outcomes.map((o) => ({
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
      this.logger.log(`Recorded ${created.count} directive outcomes`);
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
        // Only compute if at least 15 min have passed
        predictedAt: { lte: new Date(now.getTime() - 15 * 60 * 1000) },
      },
      take: 500,
      orderBy: { predictedAt: 'asc' },
    });

    for (const rec of pending) {
      try {
        // Look up prices at future timestamps from MarketBar
        const priceT15m = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 15 * 60 * 1000));
        const priceT1h = await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 60 * 60 * 1000));
        const priceT4h = rec.predictedAt.getTime() + 4 * 60 * 60 * 1000 <= now.getTime()
          ? await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 4 * 60 * 60 * 1000))
          : null;
        const priceT24h = rec.predictedAt.getTime() + 24 * 60 * 60 * 1000 <= now.getTime()
          ? await this.getPriceAt(rec.symbol, rec.timeframe, new Date(rec.predictedAt.getTime() + 24 * 60 * 60 * 1000))
          : null;

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
   * Get the close price from MarketBar nearest to the target timestamp.
   */
  private async getPriceAt(symbol: string, timeframe: string, targetTime: Date): Promise<number | null> {
    try {
      const bar = await this.prisma.marketBar.findFirst({
        where: {
          symbolId: symbol,
          timeframe,
          timestamp: { lte: targetTime },
        },
        orderBy: { timestamp: 'desc' },
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
