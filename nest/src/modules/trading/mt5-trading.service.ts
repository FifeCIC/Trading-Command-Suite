import { Injectable, Logger } from '@nestjs/common';
import { TradeRecorderService } from './trade-recorder.service';

const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:5001';

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
  private bridgeUrl = BRIDGE_URL;

  constructor(private readonly tradeRecorder: TradeRecorderService) {}

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
      if (params.comment) body.comment = params.comment;

      const res = await fetch(`${this.bridgeUrl}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        // Record successful trade
        this.tradeRecorder.record({
          symbol: params.symbol,
          side,
          quantity: params.volume,
          entryPrice: data.price,
          provider: 'mt5',
          status: 'open',
          origin,
          strategy: params.comment || undefined,
        });
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
      return { success: false, error: errorMsg };
    }
  }

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
