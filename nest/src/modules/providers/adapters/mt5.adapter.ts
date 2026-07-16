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
import { PrismaService } from '../../../database/prisma.service';
import {
  IProviderAdapter,
  BrokerAccount,
  BrokerOrderRequest,
  BrokerOrderResult,
  BrokerPosition,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';
import { NotificationService } from '../../notifications/notifications.service';
import { BridgeEventService } from '../bridge-event.service';

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
  readonly supportsBrokerage = true;
  private readonly logger = new Logger(Mt5Adapter.name);
  private readonly bridgeUrl: string;
  consecutiveErrors = 0;
  tripped = false;
  private trippedAt: number | null = null;

  private lastBridgeState: 'connected' | 'disconnected' | 'unknown' = 'unknown';

  constructor(
    private readonly notifications?: NotificationService,
    private readonly bridgeEvents?: BridgeEventService,
    private readonly prisma?: PrismaService,
  ) {
    this.bridgeUrl = process.env.MT5_BRIDGE_URL || 'http://localhost:5000';
  }

  private get authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  private async bridgeGet<T>(path: string): Promise<T | null> {
    if (this.tripped) {
      const cooldownMs = 60_000; // 1 min circuit breaker
      if (this.trippedAt && Date.now() - this.trippedAt >= cooldownMs) {
        this.tripped = false;
        this.consecutiveErrors = 0;
        this.logger.log('MT5 circuit breaker released after cooldown');
        this.logBridgeEvent('reconnected', 'Circuit breaker released');
        this.notifications?.send({
          title: '✅ MT5 Bridge Reconnected',
          body: 'Circuit breaker released — MT5 bridge is responding again.',
          event: 'provider-degraded',
        }).catch(() => {});
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
        if (this.consecutiveErrors >= 10) {
          this.tripBreaker(`HTTP ${res.status} from bridge`);
        }
        this.logBridgeState('disconnected', `HTTP ${res.status}`);
        return null;
      }
      this.consecutiveErrors = 0;
      this.logBridgeState('connected');
      return (await res.json()) as T;
    } catch (error: unknown) {
      const err = error as Error;
      const isTransient = err.message?.includes('fetch failed') || err.message?.includes('ECONNREFUSED') || err.message?.includes('Connection refused');
      // Only count non-transient errors (timeouts, etc.) toward circuit breaker
      if (!isTransient) {
        this.consecutiveErrors++;
      }
      if (this.consecutiveErrors >= 10) {
        this.tripBreaker(err.message);
      }
      this.logBridgeState('disconnected', err.message);
      this.logger.warn(`MT5 bridge request failed: ${err.message}`);
      return null;
    }
  }

  private tripBreaker(reason: string): void {
    this.tripped = true;
    this.trippedAt = Date.now();
    this.logger.warn(`MT5 bridge circuit breaker TRIPPED (10 errors): ${reason}`);
    this.logBridgeEvent('disconnected', reason);
    this.notifications?.send({
      title: '🚨 MT5 Bridge Disconnected',
      body: `Circuit breaker tripped — ${reason}. Trading via MT5 is unavailable until the bridge recovers.`,
      event: 'provider-degraded',
    }).catch(() => {});
  }

  private logBridgeState(state: 'connected' | 'disconnected', errorMessage?: string): void {
    if (this.lastBridgeState !== state) {
      this.lastBridgeState = state;
      this.logBridgeEvent(state, errorMessage);
    }
  }

  private logBridgeEvent(eventType: string, errorMessage?: string): void {
    this.bridgeEvents?.log({
      eventType,
      account: process.env.MT5_ACCOUNT || undefined,
      server: process.env.MT5_SERVER || undefined,
      errorMessage: errorMessage?.substring(0, 500),
    }).catch(() => {});
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

  // ── Brokerage Methods (IProviderAdapter) ─────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.bridgeGet<{ positions: any[]; count: number }>('/positions');
    if (!data?.positions) return [];

    return data.positions.map((p: any) => ({
      brokerId: this.id!,
      brokerName: this.name,
      symbol: p.symbol,
      ticker: p.symbol,
      quantity: p.volume,
      avgCost: p.priceOpen,
      currentPrice: p.priceCurrent,
      marketValue: p.priceCurrent * p.volume,
      unrealizedPnl: p.profit,
      unrealizedPnlPct: p.priceOpen > 0 ? ((p.priceCurrent - p.priceOpen) / p.priceOpen) * 100 : 0,
      currency: 'GBP',
      openedAt: p.openTime || new Date().toISOString(),
    }));
  }

  async getAccount(): Promise<BrokerAccount | null> {
    const data = await this.bridgeGet<any>('/account');
    if (!data) return null;

    return {
      brokerId: this.id!,
      brokerName: this.name,
      balance: data.balance,
      equity: data.equity,
      margin: data.margin,
      marginFree: data.marginFree,
      marginLevel: data.marginLevel ?? null,
      currency: data.currency || 'GBP',
      mode: 'demo',
      connected: true,
    };
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrderResult> {
    // MT5 only allows basic ASCII in comments — sanitize
    const safeComment = (params.comment ?? 'TCS auto').replace(/[^a-zA-Z0-9 -]/g, '').substring(0, 50);
    const body = {
      symbol: params.symbol,
      type: params.side === 'BUY' ? 'buy' : 'sell',
      volume: params.quantity,
      sl: params.sl ?? null,
      tp: params.tp ?? null,
      comment: safeComment,
    };

    this.logger.log(`MT5 order: ${body.type} ${body.symbol} ×${body.volume} sl=${body.sl} tp=${body.tp} [tripped=${this.tripped}]`);
    const data = await this.bridgePost<any>('/order', body);

    if (!data) {
      this.logger.warn(`MT5 order FAILED: bridgePost returned null [url=${this.bridgeUrl} tripped=${this.tripped} errors=${this.consecutiveErrors}]`);
      // Record failed order attempt
      this.prisma?.order.create({
        data: {
          symbol: params.symbol,
          type: 'market',
          side: params.side === 'BUY' ? 'buy' : 'sell',
          quantity: params.quantity,
          status: 'rejected',
          provider: 'mt5',
        },
      }).catch(() => {});
      return { success: false, error: 'Bridge unreachable' };
    }

    const result: BrokerOrderResult = {
      success: data.success === true,
      ticket: data.ticket ?? undefined,
      price: data.price ?? undefined,
      error: data.error ?? undefined,
    };

    // Persist every order attempt (success + failure) to the Order table
    this.prisma?.order.create({
      data: {
        symbol: params.symbol,
        type: 'market',
        side: params.side === 'BUY' ? 'buy' : 'sell',
        quantity: params.quantity,
        price: result.price ?? null,
        status: result.success ? 'filled' : 'rejected',
        provider: 'mt5',
        providerId: result.ticket ? String(result.ticket) : null,
        filledAt: result.success ? new Date() : null,
      },
    }).catch(err => this.logger.warn(`Failed to persist order: ${err.message}`));

    return result;
  }

  private async bridgePost<T>(path: string, body: unknown): Promise<T | null> {
    if (this.tripped) {
      const cooldownMs = 60_000;
      if (this.trippedAt && Date.now() - this.trippedAt >= cooldownMs) {
        this.tripped = false;
        this.consecutiveErrors = 0;
        this.logBridgeEvent('reconnected', 'Circuit breaker released');
      } else {
        return null;
      }
    }

    try {
      const res = await fetch(`${this.bridgeUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= 10) {
          this.tripBreaker(`HTTP ${res.status} from bridge POST`);
        }
        this.logBridgeState('disconnected', `HTTP ${res.status}`);
        return null;
      }
      this.consecutiveErrors = 0;
      this.logBridgeState('connected');
      return (await res.json()) as T;
    } catch (err) {
      const error = err as Error;
      const isTransient = error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('Connection refused');
      if (!isTransient) {
        this.consecutiveErrors++;
      }
      if (this.consecutiveErrors >= 10) {
        this.tripBreaker(error.message);
      }
      this.logBridgeState('disconnected', error.message);
      return null;
    }
  }
}
