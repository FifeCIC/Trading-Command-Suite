import { Injectable, Logger } from '@nestjs/common';
import { TradeRecorderService } from './trade-recorder.service';
import { StopGuardianService } from './stop-guardian.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { PrismaService } from '../../database/prisma.service';
import { sanitizeMt5Comment } from '../providers/mt5-comment.util';

export interface Mt5Position {
  ticket: number;
  symbol: string;
  type: number;
  volume: number;
  price_open: number;
  sl: number;
  tp: number;
  price_current: number;
  profit: number;
  comment: string;
  time: number;
}

export interface Mt5Account {
  login: number;
  balance: number;
  equity: number;
  margin: number;
  margin_free: number;
  margin_level: number;
  currency: string;
}

@Injectable()
export class Mt5TradingService {
  private readonly logger = new Logger(Mt5TradingService.name);

  constructor(
    private readonly tradeRecorder: TradeRecorderService,
    private readonly stopGuardian: StopGuardianService,
    private readonly prisma: PrismaService,
    private readonly mt5Connection: Mt5ConnectionManager,
  ) {}

  /** Get the bridge URL for a broker (defaults to first active) */
  private get bridgeUrl(): string {
    return this.mt5Connection.getUrl();
  }

  async getAccount(): Promise<Mt5Account | null> {
    try {
      const res = await fetch(`${this.bridgeUrl}/account`);
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  async getPositions(): Promise<Mt5Position[]> {
    try {
      const res = await fetch(`${this.bridgeUrl}/positions`);
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  }

  /** Fetch candles from MT5 bridge for on-demand scoring (Sprint 2026-07-04) */
  async getCandles(symbol: string, timeframe = '1h', limit = 200): Promise<Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }>> {
    try {
      const res = await fetch(`${this.bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${Math.min(limit, 1000)}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!data?.bars?.length) return [];
      return data.bars.map((b: any) => ({
        timestamp: new Date(b.timestamp),
        open: Number(b.open), high: Number(b.high), low: Number(b.low),
        close: Number(b.close), volume: Number(b.volume),
      }));
    } catch { return []; }
  }

  async placeOrder(params: {
    symbol: string;
    type: 'BUY' | 'SELL';
    volume: number;
    sl?: number;
    tp?: number;
    comment?: string;
    origin?: string;
  }): Promise<{ success: boolean; ticket?: number; price?: number; error?: string }> {
    const side = params.type === 'BUY' ? 'buy' : 'sell';
    const origin = (params.origin || 'user') as 'user' | 'agent' | 'strategy' | 'system';

    try {
      const body: any = {
        symbol: params.symbol,
        type: params.type.toLowerCase(),
        volume: params.volume,
      };
      if (params.sl) body.sl = params.sl;
      if (params.tp) body.tp = params.tp;
      if (params.comment) body.comment = sanitizeMt5Comment(params.comment);

      const res = await fetch(`${this.bridgeUrl}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      // ── Order audit: record every bridge order attempt (#477) ──
      this.recordOrder(params.symbol, params.type, params.volume, data.success ? 'filled' : 'rejected', data.ticket, data.price, data.error);

      if (data.success) {
        // Record successful trade with MT5 traceability fields (#446)
        this.tradeRecorder.record({
          symbol: params.symbol,
          side,
          quantity: params.volume,
          entryPrice: data.price,
          provider: 'mt5',
          status: 'open',
          origin,
          strategy: params.comment || undefined,
          ticket: data.ticket as number | undefined,
          sl: params.sl,
          tp: params.tp,
          brokerComment: params.comment,
        });
        // Record initial SL/TP as adjustment (#476)
        if (data.ticket && (params.sl || params.tp)) {
          this.stopGuardian.recordAdjustment({
            tradeTicket: data.ticket as number,
            symbol: params.symbol,
            newSl: params.sl ?? null,
            newTp: params.tp ?? null,
            reason: 'Initial SL/TP set at order placement',
          });
        }
        return { success: true, ticket: data.ticket, price: data.price };
      }
      // Record rejected attempt
      this.tradeRecorder.record({
        symbol: params.symbol,
        side,
        quantity: params.volume,
        provider: 'mt5',
        status: 'rejected',
        origin,
        strategy: params.comment || undefined,
      });
      return { success: false, error: data.error || `HTTP ${res.status}` };
    } catch (err) {
      const errorMsg = (err as Error).message;
      // Record failed attempt
      this.tradeRecorder.record({
        symbol: params.symbol,
        side,
        quantity: params.volume,
        provider: 'mt5',
        status: 'rejected',
        origin,
        strategy: params.comment || undefined,
      });
      // Order audit: network/bridge failures (#477)
      this.recordOrder(params.symbol, params.type, params.volume, 'error', undefined, undefined, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /** Record every order attempt in the order audit table (#477). Fire-and-forget. */
  private recordOrder(symbol: string, type: string, quantity: number, status: string, ticket?: number, price?: number, error?: string): void {
    if (!this.prisma.isAvailable) return;
    this.prisma.order.create({
      data: {
        symbol,
        type: type.toLowerCase(),
        side: type === 'BUY' ? 'buy' : 'sell',
        quantity,
        price: price ?? null,
        status,
        provider: 'mt5',
        providerId: ticket ? String(ticket) : null,
        filledAt: status === 'filled' ? new Date() : null,
      },
    }).catch(() => {}); // fire-and-forget — failures logged silently
  }

  /**
   * closePosition() — STEP 5 of 6 in the trade lifecycle pipeline.
   * BEFORE: placeOrder() opens the trade with strategy tag in MT5 comment field.
   * AFTER:  tradeRecorder.record() persists closed trade to DB with strategy name.
   * NEXT:   Strategy Comparison page (GET /api/trading/strategy-comparison) groups
   *         closed trades WHERE strategy IS NOT NULL for per-strategy P&L/win rate.
   *
   * ⚠️ WARNING: Strategy name is extracted from MT5 position's comment field.
   * Legacy format: "TCS Strategy Name | Score%". Since the shared sanitizer
   * (mt5-comment.util.ts) strips '|', new positions use "TCS Strategy Name Score".
   * Phase 3 moves strategy tracking to the magic number + DB, replacing this
   * fragile comment parsing entirely. Keep both parses aligned until then.
   * @see nest/src/modules/trading/mt5-trading.service.ts placeOrder() line ~98
   */
  async closePosition(ticket: number): Promise<{ success: boolean; error?: string }> {
    try {
      // Snapshot position before closing for audit trail
      const positions = await this.getPositions();
      const pos = positions.find((p) => p.ticket === ticket);

      const res = await fetch(`${this.bridgeUrl}/close/${ticket}`, { method: 'POST' });
      const data = await res.json();
      const success = data.retcode === 10009;

      // Record the close in trade history
      if (pos) {
        const posType = String(pos.type) === '0' || (pos as any).type === 'buy' ? 'buy' : 'sell';
        // Extract strategy name from MT5 comment.
        // Legacy: "TCS Strategy | 119%" → split on '|'.
        // Sanitised (current): "TCS Strategy 119" → strip "TCS " prefix.
        const rawComment = pos.comment ? pos.comment.trim() : '';
        const strategyFromComment = rawComment.includes('|')
          ? rawComment.split('|')[0]?.trim() || undefined
          : rawComment.replace(/^TCS\s+/i, '').trim() || undefined;
        this.tradeRecorder.record({
          symbol: pos.symbol,
          side: posType === 'buy' ? 'sell' : 'buy', // closing side is opposite
          quantity: pos.volume,
          entryPrice: pos.price_open || 0,
          exitPrice: data.price || pos.price_current || 0,
          pnl: pos.profit || 0,
          provider: 'mt5',
          status: 'closed',
          origin: 'user',
          openedAt: pos.time ? new Date(pos.time * 1000) : undefined,
          strategy: strategyFromComment,
        });
      }

      return { success, error: data.comment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async closePartial(ticket: number, volume: number): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.bridgeUrl}/close/${ticket}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volume }),
      });
      const data = await res.json();
      return { success: data.retcode === 10009, error: data.comment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async modifyPosition(ticket: number, sl?: number, tp?: number): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.bridgeUrl}/order/modify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket, sl, tp }),
      });
      const data = await res.json();
      return { success: data.retcode === 10009, error: data.comment };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async getHistory(days = 30): Promise<any[]> {
    try {
      const res = await fetch(`${this.bridgeUrl}/history?days=${days}`);
      if (!res.ok) return [];
      return res.json();
    } catch { return []; }
  }

  async closeAll(): Promise<{ closed: number; failed: number }> {
    const positions = await this.getPositions();
    let closed = 0;
    let failed = 0;
    for (const pos of positions) {
      const result = await this.closePosition(pos.ticket);
      result.success ? closed++ : failed++;
    }
    return { closed, failed };
  }

  /** Close only positions that are currently in profit. */
  async closeProfitable(): Promise<{
    closed: number;
    failed: number;
    skipped: number;
    totalPnl: number;
    closedTickets: { ticket: number; symbol: string; profit: number }[];
  }> {
    const positions = await this.getPositions();
    const profitable = positions.filter((p) => p.profit > 0);
    const unprofitable = positions.length - profitable.length;

    let closed = 0;
    let failed = 0;
    let totalPnl = 0;
    const closedTickets: { ticket: number; symbol: string; profit: number }[] = [];

    for (const pos of profitable) {
      const result = await this.closePosition(pos.ticket);
      if (result.success) {
        closed++;
        totalPnl += pos.profit;
        closedTickets.push({ ticket: pos.ticket, symbol: pos.symbol, profit: pos.profit });
      } else {
        failed++;
      }
    }

    this.logger.log(
      `closeProfitable: ${closed} closed, ${failed} failed, ${unprofitable} skipped, P&L=${totalPnl.toFixed(2)}`,
    );

    return { closed, failed, skipped: unprofitable, totalPnl, closedTickets };
  }
}
