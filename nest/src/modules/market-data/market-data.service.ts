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
    // Reverse to oldest→newest per DirectiveInput contract
    return bars.reverse();
  }
}
