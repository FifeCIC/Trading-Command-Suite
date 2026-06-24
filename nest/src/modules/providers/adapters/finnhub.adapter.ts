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
  AnalystRecommendation,
  EarningsEvent,
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
  private disabled = false;                // 🔒 set true when credentials are bad — skip all subsequent calls
  private disabledReason = '';

  private get token(): string {
    return this.apiKey;
  }

  private checkCredentials(): void {
    if (!this.apiKey) {
      this.disabled = true;
      this.disabledReason = 'No FINNHUB_API_KEY in .env';
      throw new Error('Finnhub credentials not configured — set FINNHUB_API_KEY in .env');
    }
    if (this.disabled) {
      throw new Error(`Finnhub disabled: ${this.disabledReason}`);
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
        this.disabled = true;
        this.disabledReason = 'Finnhub API key invalid (401/403)';
        throw new Error('Finnhub API key invalid — all Finnhub calls disabled for this process');
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

  // ── Analyst Recommendations (free tier) ──────────────

  async getRecommendations(symbol: string): Promise<AnalystRecommendation[]> {
    this.logger.log(`Finnhub: fetching recommendations for ${symbol}`);
    const data = await this.finnhubGet<any[]>(
      `/stock/recommendation?symbol=${encodeURIComponent(symbol)}`,
    );

    if (!data || !Array.isArray(data)) return [];

    return data.map((r: any) => ({
      symbol: r.symbol || symbol,
      period: r.period || '',
      strongBuy: r.strongBuy ?? 0,
      buy: r.buy ?? 0,
      hold: r.hold ?? 0,
      sell: r.sell ?? 0,
      strongSell: r.strongSell ?? 0,
      source: 'finnhub',
    }));
  }

  // ── Earnings Calendar ────────────────────────────────

  async getEarningsCalendar(symbol?: string, horizonMonths = 3): Promise<EarningsEvent[]> {
    const from = new Date().toISOString().split('T')[0];
    const to = new Date(Date.now() + horizonMonths * 30 * 86400000).toISOString().split('T')[0];
    this.logger.log(`Finnhub: fetching earnings calendar ${from} → ${to}${symbol ? ' for ' + symbol : ''}`);
    const data = await this.finnhubGet<any>(
      `/calendar/earnings?from=${from}&to=${to}`,
    );
    if (!data?.earningsCalendar) return [];
    const events: EarningsEvent[] = data.earningsCalendar.map((e: any) => ({
      symbol: e.symbol,
      name: e.name || undefined,
      reportDate: e.date,
      epsEstimate: e.epsEstimate ?? null,
      epsActual: e.epsActual ?? null,
      revenueEstimate: e.revenueEstimate ?? null,
      revenueActual: e.revenueActual ?? null,
      timeOfDay: e.hour === 'bmo' ? 'Before Open' : e.hour === 'amc' ? 'After Close' : null,
      source: 'finnhub',
    } as EarningsEvent));
    // Filter by symbol if provided (Finnhub returns all earnings)
    const filtered = symbol
      ? events.filter((e) => e.symbol?.toUpperCase() === symbol.toUpperCase())
      : events;
    return filtered.sort((a, b) => new Date(a.reportDate).getTime() - new Date(b.reportDate).getTime());
  }

  // ── Price Target ──────────────────────────────────────

  async getPriceTarget(symbol: string): Promise<{
    symbol: string;
    companyName?: string;
    currentPrice: number;
    avgTarget: number;
    highTarget: number;
    lowTarget: number;
    consensus: string;
    analystCount?: number;
    upside?: number;
    source: string;
  } | null> {
    this.logger.log(`Finnhub: fetching price target for ${symbol}`);
    const data = await this.finnhubGet<any>(
      `/stock/price-target?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!data || data.error) return null;

    const currentPrice = data.lastUpdatedPrice || data.currentPrice || 0;
    const avgTarget = data.targetMean || 0;
    const upside = currentPrice > 0 ? ((avgTarget - currentPrice) / currentPrice) * 100 : null;

    // Derive consensus from buy/hold/sell counts
    let consensus = 'Hold';
    if (data.numberOfAnalysts) {
      const buyCount = (data.buy || 0) + (data.strongBuy || 0);
      const sellCount = (data.sell || 0) + (data.strongSell || 0);
      if (buyCount > sellCount * 2) consensus = 'Strong Buy';
      else if (buyCount > sellCount) consensus = 'Buy';
      else if (sellCount > buyCount * 2) consensus = 'Strong Sell';
      else if (sellCount > buyCount) consensus = 'Sell';
    }

    return {
      symbol: data.symbol || symbol,
      companyName: data.companyName || null,
      currentPrice,
      avgTarget,
      highTarget: data.targetHigh || 0,
      lowTarget: data.targetLow || 0,
      consensus,
      analystCount: data.numberOfAnalysts || null,
      upside: upside !== null ? Number(upside.toFixed(1)) : undefined,
      source: 'finnhub',
    };
  }

  // ── Social Sentiment ──────────────────────────────────

  async getSocialSentiment(symbol: string): Promise<{
    symbol: string;
    redditMentions: number;
    redditSentiment: number; // -1 to 1
    twitterMentions: number;
    twitterSentiment: number;
    totalMentions: number;
    avgSentiment: number;
    source: string;
  } | null> {
    this.logger.debug(`Finnhub: fetching social sentiment for ${symbol}`);
    const data = await this.finnhubGet<any>(
      `/stock/social-sentiment?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!data || data.error) return null;

    const reddit = data.reddit || {};
    const twitter = data.twitter || {};
    const redditMentions = reddit.mention || 0;
    const twitterMentions = twitter.mention || 0;
    const totalMentions = redditMentions + twitterMentions;

    const redditSentiment = this.parseSentimentScore(reddit);
    const twitterSentiment = this.parseSentimentScore(twitter);
    const avgSentiment = totalMentions > 0
      ? (redditSentiment * redditMentions + twitterSentiment * twitterMentions) / totalMentions
      : 0;

    return {
      symbol: data.symbol || symbol,
      redditMentions,
      redditSentiment: Math.round(redditSentiment * 100) / 100,
      twitterMentions,
      twitterSentiment: Math.round(twitterSentiment * 100) / 100,
      totalMentions,
      avgSentiment: Math.round(avgSentiment * 100) / 100,
      source: 'finnhub',
    };
  }

  // ── Insider Transactions ───────────────────────────────

  async getInsiderTransactions(symbol: string): Promise<Array<{
    name: string;
    share: number;
    change: number;
    transactionDate: string;
    transactionCode: string; // P=Purchase, S=Sell
    filingDate: string;
    currency: string;
  }> | null> {
    this.logger.debug(`Finnhub: fetching insider transactions for ${symbol}`);
    const data = await this.finnhubGet<any>(
      `/stock/insider-transactions?symbol=${encodeURIComponent(symbol)}`,
    );
    if (!data?.data || !Array.isArray(data.data)) return null;

    return data.data.slice(0, 20).map((t: any) => ({
      name: t.name || 'Unknown',
      share: t.share || 0,
      change: t.change || 0,
      transactionDate: t.transactionDate || '',
      transactionCode: t.transactionCode || '',
      filingDate: t.filingDate || '',
      currency: t.currency || 'USD',
    }));
  }

  // ── Company Metrics ────────────────────────────────────

  async getCompanyMetrics(symbol: string): Promise<{
    symbol: string;
    sharesOutstanding: number; // in millions
    shareChange3m: number; // % change over 3 months
    shareChange12m: number; // % change over 12 months
    marketCap: number;
    source: string;
  } | null> {
    this.logger.debug(`Finnhub: fetching company metrics for ${symbol}`);
    const data = await this.finnhubGet<any>(
      `/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`,
    );
    if (!data?.metric) return null;

    const m = data.metric;

    // Shares outstanding — try quarterly fields
    const sharesNow = m.shareOutstanding || m.sharesOutstanding || null;

    return {
      symbol: data.symbol || symbol,
      sharesOutstanding: sharesNow ? Number((sharesNow / 1_000_000).toFixed(2)) : 0,
      shareChange3m: m.shareChange3m || 0,
      shareChange12m: m.shareChange12m || 0,
      marketCap: m.marketCapitalization
        ? Number((m.marketCapitalization / 1_000_000).toFixed(2))
        : 0,
      source: 'finnhub',
    };
  }

  // ── Helpers ────────────────────────────────────────────

  private parseSentimentScore(source: any): number {
    if (!source) return 0;
    // Finnhub returns bullish/bearish counts
    const bullish = source.bullishPercent || source.positiveMention || 0;
    const bearish = source.bearishPercent || source.negativeMention || 0;
    const total = bullish + bearish;
    if (total === 0) return 0;
    // Scale: purely bullish = 1, purely bearish = -1, neutral = 0
    return (bullish - bearish) / total;
  }

  getCapabilities(): string[] {
    return ['quotes', 'candles', 'profiles', 'recommendations', 'earnings', 'price-targets', 'social-sentiment', 'insider-transactions', 'company-metrics'];
  }

  private resolutionSeconds(res: string): number {
    const map: Record<string, number> = {
      '1': 60, '5': 300, '15': 900, '30': 1800,
      '60': 3600, 'D': 86400, 'W': 604800,
    };
    return map[res] || 86400;
  }
}
