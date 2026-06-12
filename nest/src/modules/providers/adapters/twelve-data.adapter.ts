/**
 * Twelve Data Provider Adapter
 * =============================
 * Free tier: 8 calls/min, 800/day. Good alternative to Alpha Vantage.
 *
 * Base URL: https://api.twelvedata.com
 *
 * Config (.env):
 *   TWELVE_DATA_API_KEY=your_key (get at twelvedata.com)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

const BASE_URL = 'https://api.twelvedata.com';

// Interval mapping
const INTERVAL_MAP: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '1d': '1day',
  '1wk': '1week',
};

@Injectable()
export class TwelveDataAdapter implements IProviderAdapter {
  readonly name = 'Twelve Data';
  readonly id = 'twelvedata';
  private readonly logger = new Logger(TwelveDataAdapter.name);
  private readonly apiKey = process.env.TWELVE_DATA_API_KEY || '';
  private callCount = 0;
  private dayStart = Date.now();

  private get apikey(): string {
    return this.apiKey;
  }

  private checkCredentials(): void {
    if (!this.apiKey) {
      throw new Error('Twelve Data credentials not configured — set TWELVE_DATA_API_KEY in .env');
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.dayStart > 86_400_000) {
      this.logger.debug(`Twelve Data: ${this.callCount} calls today`);
      this.callCount = 0;
      this.dayStart = now;
    }
    if (this.callCount >= 750) {
      this.logger.warn(`Twelve Data: ${this.callCount}/800 daily calls used — near limit`);
    }
    this.callCount++;
  }

  private async tdGet<T>(path: string): Promise<T | null> {
    this.checkCredentials();
    await this.rateLimit();

    try {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${BASE_URL}${path}${sep}apikey=${this.apikey}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 429) {
        this.logger.warn('Twelve Data rate limit hit — waiting 60s');
        await new Promise((r) => setTimeout(r, 60_000));
        return null;
      }

      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`Twelve Data request failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    this.logger.log(`Twelve Data: fetching quote for ${symbol}`);
    const data = await this.tdGet<any>(`/quote?symbol=${encodeURIComponent(symbol)}`);

    if (!data || data.status === 'error') return null;

    return {
      symbol,
      bid: data.bid ? Number(data.bid) : null,
      ask: data.ask ? Number(data.ask) : null,
      last: Number(data.close ?? data.last ?? 0),
      timestamp: new Date(),
    };
  }

  async getCandles(
    symbol: string,
    timeframe = '1d',
    limit = 100,
  ): Promise<MarketBar[]> {
    const interval = INTERVAL_MAP[timeframe] || '1day';
    this.logger.log(`Twelve Data: fetching ${limit} candles for ${symbol} (${interval})`);

    const data = await this.tdGet<any>(
      `/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${Math.min(limit, 500)}`,
    );

    if (!data || data.status === 'error' || !data.values) return [];

    const bars: MarketBar[] = [];
    for (const val of data.values.slice(0, limit)) {
      bars.push({
        timestamp: new Date(val.datetime),
        open: Number(val.open),
        high: Number(val.high),
        low: Number(val.low),
        close: Number(val.close),
        volume: Number(val.volume ?? 0),
      });
    }

    bars.reverse(); // API returns newest first
    this.logger.log(`Twelve Data: got ${bars.length} candles for ${symbol}`);
    return bars;
  }

  async getProfile(_symbol: string): Promise<ProviderProfile | null> {
    return null; // Twelve Data free tier doesn't provide profile data
  }

  async healthCheck(): Promise<boolean> {
    try {
      const data = await this.tdGet<any>('/quote?symbol=AAPL');
      return !!(data && data.close);
    } catch (err) {
      this.logger.error(`Twelve Data healthCheck failed: ${(err as Error).message}`);
      return false;
    }
  }
}
