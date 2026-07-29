import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface GapStats {
  symbol: string;
  sampleCount: number;
  meanGapPct: number;      // Average gap as percentage
  maxAdverseGapPct: number; // Worst gap against the position (negative = bad for longs)
  maxFavorableGapPct: number; // Best gap (positive = good for longs)
  gapDirectionBias: 'bullish' | 'bearish' | 'neutral';
  lastGapPct: number | null;
  lastGapDate: string | null;
  maxGapDate: string | null;
}

export interface WeekendExposure {
  symbol: string;
  direction: 'BUY' | 'SELL';
  positionValue: number;
  projectedGapRisk: number;   // Dollar risk based on max adverse gap
  projectedGapRiskPct: number; // As percentage of position
  meanGapRisk: number;        // Dollar risk based on mean gap
  gapFillProbability: number; // Estimate of gap-fill likelihood (0-100)
  stats: GapStats | null;
}

@Injectable()
export class WeekendGapRiskService {
  private readonly logger = new Logger(WeekendGapRiskService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute weekend gap statistics for a symbol from historical 1d candles.
   * Gap = (Monday open - Friday close) / Friday close
   */
  async getGapStats(symbol: string): Promise<GapStats | null> {
    if (!this.prisma.isAvailable) return null;

    try {
      // Get 1d candles filtered by symbol ticker via relation
      const bars = await (this.prisma as any).marketBar.findMany({
        where: {
          symbol: { ticker: symbol.toUpperCase() },
          timeframe: '1d',
        },
        orderBy: { timestamp: 'desc' },
        take: 200,
      });

      if (!bars || bars.length < 10) {
        this.logger.warn(`Insufficient bar data for ${symbol} gap analysis (need 10+, have ${bars?.length || 0})`);
        return null;
      }

      // Sort ascending for chronological analysis
      bars.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const gaps: { date: string; gapPct: number }[] = [];

      for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1];
        const curr = bars[i];
        const prevDate = new Date(prev.timestamp);
        const currDate = new Date(curr.timestamp);

        // Detect weekend gap: Friday → Monday (day diff >= 2 calendar days)
        const dayDiff = (currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24);
        if (dayDiff >= 2 && dayDiff <= 4) {
          const gapPct = ((curr.open - prev.close) / prev.close) * 100;
          gaps.push({
            date: currDate.toISOString().split('T')[0],
            gapPct: Math.round(gapPct * 100) / 100,
          });
        }
      }

      if (gaps.length === 0) return null;

      const gapValues = gaps.map(g => g.gapPct);
      const mean = gapValues.reduce((a, b) => a + b, 0) / gapValues.length;
      const maxAdverse = Math.min(...gapValues); // Most negative gap
      const maxFavorable = Math.max(...gapValues); // Most positive gap
      const maxGapIdx = gapValues.indexOf(maxAdverse);
      const lastGap = gaps[gaps.length - 1];

      return {
        symbol: symbol.toUpperCase(),
        sampleCount: gaps.length,
        meanGapPct: Math.round(mean * 100) / 100,
        maxAdverseGapPct: Math.round(maxAdverse * 100) / 100,
        maxFavorableGapPct: Math.round(maxFavorable * 100) / 100,
        gapDirectionBias: mean > 0.1 ? 'bullish' : mean < -0.1 ? 'bearish' : 'neutral',
        lastGapPct: lastGap.gapPct,
        lastGapDate: lastGap.date,
        maxGapDate: gaps[maxGapIdx]?.date || null,
      };
    } catch (err) {
      this.logger.error(`Failed to compute gap stats for ${symbol}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Project weekend gap exposure for a position.
   *
   * @param symbol        Trading symbol
   * @param direction     BUY or SELL
   * @param positionValue Current position value in account currency
   */
  async projectExposure(
    symbol: string,
    direction: 'BUY' | 'SELL',
    positionValue: number,
  ): Promise<WeekendExposure> {
    const stats = await this.getGapStats(symbol);
    const isLong = direction === 'BUY';

    // For longs: adverse gap = price drops (negative gap%)
    // For shorts: adverse gap = price rises (positive gap%)
    const adverseGapPct = isLong
      ? (stats?.maxAdverseGapPct ?? -2)
      : (stats?.maxFavorableGapPct ?? 2);

    const meanGapPct = stats?.meanGapPct ?? 0;

    // Projected risk in dollars
    const projectedGapRisk = Math.abs(positionValue * adverseGapPct / 100);
    const meanGapRisk = Math.abs(positionValue * meanGapPct / 100);

    // Gap-fill probability estimate: if gaps tend to revert (mean near 0), fill probability is higher
    const gapFillProbability = stats
      ? Math.round(Math.max(0, Math.min(100, 100 - Math.abs(stats.meanGapPct) * 20)))
      : 50;

    return {
      symbol: symbol.toUpperCase(),
      direction,
      positionValue: Math.round(positionValue * 100) / 100,
      projectedGapRisk: Math.round(projectedGapRisk * 100) / 100,
      projectedGapRiskPct: Math.round(Math.abs(adverseGapPct) * 100) / 100,
      meanGapRisk: Math.round(meanGapRisk * 100) / 100,
      gapFillProbability,
      stats,
    };
  }
}
