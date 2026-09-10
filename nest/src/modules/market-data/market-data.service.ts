/**
 * MarketDataService — THE bar data boundary.
 *
 * ⚠️ CONTRACT: `getBars()` is the ONE way to load a window of bars for scoring or decision
 * paths. It owns three things that callers kept re-deriving, each time losing one of them:
 *   1. the `timeframe` filter  (a mixed-cadence array silently changes what every window means)
 *   2. `desc + take` selection  (`asc + take` returns the OLDEST N bars, not the newest)
 *   3. oldest → newest order     (the order ~34 directives assume via `bars[bars.length - 1]`)
 *
 * Two hand-rolled queries that bypassed this lost the timeframe filter; one of them also
 * scored 34 symbols on ~4-month-old data (#751). If you need bars, call getBars() — do not
 * write a third query. Invariants: INV-CANONICAL-LOADER, INV-BAR-WINDOW, INV-SINGLE-CADENCE
 * in `.github/instructions/meta-stack-contracts.instructions.md` (build-enforced).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type FreshnessStatus = 'fresh' | 'stale' | 'missing';

export type FreshnessResult = {
  symbolId: string;
  timeframe: string;
  maxAgeMinutes: number;
  status: FreshnessStatus;
  latestTimestamp: string | null;
  ageMinutes: number | null;
};

@Injectable()
export class MarketDataService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluateFreshness(
    symbolId: string,
    timeframe: string,
    maxAgeMinutes: number,
  ): Promise<FreshnessResult> {
    const latest = await this.prisma.marketBar.findFirst({
      where: {
        symbolId,
        timeframe,
      },
      orderBy: [{ timestamp: 'desc' }],
      select: {
        timestamp: true,
      },
    });

    if (!latest) {
      return {
        symbolId,
        timeframe,
        maxAgeMinutes,
        status: 'missing',
        latestTimestamp: null,
        ageMinutes: null,
      };
    }

    const ageMinutes = (Date.now() - latest.timestamp.getTime()) / 60000;
    const status: FreshnessStatus =
      ageMinutes <= maxAgeMinutes ? 'fresh' : 'stale';

    return {
      symbolId,
      timeframe,
      maxAgeMinutes,
      status,
      latestTimestamp: latest.timestamp.toISOString(),
      ageMinutes: Number(ageMinutes.toFixed(2)),
    };
  }

  async getLatestBar(symbolId: string, timeframe: string) {
    return this.prisma.marketBar.findFirst({
      where: {
        symbolId,
        timeframe,
      },
      orderBy: [{ timestamp: 'desc' }],
    });
  }

  /** Return the most recent N bars for a symbol, ordered oldest → newest (directive contract). */
  async getBars(symbolId: string, timeframe: string, count: number) {
    const bars = await this.prisma.marketBar.findMany({
      where: { symbolId, timeframe },
      orderBy: [{ timestamp: 'desc' }],
      take: count,
    });
    return bars.reverse();
  }

  /** Count available bars for a symbol+timeframe (used by data readiness checks). */
  async getBarCount(symbolId: string, timeframe: string): Promise<number> {
    return this.prisma.marketBar.count({
      where: { symbolId, timeframe },
    });
  }

  /** Get top price movers across all active symbols for a given lookback period. */
  async getTopMovers(lookback: string = '15m', limit: number = 20) {
    // Fetch all active symbols
    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { id: true, ticker: true, name: true, type: true, exchange: true },
    });
    if (!symbols.length) return { gainers: [], losers: [], lookback, totalSymbols: 0 };

    const now = new Date();
    const lookbackMs = this.parseLookbackMs(lookback);
    const cutoff = new Date(now.getTime() - lookbackMs);
    // Give a 2-minute window for the "lookback-ago" bar
    const windowStart = new Date(cutoff.getTime() - 120_000);
    const windowEnd = new Date(cutoff.getTime() + 120_000);

    const movers: Array<{
      symbolId: string; ticker: string; name: string; type: string; exchange: string;
      changePct: number; latestPrice: number; previousPrice: number;
      latestTime: string; volumeSpike: boolean;
    }> = [];

    for (const sym of symbols) {
      try {
        // Get latest bar
        const latest = await this.prisma.marketBar.findFirst({
          where: { symbolId: sym.id, timeframe: lookback },
          orderBy: { timestamp: 'desc' },
          select: { close: true, volume: true, timestamp: true },
        });
        if (!latest || !latest.close) continue;

        // Get bar closest to the lookback cutoff
        const previous = await this.prisma.marketBar.findFirst({
          where: {
            symbolId: sym.id,
            timeframe: lookback,
            timestamp: { gte: windowStart, lte: windowEnd },
          },
          orderBy: { timestamp: 'asc' },
          select: { close: true, volume: true },
        });

        if (previous && previous.close && previous.close > 0) {
          const changePct = ((latest.close - previous.close) / previous.close) * 100;
          // Volume spike: latest volume > 2x previous
          const volumeSpike = latest.volume && previous.volume && latest.volume > previous.volume * 2;

          if (Math.abs(changePct) > 0.01) { // filter out flat symbols
            movers.push({
              symbolId: sym.id,
              ticker: sym.ticker,
              name: sym.name,
              type: sym.type,
              exchange: sym.exchange,
              changePct: Math.round(changePct * 100) / 100,
              latestPrice: Math.round(latest.close * 100000) / 100000,
              previousPrice: Math.round(previous.close * 100000) / 100000,
              latestTime: latest.timestamp.toISOString(),
              volumeSpike: !!volumeSpike,
            });
          }
        }
      } catch { /* skip symbols with no data */ }
    }

    // Sort: highest change first for gainers, lowest first for losers
    const sorted = movers.sort((a, b) => b.changePct - a.changePct);
    const gainers = sorted.filter(m => m.changePct > 0).slice(0, limit);
    const losers = sorted.filter(m => m.changePct < 0).reverse().slice(0, limit);

    return { gainers, losers, lookback, totalSymbols: symbols.length, matchedSymbols: movers.length };
  }

  private parseLookbackMs(lookback: string): number {
    const match = lookback.match(/^(\d+)(m|h|d)$/);
    if (!match) return 15 * 60_000;
    const value = parseInt(match[1]);
    const unit = match[2];
    if (unit === 'm') return value * 60_000;
    if (unit === 'h') return value * 3600_000;
    if (unit === 'd') return value * 86400_000;
    return 15 * 60_000;
  }
}
