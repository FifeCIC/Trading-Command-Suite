import { Injectable, Logger } from '@nestjs/common';
import { IProviderAdapter, MarketBar, ProviderProfile, ProviderQuote } from '../interfaces/provider-adapter.interface';

@Injectable()
export class AlpacaAdapter implements IProviderAdapter {
  readonly name = 'Alpaca';
  private readonly logger = new Logger(AlpacaAdapter.name);
  private readonly apiKey = process.env.ALPACA_API_KEY;
  private readonly apiSecret = process.env.ALPACA_API_SECRET;
  private readonly baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    if (!this.apiKey || !this.apiSecret) {
      this.logger.debug(`AlpacaAdapter.getQuote(${symbol}) — no credentials, returning mock data`);
      return this.getMockQuote(symbol);
    }

    // TODO: Implement real Alpaca API call
    this.logger.debug(`AlpacaAdapter.getQuote(${symbol}) — credentials present but real API not implemented yet, returning mock`);
    return this.getMockQuote(symbol);
  }

  async getCandles(symbol: string, timeframe: string, limit = 100): Promise<MarketBar[]> {
    if (!this.apiKey || !this.apiSecret) {
      this.logger.debug(`AlpacaAdapter.getCandles(${symbol}, ${timeframe}, ${limit}) — no credentials, returning mock data`);
      return this.getMockCandles(symbol, limit);
    }

    // TODO: Implement real Alpaca API call
    this.logger.debug(`AlpacaAdapter.getCandles(${symbol}) — credentials present but real API not implemented yet, returning mock`);
    return this.getMockCandles(symbol, limit);
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    if (!this.apiKey || !this.apiSecret) {
      this.logger.debug(`AlpacaAdapter.getProfile(${symbol}) — no credentials, returning mock data`);
      return this.getMockProfile(symbol);
    }

    // TODO: Implement real Alpaca API call
    this.logger.debug(`AlpacaAdapter.getProfile(${symbol}) — credentials present but real API not implemented yet, returning mock`);
    return this.getMockProfile(symbol);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey || !this.apiSecret) {
      this.logger.debug('AlpacaAdapter.healthCheck — no credentials configured');
      return false;
    }

    // TODO: Implement real health check (lightweight endpoint ping)
    this.logger.debug('AlpacaAdapter.healthCheck — credentials present but real check not implemented, returning true');
    return true;
  }

  // ---- Mock data methods for fallback mode ----

  private getMockQuote(symbol: string): ProviderQuote {
    const basePrice = this.getBasePriceForSymbol(symbol);
    const spread = basePrice * 0.001; // 0.1% spread

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
      const volatility = basePrice * 0.02; // 2% volatility
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
      AAPL: { name: 'Apple Inc.', sector: 'Technology', industry: 'Consumer Electronics', marketCap: 3000000000000 },
      NVDA: { name: 'NVIDIA Corporation', sector: 'Technology', industry: 'Semiconductors', marketCap: 2000000000000 },
      TSLA: { name: 'Tesla Inc.', sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', marketCap: 800000000000 },
    };

    const profile = profiles[symbol.toUpperCase()] || {
      name: `${symbol} Corporation`,
      sector: 'Technology',
      industry: 'Software',
      marketCap: 50000000000,
    };

    return {
      symbol,
      exchange: 'NASDAQ',
      ...profile,
    } as ProviderProfile;
  }

  private getBasePriceForSymbol(symbol: string): number {
    const prices: Record<string, number> = {
      AAPL: 175.50,
      NVDA: 485.25,
      TSLA: 248.75,
    };
    return prices[symbol.toUpperCase()] || 100.0;
  }
}
