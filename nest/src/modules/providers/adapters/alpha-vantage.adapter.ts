import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

@Injectable()
export class AlphaVantageAdapter implements IProviderAdapter {
  readonly name = 'Alpha Vantage';
  private readonly logger = new Logger(AlphaVantageAdapter.name);
  private readonly apiKey = process.env.ALPHA_VANTAGE_API_KEY;

  getQuote(symbol: string): Promise<ProviderQuote | null> {
    if (!this.apiKey) {
      this.logger.debug(
        `AlphaVantageAdapter.getQuote(${symbol}) — no credentials, returning mock`,
      );
    }
    return Promise.resolve(this.getMockQuote(symbol));
  }

  getCandles(
    symbol: string,
    timeframe: string,
    limit = 100,
  ): Promise<MarketBar[]> {
    if (!this.apiKey) {
      this.logger.debug(
        `AlphaVantageAdapter.getCandles(${symbol}, ${timeframe}, ${limit}) — no credentials, returning mock`,
      );
    }
    return Promise.resolve(this.getMockCandles(symbol, limit));
  }

  getProfile(symbol: string): Promise<ProviderProfile | null> {
    if (!this.apiKey) {
      this.logger.debug(
        `AlphaVantageAdapter.getProfile(${symbol}) — no credentials, returning mock`,
      );
    }
    return Promise.resolve(this.getMockProfile(symbol));
  }

  healthCheck(): Promise<boolean> {
    if (!this.apiKey) {
      this.logger.debug(
        'AlphaVantageAdapter.healthCheck — no credentials configured',
      );
      return Promise.resolve(false);
    }
    return Promise.resolve(true);
  }

  private getMockQuote(symbol: string): ProviderQuote {
    const basePrice = this.getBasePriceForSymbol(symbol);
    const spread = basePrice * 0.001;
    return {
      symbol,
      bid: basePrice - spread / 2,
      ask: basePrice + spread / 2,
      last: basePrice,
      timestamp: new Date(),
    };
  }

  private getMockCandles(symbol: string, limit: number): MarketBar[] {
    const bars: MarketBar[] = [];
    const basePrice = this.getBasePriceForSymbol(symbol);
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    for (let i = limit - 1; i >= 0; i--) {
      const timestamp = new Date(now - i * hourMs);
      const volatility = basePrice * 0.02;
      const open = basePrice + (Math.random() - 0.5) * volatility;
      const close = basePrice + (Math.random() - 0.5) * volatility;
      const high = Math.max(open, close) + Math.random() * volatility * 0.5;
      const low = Math.min(open, close) - Math.random() * volatility * 0.5;
      const volume = Math.floor(1000000 + Math.random() * 5000000);
      bars.push({ timestamp, open, high, low, close, volume });
    }
    return bars;
  }

  private getMockProfile(symbol: string): ProviderProfile {
    const profiles: Record<string, Partial<ProviderProfile>> = {
      AAPL: {
        name: 'Apple Inc.',
        sector: 'Technology',
        industry: 'Consumer Electronics',
        marketCap: 3000000000000,
      },
      NVDA: {
        name: 'NVIDIA Corporation',
        sector: 'Technology',
        industry: 'Semiconductors',
        marketCap: 2000000000000,
      },
      TSLA: {
        name: 'Tesla Inc.',
        sector: 'Consumer Cyclical',
        industry: 'Auto Manufacturers',
        marketCap: 800000000000,
      },
    };
    const profile = profiles[symbol.toUpperCase()] || {
      name: `${symbol} Corporation`,
      sector: 'Technology',
      industry: 'Software',
      marketCap: 50000000000,
    };
    return { symbol, exchange: 'NASDAQ', ...profile } as ProviderProfile;
  }

  private getBasePriceForSymbol(symbol: string): number {
    const prices: Record<string, number> = {
      AAPL: 175.5,
      NVDA: 485.25,
      TSLA: 248.75,
    };
    return prices[symbol.toUpperCase()] || 100.0;
  }
}
