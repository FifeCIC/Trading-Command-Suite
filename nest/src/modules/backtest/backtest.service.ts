import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { ScoringService } from '../scoring/scoring.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
    private readonly scoringService: ScoringService,
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

      const { composite, signal } = await this.fullScore(symbol, window, groups);
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

    // ── Persist to database ──────────────────────────────
    let persistedRunId: string | null = null;
    try {
      const symbolRow = await this.prisma.symbol.findUnique({ where: { ticker: symbol.toUpperCase() } });
      if (symbolRow) {
        const run = await this.prisma.backtestRun.create({
          data: {
            symbolId: symbolRow.id,
            protocolId: protocolId ?? 'default',
            timeframe,
            startDate: bars[windowSize].timestamp,
            endDate: bars[bars.length - 1].timestamp,
            totalDays: days,
            totalTrades: trades.length,
            winRate: Number(winRate.toFixed(4)),
            totalPnl: Number(totalPnl.toFixed(4)),
            profitFactor: Number((grossProfit / grossLoss).toFixed(4)),
            sharpeRatio: Number(sharpeApproximation.toFixed(4)),
            maxDrawdown: Number(maxDrawdown10d.toFixed(4)),
            avgTradePnl: Number(avgTradePnl.toFixed(4)),
          },
        });
        persistedRunId = run.id;

        // Persist individual trades
        if (trades.length > 0) {
          await this.prisma.backtestTrade.createMany({
            data: trades.map((t) => ({
              runId: run.id,
              symbolId: symbolRow.id,
              entryDate: new Date(t.entryDate),
              entryPrice: t.entryPrice,
              exitDate: new Date(t.exitDate),
              exitPrice: t.exitPrice,
              direction: t.direction,
              pnl: t.pnl,
              pnlPct: t.pnlPct,
              exitReason: t.exitReason,
              entryScore: t.score,
              signal: t.signal,
            })),
          });
        }
        this.logger.log(`Backtest persisted: run=${run.id}, symbol=${symbol}, trades=${trades.length}`);
      }
    } catch (err) {
      this.logger.error(`Failed to persist backtest for ${symbol}: ${(err as Error).message}`);
    }

    this.logger.log(`Backtest ${symbol}: ${entrySignals.length} signals, winRate=${(winRate*100).toFixed(0)}%`);
    return { ...result, id: persistedRunId || result.id };
  }

  async getResult(runId: string): Promise<BacktestResult | null> {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: runId },
      include: { trades: true, symbol: true },
    });
    if (!run) return null;
    return this.formatRunResult(run);
  }

  async getSummary(symbol: string): Promise<{ symbol: string; runs: { id: string; date: string; signals: number; winRate: number }[] }> {
    const symbolRow = await this.prisma.symbol.findUnique({ where: { ticker: symbol.toUpperCase() } });
    if (!symbolRow) return { symbol, runs: [] };
    const runs = await this.prisma.backtestRun.findMany({
      where: { symbolId: symbolRow.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      symbol,
      runs: runs.map((r) => ({
        id: r.id,
        date: `${r.startDate.toISOString().split('T')[0]} to ${r.endDate.toISOString().split('T')[0]}`,
        signals: r.totalTrades,
        winRate: r.winRate,
      })),
    };
  }

  async listProtocolRuns(protocolId: string, limit = 20) {
    return this.prisma.backtestRun.findMany({
      where: { protocolId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { symbol: { select: { ticker: true } } },
    });
  }

  private formatRunResult(run: any): BacktestResult {
    return {
      id: run.id,
      symbol: run.symbol?.ticker || '',
      protocolId: run.protocolId,
      period: `${run.startDate.toISOString().split('T')[0]} to ${run.endDate.toISOString().split('T')[0]}`,
      totalDays: run.totalDays,
      timeframe: run.timeframe,
      entrySignals: [],
      trades: run.trades?.map((t: any) => ({
        entryDate: t.entryDate.toISOString(),
        entryPrice: Number(t.entryPrice),
        exitDate: t.exitDate.toISOString(),
        exitPrice: Number(t.exitPrice),
        direction: t.direction,
        pnl: Number(t.pnl),
        pnlPct: Number(t.pnlPct),
        exitReason: t.exitReason,
        score: Number(t.entryScore),
        signal: t.signal,
        protocolId: run.protocolId,
      })) || [],
      stats: {
        totalSignals: run.totalTrades,
        winRate: run.winRate,
        averageReturn10d: 0,
        maxReturn10d: 0,
        maxDrawdown10d: run.maxDrawdown,
        profitFactor: run.profitFactor,
        sharpeApproximation: run.sharpeRatio,
        totalTrades: run.totalTrades,
        tradeWinRate: run.winRate,
        avgTradePnl: run.avgTradePnl,
        totalPnl: run.totalPnl,
        maxTradeDrawdown: run.maxDrawdown,
      },
    };
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
      const { composite: score, signal } = await this.fullScore(symbol, window, DIRECTIVE_GROUPS);

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

  // ── Full SEES Pipeline (production parity) ──────────

  /**
   * Full production scoring pipeline for backtest — mirrors
   * ScoringService.rankAll() with dominance/cancellation,
   * calibration, and weighted aggregation.
   */
  private async fullScore(
    symbol: string,
    bars: MarketBar[],
    groups: DirectiveGroup[],
  ): Promise<{ composite: number; signal: string; breakdown: Array<{ directiveId: string; score: number; maxScore: number; signalClass: string }> }> {
    const input: DirectiveInput = { symbol, bars };
    const allResults = await this.directivesService.runAll(input);

    // Collect all directive IDs from groups
    const directiveIds = new Set<string>();
    for (const g of groups) {
      for (const id of g.directiveIds) directiveIds.add(id);
    }

    // Phase 1: Build breakdown with signalClass and priority
    type BreakdownEntry = { directiveId: string; score: number; maxScore: number; confidence: number; signalClass: string; priority: number };
    const breakdown: BreakdownEntry[] = [];
    const signalGroups = { bullish: 0, bearish: 0, neutral: 0 };

    for (const id of directiveIds) {
      const result = allResults.get(id);
      if (!result) continue;
      const directive = this.directivesService.get(id);
      const maxScore = directive?.maxScore ?? 100;
      const priority = directive?.priority ?? 50;
      const signalClass = result.signalClass ?? 'neutral';

      if (signalClass === 'bullish') signalGroups.bullish += maxScore;
      else if (signalClass === 'bearish') signalGroups.bearish += maxScore;
      else signalGroups.neutral += maxScore;

      breakdown.push({
        directiveId: id,
        score: result.score,
        maxScore,
        confidence: result.confidence,
        signalClass,
        priority,
      });
    }

    // Phase 2: Dominance/cancellation
    const suppressedIds = new Set<string>();
    const highPrioBull = breakdown.filter((d) => d.signalClass === 'bullish' && d.priority >= 80);
    const highPrioBear = breakdown.filter((d) => d.signalClass === 'bearish' && d.priority >= 80);

    if (highPrioBull.length > 0 && highPrioBear.length === 0) {
      for (const d of breakdown) {
        if (d.signalClass === 'bearish' && d.priority < 60) suppressedIds.add(d.directiveId);
      }
    } else if (highPrioBear.length > 0 && highPrioBull.length === 0) {
      for (const d of breakdown) {
        if (d.signalClass === 'bullish' && d.priority < 60) suppressedIds.add(d.directiveId);
      }
    }

    const totalWeight = breakdown.reduce((s, d) => s + d.maxScore, 0);
    const bullRatio = totalWeight > 0 ? signalGroups.bullish / totalWeight : 0;
    const bearRatio = totalWeight > 0 ? signalGroups.bearish / totalWeight : 0;

    if (bullRatio > bearRatio * 2 && bullRatio > 0.4) {
      for (const d of breakdown) {
        if (d.signalClass === 'bearish' && d.confidence < 0.5) suppressedIds.add(d.directiveId);
      }
    } else if (bearRatio > bullRatio * 2 && bearRatio > 0.4) {
      for (const d of breakdown) {
        if (d.signalClass === 'bullish' && d.confidence < 0.5) suppressedIds.add(d.directiveId);
      }
    }

    // Phase 3: Group-weighted aggregation
    let totalScore = 0;
    let totalMax = 0;
    let bullishWeight = 0;
    let bearishWeight = 0;

    for (const d of breakdown) {
      if (suppressedIds.has(d.directiveId)) continue;
      totalScore += d.score;
      totalMax += d.maxScore;
      if (d.signalClass === 'bullish') bullishWeight += d.maxScore;
      else if (d.signalClass === 'bearish') bearishWeight += d.maxScore;
    }

    const normalized = totalMax > 0 ? (totalScore / totalMax) * 100 : 50;

    // Risk gate from risk group
    const riskGroup = groups.find((g) => g.id === 'risk');
    let riskMultiplier = 1.0;
    if (riskGroup) {
      // Find risk directives in the breakdown
      const riskDirectives = riskGroup.directiveIds;
      let riskScore = 50;
      let riskCount = 0;
      for (const id of riskDirectives) {
        const result = allResults.get(id);
        if (result) {
          const d = this.directivesService.get(id);
          riskScore += (result.score / (d?.maxScore || 100)) * 100;
          riskCount++;
        }
      }
      if (riskCount > 0) {
        riskScore = riskScore / riskCount;
        riskMultiplier = Math.max(riskGroup.minMultiplier, Math.min(riskGroup.maxMultiplier, riskScore / 100));
      }
    }

    const composite = Math.round(Math.max(0, normalized * riskMultiplier));
    let signal = 'HOLD';
    if (bullishWeight > bearishWeight * 1.5) signal = 'BUY';
    else if (bearishWeight > bullishWeight * 1.5) signal = 'SELL';

    return {
      composite,
      signal,
      breakdown: breakdown
        .filter((d) => !suppressedIds.has(d.directiveId))
        .map((d) => ({ directiveId: d.directiveId, score: d.score, maxScore: d.maxScore, signalClass: d.signalClass })),
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

  // ── Grid Search Optimization ────────────────────────

  async optimize(params: {
    symbol: string;
    days?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }): Promise<{ best: BacktestResult; runs: number; params: { slPct: number; tpPct: number; winRate: number }[] }> {
    const { symbol, days = 365, protocolId, slRange = { min: 1, max: 5, step: 1 }, tpRange = { min: 1, max: 10, step: 2 } } = params;
    this.logger.log(`Grid search: ${symbol} SL=${slRange.min}-${slRange.max} TP=${tpRange.min}-${tpRange.max}`);

    let best: BacktestResult | null = null;
    const allRuns: { slPct: number; tpPct: number; winRate: number }[] = [];

    for (let sl = slRange.min; sl <= slRange.max; sl += slRange.step) {
      for (let tp = tpRange.min; tp <= tpRange.max; tp += tpRange.step) {
        const result = await this.run({ symbol, days, protocolId, slPct: sl, tpPct: tp });
        const wr = result.stats.tradeWinRate ?? result.stats.winRate;
        allRuns.push({ slPct: sl, tpPct: tp, winRate: wr });

        if (!best || (result.stats.totalPnl ?? 0) > (best.stats.totalPnl ?? 0)) {
          best = result;
        }
      }
    }

    return { best: best!, runs: allRuns.length, params: allRuns.sort((a, b) => b.winRate - a.winRate) };
  }

  // ── Walk-Forward Optimization ───────────────────────

  async walkForward(params: {
    symbol: string;
    trainDays?: number;
    testDays?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }): Promise<{ train: BacktestResult; test: BacktestResult; optimizedParams: { slPct: number; tpPct: number }; outOfSampleWinRate: number }> {
    const { symbol, trainDays = 730, testDays = 365, protocolId, slRange = { min: 1, max: 5, step: 1 }, tpRange = { min: 1, max: 10, step: 2 } } = params;
    this.logger.log(`Walk-forward: ${symbol} train=${trainDays}d test=${testDays}d`);

    // Step 1: Optimize on training period
    const opt = await this.optimize({ symbol, days: trainDays, protocolId, slRange, tpRange });
    const bestParams = opt.params[0]; // highest win rate

    // Step 2: Run on test period with optimized params
    const testResult = await this.run({
      symbol,
      days: testDays,
      protocolId,
      slPct: bestParams.slPct,
      tpPct: bestParams.tpPct,
    });

    const trainResult = opt.best;

    return {
      train: trainResult,
      test: testResult,
      optimizedParams: { slPct: bestParams.slPct, tpPct: bestParams.tpPct },
      outOfSampleWinRate: testResult.stats.tradeWinRate ?? testResult.stats.winRate,
    };
  }
}
