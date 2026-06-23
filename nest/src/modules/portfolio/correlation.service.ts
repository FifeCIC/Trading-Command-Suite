/**
 * Correlation Service (Q307)
 * ==========================
 * Pearson correlation matrix between all traded symbols.
 * Rolling 90-day window, updated daily.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

export interface CorrelationMatrix {
  symbols: string[];
  matrix: (number | null)[][];  // null = not yet computed
  flags: { pair: string; correlation: number; warning: string }[];
  computedAt: string;
}

@Injectable()
export class CorrelationService {
  private readonly logger = new Logger(CorrelationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Daily at 06:00 — compute correlation matrix for all active symbols.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async computeAll() {
    this.logger.log('Starting daily correlation computation...');
    const start = Date.now();

    try {
      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });
      const tickers = symbols.map((s) => s.ticker);

      for (let i = 0; i < tickers.length; i++) {
        for (let j = i + 1; j < tickers.length; j++) {
          const corr = await this.computePairCorrelation(tickers[i], tickers[j], 90);
          if (corr !== null) {
            await this.prisma.correlationPair.upsert({
              where: {
                symbolA_symbolB_periodDays: {
                  symbolA: tickers[i],
                  symbolB: tickers[j],
                  periodDays: 90,
                },
              },
              create: {
                symbolA: tickers[i],
                symbolB: tickers[j],
                correlation: corr,
                periodDays: 90,
              },
              update: { correlation: corr, computedAt: new Date() },
            });
          }
        }
      }

      this.logger.log(`Correlation matrix computed for ${tickers.length} symbols (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    } catch (err) {
      this.logger.error(`Correlation computation failed: ${(err as Error).message}`);
    }
  }

  /** Get correlation matrix for specified symbols (or all active). */
  async getMatrix(symbols?: string[]): Promise<CorrelationMatrix> {
    const tickers = symbols?.length
      ? symbols
      : (await this.prisma.symbol.findMany({ where: { active: true }, select: { ticker: true } })).map((s) => s.ticker);

    const pairs = await this.prisma.correlationPair.findMany({
      where: { symbolA: { in: tickers }, symbolB: { in: tickers } },
    });

    // Build matrix
    const n = tickers.length;
    const matrix: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
    const pairMap = new Map<string, number>();
    for (const p of pairs) {
      pairMap.set(`${p.symbolA}|${p.symbolB}`, p.correlation);
      pairMap.set(`${p.symbolB}|${p.symbolA}`, p.correlation);
    }

    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const raw = pairMap.get(`${tickers[i]}|${tickers[j]}`);
        if (raw !== undefined) {
          matrix[i][j] = Math.round(raw * 100) / 100;
          matrix[j][i] = Math.round(raw * 100) / 100;
        }
        // else stays null (uncomputed)
      }
    }

    // Flag high correlations
    const flags: { pair: string; correlation: number; warning: string }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const r = matrix[i][j];
        if (r === null) continue; // skip uncomputed pairs
        if (r > 0.7) {
          flags.push({ pair: `${tickers[i]} + ${tickers[j]}`, correlation: r, warning: 'High positive correlation — reduce combined exposure if long both' });
        } else if (r > 0.5) {
          flags.push({ pair: `${tickers[i]} + ${tickers[j]}`, correlation: r, warning: 'Moderate correlation — sector overlap possible' });
        } else if (r < -0.3) {
          flags.push({ pair: `${tickers[i]} + ${tickers[j]}`, correlation: r, warning: 'Negative correlation — good hedging opportunity' });
        }
      }
    }
    flags.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

    return {
      symbols: tickers,
      matrix,
      flags: flags.slice(0, 10),
      computedAt: new Date().toISOString(),
    };
  }

  /**
   * Compute Pearson correlation between two symbols over a period.
   * Uses daily close prices from MarketBar.
   */
  async computePairCorrelation(
    tickerA: string,
    tickerB: string,
    periodDays: number,
  ): Promise<number | null> {
    const since = new Date(Date.now() - periodDays * 86400000);

    const symA = await this.prisma.symbol.findUnique({ where: { ticker: tickerA } });
    const symB = await this.prisma.symbol.findUnique({ where: { ticker: tickerB } });
    if (!symA || !symB) return null;

    const [barsA, barsB] = await Promise.all([
      this.prisma.marketBar.findMany({
        where: { symbolId: symA.id, timeframe: '1d', timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.marketBar.findMany({
        where: { symbolId: symB.id, timeframe: '1d', timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
      }),
    ]);

    if (barsA.length < 5 || barsB.length < 5) return null;

    // Align by date
    const dateMap = new Map<string, { a: number; b: number }>();
    for (const b of barsA) {
      const key = b.timestamp.toISOString().substring(0, 10);
      const existing = dateMap.get(key) || { a: 0, b: 0 };
      existing.a = Number(b.close);
      dateMap.set(key, existing);
    }
    for (const b of barsB) {
      const key = b.timestamp.toISOString().substring(0, 10);
      const existing = dateMap.get(key);
      if (existing) {
        existing.b = Number(b.close);
        dateMap.set(key, existing);
      }
    }

    const pairs = Array.from(dateMap.values()).filter((p) => p.a !== 0 && p.b !== 0);
    if (pairs.length < 5) return null;

    return this.pearson(pairs.map((p) => p.a), pairs.map((p) => p.b));
  }

  /** Standard Pearson correlation coefficient. */
  private pearson(x: number[], y: number[]): number {
    const n = x.length;
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
    const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);
    const sumY2 = y.reduce((s, yi) => s + yi * yi, 0);

    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
  }

  /** Exposure analysis by currency and sector. */
  async getExposure() {
    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { id: true, ticker: true },
    });

    const byCurrency: Record<string, number> = {};
    for (const sym of symbols) {
      const lastBar = await this.prisma.marketBar.findFirst({
        where: { symbolId: sym.id, timeframe: '1d' },
        orderBy: { timestamp: 'desc' },
      });
      if (!lastBar) continue;
      const parts = sym.ticker.split('_');
      const currency = parts.length > 1 ? parts[parts.length - 1] : 'USD';
      byCurrency[currency] = (byCurrency[currency] || 0) + Number(lastBar.close);
    }

    return { byCurrency: { long: byCurrency }, computedAt: new Date().toISOString() };
  }
}
