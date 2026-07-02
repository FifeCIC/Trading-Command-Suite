/**
 * TradeHistoryController — unified trade audit trail
 * ====================================================
 * Reads from the Prisma Trade model for all providers.
 */

import { Controller, Get, Query, Logger } from '@nestjs/common';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { PrismaService } from '../../database/prisma.service';

@Controller('trading')
export class TradeHistoryController {
  private readonly logger = new Logger(TradeHistoryController.name);

  constructor(
    private readonly tradeRecorder: TradeRecorderService,
    private readonly prisma: PrismaService,
  ) {}

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

    // ── 2. Live positions from MT5 (not yet strategy-tagged — show open trades) ──
    const openTrades = await this.prisma.trade.findMany({
      where: { status: 'open' },
      orderBy: { openedAt: 'desc' },
      take: 100,
    }).catch(() => []);

    const liveByStrategy = new Map<string, any[]>();
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

    return {
      generatedAt: new Date().toISOString(),
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
}
