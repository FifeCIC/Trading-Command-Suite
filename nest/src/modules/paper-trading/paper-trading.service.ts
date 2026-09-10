/**
 * PaperTradingService — Virtual Trading Ledger
 * ============================================
 *
 * Simulates trade execution without real money. Tracks virtual positions,
 * P&L, and trade history using the existing Trade Prisma model
 * (provider='paper'). Provides the same placeOrder/closePosition interface
 * as Mt5TradingService so it can be swapped in transparently.
 *
 * Features:
 * - Configurable starting balance (default $10,000)
 * - Simulated fills at current market price
 * - Real-time P&L tracking per position and portfolio
 * - Drawdown monitoring with alert thresholds
 * - Full trade history via existing Trade model
 * - Compatible with TradingStrategyService.execute() and AutomationLoopService
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface PaperPosition {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  sl: number | null;
  tp: number | null;
  openedAt: Date;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
}

export interface PaperAccount {
  startingBalance: number;
  currentBalance: number;
  equity: number;            // balance + unrealized PnL
  realizedPnl: number;
  openPositions: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  peakEquity: number;
  currentDrawdown: number;   // percent from peak
  maxDrawdown: number;       // all-time max
}

@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);
  private startingBalance = 10_000;
  private realizedPnl = 0;
  private peakEquity = 10_000;
  private maxDrawdownPct = 0;
  private totalTrades = 0;
  private winningTrades = 0;
  private losingTrades = 0;
  private nextTicket = 100000; // Simulated ticket numbers

  /** Open paper positions keyed by ticket number */
  private positions = new Map<number, PaperPosition>();

  /** Latest quote cache for fill simulation */
  private quotes = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  // ── Configuration ───────────────────────────────────

  setStartingBalance(balance: number) {
    this.startingBalance = balance;
    this.peakEquity = balance + this.realizedPnl;
  }

  // ── Quote cache (fed by the automation loop) ────────

  updateQuote(symbol: string, price: number) {
    this.quotes.set(symbol.toUpperCase(), price);
  }

  private getCurrentPrice(symbol: string): number | null {
    return this.quotes.get(symbol.toUpperCase()) ?? null;
  }

  // ── Order Placement ─────────────────────────────────

  async placeOrder(params: {
    symbol: string;
    type: 'BUY' | 'SELL';
    volume: number;
    sl?: number;
    tp?: number;
    comment?: string;
    origin?: string;
  }): Promise<{ success: boolean; ticket?: number; price?: number; error?: string }> {
    const symbol = params.symbol.toUpperCase();
    const fillPrice = this.getCurrentPrice(symbol);

    if (!fillPrice) {
      return { success: false, error: `No quote available for ${symbol} — cannot simulate fill` };
    }

    const ticket = this.nextTicket++;
    const now = new Date();
    const side = params.type === 'BUY' ? 'buy' : 'sell';

    this.positions.set(ticket, {
      symbol,
      side,
      quantity: params.volume,
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      sl: params.sl ?? null,
      tp: params.tp ?? null,
      openedAt: now,
      unrealizedPnl: 0,
      unrealizedPnlPct: 0,
    });

    // Record to persistent trade audit
    try {
      await this.prisma.trade.create({
        data: {
          symbol,
          side,
          quantity: params.volume,
          entryPrice: fillPrice,
          status: 'open',
          provider: 'paper',
          strategy: params.comment?.includes('strategy:') ? params.comment : null,
          origin: (params.origin as any) || 'user',
          openedAt: now,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist paper trade to DB: ${(err as Error).message}`);
    }

    this.logger.log(`📝 PAPER ${params.type} ${symbol} × ${params.volume} @ $${fillPrice.toFixed(2)} [ticket #${ticket}]`);
    return { success: true, ticket, price: fillPrice };
  }

  // ── Position Management ─────────────────────────────

  async closePosition(ticket: number): Promise<{ success: boolean; pnl?: number; error?: string }> {
    const pos = this.positions.get(ticket);
    if (!pos) return { success: false, error: `Position #${ticket} not found` };

    // ⚠️ NEVER fall back to `pos.entryPrice` as the exit price (fixed 2026-09-10).
    //
    // The old chain was `getCurrentPrice() ?? pos.currentPrice ?? pos.entryPrice`.
    // The last link substitutes the ENTRY price for the EXIT, which forces
    // `pnl = 0` and books a fabricated break-even trade as a real close. It also
    // incremented totalTrades / winning / losing counters, so a missing quote
    // silently polluted the paper statistics.
    //
    // This is the same defect class as the MT5 bridge P&L fabrication found the
    // same day: a plausible-but-wrong number substituted where an error belongs.
    // A close with no observable price is a FAILED close, and must say so.
    const exitPrice = this.getCurrentPrice(pos.symbol) ?? pos.currentPrice ?? null;
    if (exitPrice == null || !Number.isFinite(exitPrice)) {
      this.logger.warn(
        `📝 PAPER CLOSE REFUSED #${ticket} ${pos.symbol} — no observable exit price ` +
        `(live price and currentPrice both unavailable). Position left OPEN rather than ` +
        `booking a fabricated break-even close.`,
      );
      return {
        success: false,
        error: `No exit price available for ${pos.symbol} — position remains open`,
      };
    }

    const pnl = (exitPrice - pos.entryPrice) * pos.quantity * (pos.side === 'sell' ? -1 : 1);
    this.realizedPnl += pnl;
    this.totalTrades++;
    if (pnl > 0) this.winningTrades++; else if (pnl < 0) this.losingTrades++;

    this.positions.delete(ticket);

    // Update persisted trade
    try {
      await this.prisma.trade.updateMany({
        where: { symbol: pos.symbol, status: 'open', provider: 'paper', openedAt: pos.openedAt },
        data: { status: 'closed', exitPrice, pnl, closedAt: new Date() },
      });
    } catch (err) {
      this.logger.warn(`Failed to close paper trade in DB: ${(err as Error).message}`);
    }

    this.updateDrawdown();
    this.logger.log(`📝 PAPER CLOSE #${ticket} ${pos.symbol} — PnL: $${pnl.toFixed(2)}`);
    return { success: true, pnl };
  }

  async closeAll(): Promise<{ closed: number; totalPnl: number }> {
    let totalPnl = 0;
    let closed = 0;
    for (const ticket of [...this.positions.keys()]) {
      const result = await this.closePosition(ticket);
      if (result.success && result.pnl != null) {
        totalPnl += result.pnl;
        closed++;
      }
    }
    return { closed, totalPnl };
  }

  async closeProfitable(): Promise<{ closed: number; totalPnl: number }> {
    let totalPnl = 0;
    let closed = 0;
    for (const [ticket, pos] of this.positions) {
      // No entryPrice fallback — see closePosition(). An unpriceable position is
      // skipped, not silently treated as break-even.
      const currentPrice = this.getCurrentPrice(pos.symbol) ?? pos.currentPrice ?? null;
      if (currentPrice == null || !Number.isFinite(currentPrice)) continue;
      const unrealizedPnl = (currentPrice - pos.entryPrice) * pos.quantity * (pos.side === 'sell' ? -1 : 1);
      if (unrealizedPnl > 0) {
        const result = await this.closePosition(ticket);
        if (result.success && result.pnl != null) {
          totalPnl += result.pnl;
          closed++;
        }
      }
    }
    return { closed, totalPnl };
  }

  async modifyPosition(ticket: number, sl?: number, tp?: number): Promise<{ success: boolean; error?: string }> {
    const pos = this.positions.get(ticket);
    if (!pos) return { success: false, error: `Position #${ticket} not found` };
    if (sl !== undefined) pos.sl = sl;
    if (tp !== undefined) pos.tp = tp;
    return { success: true };
  }

  // ── P&L & Account ───────────────────────────────────

  /**
   * Trigger this on every tick to mark positions to market.
   * Checks SL/TP levels and auto-closes if triggered.
   */
  markToMarket(): { closed: number } {
    let autoClosed = 0;

    for (const [ticket, pos] of this.positions) {
      const currentPrice = this.getCurrentPrice(pos.symbol);
      if (!currentPrice) continue;

      pos.currentPrice = currentPrice;
      const direction = pos.side === 'buy' ? 1 : -1;
      pos.unrealizedPnl = (currentPrice - pos.entryPrice) * pos.quantity * direction;
      pos.unrealizedPnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 * direction;

      // Auto-close on SL/TP hit
      if (pos.sl && direction === 1 && currentPrice <= pos.sl) {
        this.closePosition(ticket);
        autoClosed++;
        this.logger.log(`🛑 PAPER SL hit for #${ticket} ${pos.symbol} @ $${currentPrice.toFixed(2)}`);
      } else if (pos.tp && direction === 1 && currentPrice >= pos.tp) {
        this.closePosition(ticket);
        autoClosed++;
        this.logger.log(`🎯 PAPER TP hit for #${ticket} ${pos.symbol} @ $${currentPrice.toFixed(2)}`);
      } else if (pos.sl && direction === -1 && currentPrice >= pos.sl) {
        this.closePosition(ticket);
        autoClosed++;
      } else if (pos.tp && direction === -1 && currentPrice <= pos.tp) {
        this.closePosition(ticket);
        autoClosed++;
      }
    }

    this.updateDrawdown();
    return { closed: autoClosed };
  }

  private updateDrawdown() {
    const equity = this.getEquity();
    if (equity > this.peakEquity) this.peakEquity = equity;
    const drawdown = this.peakEquity > 0 ? ((this.peakEquity - equity) / this.peakEquity) * 100 : 0;
    if (drawdown > this.maxDrawdownPct) this.maxDrawdownPct = drawdown;
  }

  getEquity(): number {
    let unrealizedPnl = 0;
    for (const pos of this.positions.values()) {
      unrealizedPnl += pos.unrealizedPnl;
    }
    return this.startingBalance + this.realizedPnl + unrealizedPnl;
  }

  getAccount(): PaperAccount {
    return {
      startingBalance: this.startingBalance,
      currentBalance: this.startingBalance + this.realizedPnl,
      equity: this.getEquity(),
      realizedPnl: this.realizedPnl,
      openPositions: this.positions.size,
      totalTrades: this.totalTrades,
      winningTrades: this.winningTrades,
      losingTrades: this.losingTrades,
      winRate: this.totalTrades > 0 ? this.winningTrades / this.totalTrades : 0,
      peakEquity: this.peakEquity,
      currentDrawdown: this.peakEquity > 0 ? ((this.peakEquity - this.getEquity()) / this.peakEquity) * 100 : 0,
      maxDrawdown: this.maxDrawdownPct,
    };
  }

  getOpenPositions(): PaperPosition[] {
    return [...this.positions.values()];
  }

  getPosition(ticket: number): PaperPosition | null {
    return this.positions.get(ticket) ?? null;
  }

  // ── History ─────────────────────────────────────────

  async getTradeHistory(limit = 50): Promise<any[]> {
    return this.prisma.trade.findMany({
      where: { provider: 'paper' },
      orderBy: { openedAt: 'desc' },
      take: limit,
    });
  }

  // ── Reset ───────────────────────────────────────────

  reset(balance?: number) {
    this.positions.clear();
    this.realizedPnl = 0;
    this.totalTrades = 0;
    this.winningTrades = 0;
    this.losingTrades = 0;
    this.nextTicket = 100000;
    if (balance) this.startingBalance = balance;
    this.peakEquity = this.startingBalance;
    this.maxDrawdownPct = 0;
    this.logger.log('Paper trading account reset');
  }
}
