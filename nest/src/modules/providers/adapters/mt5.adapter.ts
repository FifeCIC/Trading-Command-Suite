/**
 * MT5 Provider Adapter
 * =====================
 * Communicates with the MT5 Python bridge via HTTP.
 * The bridge runs as a Flask server on localhost:5000 and connects
 * to the MetaTrader 5 desktop application via the MetaTrader5 Python package.
 *
 * Bridge script: scripts/mt5-bridge/mt5_bridge.py
 *
 * Config (.env):
 *   MT5_BRIDGE_URL=http://localhost:5000
 *   MT5_ACCOUNT=your_account_number
 *   MT5_PASSWORD=your_password
 *   MT5_SERVER=ICMarkets-Demo
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

interface BridgeQuoteResponse {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
}

interface BridgeCandlesResponse {
  symbol: string;
  timeframe: string;
  bars: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

interface BridgeHealthResponse {
  connected: boolean;
  mt5Package: boolean;
  account?: string;
  server?: string;
  balance?: number;
  equity?: number;
}

@Injectable()
export class Mt5Adapter implements IProviderAdapter {
  readonly name = 'MT5';
  readonly id = 'mt5';
  private readonly logger = new Logger(Mt5Adapter.name);
  private readonly bridgeUrl: string;
  consecutiveErrors = 0;
  tripped = false;
  private trippedAt: number | null = null;

  constructor() {
    this.bridgeUrl = process.env.MT5_BRIDGE_URL || 'http://localhost:5000';
  }

  private get authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  private async bridgeGet<T>(path: string): Promise<T | null> {
    if (this.tripped) {
      const cooldownMs = 120_000; // 2 min circuit breaker
      if (this.trippedAt && Date.now() - this.trippedAt >= cooldownMs) {
        this.tripped = false;
        this.consecutiveErrors = 0;
        this.logger.log('MT5 circuit breaker released after cooldown');
      } else {
        this.logger.debug('MT5 circuit breaker active — skipping request');
        return null;
      }
    }

    try {
      const res = await fetch(`${this.bridgeUrl}${path}`, {
        headers: this.authHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= 5) {
          this.tripped = true;
          this.trippedAt = Date.now();
          this.logger.warn('MT5 bridge circuit breaker TRIPPED (5 consecutive errors)');
        }
        return null;
      }
      this.consecutiveErrors = 0;
      return (await res.json()) as T;
    } catch (error: unknown) {
      const err = error as Error;
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= 5) {
        this.tripped = true;
        this.trippedAt = Date.now();
        this.logger.warn(`MT5 bridge circuit breaker TRIPPED: ${err.message}`);
      }
      this.logger.warn(`MT5 bridge request failed: ${err.message}`);
      return null;
    }
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    this.logger.log(`MT5: fetching quote for ${symbol}`);
    const data = await this.bridgeGet<BridgeQuoteResponse>(`/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!data) return null;

    return {
      symbol: data.symbol,
      bid: data.bid ?? null,
      ask: data.ask ?? null,
      last: data.last ?? null,
      timestamp: new Date(data.timestamp),
    };
  }

  async getCandles(symbol: string, timeframe = '1h', limit = 100): Promise<MarketBar[]> {
    this.logger.log(`MT5: fetching ${limit} candles for ${symbol} (${timeframe})`);
    const data = await this.bridgeGet<BridgeCandlesResponse>(
      `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${Math.min(limit, 1000)}`,
    );
    if (!data?.bars) return [];

    this.logger.log(`MT5: got ${data.bars.length} candles for ${symbol} (${timeframe})`);
    return data.bars.map((b) => ({
      timestamp: new Date(b.timestamp),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  }

  async getProfile(_symbol: string): Promise<ProviderProfile | null> {
    // MT5 doesn't provide fundamental data
    return null;
  }

  async healthCheck(): Promise<boolean> {
    const data = await this.bridgeGet<BridgeHealthResponse>('/health');
    if (!data) return false;
    return data.connected === true;
  }

  /** Reset circuit breaker manually (e.g., after bridge restart). */
  resetCircuitBreaker(): void {
    this.tripped = false;
    this.trippedAt = null;
    this.consecutiveErrors = 0;
    this.logger.log('MT5 circuit breaker manually reset');
  }
}
