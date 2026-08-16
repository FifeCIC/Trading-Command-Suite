import { Injectable, Logger } from '@nestjs/common';
import {
  EarningsEvent,
  IProviderAdapter,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';

/**
 * Alpha Vantage API Adapter
 * ==========================
 * Real implementation using the free tier API.
 *
 * ── Rate Limits (free tier) ─────────────────────────────
 * 5 requests per minute, 500 per day.
 * Premium plans: 75 RPM at $49.99/mo.
 *
 * ── Endpoints Used ─────────────────────────────────────
 * GLOBAL_QUOTE       — real-time quote (delayed on free)
 * TIME_SERIES_DAILY  — daily OHLCV candles
 * OVERVIEW           — company profile & fundamentals
 * EARNINGS_CALENDAR  — upcoming earnings dates & estimates
 */

@Injectable()
export class AlphaVantageAdapter implements IProviderAdapter {
  readonly name = 'Alpha Vantage';
  readonly id = 'alphavantage';
  private readonly logger = new Logger(AlphaVantageAdapter.name);
  private readonly apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  private readonly baseUrl = 'https://www.alphavantage.co/query';

  // ── credentials ───────────────────────────────────────

  private get hasCredentials(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  // ── helpers ───────────────────────────────────────────

  private buildUrl(params: Record<string, string>): string {
    const searchParams = new URLSearchParams({ ...params, apikey: this.apiKey! });
    return `${this.baseUrl}?${searchParams.toString()}`;
  }

  private async fetchJson(params: Record<string, string>): Promise<any> {
    const url = this.buildUrl(params);
    const res = await fetch(url);
    if (res.status === 429) {
      this.logger.warn('Alpha Vantage rate limit hit (429)');
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json();
    // Alpha Vantage returns errors as { "Error Message": "..." } or { "Note": "..." }
    if (data?.['Error Message']) {
      this.logger.warn(`Alpha Vantage error: ${data['Error Message']}`);
      return null;
    }
    if (data?.Note) {
      this.logger.warn(`Alpha Vantage note: ${data.Note}`);
      return null;
    }
    return data;
  }

  // ── IProviderAdapter: Quote ───────────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    if (!this.hasCredentials) return null; // No API key — never fabricate quotes
    try {
      const data = await this.fetchJson({ function: 'GLOBAL_QUOTE', symbol });
      const quote = data?.['Global Quote'];
      if (!quote || !quote['05. price']) {
        this.logger.debug(`AV getQuote(${symbol}): no data`);
        return null;
      }
      return {
        symbol,
        bid: parseFloat(quote['09. bid']) || null,
        ask: parseFloat(quote['10. ask']) || null,
        last: parseFloat(quote['05. price']),
        timestamp: new Date(),
      };
    } catch (err) {
      this.logger.error(`AV getQuote(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── IProviderAdapter: Candles ─────────────────────────

  async getCandles(
    symbol: string,
    timeframe = '1d',
    limit = 100,
  ): Promise<MarketBar[]> {
    if (!this.hasCredentials) return []; // No API key — never fabricate candles
    try {
      // Map timeframe to Alpha Vantage function
      const fn = timeframe === '1d' || timeframe === 'daily'
        ? 'TIME_SERIES_DAILY'
        : 'TIME_SERIES_INTRADAY';
      
      const params: Record<string, string> = { function: fn, symbol, outputsize: 'compact' };
      if (fn === 'TIME_SERIES_INTRADAY') {
        const intervalMap: Record<string, string> = {
          '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min', '1h': '60min',
        };
        params.interval = intervalMap[timeframe] || '60min';
      }

      const data = await this.fetchJson(params);
      if (!data) return [];

      // Parse the time series key (varies by function)
      const timeSeriesKey = Object.keys(data).find((k) => k.startsWith('Time Series'));
      if (!timeSeriesKey) return [];

      const series = data[timeSeriesKey];
      const bars: MarketBar[] = [];

      for (const [timestamp, values] of Object.entries(series).slice(0, limit)) {
        const v = values as Record<string, string>;
        bars.push({
          timestamp: new Date(timestamp),
          open: parseFloat(v['1. open']),
          high: parseFloat(v['2. high']),
          low: parseFloat(v['3. low']),
          close: parseFloat(v['4. close']),
          volume: parseInt(v['5. volume'] || '0', 10),
        });
      }

      return bars.reverse(); // Alpha Vantage returns newest first
    } catch (err) {
      this.logger.error(`AV getCandles(${symbol}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  // ── IProviderAdapter: Profile ─────────────────────────

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    if (!this.hasCredentials) return null; // No API key — never fabricate profiles
    try {
      const data = await this.fetchJson({ function: 'OVERVIEW', symbol });
      if (!data || !data.Symbol) {
        this.logger.debug(`AV getProfile(${symbol}): no data`);
        return null;
      }
      return {
        symbol: data.Symbol,
        name: data.Name || symbol,
        exchange: data.Exchange || 'Unknown',
        sector: data.Sector || null,
        industry: data.Industry || null,
        marketCap: data.MarketCapitalization
          ? parseInt(data.MarketCapitalization, 10)
          : null,
      };
    } catch (err) {
      this.logger.error(`AV getProfile(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── IProviderAdapter: Health ──────────────────────────

  async healthCheck(): Promise<boolean> {
    if (!this.hasCredentials) {
      this.logger.debug('AV healthCheck: no credentials');
      return false;
    }
    try {
      const data = await this.fetchJson({ function: 'GLOBAL_QUOTE', symbol: 'AAPL' });
      return !!data?.['Global Quote'];
    } catch {
      return false;
    }
  }

  // ── Earnings Calendar (NEW) ───────────────────────────

  /**
   * Fetch upcoming earnings for a symbol or all tracked symbols.
   * Alpha Vantage EARNINGS_CALENDAR endpoint returns CSV by default.
   *
   * @param symbol  Optional ticker. If omitted, fetches all upcoming.
   * @param horizonMonths  3, 6, or 12 months ahead.
   */
  async getEarningsCalendar(symbol?: string, horizonMonths = 3): Promise<EarningsEvent[]> {
    if (!this.hasCredentials) {
      this.logger.debug('AV getEarningsCalendar: no credentials');
      return [];
    }
    try {
      const params: Record<string, string> = {
        function: 'EARNINGS_CALENDAR',
        horizon: `${horizonMonths}month`,
      };
      if (symbol) params.symbol = symbol;

      // EARNINGS_CALENDAR returns CSV — build URL and fetch as text
      const url = this.buildUrl(params);
      const res = await fetch(url);
      if (!res.ok) return [];
      const csvText = await res.text();

      // Parse CSV: first line is headers, rest are data rows
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) return [];

      const headers = lines[0].split(',');
      const result: EarningsEvent[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        if (values.length < headers.length) continue;

        const row: Record<string, string> = {};
        headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });

        const eventSymbol = row.symbol || symbol || '';
        if (!eventSymbol || !row.reportDate) continue;

        result.push({
          symbol: eventSymbol,
          name: row.name || undefined,
          reportDate: row.reportDate,
          fiscalDateEnding: row.fiscalDateEnding || undefined,
          epsEstimate: row.estimate ? parseFloat(row.estimate) : null,
          epsActual: null,
          revenueEstimate: null,
          revenueActual: null,
          surprisePercent: null,
          timeOfDay: (row.timeOfTheDay === 'Before Open' || row.timeOfTheDay === 'After Close')
            ? row.timeOfTheDay as 'Before Open' | 'After Close'
            : null,
          currency: row.currency || 'USD',
          source: 'alphavantage',
        });
      }

      this.logger.log(`AV getEarningsCalendar: ${result.length} events (symbol=${symbol || 'all'}, horizon=${horizonMonths}m)`);
      return result;
    } catch (err) {
      this.logger.error(`AV getEarningsCalendar failed: ${(err as Error).message}`);
      return [];
    }
  }

  // ── Capabilities ──────────────────────────────────────

  getCapabilities(): string[] {
    return this.hasCredentials
      ? ['quotes', 'candles', 'profiles', 'earnings', 'fundamentals']
      : [];
  }

}
