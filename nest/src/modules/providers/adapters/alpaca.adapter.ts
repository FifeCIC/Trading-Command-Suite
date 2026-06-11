import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

@Injectable()
export class AlpacaAdapter implements IProviderAdapter {
  readonly name = 'Alpaca';
  private readonly logger = new Logger(AlpacaAdapter.name);
  private readonly apiKey = process.env.ALPACA_API_KEY;
  private readonly apiSecret = process.env.ALPACA_API_SECRET;
  private readonly baseUrl =
    process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
  private readonly dataUrl = 'https://data.alpaca.markets';

  private authHeaders(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.apiKey || '',
      'APCA-API-SECRET-KEY': this.apiSecret || '',
    };
  }

  private checkCredentials(): void {
    if (!this.apiKey || !this.apiSecret) {
      throw new Error('Alpaca credentials not configured');
    }
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    try {
      this.checkCredentials();
      this.logger.log(`Alpaca: fetching quote for ${symbol}`);
      const res = await fetch(
        `${this.dataUrl}/v2/stocks/${symbol}/quotes/latest`,
        { headers: this.authHeaders() },
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error('Alpaca authentication failed — check API keys');
      }
      if (res.status === 429) {
        this.logger.warn(`Alpaca rate limit hit for quote ${symbol}`);
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const q = data.quote;
      if (!q) return null;
      return {
        symbol,
        bid: q.bp ?? 0,
        ask: q.ap ?? 0,
        last: q.ap ?? q.bp ?? 0,
        timestamp: new Date(q.t || Date.now()),
      };
    } catch (err) {
      this.logger.error(`Alpaca getQuote(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getCandles(
    symbol: string,
    timeframe = '1Hour',
    limit = 100,
  ): Promise<MarketBar[]> {
    try {
      this.checkCredentials();
      this.logger.log(`Alpaca: fetching ${limit} candles for ${symbol} (${timeframe})`);
      const res = await fetch(
        `${this.dataUrl}/v2/stocks/${symbol}/bars?timeframe=${timeframe}&limit=${limit}`,
        { headers: this.authHeaders() },
      );
      if (res.status === 401 || res.status === 403) {
        throw new Error('Alpaca authentication failed — check API keys');
      }
      if (res.status === 429) {
        this.logger.warn(`Alpaca rate limit hit for candles ${symbol}`);
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      const bars = data.bars || [];
      this.logger.log(`Alpaca: got ${bars.length} candles for ${symbol} (${timeframe})`);
      return bars.map((b: any) => ({
        timestamp: new Date(b.t),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));
    } catch (err) {
      this.logger.error(`Alpaca getCandles(${symbol}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    try {
      this.checkCredentials();
      const res = await fetch(
        `${this.dataUrl}/v2/assets/${symbol}`,
        { headers: this.authHeaders() },
      );
      if (res.status === 429) return null;
      if (!res.ok) return null;
      const asset = await res.json();
      return {
        symbol,
        name: asset.name || symbol,
        sector: asset.class || 'unknown',
        exchange: asset.exchange || 'unknown',
        industry: null,
        marketCap: null,
      };
    } catch (err) {
      this.logger.error(`Alpaca getProfile(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      this.checkCredentials();
      const res = await fetch(`${this.baseUrl}/v2/clock`, {
        headers: this.authHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        this.logger.warn('Alpaca healthCheck: authentication failed');
        return false;
      }
      const ok = res.ok;
      this.logger.log(`Alpaca healthCheck: ${ok ? 'OK' : 'failed'} (${res.status})`);
      return ok;
    } catch (err) {
      this.logger.error(`Alpaca healthCheck failed: ${(err as Error).message}`);
      return false;
    }
  }
}
