import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';

export type FreshnessStatus = 'fresh' | 'stale' | 'missing';

export interface FreshnessResult {
  symbolId: string;
  ticker?: string;
  timeframe: string;
  status: FreshnessStatus;
  latestTimestamp: string | null;
  ageMinutes: number | null;
}

export interface BatchFreshnessResult {
  mode: string;
  services: { database: boolean; queue: boolean; redis: boolean };
  results: FreshnessResult[];
}

@Injectable()
export class FreshnessService {
  private readonly logger = new Logger(FreshnessService.name);

  // Default: 1 hour during assumed market hours, 24h otherwise.
  private readonly MARKET_HOURS_THRESHOLD_MINUTES = 60;
  private readonly OFF_HOURS_THRESHOLD_MINUTES = 1440;

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
  ) {}

  /**
   * Evaluate freshness for all active symbols across a timeframe.
   */
  async checkAllActive(
    timeframe = '1h',
    maxAgeMinutes?: number,
  ): Promise<BatchFreshnessResult> {
    const modeInfo = this.modeService.getModeInfo();

    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable — returning empty freshness batch.');
      return {
        mode: modeInfo.mode,
        services: {
          database: modeInfo.database,
          queue: modeInfo.queue,
          redis: modeInfo.redis,
        },
        results: [],
      };
    }

    try {
      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { id: true, ticker: true },
        orderBy: { ticker: 'asc' },
      });

      const threshold =
        maxAgeMinutes ?? this.resolveDefaultThreshold();

      const results = await Promise.all(
        symbols.map((s) =>
          this.evaluateSingle(s.id, s.ticker, timeframe, threshold),
        ),
      );

      const summary = results.reduce(
        (acc, r) => {
          acc[r.status] = (acc[r.status] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      this.logger.log(
        `Freshness batch complete: ${results.length} symbols — ${summary.fresh ?? 0} fresh, ${summary.stale ?? 0} stale, ${summary.missing ?? 0} missing.`,
      );

      return {
        mode: modeInfo.mode,
        services: {
          database: modeInfo.database,
          queue: modeInfo.queue,
          redis: modeInfo.redis,
        },
        results,
      };
    } catch (error) {
      this.logger.warn(`Freshness batch failed: ${String(error)}`);
      return {
        mode: modeInfo.mode,
        services: {
          database: modeInfo.database,
          queue: modeInfo.queue,
          redis: modeInfo.redis,
        },
        results: [],
      };
    }
  }

  /**
   * Evaluate freshness for a single symbol.
   */
  async checkOne(
    symbolId: string,
    timeframe = '1h',
    maxAgeMinutes?: number,
  ): Promise<FreshnessResult> {
    const threshold =
      maxAgeMinutes ?? this.resolveDefaultThreshold();

    return this.evaluateSingle(symbolId, undefined, timeframe, threshold);
  }

  // ─── internal ────────────────────────────────────────────────

  private async evaluateSingle(
    symbolId: string,
    ticker: string | undefined,
    timeframe: string,
    maxAgeMinutes: number,
  ): Promise<FreshnessResult> {
    if (!this.prisma.isAvailable) {
      return {
        symbolId,
        ticker,
        timeframe,
        status: 'missing',
        latestTimestamp: null,
        ageMinutes: null,
      };
    }

    try {
      const latest = await this.prisma.marketBar.findFirst({
        where: { symbolId, timeframe },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });

      if (!latest) {
        this.logger.debug(
          `Freshness ${symbolId}/${timeframe}: missing (no bars stored).`,
        );
        return { symbolId, ticker, timeframe, status: 'missing', latestTimestamp: null, ageMinutes: null };
      }

      const ageMinutes =
        (Date.now() - latest.timestamp.getTime()) / 60000;
      const status: FreshnessStatus =
        ageMinutes <= maxAgeMinutes ? 'fresh' : 'stale';

      this.logger.debug(
        `Freshness ${symbolId}/${timeframe}: ${status} (${ageMinutes.toFixed(1)} min old, threshold ${maxAgeMinutes} min).`,
      );

      return {
        symbolId,
        ticker,
        timeframe,
        status,
        latestTimestamp: latest.timestamp.toISOString(),
        ageMinutes: Number(ageMinutes.toFixed(2)),
      };
    } catch (error) {
      this.logger.warn(
        `Freshness check failed for ${symbolId}: ${String(error)}`,
      );
      return { symbolId, ticker, timeframe, status: 'missing', latestTimestamp: null, ageMinutes: null };
    }
  }

  private resolveDefaultThreshold(): number {
    const hour = new Date().getUTCHours();
    // Rough: 13:30–20:00 UTC = US market hours (9:30–16:00 ET).
    const isMarketHours = hour >= 13 && hour < 20;
    return isMarketHours
      ? this.MARKET_HOURS_THRESHOLD_MINUTES
      : this.OFF_HOURS_THRESHOLD_MINUTES;
  }
}
