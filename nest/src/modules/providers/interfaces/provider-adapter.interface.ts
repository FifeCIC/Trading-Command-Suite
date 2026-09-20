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

/**
 * Per-symbol BROKER CONSTRAINTS for one broker instance.
 *
 * A provider can list a symbol and still refuse to trade it, so "listed" and "tradeable"
 * are separate facts and only the second one justifies offering a trade. Both fields here
 * are the ones the MT5 bridge's `/order` pre-flight tests.
 *
 * ⚠️ `tradeMode` is a property of the BROKER × symbol pair, never of the symbol alone:
 * the same ticker can be tradeable on one bridge and disabled on another (measured
 * 2026-09-15 — US500: `tradeMode 0` on MetaQuotes :5000, `4` on Pepperstone :5001). Never
 * cache or persist it against the symbol by itself.
 */
export interface SymbolTradability {
  /** MT5 SYMBOL_TRADE_MODE: 4 = FULL (tradeable), 0 = DISABLED, 1/2 = one-way, 3 = close-only. */
  tradeMode: number;
  /** Minimum order volume in lots; `null` = not reported by this provider (UNKNOWN, not 0). */
  volumeMin: number | null;
  /** Maximum order volume in lots; `null` = unknown. */
  volumeMax: number | null;
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
   * List broker-native symbol names this provider can serve (optional).
   * MT5: per-broker instance (`brokerId`) — powers the symbol-availability gate (#747).
   * Returns a Set (MT5) or array (some adapters) — callers should normalise.
   */
  getSymbols?(brokerId?: number): Promise<Set<string> | string[] | null>;

  /**
   * Per-symbol broker constraints (trade mode + volume limits) for one broker instance.
   *
   * `getSymbols()` answers "is this symbol listed?"; this answers "will the broker ACCEPT
   * A TRADE for it?". Both are needed to know whether offering a trade is honest — the
   * bridge refuses on either failing, and a refusal discovered after the click is the bug
   * this exists to prevent.
   *
   * Returns `null` when the provider is unreachable. Callers MUST treat that as UNKNOWN
   * rather than as untradeable.
   */
  getSymbolTradability?(brokerId?: number): Promise<Map<string, SymbolTradability> | null>;

  /** Close an open position by broker ticket (optional, broker-aware). #747 */
  closePosition?(ticket: string, volume?: number, brokerId?: number): Promise<BrokerOrderResult>;

  /** Partially close an open position by broker ticket (optional, broker-aware). #747 */
  closePartial?(ticket: string, volume: number, brokerId?: number): Promise<BrokerOrderResult>;

  /** Modify SL/TP on an open position by broker ticket (optional, broker-aware). #747 */
  modifyPosition?(ticket: string, mods: { sl?: number | null; tp?: number | null }, brokerId?: number): Promise<BrokerOrderResult>;

  /** Bulk quotes for many symbols in one pass (optional, scales to many). #747 */
  getQuotesBulk?(symbols: string[]): Promise<Record<string, ProviderQuote>>;

  /** Bulk candles for many symbols in one pass (optional, scales to many). #747 */
  getCandlesBatch?(symbols: string[], timeframe?: string, limit?: number): Promise<Record<string, MarketBar[]>>;

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

  /**
   * Fetch analyst recommendation trends (optional — Finnhub free tier).
   * Returns monthly consensus: strongBuy, buy, hold, sell, strongSell counts.
   */
  getRecommendations?(symbol: string): Promise<AnalystRecommendation[]>;

  // ─── Optional: Broker Portfolio & Execution ─────────────────
  //
  // These methods are implemented by brokers that support portfolio
  // management and order execution (Trading212, MT5, Alpaca).
  // Pure data providers (Finnhub, Yahoo, Polygon) do NOT implement these.
  // The automation loop queries AdapterFactory.getBrokerageAdapters()
  // to find which adapters support brokerage operations.

  /** Whether this adapter supports brokerage (portfolio + orders). */
  readonly supportsBrokerage?: boolean;

  /**
   * Fetch open positions for this broker.
   * Returns normalized BrokerPosition[] across all broker-specific formats.
   */
  getPositions?(): Promise<BrokerPosition[]>;

  /** Fetch positions together with proof that an empty result is complete. */
  getPositionSnapshot?(): Promise<BrokerPositionSnapshot>;

  /**
   * Fetch account summary (balance, equity, margin).
   */
  getAccount?(): Promise<BrokerAccount | null>;

  /**
   * Place a market order on this broker.
   */
  placeOrder?(params: BrokerOrderRequest): Promise<BrokerOrderResult>;

  /**
   * Fetch executed deals (fills) since a date — used to reconcile closed
   * positions with their real exit price and realised PnL (#470).
   */
  getDeals?(since: Date): Promise<BrokerDeal[]>;
}

// ─── Broker Portfolio & Execution Types ─────────────────────

/** Normalized position across all brokers. */
export interface BrokerPosition {
  brokerId: string;
  brokerName: string;
  symbol: string;
  ticker: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  currency: string;
  openedAt: string;
  /** Broker account containing the position. Required for multi-account reconciliation. */
  accountId?: string;
  /** Broker-specific position/order ID (MT5 ticket, T212 orderId). Always a string — 64-bit safe. */
  brokerTicket?: string;
  /** Position direction — required to create Trade rows for broker-managed positions. */
  side?: 'buy' | 'sell';
  sl?: number | null;
  tp?: number | null;
  magic?: number | null;
  comment?: string | null;
}

export interface BrokerPositionSnapshot {
  positions: BrokerPosition[];
  authoritative: boolean;
}

/** A single executed fill/deal from broker history. */
export interface BrokerDeal {
  brokerTicket: string;
  /** Broker position identifier. Unlike brokerTicket, this groups all fills for one position. */
  positionId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  volume: number;
  price: number;
  profit: number;
  commission?: number;
  swap?: number;
  fee?: number;
  time: Date;
  /**
   * WHY the broker executed this deal — `mt5.DEAL_REASON_*` (4 = SL, 5 = TP, 6 = stop-out,
   * 3 = expert, 0-2 = client/mobile/web, …).
   *
   * ⚠️ This is the only authoritative answer to "what closed this position?", and it is OPTIONAL
   * because not every broker adapter reports one. `undefined` means "not reported" — callers must
   * map it to an honest unknown (`broker:unknown`) rather than a default that reads like knowledge.
   * See `nest/src/common/trading/close-reason.ts` and the 2026-09-18 close-attribution work.
   */
  reason?: number;
  /**
   * The deal's own comment, VERBATIM. Our bridge stamps `TCS:<origin>` on deals IT closes
   * (`TCS:time-stop`, `TCS:manual`), which is how a close is attributed to an ACTOR rather than to
   * "the terminal" (#916, 2026-09-20). A stop-loss fill instead carries the broker's `[sl <price>]`.
   * Parsed by `closeReasonFromComment()`.
   */
  comment?: string;
}

/** Normalized account summary across all brokers. */
export interface BrokerAccount {
  brokerId: string;
  brokerName: string;
  balance: number;
  equity: number;
  margin: number;
  marginFree: number;
  marginLevel: number | null;
  currency: string;
  mode: 'live' | 'demo' | 'paper' | 'mock';
  connected: boolean;
  accountId?: string;
}

/** Standardized order request for any broker. */
export interface BrokerOrderRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  sl?: number;
  tp?: number;
  comment?: string;
  /** Stable caller-generated key used to make broker retries safe. */
  clientOrderId?: string;
}

/** Standardized order result from any broker. */
export interface BrokerOrderResult {
  success: boolean;
  ticket?: string | number;
  price?: number;
  error?: string;
  status?: 'FILLED' | 'PARTIALLY_FILLED' | 'REJECTED' | 'UNKNOWN';
  filledQuantity?: number;
  duplicate?: boolean;
  /**
   * Notice-registry code + data (#826 Phase 3). A broker refusal is identified by a STABLE CODE,
   * not by its wording, so a log line, a UI card and a GitHub issue can be joined — and so the
   * message can be reworded or translated without breaking that link.
   *
   * `external` carries the broker's own code (e.g. MT5 retcode 10030) for look-up.
   */
  code?: string;
  params?: Record<string, unknown>;
  external?: Record<string, unknown>;
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
  marketCap?: number | null; // USD — only some sources provide this (Nasdaq does, Finnhub doesn't)
  lastYearEps?: number | null; // same quarter prior year (Nasdaq provides lastYearEPS)
  lastYearDate?: string; // report date of that prior-year quarter (Nasdaq lastYearRptDt)
  source: string;
}

/** Monthly analyst recommendation trends from a provider. */
export interface AnalystRecommendation {
  symbol: string;
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  source: string;
}
