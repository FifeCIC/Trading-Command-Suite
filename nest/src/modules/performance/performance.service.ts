/**
 * Performance Tracking Service
 * ============================
 * Tracks trade records and computes per-strategy performance metrics.
 * Based on TradePress strategy table: Success Rate, Trades, Profit/Loss.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface TradeRecord {
  id: string;
  strategyId: string;
  strategyName: string;
  symbol: string;
  action: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  status: 'open' | 'win' | 'loss' | 'breakeven';
  pnl: number | null;
  pnlPercent: number | null;
  entryScore: number | null;
  exitReason: string | null;
  openedAt: string;
  closedAt: string | null;
}

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
  avgHoldingDays: number;
  scoreDistribution: { high: number; medium: number; low: number };
  trades: TradeRecord[];
}

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);
  private trades: Map<string, TradeRecord> = new Map();

  recordTrade(data: Omit<TradeRecord, 'id' | 'status' | 'closedAt'>): TradeRecord {
    const id = `tr-${Date.now()}`;
    const record: TradeRecord = {
      ...data,
      id,
      status: 'open',
      closedAt: null,
    };
    this.trades.set(id, record);
    this.logger.log(`Trade recorded: ${data.symbol} ${data.action} ${data.quantity} @ $${data.entryPrice}`);
    return record;
  }

  closeTrade(id: string, exitPrice: number, exitReason: string): TradeRecord | null {
    const record = this.trades.get(id);
    if (!record || record.status !== 'open') return null;

    const pnl = (exitPrice - record.entryPrice) * record.quantity;
    const pnlPercent = ((exitPrice - record.entryPrice) / record.entryPrice) * 100;

    record.exitPrice = exitPrice;
    record.pnl = pnl;
    record.pnlPercent = pnlPercent;
    record.exitReason = exitReason;
    record.closedAt = new Date().toISOString();
    record.status = pnl > 0.01 ? 'win' : pnl < -0.01 ? 'loss' : 'breakeven';

    this.trades.set(id, record);
    this.logger.log(`Trade closed: ${record.symbol} ${record.status} PnL $${pnl.toFixed(2)}`);
    return record;
  }

  /** Compute per-strategy performance */
  getStrategyPerformance(strategyId: string): StrategyPerformance | null {
    const strategyTrades = Array.from(this.trades.values())
      .filter(t => t.strategyId === strategyId);

    if (strategyTrades.length === 0) return null;

    const closed = strategyTrades.filter(t => t.status !== 'open');
    const wins = closed.filter(t => t.status === 'win');
    const losses = closed.filter(t => t.status === 'loss');
    const breakeven = closed.filter(t => t.status === 'breakeven');

    const winPnl = wins.map(t => t.pnl ?? 0);
    const lossPnl = losses.map(t => t.pnl ?? 0);
    const totalWinAmount = winPnl.reduce((s, v) => s + v, 0);
    const totalLossAmount = Math.abs(lossPnl.reduce((s, v) => s + v, 0));

    const scoreDistribution = {
      high: strategyTrades.filter(t => (t.entryScore ?? 0) >= 80).length,
      medium: strategyTrades.filter(t => (t.entryScore ?? 0) >= 60 && (t.entryScore ?? 0) < 80).length,
      low: strategyTrades.filter(t => (t.entryScore ?? 0) < 60).length,
    };

    return {
      strategyId,
      strategyName: strategyTrades[0].strategyName,
      totalTrades: strategyTrades.length,
      openTrades: strategyTrades.filter(t => t.status === 'open').length,
      wins: wins.length,
      losses: losses.length,
      breakeven: breakeven.length,
      winRate: closed.length > 0 ? wins.length / closed.length : 0,
      totalPnl: closed.reduce((s, t) => s + (t.pnl ?? 0), 0),
      avgWin: wins.length > 0 ? totalWinAmount / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLossAmount / losses.length : 0,
      profitFactor: totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? Infinity : 0,
      largestWin: Math.max(0, ...winPnl),
      largestLoss: Math.min(0, ...lossPnl),
      avgHoldingDays: 0, // mock
      scoreDistribution,
      trades: strategyTrades,
    };
  }

  /** Get all strategies with performance */
  getAllPerformance(): StrategyPerformance[] {
    const strategyIds = new Set(Array.from(this.trades.values()).map(t => t.strategyId));
    return Array.from(strategyIds)
      .map(id => this.getStrategyPerformance(id))
      .filter(Boolean) as StrategyPerformance[];
  }

  getTrade(id: string): TradeRecord | undefined {
    return this.trades.get(id);
  }

  getAllTrades(): TradeRecord[] {
    return Array.from(this.trades.values());
  }
}
