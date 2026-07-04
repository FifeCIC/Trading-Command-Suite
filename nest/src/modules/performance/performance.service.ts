/**
 * Performance Tracking Service
 * ============================
 * Reads from the Trade table (Prisma/MySQL) for real per-strategy metrics.
 * Trade records originate from MT5 close, strategy execution, and manual trading.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface StrategyPerformance {
  strategyId: string;
  strategyName: string;
  totalTrades: number;
  openTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  largestWin: number;
  largestLoss: number;
  avgHoldingHours: number;
  symbols: string[];
  firstTrade: string | null;
  lastTrade: string | null;
}

export interface EquityPoint {
  date: string;
  pnl: number;
  cumPnl: number;
}

export interface MonthlyBreakdown {
  month: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnl: number;
}

export interface PerformanceSummary {
  strategies: StrategyPerformance[];
  overall: {
    totalTrades: number;
    totalWins: number;
    totalLosses: number;
    winRate: number;
    totalPnl: number;
    profitFactor: number;
    activeStrategies: number;
  };
  equityCurve: EquityPoint[];
  monthlyBreakdown: MonthlyBreakdown[];
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Per-strategy performance ─────────────────────────────

  async getStrategyPerformance(strategyId: string): Promise<StrategyPerformance | null> {
    const trades = await this.prisma.trade.findMany({
      where: { strategy: strategyId },
      orderBy: { openedAt: 'asc' },
    }).catch(() => []);

    if (trades.length === 0) return null;

    return this.computeStrategyStats(strategyId, trades);
  }

  // ── All strategies ────────────────────────────────────────

  async getAllPerformance(): Promise<StrategyPerformance[]> {
    const trades = await this.prisma.trade.findMany({
      where: { strategy: { not: null } },
      orderBy: { openedAt: 'asc' },
    }).catch(() => []);

    const byStrategy = new Map<string, any[]>();
    for (const t of trades) {
      const key = t.strategy || 'untagged';
      if (!byStrategy.has(key)) byStrategy.set(key, []);
      byStrategy.get(key)!.push(t);
    }

    return Array.from(byStrategy.entries())
      .map(([id, t]) => this.computeStrategyStats(id, t as any[]))
      .sort((a, b) => b.totalPnl - a.totalPnl);
  }

  // ── Full summary with equity curve ─────────────────────────

  async getSummary(days = 90): Promise<PerformanceSummary> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const trades = await this.prisma.trade.findMany({
      where: {
        strategy: { not: null },
        closedAt: { gte: cutoff },
        pnl: { not: null },
      },
      orderBy: { closedAt: 'asc' },
    }).catch(() => []);

    // Per-strategy aggregation
    const byStrategy2 = new Map<string, any[]>();
    for (const t of trades) {
      const key = t.strategy || 'untagged';
      if (!byStrategy2.has(key)) byStrategy2.set(key, []);
      byStrategy2.get(key)!.push(t);
    }

    const strategies = Array.from(byStrategy2.entries())
      .map(([id, t]) => this.computeStrategyStats(id, t as any[]))
      .sort((a, b) => b.totalPnl - a.totalPnl);

    // Equity curve: daily P&L
    const dailyPnl = new Map<string, number>();
    for (const t of trades) {
      if (!t.closedAt || t.pnl == null) continue;
      const day = t.closedAt.toISOString().split('T')[0];
      dailyPnl.set(day, (dailyPnl.get(day) || 0) + t.pnl);
    }

    const sortedDays = Array.from(dailyPnl.keys()).sort();
    let cum = 0;
    const equityCurve: EquityPoint[] = sortedDays.map(date => {
      cum += dailyPnl.get(date) || 0;
      return { date, pnl: dailyPnl.get(date) || 0, cumPnl: cum };
    });

    // Monthly breakdown
    const monthly = new Map<string, { trades: number; wins: number; losses: number; pnl: number }>();
    for (const t of trades) {
      if (!t.closedAt || t.pnl == null) continue;
      const month = t.closedAt.toISOString().substring(0, 7);
      if (!monthly.has(month)) monthly.set(month, { trades: 0, wins: 0, losses: 0, pnl: 0 });
      const m = monthly.get(month)!;
      m.trades++;
      m.pnl += t.pnl;
      if (t.pnl >= 0) m.wins++; else m.losses++;
    }

    const monthlyBreakdown: MonthlyBreakdown[] = Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({
        month,
        trades: m.trades,
        wins: m.wins,
        losses: m.losses,
        winRate: m.trades > 0 ? Math.round((m.wins / m.trades) * 100) : 0,
        pnl: Math.round(m.pnl * 100) / 100,
      }));

    // Overall stats
    const closed = trades.filter(t => t.status === 'closed' && t.pnl != null);
    const wins = closed.filter(t => (t.pnl || 0) >= 0);
    const losses = closed.filter(t => (t.pnl || 0) < 0);
    const totalWin = wins.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl || 0), 0));

    return {
      strategies,
      overall: {
        totalTrades: closed.length,
        totalWins: wins.length,
        totalLosses: losses.length,
        winRate: closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0,
        totalPnl: Math.round(closed.reduce((s, t) => s + (t.pnl || 0), 0) * 100) / 100,
        profitFactor: totalLoss > 0 ? Math.round((totalWin / totalLoss) * 100) / 100 : totalWin > 0 ? Infinity : 0,
        activeStrategies: strategies.length,
      },
      equityCurve,
      monthlyBreakdown,
    };
  }

  // ── Helper: compute stats for a set of trades ─────────────

  private computeStrategyStats(strategyId: string, trades: any[]): StrategyPerformance {
    const closed = trades.filter(t => t.status === 'closed' && t.pnl != null);
    const open = trades.filter(t => t.status === 'open');
    const wins = closed.filter(t => (t.pnl || 0) >= 0);
    const losses = closed.filter(t => (t.pnl || 0) < 0);
    const breakeven = closed.filter(t => (t.pnl || 0) === 0);

    const winPnl = wins.map(t => t.pnl || 0);
    const lossPnl = losses.map(t => t.pnl || 0);
    const totalWin = winPnl.reduce((s, v) => s + v, 0);
    const totalLoss = Math.abs(lossPnl.reduce((s, v) => s + v, 0));

    // Avg holding time
    let avgHoldingHours = 0;
    const withHolding = closed.filter(t => t.openedAt && t.closedAt);
    if (withHolding.length > 0) {
      avgHoldingHours = withHolding.reduce((s, t) =>
        s + (new Date(t.closedAt!).getTime() - new Date(t.openedAt).getTime()) / 3600000, 0
      ) / withHolding.length;
    }

    const uniqueSymbols = [...new Set(trades.map(t => t.symbol))];
    const dates = trades.map(t => t.openedAt).sort();

    return {
      strategyId,
      strategyName: strategyId,
      totalTrades: trades.length,
      openTrades: open.length,
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      winRate: closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : 0,
      totalPnl: Math.round(closed.reduce((s, t) => s + (t.pnl || 0), 0) * 100) / 100,
      avgWin: wins.length > 0 ? Math.round((totalWin / wins.length) * 100) / 100 : 0,
      avgLoss: losses.length > 0 ? Math.round((totalLoss / losses.length) * 100) / 100 : 0,
      profitFactor: totalLoss > 0 ? Math.round((totalWin / totalLoss) * 100) / 100 : totalWin > 0 ? Infinity : 0,
      largestWin: Math.round(Math.max(0, ...winPnl) * 100) / 100,
      largestLoss: Math.round(Math.min(0, ...lossPnl) * 100) / 100,
      avgHoldingHours: Math.round(avgHoldingHours * 10) / 10,
      symbols: uniqueSymbols,
      firstTrade: dates[0]?.toISOString() || null,
      lastTrade: dates[dates.length - 1]?.toISOString() || null,
    };
  }
}
