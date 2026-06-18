import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

interface FxRateResult {
  pair: string;
  rate: number;
  timestamp: Date;
  provider: string;
}

interface NormalizedPair {
  pair: string;
  from: string;
  to: string;
  compact: string;
}

const MAX_HISTORY_DAYS = 365;

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getLatestRate(inputPair: string) {
    const pair = this.normalizePair(inputPair);
    if (!pair) {
      return {
        status: 'invalid_pair',
        rate: null,
        message: 'Currency pair must use a six-letter code or slash format, e.g. USDGBP or USD/GBP.',
      };
    }

    const rate = await this.fetchLatestFromProviders(pair);
    if (!rate) {
      const cached = await this.getLatestStoredRate(pair.pair);
      if (cached) {
        return { status: 'cached', ...this.serializeRate(cached) };
      }

      return {
        status: 'unavailable',
        pair: pair.pair,
        rate: null,
        provider: null,
        timestamp: null,
        message: 'No configured FX provider returned a rate. Set ALPHA_VANTAGE_API_KEY, TWELVE_DATA_API_KEY, POLYGON_API_KEY, or TRADING212_API_KEY.',
      };
    }

    await this.storeRate(rate);
    return { status: 'live', ...this.serializeRate(rate) };
  }

  async getHistory(inputPair: string, requestedDays = 30) {
    const pair = this.normalizePair(inputPair);
    if (!pair) {
      return {
        status: 'invalid_pair',
        pair: inputPair,
        rates: [],
        message: 'Currency pair must use a six-letter code or slash format, e.g. USDGBP or USD/GBP.',
      };
    }

    const days = Number.isFinite(requestedDays)
      ? Math.max(1, Math.min(Math.floor(requestedDays), MAX_HISTORY_DAYS))
      : 30;

    const stored = await this.getStoredHistory(pair.pair, days);
    if (stored.length > 0) {
      return {
        status: 'stored',
        pair: pair.pair,
        days,
        rates: stored.map((rate) => this.serializeRate(rate)),
      };
    }

    const providerHistory = await this.fetchHistoryFromProviders(pair, days);
    for (const rate of providerHistory) {
      await this.storeRate(rate);
    }

    return {
      status: providerHistory.length > 0 ? 'live' : 'unavailable',
      pair: pair.pair,
      days,
      rates: providerHistory.map((rate) => this.serializeRate(rate)),
      message: providerHistory.length > 0
        ? undefined
        : 'No stored FX history exists and no configured provider returned historical FX rates.',
    };
  }

  private async fetchLatestFromProviders(pair: NormalizedPair): Promise<FxRateResult | null> {
    return await this.firstResult([
      () => this.fetchAlphaVantageLatest(pair),
      () => this.fetchTwelveDataLatest(pair),
      () => this.fetchPolygonLatest(pair),
      () => this.fetchTrading212Latest(pair),
    ]);
  }

  private async fetchHistoryFromProviders(pair: NormalizedPair, days: number): Promise<FxRateResult[]> {
    const providers = [
      () => this.fetchAlphaVantageHistory(pair, days),
      () => this.fetchTwelveDataHistory(pair, days),
    ];

    for (const provider of providers) {
      const result = await provider();
      if (result.length > 0) return result;
    }

    return [];
  }

  private async firstResult(providers: Array<() => Promise<FxRateResult | null>>) {
    for (const provider of providers) {
      const result = await provider();
      if (result) return result;
    }
    return null;
  }

  private async fetchAlphaVantageLatest(pair: NormalizedPair): Promise<FxRateResult | null> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return null;

    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'CURRENCY_EXCHANGE_RATE');
    url.searchParams.set('from_currency', pair.from);
    url.searchParams.set('to_currency', pair.to);
    url.searchParams.set('apikey', apiKey);

    const data = await this.fetchJson(url.toString(), 'alphavantage');
    const row = data?.['Realtime Currency Exchange Rate'];
    const rate = Number(row?.['5. Exchange Rate']);
    if (!Number.isFinite(rate) || rate <= 0) return null;

    return {
      pair: pair.pair,
      rate,
      timestamp: row?.['6. Last Refreshed'] ? new Date(`${row['6. Last Refreshed']}Z`) : new Date(),
      provider: 'alphavantage',
    };
  }

  private async fetchAlphaVantageHistory(pair: NormalizedPair, days: number): Promise<FxRateResult[]> {
    const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!apiKey) return [];

    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'FX_DAILY');
    url.searchParams.set('from_symbol', pair.from);
    url.searchParams.set('to_symbol', pair.to);
    url.searchParams.set('outputsize', days > 100 ? 'full' : 'compact');
    url.searchParams.set('apikey', apiKey);

    const data = await this.fetchJson(url.toString(), 'alphavantage');
    const series = data?.['Time Series FX (Daily)'];
    if (!series || typeof series !== 'object') return [];

    return Object.entries(series)
      .slice(0, days)
      .map(([date, values]) => {
        const row = values as Record<string, string>;
        return {
          pair: pair.pair,
          rate: Number(row['4. close']),
          timestamp: new Date(`${date}T00:00:00Z`),
          provider: 'alphavantage',
        };
      })
      .filter((rate: FxRateResult) => Number.isFinite(rate.rate) && rate.rate > 0)
      .reverse();
  }

  private async fetchTwelveDataLatest(pair: NormalizedPair): Promise<FxRateResult | null> {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) return null;

    const symbol = `${pair.from}/${pair.to}`;
    const url = new URL('https://api.twelvedata.com/exchange_rate');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('apikey', apiKey);

    const data = await this.fetchJson(url.toString(), 'twelvedata');
    const rate = Number(data?.rate);
    if (!Number.isFinite(rate) || rate <= 0) return null;

    return {
      pair: pair.pair,
      rate,
      timestamp: data?.timestamp ? new Date(Number(data.timestamp) * 1000) : new Date(),
      provider: 'twelvedata',
    };
  }

  private async fetchTwelveDataHistory(pair: NormalizedPair, days: number): Promise<FxRateResult[]> {
    const apiKey = process.env.TWELVE_DATA_API_KEY;
    if (!apiKey) return [];

    const symbol = `${pair.from}/${pair.to}`;
    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', '1day');
    url.searchParams.set('outputsize', String(Math.min(days, 500)));
    url.searchParams.set('apikey', apiKey);

    const data = await this.fetchJson(url.toString(), 'twelvedata');
    if (!Array.isArray(data?.values)) return [];

    return data.values
      .slice(0, days)
      .map((row: any) => ({
        pair: pair.pair,
        rate: Number(row.close),
        timestamp: new Date(`${row.datetime}T00:00:00Z`),
        provider: 'twelvedata',
      }))
      .filter((rate: FxRateResult) => Number.isFinite(rate.rate) && rate.rate > 0)
      .reverse();
  }

  private async fetchPolygonLatest(pair: NormalizedPair): Promise<FxRateResult | null> {
    const apiKey = process.env.POLYGON_API_KEY;
    if (!apiKey) return null;

    const ticker = `C:${pair.compact}`;
    const url = `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev?adjusted=true&apiKey=${encodeURIComponent(apiKey)}`;
    const data = await this.fetchJson(url, 'polygon');
    const row = data?.results?.[0];
    const rate = Number(row?.c);
    if (!Number.isFinite(rate) || rate <= 0) return null;

    return {
      pair: pair.pair,
      rate,
      timestamp: row?.t ? new Date(row.t) : new Date(),
      provider: 'polygon',
    };
  }

  private async fetchTrading212Latest(pair: NormalizedPair): Promise<FxRateResult | null> {
    const apiKey = process.env.TRADING212_API_KEY || process.env.TRADING212_LIVE_API_KEY;
    if (!apiKey) return null;

    const baseUrl = process.env.TRADING212_LIVE_BASE_URL || 'https://live.trading212.com/api/v0';
    const candidates = [`FX:${pair.compact}`, pair.compact, `${pair.compact}_FX`];

    for (const candidate of candidates) {
      const data = await this.fetchJson(`${baseUrl}/equity/quotes/${encodeURIComponent(candidate)}`, 'trading212', {
        Authorization: apiKey,
      });
      const rate = Number(data?.last ?? data?.ask ?? data?.bid);
      if (Number.isFinite(rate) && rate > 0) {
        return {
          pair: pair.pair,
          rate,
          timestamp: new Date(),
          provider: 'trading212',
        };
      }
    }

    return null;
  }

  private async fetchJson(url: string, provider: string, headers?: Record<string, string>) {
    try {
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429) {
        this.logger.warn(`${provider} FX rate limit hit`);
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.['Error Message'] || data?.Note || data?.status === 'error') {
        this.logger.warn(`${provider} FX response rejected: ${data['Error Message'] || data.Note || data.message || 'error'}`);
        return null;
      }
      return data;
    } catch (err) {
      this.logger.warn(`${provider} FX request failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async getLatestStoredRate(pair: string): Promise<FxRateResult | null> {
    if (!this.prisma.isAvailable) return null;

    try {
      const row = await (this.prisma as any).fxRate.findFirst({
        where: { pair },
        orderBy: { timestamp: 'desc' },
      });
      return row ? this.fromDbRow(row) : null;
    } catch (err) {
      this.logger.warn(`FX cache read failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async getStoredHistory(pair: string, days: number): Promise<FxRateResult[]> {
    if (!this.prisma.isAvailable) return [];

    const since = new Date(Date.now() - days * 86_400_000);
    try {
      const rows = await (this.prisma as any).fxRate.findMany({
        where: { pair, timestamp: { gte: since } },
        orderBy: { timestamp: 'asc' },
        take: days * 24,
      });
      return rows.map((row: any) => this.fromDbRow(row));
    } catch (err) {
      this.logger.warn(`FX history read failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async storeRate(rate: FxRateResult): Promise<void> {
    if (!this.prisma.isAvailable) return;

    try {
      await (this.prisma as any).fxRate.create({
        data: {
          pair: rate.pair,
          rate: rate.rate,
          timestamp: rate.timestamp,
          provider: rate.provider,
        },
      });
    } catch (err) {
      this.logger.warn(`FX cache write failed: ${(err as Error).message}`);
    }
  }

  private fromDbRow(row: any): FxRateResult {
    return {
      pair: row.pair,
      rate: row.rate,
      timestamp: row.timestamp,
      provider: row.provider,
    };
  }

  private serializeRate(rate: FxRateResult) {
    return {
      pair: rate.pair,
      rate: rate.rate,
      provider: rate.provider,
      timestamp: rate.timestamp.toISOString(),
    };
  }

  private normalizePair(input: string): NormalizedPair | null {
    const cleaned = decodeURIComponent(input || '')
      .toUpperCase()
      .replace(/[^A-Z]/g, '');

    if (cleaned.length !== 6) return null;

    const from = cleaned.slice(0, 3);
    const to = cleaned.slice(3, 6);
    if (from === to) return null;

    return {
      pair: `${from}/${to}`,
      from,
      to,
      compact: `${from}${to}`,
    };
  }
}
