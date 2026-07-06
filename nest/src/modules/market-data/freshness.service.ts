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
      this.logger.warn(
        'Database unavailable — returning empty freshness batch.',
      );
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

      const threshold = maxAgeMinutes ?? this.resolveDefaultThreshold();

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
    const threshold = maxAgeMinutes ?? this.resolveDefaultThreshold();

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
        return {
          symbolId,
          ticker,
          timeframe,
          status: 'missing',
          latestTimestamp: null,
          ageMinutes: null,
        };
      }

      const ageMinutes = (Date.now() - latest.timestamp.getTime()) / 60000;
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
      return {
        symbolId,
        ticker,
        timeframe,
        status: 'missing',
        latestTimestamp: null,
        ageMinutes: null,
      };
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

  // ── Multi-Type Freshness (beyond MarketBar) ────────────────

  /** Thresholds per data type (minutes) */
  private readonly TYPE_THRESHOLDS: Record<string, number> = {
    marketBar: 60,
    earnings: 1440,   // 24h — earnings don't change intraday
    news: 120,         // 2h — news ages quickly
    dividends: 1440,   // 24h
    profile: 10080,    // 7 days — company profiles change rarely
  };

  /**
   * Get overall freshness for a symbol across all data types.
   * Returns the worst status across all types.
   */
  async overallFreshness(symbolId: string, ticker?: string): Promise<{
    symbolId: string;
    ticker: string | undefined;
    status: FreshnessStatus;
    types: Record<string, FreshnessResult>;
    recommendation: string;
  }> {
    const types: Record<string, FreshnessResult> = {};

    // Market bars (1h)
    types.marketBar = await this.checkOne(symbolId, '1h');

    // Earnings — check if any future earnings exist within threshold
    types.earnings = await this.checkDataType(
      symbolId, ticker, 'earnings', this.TYPE_THRESHOLDS.earnings,
      async () => {
        if (!this.prisma.isAvailable) return null;
        const row = await this.prisma.earningsEvent.findFirst({
          where: { symbol: ticker || symbolId },
          orderBy: { reportDate: 'desc' },
          select: { reportDate: true },
        });
        return row?.reportDate ?? null;
      },
    );

    // News
    types.news = await this.checkDataType(
      symbolId, ticker, 'news', this.TYPE_THRESHOLDS.news,
      async () => {
        if (!this.prisma.isAvailable) return null;
        const row = await this.prisma.newsArticle.findFirst({
          where: { symbol: ticker || symbolId },
          orderBy: { publishedAt: 'desc' },
          select: { publishedAt: true },
        });
        return row?.publishedAt ?? null;
      },
    );

    // Profile
    types.profile = await this.checkDataType(
      symbolId, ticker, 'profile', this.TYPE_THRESHOLDS.profile,
      async () => {
        if (!this.prisma.isAvailable) return null;
        const row = await this.prisma.symbol.findUnique({
          where: { id: symbolId },
          select: { updatedAt: true },
        });
        return row?.updatedAt ?? null;
      },
    );

    // Worst status wins
    const statusOrder: FreshnessStatus[] = ['missing', 'stale', 'fresh'];
    let worstStatus: FreshnessStatus = 'fresh';
    const staleTypes: string[] = [];

    for (const [type, result] of Object.entries(types)) {
      if (result && statusOrder.indexOf(result.status) < statusOrder.indexOf(worstStatus)) {
        worstStatus = result.status;
      }
      if (result && result.status !== 'fresh') {
        staleTypes.push(type);
      }
    }

    let recommendation = 'All data fresh — ready for scoring.';
    if (worstStatus === 'missing') {
      recommendation = `Missing data: ${staleTypes.join(', ')}. Run imports to populate.`;
    } else if (worstStatus === 'stale') {
      recommendation = `Stale data: ${staleTypes.join(', ')}. Consider refreshing.`;
    }

    return { symbolId, ticker, status: worstStatus, types, recommendation };
  }

  /**
   * Generic freshness check for any data type with a custom fetcher.
   */
  private async checkDataType(
    symbolId: string,
    ticker: string | undefined,
    type: string,
    thresholdMinutes: number,
    fetcher: () => Promise<Date | null>,
  ): Promise<FreshnessResult> {
    try {
      const latest = await fetcher();
      if (!latest) {
        return { symbolId, ticker, timeframe: type, status: 'missing', latestTimestamp: null, ageMinutes: null };
      }
      const ageMinutes = (Date.now() - latest.getTime()) / 60000;
      const status: FreshnessStatus = ageMinutes <= thresholdMinutes ? 'fresh' : 'stale';
      return {
        symbolId, ticker, timeframe: type, status,
        latestTimestamp: latest.toISOString(),
        ageMinutes: Number(ageMinutes.toFixed(2)),
      };
    } catch {
      return { symbolId, ticker, timeframe: type, status: 'missing', latestTimestamp: null, ageMinutes: null };
    }
  }
}
