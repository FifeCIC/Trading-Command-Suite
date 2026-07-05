/**
 * Binance Crypto Provider Adapter
 * =================================
 * Free, no-auth-required crypto market data via Binance public REST API.
 *
 * Endpoints used (all public, no API key needed):
 *   GET /api/v3/ticker/bookTicker?symbol=BTCUSDT  → bid/ask
 *   GET /api/v3/ticker/price?symbol=BTCUSDT       → last price
 *   GET /api/v3/klines?symbol=BTCUSDT&interval=1h&limit=200 → candles
 *   GET /api/v3/ping                               → health check
 *   GET /api/v3/exchangeInfo                       → symbol validation
 *
 * Rate limits (public endpoints):
 *   1200 weight / minute per IP
 *   Each /api/v3 request is weight 1-2
 *   Realistic: ~600 requests/min sustained
 *
 * Symbol mapping:
 *   Internal (TCS) format → Binance format:
 *     BTCUSD  → BTCUSDT
 *     ETHUSD  → ETHUSDT
 *     SOLUSD  → SOLUSDT
 *     BTC-USD → BTCUSDT
 *     BTC     → BTCUSDT
 *
 * Architecture:
 *   - Primary crypto data source (free, reliable, 24/7)
 *   - Falls back to MT5 if Binance is down AND MT5 has crypto
 *   - Falls back to Yahoo Finance as last resort
 *   - Circuit breaker with 60s cooldown
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  ProviderQuote,
  ProviderProfile,
  MarketBar,
} from '../interfaces/provider-adapter.interface';

// ─── Binance API Types ────────────────────────────────────

interface BinanceBookTicker {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
}

interface BinancePrice {
  symbol: string;
  price: string;
}

interface BinanceKline {
  0: number;  // Open time
  1: string;  // Open
  2: string;  // High
  3: string;  // Low
  4: string;  // Close
  5: string;  // Volume
  6: number;  // Close time
}

interface BinanceExchangeInfo {
  symbols: Array<{
    symbol: string;
    status: string;
    baseAsset: string;
    quoteAsset: string;
  }>;
}

// ─── Symbol Mapping ───────────────────────────────────────

/**
 * Maps TCS internal crypto ticker formats to Binance USDT pairs.
 * Supports: BTCUSD, BTC-USD, BTC → BTCUSDT
 */
const TCS_TO_BINANCE: Record<string, string> = {
  BTCUSD: 'BTCUSDT',
  ETHUSD: 'ETHUSDT',
  SOLUSD: 'SOLUSDT',
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  'BTC-USD': 'BTCUSDT',
  'ETH-USD': 'ETHUSDT',
  'SOL-USD': 'SOLUSDT',
  DOGEUSD: 'DOGEUSDT',
  'DOGE-USD': 'DOGEUSDT',
  XRPUSD: 'XRPUSDT',
  'XRP-USD': 'XRPUSDT',
  ADAUSD: 'ADAUSDT',
  'ADA-USD': 'ADAUSDT',
  LTCUSD: 'LTCUSDT',
  'LTC-USD': 'LTCUSDT',
  LINKUSD: 'LINKUSDT',
  'LINK-USD': 'LINKUSDT',
};

/** Reverse map: Binance → TCS (for display/history) */
const BINANCE_TO_TCS: Record<string, string> = {};
for (const [tcs, binance] of Object.entries(TCS_TO_BINANCE)) {
  if (!BINANCE_TO_TCS[binance]) {
    BINANCE_TO_TCS[binance] = tcs;
  }
}

/** Check if a ticker looks like a crypto symbol */
export function isCryptoTicker(ticker: string): boolean {
  const upper = ticker.toUpperCase();
  if (upper in TCS_TO_BINANCE) return true;
  // Pattern match: ends with USD/USDT but not a known forex pair
  if (/^(BTC|ETH|SOL|DOGE|XRP|ADA|LTC|LINK|DOT|MATIC|SHIB|UNI|AVAX|ATOM)(USD|USDT|\\-USD)$/.test(upper)) return true;
  return false;
}

/** Convert TCS ticker → Binance symbol, returns null if not crypto */
export function toBinanceSymbol(ticker: string): string | null {
  const upper = ticker.toUpperCase().replace('-', '');
  if (TCS_TO_BINANCE[upper]) return TCS_TO_BINANCE[upper];
  if (TCS_TO_BINANCE[ticker.toUpperCase()]) return TCS_TO_BINANCE[ticker.toUpperCase()];
  // Try adding USDT suffix for bare crypto names
  if (/^(BTC|ETH|SOL|DOGE|XRP|ADA|LTC|LINK|DOT|MATIC|SHIB|UNI|AVAX|ATOM)$/.test(upper)) {
    return upper + 'USDT';
  }
  return null;
}

/** Convert back: Binance symbol → TCS ticker */
export function fromBinanceSymbol(binanceSymbol: string): string {
  return BINANCE_TO_TCS[binanceSymbol] || binanceSymbol.replace('USDT', 'USD');
}

// ─── Adapter ──────────────────────────────────────────────

@Injectable()
export class BinanceAdapter implements IProviderAdapter {
  readonly name = 'Binance';
  readonly id = 'binance';

  private readonly logger = new Logger(BinanceAdapter.name);
  private readonly baseUrl = 'https://api.binance.com';
  private readonly apiKey: string | null;
  private readonly apiSecret: string | null;

  // Circuit breaker
  consecutiveErrors = 0;
  tripped = false;
  private trippedAt: number | null = null;
  private readonly MAX_ERRORS = 5;
  private readonly COOLDOWN_MS = 60_000; // 1 minute

  // Cache to reduce API calls
  private quoteCache = new Map<string, { data: ProviderQuote; ts: number }>();
  private readonly QUOTE_TTL_MS = 5_000; // 5 second cache for quotes

  constructor() {
    this.apiKey = process.env.BINANCE_API_KEY || null;
    this.apiSecret = process.env.BINANCE_API_SECRET || null;
    if (this.apiKey) {
      this.logger.log('Binance adapter initialized with API key (higher rate limits)');
    } else {
      this.logger.log('Binance adapter initialized (public API, no key — 1200 weight/min)');
    }
  }

  // ─── IProviderAdapter Implementation ──────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    const binanceSymbol = toBinanceSymbol(symbol);
    if (!binanceSymbol) return null; // Not a crypto ticker

    // Check cache
    const cached = this.quoteCache.get(binanceSymbol);
    if (cached && Date.now() - cached.ts < this.QUOTE_TTL_MS) {
      return { ...cached.data, timestamp: new Date() };
    }

    // Fetch book ticker (bid/ask) + price ticker (last)
    const [book, price] = await Promise.all([
      this.binanceGet<BinanceBookTicker>(`/api/v3/ticker/bookTicker?symbol=${binanceSymbol}`),
      this.binanceGet<BinancePrice>(`/api/v3/ticker/price?symbol=${binanceSymbol}`),
    ]);

    if (!book && !price) return null;

    const quote: ProviderQuote = {
      symbol: fromBinanceSymbol(binanceSymbol),
      bid: book ? parseFloat(book.bidPrice) : null,
      ask: book ? parseFloat(book.askPrice) : null,
      last: price ? parseFloat(price.price) : null,
      timestamp: new Date(),
    };

    // Update cache
    this.quoteCache.set(binanceSymbol, { data: quote, ts: Date.now() });

    return quote;
  }

  async getCandles(
    symbol: string,
    timeframe = '1h',
    limit = 200,
  ): Promise<MarketBar[]> {
    const binanceSymbol = toBinanceSymbol(symbol);
    if (!binanceSymbol) return [];

    const interval = this.toBinanceInterval(timeframe);
    const url = `/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${Math.min(limit, 1000)}`;

    const klines = await this.binanceGet<BinanceKline[]>(url);
    if (!klines || !Array.isArray(klines)) return [];

    return klines.map((k) => ({
      timestamp: new Date(k[0]),
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    const binanceSymbol = toBinanceSymbol(symbol);
    if (!binanceSymbol) return null;

    const tcsSymbol = fromBinanceSymbol(binanceSymbol);
    return {
      symbol: tcsSymbol,
      name: tcsSymbol.replace('USD', ''),
      exchange: 'Binance',
      sector: 'Cryptocurrency',
      industry: 'Digital Asset',
      marketCap: null,
    };
  }

  async healthCheck(): Promise<boolean> {
    const result = await this.binanceGet<Record<string, unknown>>('/api/v3/ping');
    return result !== null;
  }

  getCapabilities(): string[] {
    return ['quotes', 'candles', 'profiles'];
  }

  async getRateLimit(): Promise<{
    remaining: number;
    limit: number;
    resetAt: Date | null;
  } | null> {
    // Binance doesn't expose remaining calls via a header we can easily capture here.
    // The rate limit governor handles this at the application level.
    return null;
  }

  /** Reset the circuit breaker (e.g., after connectivity restored) */
  resetCircuitBreaker(): void {
    this.tripped = false;
    this.trippedAt = null;
    this.consecutiveErrors = 0;
    this.quoteCache.clear();
  }

  // ─── Private Helpers ─────────────────────────────────────

  private async binanceGet<T>(path: string): Promise<T | null> {
    // Circuit breaker check
    if (this.tripped) {
      if (this.trippedAt && Date.now() - this.trippedAt >= this.COOLDOWN_MS) {
        this.logger.log('Circuit breaker cooldown elapsed — resetting Binance adapter');
        this.resetCircuitBreaker();
      } else {
        return null;
      }
    }

    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (this.apiKey) {
        headers['X-MBX-APIKEY'] = this.apiKey;
      }

      const res = await fetch(`${this.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        this.consecutiveErrors++;
        this.logger.warn(
          `Binance HTTP ${res.status} for ${path}: ${res.statusText}`,
        );
        if (this.consecutiveErrors >= this.MAX_ERRORS) {
          this.tripped = true;
          this.trippedAt = Date.now();
          this.logger.error(
            `Binance circuit breaker TRIPPED after ${this.MAX_ERRORS} consecutive errors`,
          );
        }
        return null;
      }

      this.consecutiveErrors = 0;
      const data = await res.json();
      return data as T;
    } catch (error: unknown) {
      this.consecutiveErrors++;
      const errMsg = (error as Error).message || String(error);
      this.logger.warn(`Binance fetch error for ${path}: ${errMsg}`);
      if (this.consecutiveErrors >= this.MAX_ERRORS) {
        this.tripped = true;
        this.trippedAt = Date.now();
        this.logger.error(
          `Binance circuit breaker TRIPPED after ${this.MAX_ERRORS} consecutive errors`,
        );
      }
      return null;
    }
  }

  /** Convert TCS timeframe → Binance kline interval */
  private toBinanceInterval(timeframe: string): string {
    const map: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      '1w': '1w',
      '1mn': '1M',
    };
    return map[timeframe.toLowerCase()] || '1h';
  }
}
