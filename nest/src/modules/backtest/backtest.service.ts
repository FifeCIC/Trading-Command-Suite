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

  async getChartData(
    symbol: string,
    timeframe = '1d',
    from?: string,
    to?: string,
  ): Promise<{
    bars: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
    signals: Array<{ time: string; type: string; score: number; label: string; price: number; pnl?: number }>;
    indicators: {
      rsi: Array<{ time: string; value: number }>;
      macd: Array<{ time: string; macd: number; signal: number; histogram: number }>;
      ema9: Array<{ time: string; value: number }>;
      ema21: Array<{ time: string; value: number }>;
    };
  }> {
    const where: Record<string, unknown> = {
      symbol: { ticker: symbol.toUpperCase() },
      timeframe,
    };

    if (from) {
      where.timestamp = { ...(where.timestamp as Record<string, unknown> || {}), gte: new Date(from) };
    }
    if (to) {
      where.timestamp = { ...(where.timestamp as Record<string, unknown> || {}), lte: new Date(to) };
    }

    const rows = await this.prisma.marketBar.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: 2000,
    });

    const closes = rows.map(r => Number(r.close));
    const highs = rows.map(r => Number(r.high));
    const lows = rows.map(r => Number(r.low));
    const volumes = rows.map(r => Number(r.volume));

    // Compute indicators
    const rsiValues = this.computeRSI(closes, 14);
    const macdData = this.computeMACD(closes);
    const ema9 = this.computeEMA(closes, 9);
    const ema21 = this.computeEMA(closes, 21);

    // Format bars for lightweight-charts
    const bars = rows.map((r, i) => ({
      time: r.timestamp.toISOString().split('T')[0],
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    // Generate signals from directive scoring on the full window
    const signals: Array<{ time: string; type: string; score: number; label: string; price: number; pnl?: number }> = [];
    const windowSize = 100;

    for (let day = windowSize; day < rows.length; day++) {
      const window = rows.slice(day - windowSize, day).map(r => ({
        timestamp: r.timestamp,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));

      const input: DirectiveInput = { symbol, bars: window };
      const results = this.directivesService.runAll(input);

      let totalScore = 0;
      for (const [id, result] of results) {
        const weight = STRATEGY_WEIGHTS[id] ?? 0;
        totalScore += (result.score * weight) / 100;
      }

      const score = Math.min(100, totalScore);
      const currentClose = window[window.length - 1].close;

      if (score >= ENTRY_THRESHOLD) {
        const future10 = rows[day + 10]?.close;
        const pnl = future10 ? Number(((Number(future10) - currentClose) / currentClose * 100).toFixed(2)) : undefined;

        signals.push({
          time: window[window.length - 1].timestamp.toISOString().split('T')[0],
          type: 'entry',
          score: Number(score.toFixed(1)),
          label: `Entry: score ${score.toFixed(0)}`,
          price: currentClose,
          pnl,
        });
      }
    }

    return {
      bars,
      signals,
      indicators: {
        rsi: rsiValues.map((v, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', value: v })),
        macd: macdData.map((m, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', ...m })),
        ema9: ema9.map((v, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', value: v })),
        ema21: ema21.map((v, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', value: v })),
      },
    };
  }

  // ── Indicator helpers (pure functions) ──

  private computeRSI(closes: number[], period: number): number[] {
    const result = Array(closes.length).fill(0);
    if (closes.length < period + 1) return result;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
    }
    return result;
  }

  private computeMACD(closes: number[]): Array<{ macd: number; signal: number; histogram: number }> {
    const ema12 = this.computeEMA(closes, 12);
    const ema26 = this.computeEMA(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = this.computeEMA(macdLine, 9);
    return macdLine.map((macd, i) => ({
      macd: Number(macd.toFixed(4)),
      signal: Number((signalLine[i] || 0).toFixed(4)),
      histogram: Number((macd - (signalLine[i] || 0)).toFixed(4)),
    }));
  }

  private computeEMA(values: number[], period: number): number[] {
    const result = Array(values.length).fill(0);
    if (values.length < period) return result;

    // SMA seed
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result[period - 1] = sum / period;

    const multiplier = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
    }
    return result;
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
