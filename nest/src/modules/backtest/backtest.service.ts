import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { DirectiveInput, DirectiveResult, MarketBar } from '../directives/interfaces/directive.interface';
import {
  DIRECTIVE_GROUPS,
  BTC_SPEED_GROUPS,
  PROTOCOL_REGISTRY,
  DirectiveGroup,
} from '../directives/directive-groups';

export interface BacktestRunRequest {
  symbol: string;
  days?: number;
  timeframe?: string;
  protocolId?: string;         // NEW: which protocol to test
  slPct?: number;              // NEW: stop-loss % (for bracket simulation)
  tpPct?: number;              // NEW: take-profit % (for bracket simulation)
}

export interface TradeRecord {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  direction: 'LONG' | 'SHORT';
  pnl: number;
  pnlPct: number;
  exitReason: 'TP' | 'SL' | 'EOD';  // Take-profit, Stop-loss, End-of-data
  score: number;
  signal: string;
  protocolId: string;
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
  protocolId: string;
  period: string;
  totalDays: number;
  timeframe: string;
  entrySignals: EntrySignal[];
  trades?: TradeRecord[];              // NEW: bracket simulation results
  stats: {
    totalSignals: number;
    winRate: number;
    averageReturn10d: number;
    maxReturn10d: number;
    maxDrawdown10d: number;
    profitFactor: number;
    sharpeApproximation: number;
    // NEW: bracket trade stats
    totalTrades?: number;
    tradeWinRate?: number;
    avgTradePnl?: number;
    totalPnl?: number;
    maxTradeDrawdown?: number;
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
    const {
      symbol,
      days = 365,
      timeframe = '1d',
      protocolId,
      slPct = 1.0,
      tpPct = 1.0,
    } = request;

    const doBrackets = slPct > 0 && tpPct > 0;
    this.logger.log(`Backtest: ${symbol} over ${days} days (${timeframe}), protocol=${protocolId ?? 'default'}, brackets=${doBrackets}`);

    // Load all bars
    const rows = await this.prisma.marketBar.findMany({
      where: {
        symbol: { ticker: symbol.toUpperCase() },
        timeframe,
      },
      orderBy: { timestamp: 'asc' },
      take: days + 120,
    });

    if (rows.length < 100) {
      throw new Error(`Not enough data for ${symbol}: need 100+ bars, have ${rows.length}. Try importing data first.`);
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
    const trades: TradeRecord[] = [];
    const windowSize = 100;

    for (let day = windowSize; day < bars.length; day++) {
      const window = bars.slice(day - windowSize, day);

      // Inline protocol-gated scoring (avoids DI circular deps)
      const groups = protocolId
        ? (PROTOCOL_REGISTRY[protocolId]?.groups ?? DIRECTIVE_GROUPS)
        : DIRECTIVE_GROUPS;

      const { composite, signal } = await this.gateScore(symbol, window, groups);
      const score = composite;

      const currentBar = bars[day];
      const currentClose = currentBar.close;

      // Entry signal
      if (signal === 'BUY') {
        const future5 = bars[day + 5]?.close;
        const future10 = bars[day + 10]?.close;
        const future20 = bars[day + Math.min(20, bars.length - day - 1)]?.close;

        entrySignals.push({
          date: currentBar.timestamp.toISOString().split('T')[0],
          score: Number(score.toFixed(1)),
          signal,
          return5d: future5 ? Number(((future5 - currentClose) / currentClose * 100).toFixed(2)) : null,
          return10d: future10 ? Number(((future10 - currentClose) / currentClose * 100).toFixed(2)) : null,
          return20d: future20 ? Number(((future20 - currentClose) / currentClose * 100).toFixed(2)) : null,
          wasProfitable: (future10 || 0) > currentClose,
        });

        // Bracket order simulation
        if (doBrackets) {
          const slPrice = currentClose * (1 - slPct / 100);
          const tpPrice = currentClose * (1 + tpPct / 100);

          let exitPrice = currentClose;
          let exitReason: TradeRecord['exitReason'] = 'EOD';
          let exitDate = currentBar.timestamp.toISOString().split('T')[0];

          // Walk forward through remaining bars to check SL/TP
          for (let future = day + 1; future < bars.length; future++) {
            const fb = bars[future];

            // Check intra-bar: did SL or TP get hit?
            // For a LONG trade: SL is below entry, TP is above
            if (fb.low <= slPrice) {
              exitPrice = slPrice;
              exitReason = 'SL';
              exitDate = fb.timestamp.toISOString().split('T')[0];
              break;
            }
            if (fb.high >= tpPrice) {
              exitPrice = tpPrice;
              exitReason = 'TP';
              exitDate = fb.timestamp.toISOString().split('T')[0];
              break;
            }
          }

          const pnl = exitPrice - currentClose;
          const pnlPct = (pnl / currentClose) * 100;

          trades.push({
            entryDate: currentBar.timestamp.toISOString().split('T')[0],
            entryPrice: currentClose,
            exitDate,
            exitPrice,
            direction: 'LONG',
            pnl: Number(pnl.toFixed(4)),
            pnlPct: Number(pnlPct.toFixed(2)),
            exitReason,
            score: Number(score.toFixed(1)),
            signal,
            protocolId: protocolId ?? 'default',
          });
        }
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

    // Bracket trade stats
    const tradeWinners = trades.filter(t => t.pnl > 0).length;
    const tradeWinRate = trades.length ? tradeWinners / trades.length : 0;
    const avgTradePnl = trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const tradePnls = trades.map(t => t.pnl);
    const maxTradeDrawdown = tradePnls.length ? Math.min(...tradePnls) : 0;

    const result: BacktestResult = {
      id: `${symbol}-${Date.now()}`,
      symbol: symbol.toUpperCase(),
      protocolId: protocolId ?? 'default',
      period: `${bars[windowSize].timestamp.toISOString().split('T')[0]} to ${bars[bars.length - 1].timestamp.toISOString().split('T')[0]}`,
      totalDays: days,
      timeframe,
      entrySignals: entrySignals.slice(-200),
      trades: doBrackets ? trades : undefined,
      stats: {
        totalSignals: entrySignals.length,
        winRate: Number(winRate.toFixed(2)),
        averageReturn10d: Number(avgReturn10d.toFixed(2)),
        maxReturn10d: Number(maxReturn10d.toFixed(2)),
        maxDrawdown10d: Number(maxDrawdown10d.toFixed(2)),
        profitFactor: Number((grossProfit / grossLoss).toFixed(2)),
        sharpeApproximation: Number(sharpeApproximation.toFixed(2)),
        ...(doBrackets ? {
          totalTrades: trades.length,
          tradeWinRate: Number(tradeWinRate.toFixed(2)),
          avgTradePnl: Number(avgTradePnl.toFixed(2)),
          totalPnl: Number(totalPnl.toFixed(4)),
          maxTradeDrawdown: Number(maxTradeDrawdown.toFixed(4)),
        } : {}),
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

      // Use inline protocol-gated scoring
      const { composite: score, signal } = await this.gateScore(symbol, window, DIRECTIVE_GROUPS);

      const currentClose = window[window.length - 1].close;

      if (signal === 'BUY') {
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

  // ── Inline Gating (avoids DI circular dependency with ScoringModule) ──

  /**
   * Compute a gated score inline using DirectivesService + directive groups.
   * Same logic as ProtocolGatingService.scoreWithGating() but self-contained.
   */
  private async gateScore(
    symbol: string,
    bars: MarketBar[],
    groups: DirectiveGroup[],
  ): Promise<{ composite: number; signal: string }> {
    const input: DirectiveInput = { symbol, bars };
    const allResults = this.directivesService.runAll(input);

    let technicalScore = 50;
    let sentimentScore = 50;
    let riskScore = 50;

    for (const group of groups) {
      let totalNorm = 0;
      let count = 0;
      for (const directiveId of group.directiveIds) {
        const result = allResults.get(directiveId);
        if (!result) continue;
        const directive = this.directivesService.get(directiveId);
        const maxScore = directive?.maxScore ?? 100;
        const normalized = maxScore > 0 ? (result.score / maxScore) * 100 : 0;
        totalNorm += normalized;
        count++;
      }
      const avg = count > 0 ? totalNorm / count : 50;
      if (group.id === 'technical') technicalScore = avg;
      else if (group.id === 'sentiment') sentimentScore = avg;
      else if (group.id === 'risk') riskScore = avg;
    }

    // Risk gate
    const riskGroup = groups.find(g => g.id === 'risk');
    let riskMultiplier = riskScore / 100;
    if (riskGroup) {
      riskMultiplier = Math.max(riskGroup.minMultiplier, Math.min(riskGroup.maxMultiplier, riskMultiplier));
    }

    const raw = (technicalScore * 0.40 + sentimentScore * 0.35) * riskMultiplier;
    const composite = Math.round(Math.max(0, Math.min(100, raw)));
    const signal = composite >= 65 ? 'BUY' : composite >= 35 ? 'HOLD' : 'SELL';

    return { composite, signal };
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
