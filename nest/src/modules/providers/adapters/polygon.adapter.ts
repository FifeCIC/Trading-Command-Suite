import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

/**
 * Polygon.io Adapter — unlimited free EOD data with 5+ years history.
 * Best free source for backtesting data.
 *
 * Free tier: unlimited EOD, 1 real-time call/min.
 * API docs: https://polygon.io/docs/stocks
 */
@Injectable()
export class PolygonAdapter implements IProviderAdapter {
  readonly name = 'Polygon.io';
  readonly id = 'polygon';

  private readonly logger = new Logger(PolygonAdapter.name);
  private readonly apiKey = process.env.POLYGON_API_KEY;
  private readonly baseUrl = 'https://api.polygon.io';

  // Track realtime calls per minute (free tier: 1/min)
  private realtimeCallsThisMinute = 0;
  private realtimeMinuteStart = Date.now();

  private resetRealtimeCounterIfNeeded(): void {
    const now = Date.now();
    if (now - this.realtimeMinuteStart >= 60_000) {
      this.realtimeCallsThisMinute = 0;
      this.realtimeMinuteStart = now;
    }
  }

  private canUseRealtime(): boolean {
    this.resetRealtimeCounterIfNeeded();
    return this.realtimeCallsThisMinute < 1;
  }

  private markRealtimeUsed(): void {
    this.realtimeCallsThisMinute++;
    this.logger.log(
      `Polygon: using EOD data (${this.realtimeCallsThisMinute} realtime call used this minute)`,
    );
  }

  private checkCredentials(): void {
    if (!this.apiKey) {
      throw new Error('Polygon.io credentials not configured — set POLYGON_API_KEY');
    }
  }

  // ─── getQuote ──────────────────────────────────────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    try {
      this.checkCredentials();
      const sym = symbol.toUpperCase();

      // Try real-time trade first (free tier: 1/min)
      if (this.canUseRealtime()) {
        this.markRealtimeUsed();
        const res = await fetch(
          `${this.baseUrl}/v2/last/trade/${sym}?apiKey=${this.apiKey}`,
        );
        if (res.ok) {
          const data = await res.json();
          const trade = data?.results;
          if (trade) {
            return {
              symbol: sym,
              bid: trade.p,
              ask: trade.p,
              last: trade.p,
              timestamp: new Date(trade.t || Date.now()),
            };
          }
        }
      }

      // Fallback: use previous close (unlimited, free)
      this.logger.debug(`Polygon: using previous close for ${sym} quote`);
      const res = await fetch(
        `${this.baseUrl}/v2/aggs/ticker/${sym}/prev?apiKey=${this.apiKey}`,
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error('Polygon.io authentication failed — check POLYGON_API_KEY');
      }
      if (!res.ok) return null;

      const data = await res.json();
      const bar = data?.results?.[0];
      if (!bar) return null;

      return {
        symbol: sym,
        bid: bar.c,
        ask: bar.c,
        last: bar.c,
        timestamp: new Date(bar.t || Date.now()),
      };
    } catch (err) {
      this.logger.error(`Polygon getQuote(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ─── getCandles ────────────────────────────────────────────────────

  async getCandles(
    symbol: string,
    timeframe = '1d',
    limit = 365,
  ): Promise<MarketBar[]> {
    try {
      this.checkCredentials();
      const sym = symbol.toUpperCase();

      // Map timeframe to Polygon multiplier/timespan
      const timespan = this.mapTimeframe(timeframe);
      const multiplier = 1;

      // Calculate date range
      const to = new Date();
      const from = new Date();
      from.setFullYear(from.getFullYear() - 5); // 5 years default

      const fromStr = from.toISOString().split('T')[0];
      const toStr = to.toISOString().split('T')[0];

      this.logger.log(
        `Polygon: fetching ${limit} candles for ${sym} (${timeframe}), ${fromStr} → ${toStr}`,
      );

      const res = await fetch(
        `${this.baseUrl}/v2/aggs/ticker/${sym}/range/${multiplier}/${timespan}/${fromStr}/${toStr}?limit=${limit}&apiKey=${this.apiKey}`,
      );

      if (res.status === 401 || res.status === 403) {
        throw new Error('Polygon.io authentication failed — check POLYGON_API_KEY');
      }
      if (res.status === 429) {
        this.logger.warn(`Polygon rate limit hit for candles ${sym}`);
        return [];
      }
      if (!res.ok) return [];

      const data = await res.json();
      const bars = data?.results || [];

      this.logger.log(`Polygon: got ${bars.length} candles for ${sym} (${timeframe})`);

      return bars.map((b: any) => ({
        timestamp: new Date(b.t),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));
    } catch (err) {
      this.logger.error(
        `Polygon getCandles(${symbol}) failed: ${(err as Error).message}`,
      );
      return [];
    }
  }

  // ─── getProfile ────────────────────────────────────────────────────

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    try {
      this.checkCredentials();
      const sym = symbol.toUpperCase();

      const res = await fetch(
        `${this.baseUrl}/v3/reference/tickers/${sym}?apiKey=${this.apiKey}`,
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error('Polygon.io authentication failed');
      }
      if (res.status === 429) return null;
      if (!res.ok) return null;

      const data = await res.json();
      const ticker = data?.results;
      if (!ticker) return null;

      return {
        symbol: sym,
        name: ticker.name || sym,
        exchange: ticker.primary_exchange || ticker.exchange || 'unknown',
        sector: ticker.sic_description || null,
        industry: null,
        marketCap: ticker.market_cap ? Number(ticker.market_cap) : null,
      };
    } catch (err) {
      this.logger.error(
        `Polygon getProfile(${symbol}) failed: ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ─── healthCheck ───────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    try {
      this.checkCredentials();
      const res = await fetch(
        `${this.baseUrl}/v2/aggs/ticker/AAPL/prev?apiKey=${this.apiKey}`,
      );
      if (res.status === 401 || res.status === 403) {
        this.logger.warn('Polygon healthCheck: authentication failed');
        return false;
      }
      const ok = res.ok;
      this.logger.log(`Polygon healthCheck: ${ok ? 'OK' : 'failed'} (${res.status})`);
      return ok;
    } catch (err) {
      this.logger.error(`Polygon healthCheck failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ─── getCapabilities ───────────────────────────────────────────────

  getCapabilities(): string[] {
    return ['quotes', 'candles', 'profiles'];
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  /**
   * Map our internal timeframe string to Polygon.io timespan.
   */
  private mapTimeframe(timeframe: string): string {
    switch (timeframe.toLowerCase()) {
      case '1m':
        return 'minute';
      case '5m':
        return 'minute';
      case '15m':
        return 'minute';
      case '1h':
        return 'hour';
      case '4h':
        return 'hour';
      case '1d':
      case 'day':
      default:
        return 'day';
    }
  }
}
