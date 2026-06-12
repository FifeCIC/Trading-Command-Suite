import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { DirectiveInput, MarketBar } from '../directives/interfaces/directive.interface';

const STRATEGY_WEIGHTS: Record<string, number> = {
  'rsi-oversold': 24, 'macd-crossover': 22, 'ema-structure': 20, 'atr-dip': 18, 'volume-confirmation': 16,
};
const ENTRY_THRESHOLD = 60;

export interface BacktestRunRequest {
  symbol: string;
  days?: number;
  timeframe?: string;
}

export interface EntrySignal {
  date: string;
  score: number;
  signal: string;
  return5d: number | null;
  return10d: number | null;
  return20d: number | null;
  wasProfitable: boolean;
}

export interface BacktestResult {
  id: string;
  symbol: string;
  period: string;
  totalDays: number;
  entrySignals: EntrySignal[];
  stats: {
    totalSignals: number;
    winRate: number;
    averageReturn10d: number;
    maxReturn10d: number;
    maxDrawdown10d: number;
    profitFactor: number;
    sharpeApproximation: number;
  };
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);
  private results = new Map<string, BacktestResult>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
  ) {}

  async run(request: BacktestRunRequest): Promise<BacktestResult> {
    const { symbol, days = 365, timeframe = '1d' } = request;
    this.logger.log(`Backtest: ${symbol} over ${days} days (${timeframe})`);

    // Load all bars for symbol
    const rows = await this.prisma.marketBar.findMany({
      where: {
        symbol: { ticker: symbol.toUpperCase() },
        timeframe,
      },
      orderBy: { timestamp: 'asc' },
      take: days + 120, // extra for warmup
    });

    if (rows.length < 120) {
      throw new Error(`Not enough data for ${symbol}: need 120+ bars, have ${rows.length}`);
    }

    const bars: MarketBar[] = rows.map((r) => ({
      timestamp: r.timestamp,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    const entrySignals: EntrySignal[] = [];
    const windowSize = 100;

    for (let day = windowSize; day < bars.length; day++) {
      const window = bars.slice(day - windowSize, day);
      const input: DirectiveInput = { symbol, bars: window };
      const results = this.directivesService.runAll(input);

      let totalScore = 0;
      for (const [id, result] of results) {
        const weight = STRATEGY_WEIGHTS[id] ?? 0;
        totalScore += (result.score * weight) / 100;
      }

      const score = Math.min(100, totalScore);
      const signal = score >= ENTRY_THRESHOLD ? 'entry' : score >= 40 ? 'watch' : 'defensive';

      if (signal === 'entry') {
        const currentClose = window[window.length - 1].close;
        const future5 = bars[day + 5]?.close;
        const future10 = bars[day + 10]?.close;
        const future20 = bars[day + Math.min(20, bars.length - day - 1)]?.close;

        entrySignals.push({
          date: window[window.length - 1].timestamp.toISOString().split('T')[0],
          score: Number(score.toFixed(1)),
          signal,
          return5d: future5 ? Number(((future5 - currentClose) / currentClose * 100).toFixed(2)) : null,
          return10d: future10 ? Number(((future10 - currentClose) / currentClose * 100).toFixed(2)) : null,
          return20d: future20 ? Number(((future20 - currentClose) / currentClose * 100).toFixed(2)) : null,
          wasProfitable: (future10 || 0) > currentClose,
        });
      }
    }

    // Aggregate stats
    const profitable = entrySignals.filter((s) => s.wasProfitable).length;
    const returns10d = entrySignals.filter((s) => s.return10d != null).map((s) => s.return10d!);
    const avgReturn10d = returns10d.length ? returns10d.reduce((a, b) => a + b, 0) / returns10d.length : 0;
    const maxReturn10d = returns10d.length ? Math.max(...returns10d) : 0;
    const maxDrawdown10d = returns10d.length ? Math.min(...returns10d) : 0;
    const grossProfit = returns10d.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(returns10d.filter((r) => r < 0).reduce((a, b) => a + b, 0)) || 1;
    const stdDev = Math.sqrt(returns10d.reduce((s, r) => s + (r - avgReturn10d) ** 2, 0) / (returns10d.length || 1));

    const winRate = entrySignals.length ? profitable / entrySignals.length : 0;
    const sharpeApproximation = stdDev > 0 ? (avgReturn10d / stdDev) * Math.sqrt(252 / 10) : 0;

    const result: BacktestResult = {
      id: `${symbol}-${Date.now()}`,
      symbol: symbol.toUpperCase(),
      period: `${bars[windowSize].timestamp.toISOString().split('T')[0]} to ${bars[bars.length - 1].timestamp.toISOString().split('T')[0]}`,
      totalDays: days,
      entrySignals: entrySignals.slice(-200), // keep last 200 entries
      stats: {
        totalSignals: entrySignals.length,
        winRate: Number(winRate.toFixed(2)),
        averageReturn10d: Number(avgReturn10d.toFixed(2)),
        maxReturn10d: Number(maxReturn10d.toFixed(2)),
        maxDrawdown10d: Number(maxDrawdown10d.toFixed(2)),
        profitFactor: Number((grossProfit / grossLoss).toFixed(2)),
        sharpeApproximation: Number(sharpeApproximation.toFixed(2)),
      },
    };

    this.results.set(result.id, result);
    this.logger.log(`Backtest ${symbol}: ${entrySignals.length} signals, winRate=${(winRate*100).toFixed(0)}%`);
    return result;
  }

  getResult(runId: string): BacktestResult | null {
    return this.results.get(runId) || null;
  }

  getSummary(symbol: string): { symbol: string; runs: { id: string; date: string; signals: number; winRate: number }[] } {
    const runs: { id: string; date: string; signals: number; winRate: number }[] = [];
    for (const [, r] of this.results) {
      if (r.symbol === symbol.toUpperCase()) {
        runs.push({ id: r.id, date: r.period, signals: r.stats.totalSignals, winRate: r.stats.winRate });
      }
    }
    return { symbol, runs };
  }

  async getDatasets(): Promise<Array<{ symbol: string; type: string; bars: number; from: string; to: string; source: string }>> {
    const datasets: Array<{ symbol: string; type: string; bars: number; from: string; to: string; source: string }> = [];

    try {
      // Query MarketBar for pre-loaded datasets (200+ bars = notable dataset)
      const symbols = await this.prisma.symbol.findMany({
        select: { id: true, ticker: true, type: true },
      });

      for (const sym of symbols) {
        const count = await this.prisma.marketBar.count({
          where: { symbolId: sym.id, timeframe: '1d' },
        });

        if (count >= 200) {
          const first = await this.prisma.marketBar.findFirst({
            where: { symbolId: sym.id, timeframe: '1d' },
            orderBy: { timestamp: 'asc' },
          });
          const last = await this.prisma.marketBar.findFirst({
            where: { symbolId: sym.id, timeframe: '1d' },
            orderBy: { timestamp: 'desc' },
          });

          datasets.push({
            symbol: sym.ticker,
            type: sym.type || 'stock',
            bars: count,
            from: first ? first.timestamp.toISOString().slice(0, 10) : '—',
            to: last ? last.timestamp.toISOString().slice(0, 10) : '—',
            source: count >= 1000 ? 'pre-loaded' : 'partial',
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to query datasets: ${String(error)}`);
    }

    return datasets;
  }
}
