import { Injectable, Logger } from '@nestjs/common';

const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:5000';

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
  }): Promise<{ success: boolean; ticket?: number; error?: string }> {
    try {
      const body: any = {
        symbol: params.symbol,
        order_type: params.type === 'BUY' ? 0 : 1,
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
      if (data.retcode === 10009) {
        return { success: true, ticket: data.order };
      }
      return { success: false, error: data.comment || `Retcode ${data.retcode}` };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async closePosition(ticket: number): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.bridgeUrl}/close/${ticket}`, { method: 'POST' });
      const data = await res.json();
      return { success: data.retcode === 10009, error: data.comment };
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
}
