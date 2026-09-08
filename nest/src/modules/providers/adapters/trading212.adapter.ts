import { Injectable, Logger } from '@nestjs/common';
import {
  IProviderAdapter,
  BrokerAccount,
  BrokerOrderRequest,
  BrokerOrderResult,
  BrokerPosition,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
} from '../interfaces/provider-adapter.interface';
import { RateLimitTracker } from '../rate-limit-tracker';
import { getEndpointInterval } from '../../../common/rate-limit/provider-rate-limits';
import { cleanT212Ticker } from '../t212-ticker-map';

/**
 * Trading212 API Adapter
 * =======================
 * Supports LIVE and DEMO (paper) environments with separate API keys & endpoints.
 *
 * ── Environment Variables ─────────────────────────────────
 * TRADING212_MODE           'live' | 'demo' (default: 'demo')
 * TRADING212_LIVE_API_KEY   API key for live account
 * TRADING212_DEMO_API_KEY   API key for demo/paper account
 * TRADING212_API_KEY        Fallback key (used when mode-specific key is empty)
 * TRADING212_LIVE_BASE_URL  Live endpoint (default: https://live.trading212.com/api/v0)
 * TRADING212_DEMO_BASE_URL  Demo endpoint (default: https://demo.trading212.com/api/v0)
 *
 * ── Auth ──────────────────────────────────────────────────
 * API key passed as Authorization header value directly (NOT Bearer prefix).
 *
 * ── Rate Limits (per endpoint) ────────────────────────────
 * portfolio    — 1 req / 5s
 * account      — 1 req / 2s
 * quotes       — varies
 * instruments  — 1 req / 30s
 * orders       — 1 req / 5s
 *
 * ── Docs ──────────────────────────────────────────────────
 * https://t212public-api-docs.redoc.ly/
 */

export interface Trading212Position {
  averagePrice: number;
  currentPrice: number;
  frontend: string;
  fxPpl: number;
  initialFillDate: string;
  maxBuy: number;
  maxSell: number;
  pieQuantity: number;
  ppl: number;
  quantity: number;
  ticker: string;
}

export interface Trading212AccountCash {
  blocked: number;
  free: number;
  invested: number;
  pieCash: number;
  ppl: number;
  result: number;
  total: number;
}

export interface T212OrderRequest {
  ticker: string;
  quantity: number;
  side: 'buy' | 'sell';
}

export interface T212LimitOrderRequest extends T212OrderRequest {
  limitPrice: number;
}

export interface T212OrderResult {
  success: boolean;
  orderId?: string;
  filledQuantity?: number;
  filledPrice?: number;
  status?: string;
  error?: string;
  errorCode?: string;
  rawResponse?: unknown;
}

export type Trading212Mode = 'live' | 'demo' | 'none';

@Injectable()
export class Trading212Adapter implements IProviderAdapter {
  readonly name = 'Trading212';
  readonly id = 'trading212';
  readonly supportsBrokerage = true;
  private readonly logger = new Logger(Trading212Adapter.name);
  private lastPositionSnapshotAuthoritative = false;

  // ── Mode ──────────────────────────────────────────────────

  readonly mode: Trading212Mode;

  // ── Credentials & endpoint (resolved at construction) ─────

  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly baseUrl: string;

  // ── Rate limiting ─────────────────────────────────────────

  private readonly rateTracker = new RateLimitTracker('trading212-main', 'trading212', 200);
  private readonly endpointLastCall = new Map<string, number>();

  // ── Constructor ───────────────────────────────────────────

  constructor() {
    const explicitMode = (process.env.TRADING212_MODE || '').toLowerCase();

    if (explicitMode === 'live' || explicitMode === 'demo') {
      this.mode = explicitMode;
    } else if (process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY) {
      // No explicit mode: default to DEMO. Live requires TRADING212_MODE=live —
      // never auto-connect to a live account from a stray env key (issue #24).
      this.mode = 'demo';
    } else {
      this.mode = 'none';
    }

    // Safety: a live key without an explicit live mode must NOT trade live.
    if (this.mode !== 'live' && process.env.TRADING212_LIVE_API_KEY) {
      this.logger.warn('Trading212: live API key present but TRADING212_MODE is not "live" — staying in non-live mode.');
    }

    // Resolve the correct key + secret for this mode
    if (this.mode === 'live') {
      this.apiKey = process.env.TRADING212_LIVE_API_KEY || process.env.TRADING212_API_KEY || '';
      this.apiSecret = process.env.TRADING212_LIVE_API_SECRET || process.env.TRADING212_API_SECRET || '';
      this.baseUrl = process.env.TRADING212_LIVE_BASE_URL || 'https://live.trading212.com/api/v0';
    } else if (this.mode === 'demo') {
      this.apiKey = process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY || '';
      this.apiSecret = process.env.TRADING212_DEMO_API_SECRET || process.env.TRADING212_API_SECRET || '';
      this.baseUrl = process.env.TRADING212_DEMO_BASE_URL || 'https://demo.trading212.com/api/v0';
    } else {
      this.apiKey = '';
      this.apiSecret = '';
      this.baseUrl = process.env.TRADING212_DEMO_BASE_URL || 'https://demo.trading212.com/api/v0';
    }

    if (this.mode !== 'none') {
      this.logger.log(`Trading212 adapter initialised — mode=${this.mode} base=${this.baseUrl} key=${this.apiKey ? '✓' : '✗'}`);
    } else {
      this.logger.warn('Trading212 adapter: no API keys configured — disabled (all requests fail-fast, no data fabricated)');
    }
  }

  // ── credentials ───────────────────────────────────────────

  private get hasCredentials(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  private authHeaders(): Record<string, string> {
    // Trading212 uses the API key directly as the Authorization header value
    // (no "Basic", no "Bearer", no secret). The old key:secret Basic auth was
    // malformed for T212 and would 401 (issue #34).
    return { Authorization: this.apiKey || '' };
  }

  /**
   * Enforce per-endpoint rate limiting before making an outbound call.
   * Uses the shared PROVIDER_RATE_LIMITS config for interval timing.
   */
  private async waitForRateLimit(endpointPath: string): Promise<void> {
    const intervalMs = getEndpointInterval('trading212', endpointPath);
    const lastCall = this.endpointLastCall.get(endpointPath) || 0;
    const elapsed = Date.now() - lastCall;
    if (elapsed < intervalMs) {
      const waitMs = intervalMs - elapsed;
      this.logger.debug(`T212 rate-limit wait: ${endpointPath} — ${waitMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.endpointLastCall.set(endpointPath, Date.now());
  }

  /** Expose rate-limit state for monitoring endpoints. */
  getRateLimitState(): {
    tracker: ReturnType<RateLimitTracker['getState']>;
    lastCalls: Record<string, { elapsedMs: number; intervalMs: number }>;
  } {
    const lastCalls: Record<string, { elapsedMs: number; intervalMs: number }> = {};
    const now = Date.now();
    for (const [endpoint, lastCall] of this.endpointLastCall) {
      const intervalMs = getEndpointInterval('trading212', endpoint);
      lastCalls[endpoint] = {
        elapsedMs: now - lastCall,
        intervalMs,
      };
    }
    return {
      tracker: this.rateTracker.getState(),
      lastCalls,
    };
  }

  // ── IProviderAdapter implementation ───────────────────────

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    if (!this.hasCredentials) return null; // No API key — never fabricate quotes
    try {
      await this.waitForRateLimit('quotes');
      const ticker = this.toT212Ticker(symbol);
      const res = await fetch(`${this.baseUrl}/equity/quotes/${ticker}`, {
        headers: this.authHeaders(),
      });
      if (res.status === 429) {
        this.logger.warn(`T212 rate limit hit for quote ${symbol}`);
        return null;
      }
      if (!res.ok) return null;
      const data = await res.json();
      return {
        symbol,
        bid: data.bid ?? null,
        ask: data.ask ?? null,
        last: data.last ?? data.ask ?? data.bid ?? null,
        timestamp: new Date(),
      };
    } catch (err) {
      this.logger.error(`T212 getQuote(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async getCandles(
    symbol: string,
    timeframe = 'ONE_DAY',
    limit = 100,
  ): Promise<MarketBar[]> {
    if (!this.hasCredentials) return []; // No API key — never fabricate candles
    try {
      await this.waitForRateLimit('candles');
      const ticker = this.toT212Ticker(symbol);
      const payload = {
        candles: [
          {
            ticker,
            period: this.mapTimeframe(timeframe),
            size: limit,
            includeFake: false,
          },
        ],
      };
      const res = await fetch(`${this.baseUrl}/charting/v2/batch`, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 429) {
        this.logger.warn(`T212 rate limit hit for candles ${symbol}`);
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      const series = data?.candles?.[0]?.candles || [];
      return series.map((c: any) => ({
        timestamp: new Date(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      }));
    } catch (err) {
      this.logger.error(`T212 getCandles(${symbol}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    if (!this.hasCredentials) return null; // No API key — never fabricate profiles
    try {
      await this.waitForRateLimit('metadata/instruments');
      const ticker = this.toT212Ticker(symbol);
      const res = await fetch(
        `${this.baseUrl}/equity/metadata/instruments/${ticker}`,
        { headers: this.authHeaders() },
      );
      if (res.status === 429) return null;
      if (!res.ok) return null;
      const data = await res.json();
      return {
        symbol,
        name: data.name || symbol,
        exchange: data.workingScheduleId ? 'T212' : 'Unknown',
        sector: data.type || null,
        industry: null,
        marketCap: null,
      };
    } catch (err) {
      this.logger.error(`T212 getProfile(${symbol}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.hasCredentials) {
      this.logger.warn(`Trading212 healthCheck (${this.mode}): no API key configured`);
      return false;
    }
    try {
      await this.waitForRateLimit('account/cash');
      const res = await fetch(`${this.baseUrl}/equity/account/cash`, {
        headers: this.authHeaders(),
      });
      const ok = res.ok;
      this.logger.log(`Trading212 healthCheck (${this.mode}): ${ok ? 'OK' : 'failed'} (${res.status})`);
      return ok;
    } catch (err) {
      this.logger.error(`Trading212 healthCheck (${this.mode}) failed: ${(err as Error).message}`);
      return false;
    }
  }

  // ── Trading212-specific: Portfolio ────────────────────────

  /** @deprecated Use getPositions() which returns BrokerPosition[] */
  async getRawPositions(): Promise<Trading212Position[]> {
    this.lastPositionSnapshotAuthoritative = false;
    if (!this.hasCredentials) {
      this.logger.warn(`Trading212 getPositions (${this.mode}): no credentials`);
      return [];
    }
    try {
      await this.waitForRateLimit('portfolio');
      const res = await fetch(`${this.baseUrl}/equity/portfolio`, {
        headers: this.authHeaders(),
      });
      if (res.status === 429) {
        this.logger.warn(`Trading212 rate limit hit for portfolio (${this.mode})`);
        return [];
      }
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data)) return [];
      this.lastPositionSnapshotAuthoritative = true;
      return data;
    } catch (err) {
      this.logger.error(`Trading212 getPositions (${this.mode}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  async getRawAccountCash(): Promise<Trading212AccountCash | null> {
    if (!this.hasCredentials) {
      this.logger.warn(`Trading212 getAccountCash (${this.mode}): no credentials`);
      return null;
    }
    try {
      await this.waitForRateLimit('account/cash');
      const res = await fetch(`${this.baseUrl}/equity/account/cash`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Trading212 getAccountCash (${this.mode}): HTTP ${res.status} — ${body.substring(0, 200)}`);
        return null;
      }
      return await res.json();
    } catch (err) {
      this.logger.error(`Trading212 getAccountCash (${this.mode}) failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── Order Execution ──────────────────────────────────────
  //
  // IMPORTANT: Trading212 API does NOT accept a "side" field.
  // Sell orders: the API auto-detects sell intent from existing position.
  // The controller adds side:"sell" for internal routing only.
  // This adapter sends {ticker, quantity} — NO side parameter.
  // DO NOT add "side" to the API payload. DO NOT remove sell capability.

  async placeMarketOrder(params: T212OrderRequest): Promise<T212OrderResult> {
    if (!this.hasCredentials) {
      return { success: false, error: 'No Trading212 credentials configured' };
    }
    try {
      await this.waitForRateLimit('orders/market');
      const ticker = this.toT212Ticker(params.ticker);
      const res = await fetch(`${this.baseUrl}/equity/orders/market`, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, quantity: params.quantity }),
      });
      const bodyText = await res.text();
      let data: any;
      try { data = JSON.parse(bodyText); } catch { data = bodyText; }

      if (!res.ok) {
        this.logger.error(`T212 placeMarketOrder (${this.mode}) ${params.side} ${params.ticker}: HTTP ${res.status} — ${bodyText.substring(0, 300)}`);
        return {
          success: false,
          error: typeof data === 'string' ? data : (data?.detail || data?.title || `HTTP ${res.status}`),
          errorCode: data?.code,
          rawResponse: data,
        };
      }

      this.logger.log(`T212 placeMarketOrder (${this.mode}) ${params.side} ${params.ticker} ×${params.quantity}: ${data?.id || 'filled'}`);
      return {
        success: true,
        orderId: data?.id || data?.orderId,
        filledQuantity: data?.filledQuantity || params.quantity,
        filledPrice: data?.fillPrice || data?.price,
        status: data?.status || 'filled',
        rawResponse: data,
      };
    } catch (err) {
      this.logger.error(`T212 placeMarketOrder (${this.mode}) failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  async placeLimitOrder(params: T212LimitOrderRequest): Promise<T212OrderResult> {
    if (!this.hasCredentials) {
      return { success: false, error: 'No Trading212 credentials configured' };
    }
    try {
      await this.waitForRateLimit('orders/limit');
      const ticker = this.toT212Ticker(params.ticker);
      const res = await fetch(`${this.baseUrl}/equity/orders/limit`, {
        method: 'POST',
        headers: { ...this.authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, quantity: Math.round(params.quantity * 100) / 100, limitPrice: params.limitPrice }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.logger.error(`T212 placeLimitOrder (${this.mode}) ${params.side} ${params.ticker}: HTTP ${res.status}`);
        return {
          success: false,
          error: data.message || data.code || `HTTP ${res.status}`,
          errorCode: data.code,
          rawResponse: data,
        };
      }
      this.logger.log(`T212 placeLimitOrder (${this.mode}) ${params.side} ${params.ticker} ×${params.quantity} @${params.limitPrice}: ${data.id || 'placed'}`);
      return {
        success: true,
        orderId: data.id || data.orderId,
        filledQuantity: data.filledQuantity,
        filledPrice: data.fillPrice || data.price,
        status: data.status || 'pending',
        rawResponse: data,
      };
    } catch (err) {
      this.logger.error(`T212 placeLimitOrder (${this.mode}) failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  async cancelOrder(orderId: string): Promise<T212OrderResult> {
    if (!this.hasCredentials) {
      return { success: false, error: 'No Trading212 credentials configured' };
    }
    try {
      await this.waitForRateLimit('orders');
      const res = await fetch(`${this.baseUrl}/equity/orders/${orderId}`, {
        method: 'DELETE',
        headers: this.authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return {
          success: false,
          error: (data as any).message || `HTTP ${res.status}`,
          rawResponse: data,
        };
      }
      this.logger.log(`T212 cancelOrder (${this.mode}) ${orderId}: cancelled`);
      return { success: true, orderId, status: 'cancelled' };
    } catch (err) {
      this.logger.error(`T212 cancelOrder (${this.mode}) failed: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  async getOrder(orderId: string): Promise<T212OrderResult> {
    if (!this.hasCredentials) {
      return { success: false, error: 'No Trading212 credentials configured' };
    }
    try {
      await this.waitForRateLimit('orders');
      const res = await fetch(`${this.baseUrl}/equity/orders/${orderId}`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      const data = await res.json();
      return {
        success: true,
        orderId: data.id,
        filledQuantity: data.filledQuantity || data.quantity,
        filledPrice: data.fillPrice || data.limitPrice,
        status: data.status,
        rawResponse: data,
      };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  async getOpenOrders(): Promise<T212OrderResult[]> {
    if (!this.hasCredentials) return [];
    try {
      await this.waitForRateLimit('orders');
      const res = await fetch(`${this.baseUrl}/equity/orders`, {
        headers: this.authHeaders(),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data.map((o: any) => ({
        success: true,
        orderId: o.id,
        filledQuantity: o.filledQuantity || o.quantity,
        filledPrice: o.fillPrice || o.limitPrice,
        status: o.status,
        rawResponse: o,
      })) : [];
    } catch (err) {
      this.logger.error(`T212 getOpenOrders (${this.mode}) failed: ${(err as Error).message}`);
      return [];
    }
  }

  getCapabilities(): string[] {
    return ['quotes', 'candles', 'profiles', 'portfolio', 'account', 'orders'];
  }

  // ── helpers ───────────────────────────────────────────────

  /** Convert a simple symbol (AAPL) to Trading212 ticker (AAPL_US_EQ) */
  private toT212Ticker(symbol: string): string {
    if (symbol.includes('_')) return symbol;
    return `${symbol.toUpperCase()}_US_EQ`;
  }

  private mapTimeframe(timeframe: string): string {
    const map: Record<string, string> = {
      '1m': 'ONE_MINUTE',
      '5m': 'FIVE_MINUTES',
      '15m': 'FIFTEEN_MINUTES',
      '30m': 'THIRTY_MINUTES',
      '1h': 'ONE_HOUR',
      '4h': 'FOUR_HOURS',
      '1d': 'ONE_DAY',
      '1w': 'ONE_WEEK',
      '1M': 'ONE_MONTH',
    };
    return map[timeframe] || 'ONE_DAY';
  }

  // ── IProviderAdapter Brokerage Methods ────────────────────

  /**
   * Fetch normalized positions (IProviderAdapter interface).
   */
  async getPositions(): Promise<BrokerPosition[]> {
    const raw = await this.getRawPositions();
    return raw.map((p) => ({
      brokerId: this.id,
      brokerName: this.name,
      symbol: this.stripTicker(p.ticker),
      ticker: p.ticker,
      quantity: p.quantity,
      avgCost: p.averagePrice,
      currentPrice: p.currentPrice,
      marketValue: p.currentPrice * p.quantity,
      unrealizedPnl: p.ppl ?? (p.currentPrice - p.averagePrice) * p.quantity,
      unrealizedPnlPct: p.averagePrice > 0 ? ((p.currentPrice - p.averagePrice) / p.averagePrice) * 100 : 0,
      currency: 'GBP',
      openedAt: p.initialFillDate || new Date().toISOString(),
    }));
  }

  async getPositionSnapshot() {
    const positions = await this.getPositions();
    return { positions, authoritative: this.lastPositionSnapshotAuthoritative };
  }

  /**
   * Fetch normalized account (IProviderAdapter interface).
   */
  async getAccount(): Promise<BrokerAccount | null> {
    const cash = await this.getRawAccountCash();
    if (!cash) return null;
    return {
      brokerId: this.id,
      brokerName: this.name,
      balance: cash.free,       // Free/available cash — NOT cash.total (which includes blocked)
      equity: cash.total,       // Total cash including blocked (margin collateral)
      margin: cash.blocked ?? 0,
      marginFree: cash.free,
      marginLevel: cash.total > 0 ? (cash.free / cash.total) * 100 : null,
      currency: 'GBP',
      mode: this.mode === 'demo' ? 'demo' : this.mode === 'live' ? 'live' : 'mock',
      connected: this.hasCredentials,
    };
  }

  /**
   * Place order via IProviderAdapter interface.
   * ⛔ PORTFOLIO-ONLY GUARD: Trading212 is configured for portfolio monitoring only.
   * No trading actions are permitted through this adapter. To enable trading,
   * set TRADING212_TRADING_ENABLED=true in .env.
   */
  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrderResult> {
    if (process.env.TRADING212_TRADING_ENABLED !== 'true') {
      this.logger.warn(
        `⛔ Trading212 trade BLOCKED for ${params.symbol} — portfolio monitoring only. ` +
        `Set TRADING212_TRADING_ENABLED=true to enable trading.`,
      );
      return { success: false, error: 'Trading212 is portfolio-monitoring only. Set TRADING212_TRADING_ENABLED=true to enable.' };
    }

    const result = await this.placeMarketOrder({
      ticker: this.toT212Ticker(params.symbol),
      quantity: params.quantity,
      side: params.side === 'BUY' ? 'buy' : 'sell',
    });
    return {
      success: result.success,
      ticket: result.orderId ?? undefined,
      price: result.filledPrice ?? undefined,
      error: result.error,
    };
  }

  /** Strip Trading212 ticker suffix using the shared normalizer: 3LNVl_EQ → 3LNV, AIRp_EQ → AIR */
  private stripTicker(ticker: string): string {
    return cleanT212Ticker(ticker);
  }

}
