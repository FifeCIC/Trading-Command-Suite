/**
 * PLACEHOLDER — implement per SPRINT.md Task 3.
 *
 * Provider Adapter Contract
 * =========================
 * Every market-data provider adapter MUST implement this interface.
 * The adapter registry in providers.service.ts selects the active adapter
 * based on environment config (PROVIDER_ACTIVE or per-provider env key).
 *
 * Contract rules (from Architecture Framework):
 * - Do NOT call external providers during page rendering.
 * - Adapters are consumed by queue processors and freshness checks.
 * - Fallback mode: adapters return mock data with explicit mode/status flags.
 * - Full mode: adapters call real provider APIs.
 */

export interface MarketBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProviderQuote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  timestamp: Date;
}

export interface ProviderProfile {
  symbol: string;
  name: string;
  exchange: string;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
}

export interface IProviderAdapter {
  /** Human-readable adapter name, used in health responses. */
  readonly name: string;

  /** Unique identifier (e.g. 'alpaca') — used by AdapterFactory. */
  readonly id?: string;

  /**
   * Fetch current quote (bid/ask/last) for one symbol.
   * Must NOT throw — return null on failure and let the caller handle logging.
   */
  getQuote(symbol: string): Promise<ProviderQuote | null>;

  /**
   * Fetch OHLCV candles for a symbol and timeframe.
   * @param symbol  e.g. "AAPL"
   * @param timeframe e.g. "1h", "1d"
   * @param limit   max bars to return (1-1000)
   */
  getCandles(
    symbol: string,
    timeframe: string,
    limit?: number,
  ): Promise<MarketBar[]>;

  /**
   * Fetch company profile / fundamental data.
   */
  getProfile(symbol: string): Promise<ProviderProfile | null>;

  /**
   * Lightweight connectivity check. Return true if the provider API
   * responded within a reasonable timeout.
   */
  healthCheck(): Promise<boolean>;

  // ─── Optional: Factory capability methods ─────────────────

  /**
   * List supported data types this provider can serve.
   * Used by AdapterFactory for capability-based routing.
   */
  getCapabilities?(): string[];

  /**
   * Authenticate with provider using stored credentials.
   * Returns true if authentication succeeded.
   */
  authenticate?(credentials?: Record<string, string>): Promise<boolean>;

  /**
   * Generic data fetch — allows factory to route arbitrary queries.
   * @param query  Provider-specific query object
   */
  fetchData?(query: Record<string, any>): Promise<any>;

  /**
   * Normalize a raw provider response into a standard schema.
   * @param raw  Raw response from the provider API
   * @param schema  Target schema name ('MarketBar', 'ProviderQuote', etc.)
   */
  normalizeResponse?(raw: any, schema: string): any;

  /**
   * Return current rate limit state (remaining, limit, resetAt).
   */
  getRateLimit?(): Promise<{
    remaining: number;
    limit: number;
    resetAt: Date | null;
  } | null>;

  /**
   * Fetch news headlines for a symbol (optional — Finnhub-specific).
   */
  getNews?(symbol: string): Promise<NewsItem[] | null>;

  /**
   * Fetch aggregate sentiment for a symbol (optional — Finnhub-specific).
   */
  getSentiment?(symbol: string): Promise<SentimentData | null>;

  /**
   * Fetch earnings calendar events for a symbol or all tracked symbols.
   * @param symbol  Optional — if omitted, returns all upcoming earnings.
   * @param horizonMonths  How many months ahead to fetch (default 3).
   */
  getEarningsCalendar?(symbol?: string, horizonMonths?: number): Promise<EarningsEvent[]>;
}

/** A single news headline from a provider. */
export interface NewsItem {
  datetime: Date;
  headline: string;
  summary: string;
  source: string;
  url?: string;
  category?: string;
  sentiment?: number;
}

/** Aggregate sentiment data from Finnhub news-sentiment endpoint. */
export interface SentimentData {
  buzz: { articlesInLastWeek: number; buzzWordCount?: number };
  companyNewsScore: number;
  sectorAverageBullishPercent: number;
  sectorAverageNewsScore: number;
  bearishPercent: number;
  bullishPercent: number;
}

/** An upcoming earnings event from a provider's calendar. */
export interface EarningsEvent {
  symbol: string;
  name?: string;
  reportDate: string;
  fiscalDateEnding?: string;
  epsEstimate?: number | null;
  epsActual?: number | null;
  revenueEstimate?: number | null;
  revenueActual?: number | null;
  surprisePercent?: number | null;
  timeOfDay?: 'Before Open' | 'After Close' | 'During' | null;
  currency?: string;
  source: string;
}
