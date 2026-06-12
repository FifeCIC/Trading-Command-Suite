import { Injectable, Logger } from '@nestjs/common';

export interface TradeSignal {
  id: string;
  symbol: string;
  strategy: string;
  score: number;
  signal: 'buy' | 'sell' | 'hold' | 'no_data';
  confidence: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);
  private signals: TradeSignal[] = [];

  addSignal(signal: Omit<TradeSignal, 'id' | 'timestamp'>): TradeSignal {
    const entry: TradeSignal = {
      ...signal,
      id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date(),
    };
    this.signals.unshift(entry);
    // Keep last 1000 signals
    if (this.signals.length > 1000) this.signals = this.signals.slice(0, 1000);
    this.logger.log(`Signal: ${entry.symbol} ${entry.signal} score=${entry.score}`);
    return entry;
  }

  getSignals(filter?: { symbol?: string; signal?: string; limit?: number }): TradeSignal[] {
    let result = this.signals;
    if (filter?.symbol) result = result.filter((s) => s.symbol === filter.symbol);
    if (filter?.signal) result = result.filter((s) => s.signal === filter.signal);
    return result.slice(0, filter?.limit || 50);
  }

  getLatestSignal(symbol: string): TradeSignal | null {
    return this.signals.find((s) => s.symbol === symbol) || null;
  }

  getSummary(): { total: number; buys: number; sells: number; recent: TradeSignal[] } {
    return {
      total: this.signals.length,
      buys: this.signals.filter((s) => s.signal === 'buy').length,
      sells: this.signals.filter((s) => s.signal === 'sell').length,
      recent: this.signals.slice(0, 10),
    };
  }
}
