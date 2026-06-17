/**
 * Financial Modeling Prep (FMP) Provider Adapter
 * ===============================================
 * Free tier: 250 calls/day. Best free source for fundamentals,
 * earnings, and financial statements.
 *
 * Base URL: https://financialmodelingprep.com/api/v3
 *
 * Config (.env):
 *   FMP_API_KEY=your_key (get at financialmodelingprep.com)
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

const BASE_URL = 'https://financialmodelingprep.com/api/v3';

@Injectable()
export class FmpAdapter implements IProviderAdapter {
  readonly name = 'FMP';
  readonly id = 'fmp';
  private readonly logger = new Logger(FmpAdapter.name);
  private readonly apiKey = process.env.FMP_API_KEY || '';
  private callCount = 0;
  private dayStart = Date.now();

  private get apikey(): string {
    return this.apiKey;
  }

  private checkCredentials(): void {
    if (!this.apiKey) {
      throw new Error('FMP credentials not configured — set FMP_API_KEY in .env');
    }
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.dayStart > 86_400_000) {
      this.logger.debug(`FMP: ${this.callCount} calls today`);
      this.callCount = 0;
      this.dayStart = now;
    }
    if (this.callCount >= 230) {
      this.logger.warn(`FMP: ${this.callCount}/250 daily calls — near limit`);
    }
    this.callCount++;
  }

  private async fmpGet<T>(path: string): Promise<T | null> {
    this.checkCredentials();
    await this.rateLimit();

    try {
      const sep = path.includes('?') ? '&' : '?';
      const url = `${BASE_URL}${path}${sep}apikey=${this.apikey}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status === 429) {
        this.logger.warn('FMP rate limit hit — waiting 60s');
        await new Promise((r) => setTimeout(r, 60_000));
        return null;
      }

      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`FMP request failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    this.logger.log(`FMP: fetching quote for ${symbol}`);
    const data = await this.fmpGet<any[]>(`/quote/${encodeURIComponent(symbol)}`);

    if (!data || !Array.isArray(data) || !data[0]) return null;
    const q = data[0];

    return {
      symbol,
      bid: q.price ?? q.bid ?? null,
      ask: q.price ?? q.ask ?? null,
      last: q.price ?? null,
      timestamp: new Date(q.timestamp * 1000 || Date.now()),
    };
  }

  async getCandles(
    symbol: string,
    _timeframe = '1d',
    limit = 100,
  ): Promise<MarketBar[]> {
    this.logger.log(`FMP: fetching ${limit} daily candles for ${symbol}`);

    const data = await this.fmpGet<any>(
      `/historical-price-full/${encodeURIComponent(symbol)}?timeseries=${Math.min(limit, 1000)}`,
    );

    if (!data?.historical) return [];

    const bars: MarketBar[] = [];
    for (const h of data.historical.slice(0, limit)) {
      bars.push({
        timestamp: new Date(h.date),
        open: h.open,
        high: h.high,
        low: h.low,
        close: h.close,
        volume: h.volume ?? 0,
      });
    }

    bars.reverse(); // chrono order
    this.logger.log(`FMP: got ${bars.length} candles for ${symbol}`);
    return bars;
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    this.logger.log(`FMP: fetching profile for ${symbol}`);
    const data = await this.fmpGet<any[]>(`/profile/${encodeURIComponent(symbol)}`);

    if (!data || !Array.isArray(data) || !data[0]) return null;
    const p = data[0];

    return {
      symbol,
      name: p.companyName || symbol,
      exchange: p.exchangeShortName || p.exchange || 'Unknown',
      sector: p.sector || null,
      industry: p.industry || null,
      marketCap: p.mktCap ?? null,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const data = await this.fmpGet<any[]>('/quote/AAPL');
      return !!(data && Array.isArray(data) && data[0]?.price);
    } catch (err) {
      this.logger.error(`FMP healthCheck failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ── Price Targets ─────────────────────────────────────

  async getPriceTarget(symbol: string): Promise<any | null> {
    this.logger.log(`FMP: fetching price target for ${symbol}`);
    const data = await this.fmpGet<any>(
      `/price-target?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!data || !data.symbol) return null;
    return {
      symbol: data.symbol,
      source: 'fmp',
      targetHigh: data.targetHigh ?? null,
      targetLow: data.targetLow ?? null,
      targetConsensus: data.targetConsensus ?? null,
      targetMedian: data.targetMedian ?? null,
      numberOfAnalysts: data.numberOfAnalysts ?? null,
      lastUpdated: data.lastUpdated ? new Date(data.lastUpdated) : new Date(),
    };
  }

  // ── Analyst Estimates ─────────────────────────────────

  async getAnalystEstimates(symbol: string): Promise<any | null> {
    this.logger.log(`FMP: fetching analyst estimates for ${symbol}`);
    return this.fmpGet<any>(
      `/analyst-estimates/${encodeURIComponent(symbol)}`,
    );
  }
}
