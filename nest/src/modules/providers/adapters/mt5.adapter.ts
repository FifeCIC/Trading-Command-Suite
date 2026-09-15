/**
 * MT5 Provider Adapter
 * =====================
 * Communicates with the MT5 Python bridge via HTTP.
 * The bridge runs as a Flask server on localhost and connects
 * to the MetaTrader 5 desktop application via the MetaTrader5 Python package.
 *
 * Bridge script: scripts/mt5-bridge/mt5_bridge.py
 * Bridge URL: resolved via Mt5BridgeConfig (MT5_BRIDGE_URL env).
 *
 * Config (.env):
 *   MT5_BRIDGE_URL=http://localhost:5000 (default — see mt5-bridge.config.ts)
 *   MT5_ACCOUNT=your_account_number
 *   MT5_PASSWORD=your_password
 *   MT5_SERVER=ICMarkets-Demo
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { normalizeSide, resolvePositionPnl } from '../../../common/utils/position-pnl';
import {
  IProviderAdapter,
  BrokerAccount,
  BrokerDeal,
  BrokerOrderRequest,
  BrokerOrderResult,
  BrokerPosition,
  BrokerPositionSnapshot,
  MarketBar,
  ProviderProfile,
  ProviderQuote,
  SymbolTradability,
} from '../interfaces/provider-adapter.interface';
import { NotificationService } from '../../notifications/notifications.service';
import { BridgeEventService } from '../bridge-event.service';
import { sanitizeMt5Comment } from '../mt5-comment.util';
import { resolveMt5BridgeUrl } from '../mt5/mt5-bridge.config';
import { Mt5SymbolRouter, ResolvedSymbolRoute } from '../mt5/mt5-symbol-router.service';
import { SystemLogService } from '../../system/log.service';

interface BridgeQuoteResponse {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
}

interface BridgeCandlesResponse {
  symbol: string;
  timeframe: string;
  bars: Array<{
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

/** One entry of the bridge's `/symbols` list — a name PLUS that broker's constraints. */
interface BridgeSymbolListResponse {
  symbols: Array<{
    name: string;
    path?: string;
    /** MT5 SYMBOL_TRADE_MODE: 4 = FULL, 0 = DISABLED, 1/2 = one-way, 3 = close-only. */
    tradeMode?: number;
    /** Absent on bridges older than 2026-09-15 — see `SymbolTradability.volumeMin`. */
    volumeMin?: number;
    volumeMax?: number;
    digits?: number;
  }>;
  count?: number;
}

interface BrokerSymbolCacheEntry {
  names: Set<string>;
  tradability: Map<string, SymbolTradability>;
  fetchedAt: number;
}

interface BridgeHealthResponse {
  connected: boolean;
  mt5Package: boolean;
  account?: string;
  server?: string;
  balance?: number;
  equity?: number;
}

class BridgeRejectedError extends Error {}

@Injectable()
export class Mt5Adapter implements IProviderAdapter {
  readonly name = 'MT5';
  readonly id = 'mt5';
  readonly supportsBrokerage = true;
  private readonly logger = new Logger(Mt5Adapter.name);
  private readonly bridgeUrl: string;
  consecutiveErrors = 0;
  tripped = false;
  private trippedAt: number | null = null;

  private lastPositionSnapshotAuthoritative = false;

  /** Per-broker bridge state — one broker's outage must not mask another's (#747). */
  private readonly lastBridgeStateByBroker = new Map<number, 'connected' | 'disconnected' | 'unknown'>();

  constructor(
    private readonly notifications?: NotificationService,
    private readonly bridgeEvents?: BridgeEventService,
    private readonly prisma?: PrismaService,
    private readonly symbolRouter?: Mt5SymbolRouter,
    private readonly syslog?: SystemLogService,
  ) {
    this.bridgeUrl = resolveMt5BridgeUrl();
  }

  /**
   * Resolve which broker bridge URL + broker-native symbol name to use (#747).
   * Delegates to Mt5SymbolRouter (symbol_route table, cached) so a symbol like
   * UK100 can be sourced from Pepperstone (:5001) while others use the default.
   * Falls back to the single default bridge when no router is injected (tests).
   */
  private resolveRoute(symbol?: string, assetType?: string): ResolvedSymbolRoute {
    if (this.symbolRouter && symbol) {
      return this.symbolRouter.resolve(symbol, assetType);
    }
    const brokerId = this.symbolRouter?.primaryBrokerId() ?? 2;
    return { brokerId, url: this.bridgeUrl, brokerSymbol: symbol ?? '', explicit: false };
  }

  /** Env var for a given broker slot, e.g. MT5_ACCOUNT_3 / MT5_SERVER_3. */
  private brokerEnv(brokerId: number | undefined, key: 'MT5_ACCOUNT' | 'MT5_SERVER'): string | undefined {
    const slot = brokerId ?? (process.env.MT5_ACTIVE_ACCOUNT ? parseInt(process.env.MT5_ACTIVE_ACCOUNT, 10) : undefined);
    if (slot) return process.env[`${key}_${slot}`] || process.env[key];
    return process.env[key];
  }

  private get authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json' };
  }

  /**
   * Classify a fetch error into a diagnostic category for logging/troubleshooting.
   */
  private classifyBridgeError(err: Error): 'timeout' | 'dns' | 'refused' | 'network' | 'parse' | 'unknown' {
    const msg = err.message?.toLowerCase() ?? '';
    if (msg.includes('timeout') || msg.includes('abort')) return 'timeout';
    if (msg.includes('econnrefused') || msg.includes('connection refused')) return 'refused';
    if (msg.includes('enotfound') || msg.includes('dns') || msg.includes('getaddrinfo')) return 'dns';
    if (msg.includes('fetch failed')) return 'network';
    if (msg.includes('json') || msg.includes('unexpected token')) return 'parse';
    return 'unknown';
  }

  /**
   * Read a non-OK response body for diagnostics. Truncated to 500 chars.
   */
  private async readBridgeErrorBody(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.substring(0, 500);
    } catch {
      return '(could not read body)';
    }
  }

  /** Extract the bridge's `error` field from a JSON error body, if present. */
  private extractBridgeErrorMessage(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed?.error === 'string' ? parsed.error : null;
    } catch {
      return null;
    }
  }

  /**
   * Log detailed bridge diagnostics to the system log and logger.
   */
  private logBridgeDiag(method: string, path: string, detail: string, body?: unknown, brokerId?: number): void {
    const summary = body ? JSON.stringify(body).substring(0, 200) : '(no body)';
    this.logger.warn(`MT5 bridge [broker ${brokerId ?? 'default'}] ${method} ${path} FAILED: ${detail} [body=${summary}]`);
    // Integrate with the app-wide SystemLogService (category 'mt5') — GH #747.
    this.syslog?.warn('MT5Adapter', `bridge[${brokerId ?? 'default'}] ${method} ${path} FAILED: ${detail}`, 'mt5');
    this.bridgeEvents?.log({
      eventType: 'bridge_diag',
      account: this.brokerEnv(brokerId, 'MT5_ACCOUNT'),
      server: this.brokerEnv(brokerId, 'MT5_SERVER'),
      errorMessage: `${method} ${path}: ${detail}`.substring(0, 500),
    }).catch(() => {});
  }

  private async bridgeGet<T>(path: string, route?: ResolvedSymbolRoute): Promise<T | null> {
    const url = route?.url ?? this.bridgeUrl;
    const brokerId = route?.brokerId;
    if (this.tripped) {
      const cooldownMs = 60_000; // 1 min circuit breaker
      if (this.trippedAt && Date.now() - this.trippedAt >= cooldownMs) {
        this.tripped = false;
        this.consecutiveErrors = 0;
        this.logger.log('MT5 circuit breaker released after cooldown');
        this.logBridgeEvent('reconnected', 'Circuit breaker released', brokerId);
        this.notifications?.send({
          title: '✅ MT5 Bridge Reconnected',
          body: 'Circuit breaker released — MT5 bridge is responding again.',
          event: 'provider-degraded',
        }).catch(() => {});
      } else {
        this.logBridgeDiag('GET', path, 'circuit breaker active (skipped)', undefined, brokerId);
        return null;
      }
    }

    try {
      const res = await fetch(`${url}${path}`, {
        headers: this.authHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // A 4xx (e.g. 404 symbol-not-available) is a per-request client error, NOT a
        // bridge outage — don't flip connection state or trip the breaker for it.
        const isClientError = res.status >= 400 && res.status < 500 && res.status !== 429;
        if (!isClientError) this.consecutiveErrors++;
        const errorBody = await this.readBridgeErrorBody(res);
        const detail = `HTTP ${res.status}: ${errorBody}`;
        this.logBridgeDiag('GET', path, detail, undefined, brokerId);
        if (this.consecutiveErrors >= 10) {
          this.tripBreaker(detail, brokerId);
        }
        if (!isClientError) this.logBridgeState('disconnected', `HTTP ${res.status}`, brokerId);
        return null;
      }
      this.consecutiveErrors = 0;
      this.logBridgeState('connected', undefined, brokerId);
      return (await res.json()) as T;
    } catch (error: unknown) {
      const err = error as Error;
      const category = this.classifyBridgeError(err);
      const isTransient = category === 'refused' || category === 'dns' || category === 'network';
      if (!isTransient) {
        this.consecutiveErrors++;
      }
      this.logBridgeDiag('GET', path, `${category}: ${err.message}`, undefined, brokerId);
      if (this.consecutiveErrors >= 10) {
        this.tripBreaker(`${category}: ${err.message}`, brokerId);
      }
      this.logBridgeState('disconnected', err.message, brokerId);
      return null;
    }
  }

  private tripBreaker(reason: string, brokerId?: number): void {
    this.tripped = true;
    this.trippedAt = Date.now();
    this.logger.warn(`MT5 bridge circuit breaker TRIPPED (10 errors): ${reason}`);
    this.logBridgeEvent('disconnected', reason, brokerId);
    this.notifications?.send({
      title: '🚨 MT5 Bridge Disconnected',
      body: `Circuit breaker tripped — ${reason}. Trading via MT5 is unavailable until the bridge recovers.`,
      event: 'provider-degraded',
    }).catch(() => {});
  }

  private logBridgeState(state: 'connected' | 'disconnected', errorMessage?: string, brokerId?: number): void {
    const key = brokerId ?? 0;
    if (this.lastBridgeStateByBroker.get(key) !== state) {
      this.lastBridgeStateByBroker.set(key, state);
      this.logBridgeEvent(state, errorMessage, brokerId);
    }
  }

  private logBridgeEvent(eventType: string, errorMessage?: string, brokerId?: number): void {
    // SystemLogService integration (#747) — category 'provider' for state changes.
    const brokerTag = `broker ${brokerId ?? 'default'}`;
    const msg = `MT5 ${eventType} (${brokerTag})${errorMessage ? `: ${errorMessage}` : ''}`;
    if (eventType === 'disconnected') this.syslog?.warn('MT5Adapter', msg, 'provider');
    else this.syslog?.info('MT5Adapter', msg, 'provider');
    this.bridgeEvents?.log({
      eventType,
      account: this.brokerEnv(brokerId, 'MT5_ACCOUNT'),
      server: this.brokerEnv(brokerId, 'MT5_SERVER'),
      errorMessage: errorMessage?.substring(0, 500),
    }).catch(() => {});
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    const route = this.resolveRoute(symbol);
    this.logger.log(`MT5: fetching quote for ${route.brokerSymbol} (broker ${route.brokerId})`);
    const data = await this.bridgeGet<BridgeQuoteResponse>(`/quote?symbol=${encodeURIComponent(route.brokerSymbol)}`, route);
    if (!data) return null;

    return {
      symbol: data.symbol,
      bid: data.bid ?? null,
      ask: data.ask ?? null,
      last: data.last ?? null,
      timestamp: new Date(data.timestamp),
    };
  }

  async getCandles(symbol: string, timeframe = '1h', limit = 100): Promise<MarketBar[]> {
    const route = this.resolveRoute(symbol);
    this.logger.log(`MT5: fetching ${limit} candles for ${route.brokerSymbol} (${timeframe}) [broker ${route.brokerId}]`);
    const data = await this.bridgeGet<BridgeCandlesResponse>(
      `/candles?symbol=${encodeURIComponent(route.brokerSymbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${Math.min(limit, 1000)}`,
      route,
    );
    if (!data?.bars) return [];

    this.logger.log(`MT5: got ${data.bars.length} candles for ${route.brokerSymbol} (${timeframe})`);
    return data.bars.map((b) => ({
      timestamp: new Date(b.timestamp),
      open: b.open,
      high: b.high,
      low: b.low,
      close: b.close,
      volume: b.volume,
    }));
  }

  async getProfile(_symbol: string): Promise<ProviderProfile | null> {
    // MT5 doesn't provide fundamental data
    return null;
  }

  /** Per-broker cached symbol lists (TTL 5 min) — powers the #723 symbol-availability gate.
   *  Keyed per broker so one broker's list can't poison another's (#747). */
  private readonly symbolsCacheByBroker = new Map<number, BrokerSymbolCacheEntry>();

  /**
   * Load (or reuse) one broker's symbol list, KEEPING the per-symbol broker constraints.
   *
   * ⚠️ WHY THE CONSTRAINTS ARE KEPT HERE. The bridge has always returned `tradeMode`
   * next to the name, and `/order` refuses a trade on precisely two of these fields
   * (`tradeMode !== 4`, `volume < volumeMin`). This method used to project onto
   * `s.name` alone, so the app knew a symbol was LISTED but nothing about whether the
   * broker would ACCEPT A TRADE — which is how US500 sat on the Signals ladder looking
   * fully tradeable while MetaQuotes reported `tradeMode: 0`, with the refusal appearing
   * only after the click. `ExecutionFeasibilityService` now blocks it before the click.
   *
   * ⚠️ A missing `volumeMin` is UNKNOWN, never "no minimum": the check that consumes it
   * (`size-below-minimum`) skips rather than assuming a floor.
   */
  private async loadSymbols(brokerId?: number): Promise<BrokerSymbolCacheEntry | null> {
    const key = brokerId ?? this.symbolRouter?.primaryBrokerId() ?? 0;
    const cached = this.symbolsCacheByBroker.get(key);
    try {
      const now = Date.now();
      if (cached && now - cached.fetchedAt < 300_000) {
        return cached;
      }
      const route = this.symbolRouter?.routeForBroker(key);
      const data = await this.bridgeGet<BridgeSymbolListResponse>('/symbols', route);
      if (!data?.symbols?.length) return cached ?? null;
      const names = new Set<string>();
      const tradability = new Map<string, SymbolTradability>();
      for (const s of data.symbols) {
        const name = String(s.name).toUpperCase();
        names.add(name);
        if (typeof s.tradeMode === 'number') {
          tradability.set(name, {
            tradeMode: s.tradeMode,
            volumeMin: typeof s.volumeMin === 'number' ? s.volumeMin : null,
            volumeMax: typeof s.volumeMax === 'number' ? s.volumeMax : null,
          });
        }
      }
      const entry: BrokerSymbolCacheEntry = { names, tradability, fetchedAt: now };
      this.symbolsCacheByBroker.set(key, entry);
      return entry;
    } catch {
      return cached ?? null;
    }
  }

  async getSymbols(brokerId?: number): Promise<Set<string> | null> {
    return (await this.loadSymbols(brokerId))?.names ?? null;
  }

  /**
   * Per-symbol broker constraints (`tradeMode`, volume floor/ceiling) for ONE broker.
   *
   * Returns `null` when the broker is unreachable — callers MUST treat that as UNKNOWN
   * and not block on it, since "the broker never answered" is not evidence that a symbol
   * is untradeable (#723 fails open on unknown availability, deliberately).
   */
  async getSymbolTradability(brokerId?: number): Promise<Map<string, SymbolTradability> | null> {
    return (await this.loadSymbols(brokerId))?.tradability ?? null;
  }

  async healthCheck(): Promise<boolean> {
    const data = await this.bridgeGet<BridgeHealthResponse>('/health');
    if (!data) return false;
    return data.connected === true;
  }



  /** Reset circuit breaker manually (e.g., after bridge restart). */
  resetCircuitBreaker(): void {
    this.tripped = false;
    this.trippedAt = null;
    this.consecutiveErrors = 0;
    this.logger.log('MT5 circuit breaker manually reset');
  }

  // ── Brokerage Methods (IProviderAdapter) ─────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    this.lastPositionSnapshotAuthoritative = false;
    const data = await this.bridgeGet<{ positions: any[]; count: number }>('/positions');
    if (!data?.positions) return [];
    this.lastPositionSnapshotAuthoritative = true;

    return data.positions.map((p: any) => {
      const contractSize = p.contractSize ? Number(p.contractSize) : 0;
      // Notional market value = volume (lots) × contract size × current price.
      // Falls back to price × volume when the bridge doesn't supply contract size.
      const marketValue = contractSize > 0
        ? p.volume * contractSize * p.priceCurrent
        : p.priceCurrent * p.volume;
      const currency = this.quoteCurrency(p.symbol, p.currencyProfit);
      // 2026-09-10 — side drives the sign of P&L. The old inline percentage
      // `(current - open) / open` was long-only, so a profitable SHORT reported a
      // negative %. resolvePositionPnl keeps the sign-correct broker profit and a
      // percentage that agrees with it.
      const side = normalizeSide(p.type);
      const { pnl, pnlPct } = resolvePositionPnl({
        side,
        avgPrice: p.priceOpen,
        currentPrice: p.priceCurrent,
        quantity: p.volume,
        brokerPnl: p.profit,
      });
      return {
        brokerId: this.id!,
        brokerName: this.name,
        symbol: p.symbol,
        ticker: p.symbol,
        quantity: p.volume,
        avgCost: p.priceOpen,
        currentPrice: p.priceCurrent,
        marketValue,
        unrealizedPnl: pnl ?? 0,
        unrealizedPnlPct: pnlPct ?? 0,
        currency,
        openedAt: p.openTime || new Date().toISOString(),
        // Broker traceability (#616) — 64-bit MT5 ticket as a string
        brokerTicket: p.ticket != null ? String(p.ticket) : undefined,
        side,
        sl: p.sl ?? null,
        tp: p.tp ?? null,
        magic: p.magic ?? null,
        comment: p.comment ?? null,
      };
    });
  }

  async getPositionSnapshot(): Promise<BrokerPositionSnapshot> {
    const positions = await this.getPositions();
    return { positions, authoritative: this.lastPositionSnapshotAuthoritative };
  }

  /**
   * Derive the currency a position's notional value is denominated in.
   * MT5 instruments are quoted in their "quote" currency — EURUSD→USD,
   * USDJPY→JPY, XAUUSD/US500/BTC→USD. Falls back to the bridge's
   * `currencyProfit` hint (account/profit currency) and finally 'USD'.
   */
  private quoteCurrency(symbol: string, currencyProfit?: string | null): string {
    const s = (symbol || '').toUpperCase();
    if (s.endsWith('USD')) return 'USD'; // EURUSD, GBPUSD, XAUUSD, BTCUSD
    if (s.startsWith('USD') && s.length === 6) return s.slice(3); // USDJPY→JPY, USDCAD→CAD
    if (s.endsWith('JPY') || s.endsWith('CHF') || s.endsWith('CAD') || s.endsWith('AUD') || s.endsWith('NZD')) return s.slice(3);
    return (currencyProfit || 'USD').toUpperCase();
  }

  /**
   * Raw bridge positions (with comment/magic/profit) — used by consumers that
   * need broker-native fields not present on the normalized BrokerPosition
   * (e.g. A/B test unrealized P&L matched by comment tag).
   */
  async getPositionsRaw(): Promise<any[]> {
    const data = await this.bridgeGet<{ positions: any[]; count: number }>('/positions');
    return data?.positions ?? [];
  }

  /** Executed deals (fills) since a date — real exit price + realised PnL (#470). */
  async getDeals(since: Date): Promise<BrokerDeal[]> {
    const days = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 86_400_000) + 1);
    const data = await this.bridgeGet<{ deals: any[] }>(`/history?days=${days}`);
    if (!data?.deals?.length) return [];
    const sinceMs = since.getTime();
    return data.deals
      .map((d: any) => ({
        brokerTicket: d.ticket != null ? String(d.ticket) : '',
        positionId: d.positionId != null ? String(d.positionId) : undefined,
        symbol: d.symbol,
        side: d.type === 'buy' ? 'buy' as const : 'sell' as const,
        volume: Number(d.volume ?? 0),
        price: Number(d.price ?? 0),
        profit: Number(d.profit ?? 0),
        commission: Number(d.commission ?? 0),
        swap: Number(d.swap ?? 0),
        fee: Number(d.fee ?? 0),
        time: new Date(d.time),
      }))
      .filter((d: BrokerDeal) => d.time.getTime() >= sinceMs);
  }

  async getAccount(): Promise<BrokerAccount | null> {
    const data = await this.bridgeGet<any>('/account');
    if (!data) return null;

    return {
      brokerId: this.id!,
      brokerName: this.name,
      balance: data.balance,
      equity: data.equity,
      margin: data.margin,
      marginFree: data.marginFree,
      marginLevel: data.marginLevel ?? null,
      currency: data.currency || 'GBP',
      mode: 'demo',
      connected: true,
      accountId: data.login != null ? String(data.login) : undefined,
    };
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrderResult> {
    // MT5 only allows short ASCII comments — sanitize via shared helper
    const safeComment = sanitizeMt5Comment(params.comment);
    // Route the order to the broker that serves this symbol (#747).
    const route = this.resolveRoute(params.symbol);
    const body = {
      symbol: route.brokerSymbol,
      type: params.side === 'BUY' ? 'buy' : 'sell',
      volume: params.quantity,
      sl: params.sl ?? null,
      tp: params.tp ?? null,
      comment: safeComment,
      clientOrderId: params.clientOrderId,
    };

    this.logger.log(`MT5 order [broker ${route.brokerId}]: ${body.type} ${body.symbol} ×${body.volume} sl=${body.sl} tp=${body.tp} [tripped=${this.tripped} errors=${this.consecutiveErrors}]`);

    let data: any;
    try {
      data = await this.bridgePost<any>('/order', body, route);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.warn(`MT5 order FAILED: ${message}`);
      this.syslog?.error('MT5Adapter', `ORDER REJECTED ${route.brokerSymbol} ${params.side} ×${params.quantity} — ${message} [broker ${route.brokerId}]`, 'trading');
      this.prisma?.order.create({
        data: {
          symbol: params.symbol,
          type: 'market',
          side: params.side === 'BUY' ? 'buy' : 'sell',
          quantity: params.quantity,
          status: 'rejected',
          provider: 'mt5',
        },
      }).catch(() => {});
      return { success: false, error: message, status: 'REJECTED' };
    }

    if (!data) {
      // bridgePost returns null for BOTH a tripped breaker (cooldown skip)
      // and a network-level failure. Label the two honestly — "circuit
      // breaker active" means the cooldown is holding; anything else is the
      // bridge simply not responding.
      const reason = this.tripped
        ? 'Bridge unreachable (circuit breaker active)'
        : 'Bridge unreachable (no response)';
      this.logger.warn(`MT5 order FAILED — ${reason} [url=${route.url} broker=${route.brokerId} tripped=${this.tripped} consecutiveErrors=${this.consecutiveErrors}]`);
      this.syslog?.error('MT5Adapter', `ORDER ${reason} ${route.brokerSymbol} ${params.side} ×${params.quantity} [broker ${route.brokerId}]`, 'trading');
      // A network timeout is an unknown outcome: MT5 may have accepted the
      // order before the response was lost. Keep it retryable with the same
      // clientOrderId instead of falsely declaring it rejected.
      this.prisma?.order.create({
        data: {
          symbol: params.symbol,
          type: 'market',
          side: params.side === 'BUY' ? 'buy' : 'sell',
          quantity: params.quantity,
          status: 'unknown',
          provider: 'mt5',
          providerId: params.clientOrderId ?? null,
        },
      }).catch(() => {});
      return { success: false, error: reason, status: 'UNKNOWN' };
    }

    const result: BrokerOrderResult = {
      success: data.success === true,
      ticket: data.ticket ?? undefined,
      price: data.price ?? undefined,
      error: data.error ?? undefined,
      status: data.status === 'partially_filled' || data.partial === true
        ? 'PARTIALLY_FILLED'
        : data.success === true ? 'FILLED' : 'REJECTED',
      filledQuantity: data.filledVolume ?? data.volume ?? undefined,
      duplicate: data.duplicate === true,
    };

    // Persist every order attempt (success + failure) to the Order table
    this.prisma?.order.create({
      data: {
        symbol: params.symbol,
        type: 'market',
        side: params.side === 'BUY' ? 'buy' : 'sell',
        quantity: params.quantity,
        price: result.price ?? null,
        status: result.status?.toLowerCase() ?? (result.success ? 'filled' : 'rejected'),
        provider: 'mt5',
        providerId: result.ticket ? String(result.ticket) : null,
        filledAt: result.success ? new Date() : null,
      },
    }).catch(err => this.logger.warn(`Failed to persist order: ${err.message}`));

    this.syslog?.order(
      'MT5Adapter',
      `${route.brokerSymbol} ${params.side} ×${params.quantity} → ${result.status ?? (result.success ? 'FILLED' : 'REJECTED')}` +
      `${result.ticket ? ` (ticket ${result.ticket})` : ''}${result.error ? ` — ${result.error}` : ''} [broker ${route.brokerId}]`,
      'trading',
    );

    return result;
  }

  // ── Position management (broker-aware, #747) ─────────────

  /** Build a route for a specific broker id (undefined → default bridge). */
  private routeForBroker(brokerId?: number): ResolvedSymbolRoute | undefined {
    return this.symbolRouter && brokerId !== undefined ? this.symbolRouter.routeForBroker(brokerId) : undefined;
  }

  /** Close an open position by broker ticket. */
  async closePosition(ticket: string, volume?: number, brokerId?: number): Promise<BrokerOrderResult> {
    return this.positionAction(`/close/${encodeURIComponent(ticket)}`, volume !== undefined ? { volume } : {}, brokerId, 'CLOSE');
  }

  /** Partially close an open position by broker ticket. */
  async closePartial(ticket: string, volume: number, brokerId?: number): Promise<BrokerOrderResult> {
    return this.positionAction(`/close/partial/${encodeURIComponent(ticket)}`, { volume }, brokerId, 'CLOSE_PARTIAL');
  }

  /** Modify SL/TP on an open position by broker ticket. */
  async modifyPosition(ticket: string, mods: { sl?: number | null; tp?: number | null }, brokerId?: number): Promise<BrokerOrderResult> {
    return this.positionAction('/order/modify', { ticket, sl: mods.sl ?? null, tp: mods.tp ?? null }, brokerId, 'MODIFY');
  }

  private async positionAction(path: string, body: any, brokerId: number | undefined, op: string): Promise<BrokerOrderResult> {
    const route = this.routeForBroker(brokerId);
    try {
      const data = await this.bridgePost<any>(path, body, route);
      if (!data) {
        this.syslog?.error('MT5Adapter', `${op} no response (broker ${brokerId ?? 'default'})`, 'trading');
        return { success: false, error: 'Bridge unreachable', status: 'UNKNOWN' };
      }
      const ok = data.success === true;
      const result: BrokerOrderResult = {
        success: ok,
        ticket: data.ticket != null ? String(data.ticket) : undefined,
        price: data.price ?? undefined,
        error: data.error ?? undefined,
        status: ok ? (data.partial === true ? 'PARTIALLY_FILLED' : 'FILLED') : 'REJECTED',
        filledQuantity: data.filledVolume ?? data.volume ?? undefined,
      };
      this.syslog?.order('MT5Adapter', `${op} ticket ${body?.ticket ?? path} → ${result.status}${result.error ? ` — ${result.error}` : ''} [broker ${brokerId ?? 'default'}]`, 'trading');
      return result;
    } catch (err) {
      const message = (err as Error).message;
      this.syslog?.error('MT5Adapter', `${op} FAILED (broker ${brokerId ?? 'default'}): ${message}`, 'trading');
      return { success: false, error: message, status: 'REJECTED' };
    }
  }

  // ── Bulk market data (broker-grouped, scales to many symbols — #747) ──

  /** Group symbols by the broker that serves them (via the symbol router). */
  private groupByBroker(symbols: string[]): Map<number, { route: ResolvedSymbolRoute; symbols: string[]; originals: string[] }> {
    const groups = new Map<number, { route: ResolvedSymbolRoute; symbols: string[]; originals: string[] }>();
    for (const s of symbols) {
      const r = this.resolveRoute(s);
      const g = groups.get(r.brokerId) ?? { route: r, symbols: [], originals: [] };
      g.symbols.push(r.brokerSymbol);
      g.originals.push(s);
      groups.set(r.brokerId, g);
    }
    return groups;
  }

  /** Fetch many quotes efficiently — ONE bulk call per broker, then merge. */
  async getQuotesBulk(symbols: string[]): Promise<Record<string, ProviderQuote>> {
    const out: Record<string, ProviderQuote> = {};
    for (const { route, symbols: syms, originals } of this.groupByBroker(symbols).values()) {
      const data = await this.bridgePost<any>('/quotes', { symbols: syms }, route);
      const bySymbol = new Map<string, any>((data?.quotes ?? []).map((q: any) => [String(q.symbol).toUpperCase(), q]));
      // Map back onto the ORIGINAL tickers so callers can look up what they asked for.
      for (const orig of originals) {
        const q = bySymbol.get(orig.toUpperCase());
        if (!q) continue;
        out[orig] = { symbol: orig, bid: q.bid ?? null, ask: q.ask ?? null, last: q.last ?? null, timestamp: new Date(q.timestamp) };
      }
    }
    return out;
  }

  /** Fetch candles for many symbols — ONE bulk call per broker. Returns ticker → bars. */
  async getCandlesBatch(symbols: string[], timeframe = '1h', limit = 100): Promise<Record<string, MarketBar[]>> {
    const out: Record<string, MarketBar[]> = {};
    for (const { route, symbols: syms, originals } of this.groupByBroker(symbols).values()) {
      const data = await this.bridgePost<any>('/candles/batch', { symbols: syms, timeframe, limit }, route);
      const bySymbol = new Map<string, any[]>((data?.results ?? []).map((r: any) => [String(r.symbol).toUpperCase(), r.bars ?? []]));
      for (const orig of originals) {
        const bars = bySymbol.get(orig.toUpperCase());
        if (!bars) continue;
        out[orig] = bars.map((b: any) => ({
          timestamp: new Date(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
        }));
      }
    }
    return out;
  }

  private async bridgePost<T>(path: string, body: unknown, route?: ResolvedSymbolRoute): Promise<T | null> {
    const url = route?.url ?? this.bridgeUrl;
    const brokerId = route?.brokerId;
    if (this.tripped) {
      const cooldownMs = 60_000;
      if (this.trippedAt && Date.now() - this.trippedAt >= cooldownMs) {
        this.tripped = false;
        this.consecutiveErrors = 0;
        this.logBridgeEvent('reconnected', 'Circuit breaker released', brokerId);
      } else {
        this.logBridgeDiag('POST', path, 'circuit breaker active (skipped)', body, brokerId);
        return null;
      }
    }

    try {
      const res = await fetch(`${url}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const isClientError = res.status >= 400 && res.status < 500 && res.status !== 429;
        if (!isClientError) this.consecutiveErrors++;
        const errorBody = await this.readBridgeErrorBody(res);
        const detail = `HTTP ${res.status}: ${errorBody}`;
        this.logBridgeDiag('POST', path, detail, body, brokerId);
        if (this.consecutiveErrors >= 10) {
          this.tripBreaker(detail, brokerId);
        }
        if (!isClientError) this.logBridgeState('disconnected', `HTTP ${res.status}`, brokerId);
        // Surface the bridge's real error (e.g. "No prices", "Insufficient margin")
        // instead of a generic "Bridge unreachable" so callers can act on it.
        throw new BridgeRejectedError(this.extractBridgeErrorMessage(errorBody) ?? detail);
      }
      this.consecutiveErrors = 0;
      this.logBridgeState('connected', undefined, brokerId);
      return (await res.json()) as T;
    } catch (err) {
      const error = err as Error;
      if (error instanceof BridgeRejectedError) throw error;
      const category = this.classifyBridgeError(error);
      this.logBridgeDiag('POST', path, `${category}: ${error.message}`, body, brokerId);
      if (category !== 'refused' && category !== 'dns' && category !== 'network') {
        this.consecutiveErrors++;
      }
      if (this.consecutiveErrors >= 10) {
        this.tripBreaker(`${category}: ${error.message}`, brokerId);
      }
      this.logBridgeState('disconnected', error.message, brokerId);
      return null;
    }
  }
}
