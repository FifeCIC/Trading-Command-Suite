/**
 * Finnhub Provider Adapter
 * =========================
 * Free tier: 60 calls/min. Best free source for news sentiment and
 * company fundamentals.
 *
 * Base URL: https://finnhub.io/api/v1
 *
 * Config (.env):
 *   FINNHUB_API_KEY=your_free_key (get at finnhub.io)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

const BASE_URL = 'https://finnhub.io/api/v1';

// Resolution mapping
const RES_MAP: Record<string, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '1d': 'D',
  '1wk': 'W',
};

@Injectable()
export class FinnhubAdapter implements IProviderAdapter {
  readonly name = 'Finnhub';
  readonly id = 'finnhub';
  private readonly logger = new Logger(FinnhubAdapter.name);
  private readonly apiKey = process.env.FINNHUB_API_KEY || '';
  private callCount = 0;
  private minuteStart = Date.now();

  private get token(): string {
    return this.apiKey;
  }

  private checkCredentials(): void {
    if (!this.apiKey) {
      throw new Error('Finnhub credentials not configured — set FINNHUB_API_KEY in .env');
    }
  }

  /** Track and enforce 60 calls/min rate limit. */
  private async rateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.minuteStart > 60_000) {
      if (this.callCount > 0) {
        this.logger.debug(`Finnhub: ${this.callCount} calls in the last minute`);
      }
      this.callCount = 0;
      this.minuteStart = now;
    }

    if (this.callCount >= 55) {
      this.logger.warn(`Finnhub: ${this.callCount}/60 calls used — near limit`);
    }

    this.callCount++;
  }

  private async finnhubGet<T>(path: string): Promise<T | null> {
    this.checkCredentials();
    await this.rateLimit();

    try {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${BASE_URL}${path}${sep}token=${this.token}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 429) {
        this.logger.warn('Finnhub rate limit hit (429) — waiting 60s');
        await new Promise((r) => setTimeout(r, 60_000));
        return null;
      }

      if (res.status === 401 || res.status === 403) {
        throw new Error('Finnhub API key invalid');
      }

      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`Finnhub request failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    this.logger.log(`Finnhub: fetching quote for ${symbol}`);
    const data = await this.finnhubGet<any>(`/quote?symbol=${encodeURIComponent(symbol)}`);

    if (!data || data.c == null) return null;

    return {
      symbol,
      bid: data.c ?? null,
      ask: data.h ?? null,
      last: data.c ?? null,
      timestamp: new Date(data.t ? data.t * 1000 : Date.now()),
    };
  }

  async getCandles(
    symbol: string,
    timeframe = '1d',
    limit = 100,
  ): Promise<MarketBar[]> {
    const resolution = RES_MAP[timeframe] || 'D';

    // Calculate from/to timestamps (UNIX seconds)
    const now = Math.floor(Date.now() / 1000);
    const lookback = limit * this.resolutionSeconds(resolution);
    const from = now - lookback;

    this.logger.log(`Finnhub: fetching ${limit} candles for ${symbol} (${timeframe}→${resolution})`);

    const data = await this.finnhubGet<any>(
      `/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${now}`,
    );

    if (!data || data.s !== 'ok' || !data.t) return [];

    const bars: MarketBar[] = [];
    const count = Math.min(data.t.length, limit);
    for (let i = 0; i < count; i++) {
      bars.push({
        timestamp: new Date(data.t[i] * 1000),
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i],
      });
    }

    this.logger.log(`Finnhub: got ${bars.length} candles for ${symbol}`);
    return bars;
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    this.logger.log(`Finnhub: fetching profile for ${symbol}`);
    const data = await this.finnhubGet<any>(
      `/stock/profile2?symbol=${encodeURIComponent(symbol)}`,
    );

    if (!data || !data.name) return null;

    return {
      symbol,
      name: data.name || symbol,
      exchange: data.exchange || 'Unknown',
      sector: data.finnhubIndustry || null,
      industry: data.finnhubIndustry || null,
      marketCap: data.marketCapitalization
        ? data.marketCapitalization * 1_000_000
        : null,
    };
  }

  // ── Finnhub-specific methods (beyond IProviderAdapter) ──

  async getNews(symbol: string, days = 7): Promise<any[] | null> {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 86_400_000).toISOString().split('T')[0];
    this.logger.log(`Finnhub: fetching news for ${symbol} (${from} to ${to})`);
    return this.finnhubGet<any[]>(
      `/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`,
    );
  }

  async getSentiment(symbol: string): Promise<any | null> {
    this.logger.log(`Finnhub: fetching sentiment for ${symbol}`);
    return this.finnhubGet<any>(
      `/news-sentiment?symbol=${encodeURIComponent(symbol)}`,
    );
  }

  async healthCheck(): Promise<boolean> {
    try {
      const data = await this.finnhubGet<any>(
        `/quote?symbol=${encodeURIComponent('AAPL')}`,
      );
      return !!(data && data.c != null);
    } catch (err) {
      this.logger.error(`Finnhub healthCheck failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ── Helpers ──

  private resolutionSeconds(res: string): number {
    const map: Record<string, number> = {
      '1': 60, '5': 300, '15': 900, '30': 1800,
      '60': 3600, 'D': 86400, 'W': 604800,
    };
    return map[res] || 86400;
  }
}
