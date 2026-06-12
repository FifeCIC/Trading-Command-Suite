import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

/**
 * Yahoo Finance Adapter (Unofficial v8 API)
 * ==========================================
 * NO API KEY REQUIRED — free, rate-limited, reliable.
 *
 * Base URL: https://query1.finance.yahoo.com
 *
 * Rate limits (unofficial — be respectful):
 *   ~2000 requests/hour
 *   ~5 requests/second burst
 *   Stocks: 15-min delayed
 *   Crypto: real-time
 *
 * Symbol formats:
 *   Stocks:  AAPL, NVDA
 *   ETFs:    SPY, QQQ
 *   Forex:   EURUSD=X, GBPUSD=X
 *   Crypto:  BTC-USD, ETH-USD
 *   Indices: ^GSPC (S&P 500), ^IXIC (NASDAQ)
 */

@Injectable()
export class YahooFinanceAdapter implements IProviderAdapter {
  readonly name = 'Yahoo Finance';
  readonly id = 'yahoo';
  private readonly logger = new Logger(YahooFinanceAdapter.name);
  private readonly baseUrl = 'https://query1.finance.yahoo.com';

  private requestCount = 0;
  private hourStart = Date.now();
  private lastRequestTime = 0;
  private backoffUntil = 0;

  // ── Rate limiting ────────────────────────────────────────

  private async rateLimit(): Promise<void> {
    const now = Date.now();

    // Reset hourly counter
    if (now - this.hourStart > 3_600_000) {
      this.logger.log(`Yahoo: ${this.requestCount} requests in the last hour`);
      this.requestCount = 0;
      this.hourStart = now;
    }

    // Backoff from 429
    if (now < this.backoffUntil) {
      const wait = this.backoffUntil - now;
      this.logger.warn(`Yahoo: backing off for ${wait}ms`);
      await this.sleep(wait);
    }

    // 500ms between requests
    const elapsed = now - this.lastRequestTime;
    if (elapsed < 500) {
      await this.sleep(500 - elapsed);
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  private hitRateLimit(): void {
    this.backoffUntil = Date.now() + 10_000; // 10 second backoff
    this.logger.warn(`Yahoo: rate limited — backing off until ${new Date(this.backoffUntil).toISOString()}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ── IProviderAdapter implementation ───────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    try {
      await this.rateLimit();
      const ySymbol = this.toYahooSymbol(symbol);
      const url = `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=1d&range=1d`;
      const res = await fetch(url);

      if (res.status === 429) { this.hitRateLimit(); return null; }
      if (!res.ok) { this.logger.warn(`Yahoo quote ${symbol}: HTTP ${res.status}`); return null; }

      const data = await res.json();
      const meta = data?.chart?.result?.[0]?.meta;
      if (!meta) return null;

      return {
        symbol,
        bid: meta.bid ?? null,
        ask: meta.ask ?? null,
        last: meta.regularMarketPrice ?? meta.previousClose ?? null,
        timestamp: new Date(meta.regularMarketTime * 1000 || Date.now()),
      };
    } catch (err) {
      this.logger.error(`Yahoo getQuote(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getCandles(
    symbol: string,
    timeframe = '1d',
    limit = 100,
  ): Promise<MarketBar[]> {
    try {
      await this.rateLimit();
      const ySymbol = this.toYahooSymbol(symbol);
      const { yInterval, yRange } = this.toYahooParams(timeframe, limit);

      const url = `${this.baseUrl}/v8/finance/chart/${encodeURIComponent(ySymbol)}?interval=${yInterval}&range=${yRange}`;
      const res = await fetch(url);

      if (res.status === 429) { this.hitRateLimit(); return []; }
      if (!res.ok) { this.logger.warn(`Yahoo candles ${symbol}: HTTP ${res.status}`); return []; }

      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) return [];

      const timestamps: number[] = result.timestamp || [];
      const quote = result.indicators?.quote?.[0];
      if (!quote || !timestamps.length) return [];

      const bars: MarketBar[] = [];
      for (let i = 0; i < Math.min(timestamps.length, limit); i++) {
        const o = quote.open?.[i];
        const h = quote.high?.[i];
        const l = quote.low?.[i];
        const c = quote.close?.[i];
        const v = quote.volume?.[i];
        if (o == null || c == null) continue;
        bars.push({
          timestamp: new Date(timestamps[i] * 1000),
          open: o,
          high: h ?? Math.max(o, c),
          low: l ?? Math.min(o, c),
          close: c,
          volume: v ?? 0,
        });
      }
      return bars;
    } catch (err) {
      this.logger.error(`Yahoo getCandles(${symbol}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    try {
      await this.rateLimit();
      const ySymbol = this.toYahooSymbol(symbol);
      const url = `${this.baseUrl}/v11/finance/quoteSummary/${encodeURIComponent(ySymbol)}?modules=assetProfile,price`;
      const res = await fetch(url);

      if (res.status === 429) { this.hitRateLimit(); return null; }
      if (!res.ok) { this.logger.warn(`Yahoo profile ${symbol}: HTTP ${res.status}`); return null; }

      const data = await res.json();
      const result = data?.quoteSummary?.result?.[0];
      const profile = result?.assetProfile;
      const price = result?.price;

      return {
        symbol,
        name: price?.shortName || price?.longName || symbol,
        exchange: price?.exchangeName || profile?.exchange || 'Unknown',
        sector: profile?.sector || null,
        industry: profile?.industry || null,
        marketCap: price?.marketCap?.raw ?? null,
      };
    } catch (err) {
      this.logger.error(`Yahoo getProfile(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v8/finance/chart/AAPL?interval=1d&range=1d`);
      return res.ok;
    } catch (err) {
      this.logger.error(`Yahoo healthCheck failed: ${(err as Error).message}`);
      return false;
    }
  }

  getCapabilities(): string[] {
    return ['quotes', 'candles', 'profiles'];
  }

  // ── Symbol mapping ────────────────────────────────────────

  /**
   * Convert user-friendly symbol to Yahoo Finance format.
   * Handles forex, crypto, indices, and plain stocks/ETFs.
   */
  private toYahooSymbol(symbol: string): string {
    // Already in Yahoo format?
    if (symbol.includes('=X') || symbol.includes('-USD') || symbol.startsWith('^')) {
      return symbol;
    }

    // Forex pairs (6-char uppercase without /)
    const forexPairs: Record<string, string> = {
      EURUSD: 'EURUSD=X', GBPUSD: 'GBPUSD=X', USDJPY: 'USDJPY=X',
      AUDUSD: 'AUDUSD=X', USDCAD: 'USDCAD=X', USDCHF: 'USDCHF=X',
      NZDUSD: 'NZDUSD=X', EURGBP: 'EURGBP=X', EURJPY: 'EURJPY=X',
      GBPJPY: 'GBPJPY=X',
    };
    if (forexPairs[symbol.toUpperCase()]) return forexPairs[symbol.toUpperCase()];

    // Common crypto
    const cryptoMap: Record<string, string> = {
      BTC: 'BTC-USD', ETH: 'ETH-USD', DOGE: 'DOGE-USD',
      XRP: 'XRP-USD', ADA: 'ADA-USD', SOL: 'SOL-USD',
      MATIC: 'MATIC-USD', DOT: 'DOT-USD', SHIB: 'SHIB-USD',
      LTC: 'LTC-USD', LINK: 'LINK-USD', UNI: 'UNI-USD',
    };
    if (cryptoMap[symbol.toUpperCase()]) return cryptoMap[symbol.toUpperCase()];

    // Common indices
    const indexMap: Record<string, string> = {
      SPX: '^GSPC', SP500: '^GSPC', IXIC: '^IXIC', NASDAQ: '^IXIC',
      DJI: '^DJI', DOW: '^DJI', VIX: '^VIX', RUT: '^RUT',
      FTSE: '^FTSE', N225: '^N225', HSI: '^HSI',
    };
    if (indexMap[symbol.toUpperCase()]) return indexMap[symbol.toUpperCase()];

    // Default: leave as-is (stocks, ETFs)
    return symbol;
  }

  // ── Timeframe mapping ─────────────────────────────────────

  private toYahooParams(
    timeframe: string,
    limit: number,
  ): { yInterval: string; yRange: string } {
    const map: Record<string, { interval: string; rangeFor: (n: number) => string }> = {
      '1m':  { interval: '1m',  rangeFor: (n) => n <= 7 ? '7d' : '1mo' },
      '5m':  { interval: '5m',  rangeFor: (n) => n <= 78 ? '1mo' : '3mo' },
      '15m': { interval: '15m', rangeFor: (n) => n <= 26 ? '1mo' : '3mo' },
      '30m': { interval: '30m', rangeFor: (n) => n <= 26 ? '1mo' : '3mo' },
      '1h':  { interval: '1h',  rangeFor: (n) => n <= 21 ? '1mo' : n <= 63 ? '3mo' : '6mo' },
      '1d':  { interval: '1d',  rangeFor: (n) => n <= 5 ? '5d' : n <= 30 ? '1mo' : n <= 90 ? '3mo' : n <= 180 ? '6mo' : n <= 365 ? '1y' : '2y' },
      '1w':  { interval: '1wk', rangeFor: (n) => n <= 52 ? '1y' : '2y' },
      '1M':  { interval: '1mo', rangeFor: (n) => n <= 12 ? '1y' : n <= 24 ? '2y' : '5y' },
    };

    const entry = map[timeframe] || map['1d'];
    return { yInterval: entry.interval, yRange: entry.rangeFor(limit) };
  }
}
