/**
 * TradeHistoryController — unified trade audit trail
 * ====================================================
 * Reads from the Prisma Trade model for all providers.
 */

import { Controller, Get, Query, Logger } from '@nestjs/common';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { PrismaService } from '../../database/prisma.service';
import { Mt5TradingService } from './mt5-trading.service';
import { SwapCostService } from './swap-cost.service';
import { WeekendDefenseService } from './weekend-defense.service';
import { PositionSyncService } from '../providers/position-sync.service';

@Controller('trading')
export class TradeHistoryController {
  private readonly logger = new Logger(TradeHistoryController.name);

  constructor(
    private readonly tradeRecorder: TradeRecorderService,
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5TradingService,
    private readonly swapCost: SwapCostService,
    private readonly weekendDefense: WeekendDefenseService,
    private readonly positionSync: PositionSyncService,
  ) {}

  /**
   * GET /api/trading/position-lifecycle
   *
   * Lab prototype data feed — the full position lifecycle in one payload:
   * broker `position` rows (with 64-bit brokerTicket), reconciled `trade`
   * rows, and recent stop adjustments. Backs the Position Lifecycle Monitor.
   */
  @Get('position-lifecycle')
  async getPositionLifecycle() {
    const [positions, trades, adjustments] = await Promise.all([
      (this.prisma as any).position.findMany({
        orderBy: { lastQuotedAt: 'desc' },
        take: 200,
      }).catch(() => []),
      this.prisma.trade.findMany({
        where: { status: { in: ['open', 'closed'] } },
        orderBy: { openedAt: 'desc' },
        take: 200,
      }).catch(() => []),
      (this.prisma as any).stopAdjustment.findMany({
        orderBy: { adjustedAt: 'desc' },
        take: 50,
      }).catch(() => []),
    ]);

    const openTrades = trades.filter((t: any) => t.status === 'open').length;
    const closedTrades = trades.filter((t: any) => t.status === 'closed').length;

    return {
      positions,
      trades,
      adjustments,
      sync: {
        lastSyncedAt: this.positionSync.getLastSyncTime(),
        openPositions: positions.length,
        openTrades,
        closedTrades,
      },
    };
  }

  /** Get trade history from the audit trail (all providers) */
  @Get('trade-history')
  async getHistory(
    @Query('provider') provider?: string,
    @Query('symbol') symbol?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.tradeRecorder.getHistory({
      provider,
      symbol,
      days: days ? Number(days) : 30,
      limit: limit ? Number(limit) : 200,
      status,
    });
  }

  /**
   * GET /api/trading/strategy-comparison
   *
   * Compare trading strategies by actual trade outcomes.
   * Returns aggregate stats per strategy + live positions grouped by strategy.
   */
  @Get('strategy-comparison')
  async getStrategyComparison() {
    // ── 1. Stats from closed trades grouped by strategy ──
    const closedTrades = await this.prisma.trade.findMany({
      where: {
        status: 'closed',
        strategy: { not: null },
        pnl: { not: null },
      },
      orderBy: { closedAt: 'desc' },
      take: 2000,
    }).catch(() => []);

    const strategyMap = new Map<string, {
      trades: number;
      wins: number;
      losses: number;
      totalPnl: number;
      avgWinPnl: number;
      avgLossPnl: number;
      bestTrade: number;
      worstTrade: number;
      winAmounts: number[];
      lossAmounts: number[];
      cumPnlHistory: number[];
      symbols: Set<string>;
    }>();

    for (const t of closedTrades) {
      const key = t.strategy || 'unknown';
      if (!strategyMap.has(key)) {
        strategyMap.set(key, {
          trades: 0, wins: 0, losses: 0, totalPnl: 0,
          avgWinPnl: 0, avgLossPnl: 0, bestTrade: -Infinity, worstTrade: Infinity,
          winAmounts: [], lossAmounts: [], cumPnlHistory: [], symbols: new Set(),
        });
      }
      const s = strategyMap.get(key)!;
      s.trades++;
      s.totalPnl += t.pnl || 0;
      s.symbols.add(t.symbol);
      if (t.pnl && t.pnl >= 0) {
        s.wins++;
        s.winAmounts.push(t.pnl);
        if (t.pnl > s.bestTrade) s.bestTrade = t.pnl;
      } else {
        s.losses++;
        s.lossAmounts.push(t.pnl || 0);
        if ((t.pnl || 0) < s.worstTrade) s.worstTrade = t.pnl || 0;
      }
      s.cumPnlHistory.push(s.totalPnl);
    }

    // Compute derived metrics
    const showdown = Array.from(strategyMap.entries()).map(([name, s]) => {
      const winRate = s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0;
      const avgWin = s.winAmounts.length > 0
        ? Math.round(s.winAmounts.reduce((a, b) => a + b, 0) / s.winAmounts.length * 100) / 100
        : 0;
      const avgLoss = s.lossAmounts.length > 0
        ? Math.round(s.lossAmounts.reduce((a, b) => a + b, 0) / s.lossAmounts.length * 100) / 100
        : 0;

      // Max drawdown from cum P&L
      let peak = 0;
      let maxDd = 0;
      for (const cum of s.cumPnlHistory) {
        if (cum > peak) peak = cum;
        const dd = peak > 0 ? ((peak - cum) / peak) * 100 : 0;
        if (dd > maxDd) maxDd = dd;
      }

      return {
        strategy: name,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRate,
        totalPnl: Math.round(s.totalPnl * 100) / 100,
        avgWinPnl: avgWin,
        avgLossPnl: Math.round(avgLoss * 100) / 100,
        bestTrade: s.bestTrade === -Infinity ? 0 : Math.round(s.bestTrade * 100) / 100,
        worstTrade: s.worstTrade === Infinity ? 0 : Math.round(s.worstTrade * 100) / 100,
        maxDrawdown: Math.round(maxDd * 10) / 10,
        symbolCount: s.symbols.size,
        profitFactor: s.lossAmounts.reduce((a, b) => a + Math.abs(b), 0) > 0
          ? Math.round((s.winAmounts.reduce((a, b) => a + b, 0) / s.lossAmounts.reduce((a, b) => a + Math.abs(b), 0)) * 100) / 100
          : null,
      };
    }).sort((a, b) => b.totalPnl - a.totalPnl);

    // ── 2. Live positions — DB first, MT5 bridge fallback ──
    const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const openTrades = await this.prisma.trade.findMany({
      where: { 
        status: 'open',
        openedAt: { gte: staleThreshold },
      },
      orderBy: { openedAt: 'desc' },
      take: 100,
    }).catch(() => []);

    const liveByStrategy = new Map<string, any[]>();
    let liveSource = 'DB (stale-filtered, ≤7 days)';

    if (openTrades.length > 0) {
      for (const t of openTrades) {
        const key = t.strategy || 'manual';
        if (!liveByStrategy.has(key)) liveByStrategy.set(key, []);
        liveByStrategy.get(key)!.push({
          symbol: t.symbol,
          side: t.side,
          quantity: t.quantity,
          entryPrice: t.entryPrice,
          pnl: t.pnl || 0,
          openedAt: t.openedAt,
          provider: t.provider,
        });
      }
    } else {
      // Fallback: query MT5 bridge directly
      try {
        const mt5Positions = await this.mt5.getPositions();
        for (const p of mt5Positions) {
          const rawComment = (p.comment || '').replace(/^TCS\s+/, '');
          const strategyKey = rawComment.replace(/\s+\d+$/, '') || 'unknown';
          if (!liveByStrategy.has(strategyKey)) liveByStrategy.set(strategyKey, []);
          liveByStrategy.get(strategyKey)!.push({
            symbol: p.symbol,
            side: p.type === 0 ? 'buy' : 'sell',
            quantity: p.volume,
            entryPrice: p.price_open,
            currentPrice: p.price_current,
            pnl: p.profit || 0,
            openedAt: new Date(p.time * 1000).toISOString(),
            ticket: p.ticket,
            sl: p.sl,
            tp: p.tp,
            provider: 'mt5',
          });
        }
        liveSource = 'MT5 bridge (live positions)';
      } catch (err) {
        this.logger.warn(`MT5 bridge unavailable for live positions: ${(err as Error).message}`);
        liveSource = 'MT5 bridge unavailable';
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      liveSource,
      showdown,
      livePositions: Array.from(liveByStrategy.entries()).map(([strategy, positions]) => ({
        strategy,
        positionCount: positions.length,
        totalPnl: Math.round(positions.reduce((s, p) => s + (p.pnl || 0), 0) * 100) / 100,
        positions,
      })),
      activeStrategies: showdown.length,
      totalStrategies: showdown.length,
    };
  }

  // ── Swap Cost Calculator ──────────────────────────────

  @Get('swap-forecast')
  async swapForecast(
    @Query('symbol') symbol: string,
    @Query('volume') volume?: string,
    @Query('direction') direction?: string,
  ) {
    const vol = volume ? parseFloat(volume) : 0.1;
    const dir = (direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' as const : 'BUY' as const;
    if (!symbol) return { error: 'symbol query parameter is required' };
    const forecast = await this.swapCost.forecastSwap(symbol, vol, dir);
    if (!forecast) return { error: `Could not fetch swap rates for ${symbol}. Is MT5 bridge running?` };
    return forecast;
  }

  @Get('swap-rates')
  async swapRates(@Query('symbol') symbol: string) {
    if (!symbol) return { error: 'symbol query parameter is required' };
    const rates = await this.swapCost.getSwapRates(symbol);
    if (!rates) return { error: `Could not fetch swap rates for ${symbol}. Is MT5 bridge running?` };
    return {
      ...rates,
      interpretation: {
        swapLong: rates.swapLong < 0
          ? `Long charged ${Math.abs(rates.swapLong)} pts/day`
          : `Long credited ${rates.swapLong} pts/day`,
        swapShort: rates.swapShort < 0
          ? `Short charged ${Math.abs(rates.swapShort)} pts/day`
          : `Short credited ${rates.swapShort} pts/day`,
      },
    };
  }

  // ── Weekend Defense ──────────────────────────────────

  @Get('weekend-checklist')
  async weekendChecklist() {
    try {
      const mt5 = this.mt5 as any;
      const posData = await mt5.getPositions().catch(() => []);
      const positions = Array.isArray(posData) ? posData : [];

      if (positions.length === 0) {
        return {
          generatedAt: new Date().toISOString(),
          dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getUTCDay()],
          isFriday: new Date().getUTCDay() === 5,
          positions: [],
          totalExposure: 0,
          totalSwapCostTonight: 0,
          totalGapRisk: 0,
          summary: { holdCount: 0, reduceCount: 0, closeCount: 0, totalPositions: 0 },
          nextMarketOpen: new Date().getUTCDay() === 5 ? 'Monday 00:00 GMT' : null,
          message: 'No open positions — weekend is clear.',
        };
      }

      return this.weekendDefense.buildChecklist(positions);
    } catch (err) {
      return { error: `Failed to build weekend checklist: ${(err as Error).message}` };
    }
  }

  /**
   * GET /api/trading/stop-adjustments — query SL/TP adjustment history.
   * ?symbol=XAUUSD&tradeTicket=123&limit=20
   */
  @Get('stop-adjustments')
  async getStopAdjustments(
    @Query('symbol') symbol?: string,
    @Query('tradeTicket') tradeTicket?: string,
    @Query('limit') limit?: string,
  ) {
    if (!this.prisma.isAvailable) return { adjustments: [], message: 'Database unavailable' };
    const take = Math.min(parseInt(limit || '20', 10) || 20, 100);
    try {
      const where: any = {};
      if (symbol) where.symbol = symbol.toUpperCase();
      if (tradeTicket) where.tradeTicket = parseInt(tradeTicket, 10);

      const adjustments = await (this.prisma as any).stopAdjustment.findMany({
        where, orderBy: { adjustedAt: 'desc' }, take,
      });

      return {
        adjustments: adjustments.map((a: any) => ({
          id: a.id,
          tradeTicket: a.tradeTicket,
          symbol: a.symbol,
          oldSl: a.oldSl, newSl: a.newSl,
          oldTp: a.oldTp, newTp: a.newTp,
          reason: a.reason,
          directiveScores: a.directiveScores,
          adjustedAt: a.adjustedAt,
        })),
        total: adjustments.length,
      };
    } catch (err) {
      return { adjustments: [], error: (err as Error).message };
    }
  }

  /**
   * GET /api/trading/portfolio-snapshots — query portfolio snapshots.
   * ?type=trade&limit=10
   */
  @Get('portfolio-snapshots')
  async getPortfolioSnapshots(
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    if (!this.prisma.isAvailable) return { snapshots: [], message: 'Database unavailable' };
    const take = Math.min(parseInt(limit || '10', 10) || 10, 50);
    try {
      const where: any = {};
      if (type) where.snapshotType = type;

      const snapshots = await (this.prisma as any).portfolioSnapshot.findMany({
        where, orderBy: { takenAt: 'desc' }, take,
        include: { positions: true },
      });

      return {
        snapshots: snapshots.map((s: any) => ({
          id: s.id,
          type: s.snapshotType,
          totalValue: s.totalValue,
          totalPnl: s.totalPnl,
          totalPnlPct: s.totalPnlPct,
          positionCount: s.positionCount,
          cash: s.cash,
          providerSummary: s.providerSummary,
          takenAt: s.takenAt,
          positions: s.positions?.map((p: any) => ({
            symbol: p.symbol,
            quantity: p.quantity,
            entryPrice: p.entryPrice,
            currentPrice: p.currentPrice,
            pnl: p.pnl,
            pnlPct: p.pnlPct,
          })) || [],
        })),
        total: snapshots.length,
      };
    } catch (err) {
      return { snapshots: [], error: (err as Error).message };
    }
  }
}
