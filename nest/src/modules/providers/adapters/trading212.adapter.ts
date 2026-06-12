import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

/**
 * Trading212 API Adapter
 * =======================
 * Supports LIVE and DEMO (paper) environments with separate API keys & endpoints.
 *
 * ── Environment Variables ─────────────────────────────────
 * TRADING212_MODE           'live' | 'demo' (default: 'demo')
 * TRADING212_LIVE_API_KEY   API key for live account
 * TRADING212_DEMO_API_KEY   API key for demo/paper account
 * TRADING212_API_KEY        Fallback key (used when mode-specific key is empty)
 * TRADING212_LIVE_BASE_URL  Live endpoint (default: https://live.trading212.com/api/v0)
 * TRADING212_DEMO_BASE_URL  Demo endpoint (default: https://demo.trading212.com/api/v0)
 *
 * ── Auth ──────────────────────────────────────────────────
 * API key passed as Authorization header value directly (NOT Bearer prefix).
 *
 * ── Rate Limits (per endpoint) ────────────────────────────
 * portfolio    — 1 req / 5s
 * account      — 1 req / 2s
 * quotes       — varies
 * instruments  — 1 req / 30s
 * orders       — 1 req / 5s
 *
 * ── Docs ──────────────────────────────────────────────────
 * https://t212public-api-docs.redoc.ly/
 */

export interface Trading212Position {
  averagePrice: number;
  currentPrice: number;
  frontend: string;
  fxPpl: number;
  initialFillDate: string;
  maxBuy: number;
  maxSell: number;
  pieQuantity: number;
  ppl: number;
  quantity: number;
  ticker: string;
}

export interface Trading212AccountCash {
  blocked: number;
  free: number;
  invested: number;
  pieCash: number;
  ppl: number;
  result: number;
  total: number;
}

export type Trading212Mode = 'live' | 'demo' | 'none';

@Injectable()
export class Trading212Adapter implements IProviderAdapter {
  readonly name = 'Trading212';
  readonly id = 'trading212';
  private readonly logger = new Logger(Trading212Adapter.name);

  // ── Mode ──────────────────────────────────────────────────

  readonly mode: Trading212Mode;

  // ── Credentials & endpoint (resolved at construction) ─────

  private readonly apiKey: string;
  private readonly baseUrl: string;

  // ── Constructor ───────────────────────────────────────────

  constructor() {
    const explicitMode = (process.env.TRADING212_MODE || '').toLowerCase();

    if (explicitMode === 'live' || explicitMode === 'demo') {
      this.mode = explicitMode;
    } else if (process.env.TRADING212_LIVE_API_KEY) {
      // Auto-detect: if a live key is set, assume live
      this.mode = 'live';
    } else if (process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY) {
      // If only demo/generic key is set, assume demo
      this.mode = 'demo';
    } else {
      this.mode = 'none';
    }

    // Resolve the correct key for this mode
    if (this.mode === 'live') {
      this.apiKey = process.env.TRADING212_LIVE_API_KEY || process.env.TRADING212_API_KEY || '';
      this.baseUrl = process.env.TRADING212_LIVE_BASE_URL || 'https://live.trading212.com/api/v0';
    } else if (this.mode === 'demo') {
      this.apiKey = process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY || '';
      this.baseUrl = process.env.TRADING212_DEMO_BASE_URL || 'https://demo.trading212.com/api/v0';
    } else {
      this.apiKey = '';
      this.baseUrl = process.env.TRADING212_DEMO_BASE_URL || 'https://demo.trading212.com/api/v0';
    }

    if (this.mode !== 'none') {
      this.logger.log(`Trading212 adapter initialised — mode=${this.mode} base=${this.baseUrl} key=${this.apiKey ? '✓' : '✗'}`);
    } else {
      this.logger.warn('Trading212 adapter: no API keys configured — mock data only');
    }
  }

  // ── credentials ───────────────────────────────────────────

  private get hasCredentials(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: this.apiKey || '' };
  }

  // ── IProviderAdapter implementation ───────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    if (!this.hasCredentials) return this.fallbackQuote(symbol);
    try {
      const ticker = this.toT212Ticker(symbol);
      const res = await fetch(`${this.baseUrl}/equity/quotes/${ticker}`, {
        headers: this.authHeaders(),
      });
      if (res.status === 429) {
        this.logger.warn(`T212 rate limit hit for quote ${symbol}`);
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return {
        symbol,
        bid: data.bid ?? null,
        ask: data.ask ?? null,
        last: data.last ?? data.ask ?? data.bid ?? null,
        timestamp: new Date(),
      };
    } catch (err) {
      this.logger.error(`T212 getQuote(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getCandles(
    symbol: string,
    timeframe = 'ONE_DAY',
    limit = 100,
  ): Promise<MarketBar[]> {
    if (!this.hasCredentials) return this.fallbackCandles(symbol, limit);
    try {
      const ticker = this.toT212Ticker(symbol);
      const payload = {
        candles: [
          {
            ticker,
            period: this.mapTimeframe(timeframe),
            size: limit,
            includeFake: false,
          },
        ],
      };
      const res = await fetch(`${this.baseUrl}/charting/v2/batch`, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        this.logger.warn(`T212 rate limit hit for candles ${symbol}`);
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      const series = data?.candles?.[0]?.candles || [];
      return series.map((c: any) => ({
        timestamp: new Date(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
    } catch (err) {
      this.logger.error(`T212 getCandles(${symbol}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    if (!this.hasCredentials) return this.fallbackProfile(symbol);
    try {
      const ticker = this.toT212Ticker(symbol);
      const res = await fetch(
        `${this.baseUrl}/equity/metadata/instruments/${ticker}`,
        { headers: this.authHeaders() },
      );
      if (res.status === 429) return null;
      if (!res.ok) return null;
      const data = await res.json();
      return {
        symbol,
        name: data.name || symbol,
        exchange: data.workingScheduleId ? 'T212' : 'Unknown',
        sector: data.type || null,
        industry: null,
        marketCap: null,
      };
    } catch (err) {
      this.logger.error(`T212 getProfile(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.hasCredentials) {
      this.logger.warn(`Trading212 healthCheck (${this.mode}): no API key configured`);
      return false;
    }
    try {
      const res = await fetch(`${this.baseUrl}/equity/account/cash`, {
        headers: this.authHeaders(),
      });
      const ok = res.ok;
      this.logger.log(`Trading212 healthCheck (${this.mode}): ${ok ? 'OK' : 'failed'} (${res.status})`);
      return ok;
    } catch (err) {
      this.logger.error(`Trading212 healthCheck (${this.mode}) failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ── Trading212-specific: Portfolio ────────────────────────

  async getPositions(): Promise<Trading212Position[]> {
    if (!this.hasCredentials) {
      this.logger.warn(`Trading212 getPositions (${this.mode}): no credentials`);
      return [];
    }
    try {
      const res = await fetch(`${this.baseUrl}/equity/portfolio`, {
        headers: this.authHeaders(),
      });
      if (res.status === 429) {
        this.logger.warn(`Trading212 rate limit hit for portfolio (${this.mode})`);
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err) {
      this.logger.error(`Trading212 getPositions (${this.mode}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getAccountCash(): Promise<Trading212AccountCash | null> {
    if (!this.hasCredentials) {
      this.logger.warn(`Trading212 getAccountCash (${this.mode}): no credentials`);
      return null;
    }
    try {
      const res = await fetch(`${this.baseUrl}/equity/account/cash`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      this.logger.error(`Trading212 getAccountCash (${this.mode}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  getCapabilities(): string[] {
    return ['quotes', 'candles', 'profiles', 'portfolio', 'account'];
  }

  // ── helpers ───────────────────────────────────────────────

  /** Convert a simple symbol (AAPL) to Trading212 ticker (AAPL_US_EQ) */
  private toT212Ticker(symbol: string): string {
    if (symbol.includes('_')) return symbol;
    return `${symbol.toUpperCase()}_US_EQ`;
  }

  private mapTimeframe(timeframe: string): string {
    const map: Record<string, string> = {
      '1m': 'ONE_MINUTE',
      '5m': 'FIVE_MINUTES',
      '15m': 'FIFTEEN_MINUTES',
      '30m': 'THIRTY_MINUTES',
      '1h': 'ONE_HOUR',
      '4h': 'FOUR_HOURS',
      '1d': 'ONE_DAY',
      '1w': 'ONE_WEEK',
      '1M': 'ONE_MONTH',
    };
    return map[timeframe] || 'ONE_DAY';
  }

  // ── fallback: mock data when no credentials ───────────────

  private fallbackQuote(symbol: string): ProviderQuote {
    const base = this.fallbackPrice(symbol);
    const spread = base * 0.001;
    return { symbol, bid: base - spread / 2, ask: base + spread / 2, last: base, timestamp: new Date() };
  }

  private fallbackCandles(symbol: string, limit: number): MarketBar[] {
    const bars: MarketBar[] = [];
    const base = this.fallbackPrice(symbol);
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;
    for (let i = limit - 1; i >= 0; i--) {
      const ts = new Date(now - i * hourMs);
      const vol = base * 0.02;
      const o = base + (Math.random() - 0.5) * vol;
      const c = base + (Math.random() - 0.5) * vol;
      bars.push({
        timestamp: ts,
        open: o,
        high: Math.max(o, c) + Math.random() * vol * 0.5,
        low: Math.min(o, c) - Math.random() * vol * 0.5,
        close: c,
        volume: Math.floor(1_000_000 + Math.random() * 5_000_000),
      });
    }
    return bars;
  }

  private fallbackProfile(symbol: string): ProviderProfile {
    return { symbol, name: `${symbol} Corp`, exchange: 'NASDAQ', sector: 'Technology', industry: 'Software', marketCap: 50_000_000_000 };
  }

  private fallbackPrice(symbol: string): number {
    const prices: Record<string, number> = {
      AAPL: 198.32, NVDA: 485.25, TSLA: 227.91, MSFT: 462.75, SPY: 530.0, GOOGL: 185.0, AMZN: 195.0, QQQ: 480.0,
    };
    return prices[symbol.toUpperCase()] || 100;
  }
}
