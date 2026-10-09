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
import { Mt5SymbolRouter, ResolvedSymbolRoute, orderRouteProblems } from '../mt5/mt5-symbol-router.service';
import { venueForSymbol } from '../../calendar/market-patterns';
import { SystemLogService } from '../../system/log.service';

interface BridgeQuoteResponse {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
  /** #1085 — the BROKER's own last-tick time (offset-corrected UTC), distinct from `timestamp`
   *  (response time). Absent from a bridge older than the #1085 contract; `null` when the
   *  terminal reports no tick time. */
  tickTime?: string | null;
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
    /** #843 — absent on bridges older than 2026-10-10; UNKNOWN, never "no step". */
    volumeStep?: number;
    tickValue?: number;
    tickSize?: number;
    contractSize?: number;
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

/**
 * A refusal from the bridge (HTTP 4xx/5xx with a readable body).
 *
 * Carries the notice-registry code and params (#826 Phase 3) so the caller can surface WHICH
 * condition failed. The bridge is Python and cannot import the JS registry, so it sends the code
 * and the data; the wording is rendered client-side.
 */
class BridgeRejectedError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly params?: Record<string, unknown>,
    readonly external?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/**
 * Circuit-breaker state for ONE bridge. Held per broker so a failure on one bridge
 * cannot suppress requests to another (#846).
 */
interface BreakerState {
  consecutiveErrors: number;
  tripped: boolean;
  trippedAt: number | null;
}

@Injectable()
export class Mt5Adapter implements IProviderAdapter {
  readonly name = 'MT5';
  readonly id = 'mt5';
  readonly supportsBrokerage = true;
  private readonly logger = new Logger(Mt5Adapter.name);
  private readonly bridgeUrl: string;

  /** Errors before a broker's bridge is considered down. */
  private static readonly MAX_ERRORS = 10;
  /** How long a tripped breaker holds before it is allowed to retry. */
  private static readonly COOLDOWN_MS = 60_000;

  /**
   * Per-broker circuit-breaker state (#846).
   *
   * ⚠️ WHY THIS IS KEYED BY BROKER, NOT A SINGLE FLAG
   * ------------------------------------------------
   * Each call carries a `route` with its own `brokerId` and its own bridge URL, and the
   * two bridges fail INDEPENDENTLY. This used to be one global `tripped` boolean and one
   * global `consecutiveErrors` counter, so 10 consecutive failures against ONE bridge
   * stopped traffic to ALL of them.
   *
   * Measured 2026-09-16: MetaQuotes-Demo (:5000, broker 2) had its terminal disconnected
   * while PepperstoneUK-Demo (:5001, broker 3) was healthy. A VIX order — routed to
   * broker 3 — was refused with "Bridge unreachable (circuit breaker active)", and every
   * `bridge_event` row naming the trip carried broker 2's account (10011309743). So a
   * working broker was gagged by an unrelated one, with nothing sent to the market.
   *
   * This is not a new design decision: `lastBridgeStateByBroker` below already applies
   * exactly this principle — "one broker's outage must not mask another's (#747)" — the
   * breaker was simply never given the same treatment. The safety property is unchanged
   * per broker; what changes is that one broker's failure no longer inherits to another.
   *
   * Key `0` means "no route / the single default bridge", so a deployment with one bridge
   * behaves exactly as before.
   */
  private readonly breakers = new Map<number, BreakerState>();

  /** Worst-case view across brokers — for logging and back-compat reads only. */
  get consecutiveErrors(): number {
    let worst = 0;
    for (const b of this.breakers.values()) worst = Math.max(worst, b.consecutiveErrors);
    return worst;
  }

  /** True when ANY broker is tripped. Prefer {@link isTripped} for a specific route. */
  get tripped(): boolean {
    for (const b of this.breakers.values()) if (b.tripped) return true;
    return false;
  }

  private breakerFor(brokerId: number | undefined): BreakerState {
    const key = brokerId ?? 0;
    let state = this.breakers.get(key);
    if (!state) {
      state = { consecutiveErrors: 0, tripped: false, trippedAt: null };
      this.breakers.set(key, state);
    }
    return state;
  }

  /** Is THIS broker's breaker open? Never consults another broker's state. */
  private isTripped(brokerId?: number): boolean {
    return this.breakerFor(brokerId).tripped;
  }

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
  private resolveRoute(symbol?: string, assetType?: string, forOrder = false): ResolvedSymbolRoute {
    if (this.symbolRouter && symbol) {
      // `forOrder` (#1002): the order path may prefer a broker that can TRADE the symbol, while
      // bars and quotes keep the feed-based route. See Mt5SymbolRouter.resolveForOrder().
      return forOrder
        ? this.symbolRouter.resolveForOrder(symbol, assetType)
        : this.symbolRouter.resolve(symbol, assetType);
    }
    const brokerId = this.symbolRouter?.primaryBrokerId() ?? 2;
    // No router (tests, single-bridge installs): the default bridge is the only bridge, and the
    // canonical ticker is the established identity mapping. `mt5: true` is honest here — this
    // route DOES address the default bridge.
    return { brokerId, url: this.bridgeUrl, brokerSymbol: symbol ?? '', explicit: false, mt5: true, provider: null };
  }

  /** Env var for a given broker slot, e.g. MT5_ACCOUNT_3 / MT5_SERVER_3. */
  private brokerEnv(brokerId: number | undefined, key: 'MT5_ACCOUNT' | 'MT5_SERVER'): string | undefined {
    const slot = brokerId ?? (process.env.MT5_ACTIVE_ACCOUNT ? parseInt(process.env.MT5_ACTIVE_ACCOUNT, 10) : undefined);
    if (slot) return process.env[`${key}_${slot}`] || process.env[key];
    return process.env[key];
  }

  /**
   * getConfiguredAccountId(brokerId) — #1079: the ACCOUNT NUMBER a given route trades on.
   *
   * One provider id (`mt5`) covers several bridges with DIFFERENT accounts, so a check that
   * scopes only by `provider` treats another account's position as this account's duplicate.
   * Measured 2026-10-07 (#1079): the A/B pair holding XAUUSD locked all 8 gold bots out of the
   * symbol — and the pair was locked out while the bots held it.
   *
   * ⚠️ CONFIGURED, not bridge-reported. That is deliberate: #1035 refuses every order while a
   * bridge's actual account disagrees with its configured one, so on any path that can place an
   * order the two are equal — and the configured value costs no bridge call per dispatch.
   * Returns null when the slot names no account (callers must treat null as "unknown" and NOT
   * loosen their check — unknown must never read as "no position").
   */
  getConfiguredAccountId(brokerId?: number): string | null {
    return this.brokerEnv(brokerId, 'MT5_ACCOUNT') ?? null;
  }

  /**
   * getAccountIdForSymbol(symbol) — #1079: the account THIS SYMBOL's orders will land on.
   *
   * Uses the same `resolveForOrder()` resolution `placeOrder()` will use, so the account the
   * guard checks against is the account the order will actually reach — not a guess from the
   * adapter's primary slot. Resolves through symbol_route, so it is correct for a symbol routed
   * to a non-default broker (VIX -> broker 3).
   */
  getAccountIdForSymbol(symbol: string): string | null {
    try {
      const route = this.resolveRoute(symbol, undefined, true);
      if (route?.brokerId === undefined) return null;
      return this.getConfiguredAccountId(route.brokerId);
    } catch {
      return null;
    }
  }

  /**
   * getSizingContext(symbol) — everything the live sizing maths needs, from the SAME bridge that
   * will receive the order (#843).
   *
   * ⚠️ ROUTE RESOLUTION IS SHARED WITH `placeOrder` (`resolveForOrder`). Sizing against broker A
   * and sending the order to broker B is the kind of divergence that produces a plausible size
   * nobody can reproduce — so the route comes from the same call the order path uses.
   *
   * ⚠️ A FIELD THE BRIDGE DID NOT REPORT IS `null`, NEVER A DEFAULT. `volumeStep`/`tickValue`/
   * `tickSize` are new (2026-10-10); an older bridge omits them, and the sizing path treats null
   * as UNKNOWN and REFUSES visibly (`TCS-TRADE-023`) rather than sending an off-step order or
   * mis-sizing by orders of magnitude on metals and indices.
   *
   * Returns null when the bridge is unreachable or the symbol is absent from its list.
   */
  async getSizingContext(symbol: string): Promise<{
    equity: number | null;
    volumeMin: number | null;
    volumeMax: number | null;
    volumeStep: number | null;
    tickValue: number | null;
    tickSize: number | null;
  } | null> {
    try {
      const route = this.resolveRoute(symbol, undefined, true);
      if (!route?.url) return null;
      const native = (route.brokerSymbol || symbol).toUpperCase();
      const list = await this.bridgeGet<BridgeSymbolListResponse>('/symbols', route);
      const entry = list?.symbols?.find((s) => String(s.name).toUpperCase() === native) ?? null;
      if (!entry) return null;
      const account = await this.bridgeGet<{ equity?: number }>('/account', route);
      const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      return {
        equity: num(account?.equity),
        volumeMin: num(entry.volumeMin),
        volumeMax: num(entry.volumeMax),
        volumeStep: num(entry.volumeStep),
        tickValue: num(entry.tickValue),
        tickSize: num(entry.tickSize),
      };
    } catch {
      return null;
    }
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

  /**
   * Read the bridge's STRUCTURED refusal: `{ error, code, params, external }`.
   *
   * ⚠️ The code is a field, never parsed out of `error`. The bridge deliberately sends both so the
   * wording stays free to change while the identity (the code) does not — the principle behind the
   * whole notice registry (#826), and the reason #824's "Unsupported filling mode" was
   * unexplainable: no code, no symbol, nothing to look up.
   */
  private extractBridgeRejection(body: string): {
    message: string | null;
    code?: string;
    params?: Record<string, unknown>;
    external?: Record<string, unknown>;
  } {
    try {
      const parsed = JSON.parse(body);
      return {
        message: typeof parsed?.error === 'string' ? parsed.error : null,
        code: typeof parsed?.code === 'string' ? parsed.code : undefined,
        params: parsed?.params && typeof parsed.params === 'object' ? parsed.params : undefined,
        external: parsed?.external && typeof parsed.external === 'object' ? parsed.external : undefined,
      };
    } catch {
      return { message: null };
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
    // ⚠️ #914 — a route that does not target an MT5 bridge has NO bridge to ask. Falling back
    // to the default bridge here is exactly the defect: it answered a binance-routed symbol on
    // MetaQuotes. Refuse, loudly and cheaply, before any fetch.
    if (route && !route.mt5) {
      this.logger.warn(
        `MT5: refusing GET ${path} — broker ${route.brokerId}` +
          `${route.provider ? ` (${route.provider})` : ''} is not an active MT5 bridge (#914)`,
      );
      return null;
    }
    const url = route?.url ?? this.bridgeUrl;
    const brokerId = route?.brokerId;
    // ⚠️ Per-broker breaker state (#846). Reading `this.tripped` here was the defect: it
    // consulted a single global flag, so a failure on another bridge skipped this request.
    const breaker = this.breakerFor(brokerId);
    if (breaker.tripped) {
      const cooldownMs = Mt5Adapter.COOLDOWN_MS;
      if (breaker.trippedAt && Date.now() - breaker.trippedAt >= cooldownMs) {
        breaker.tripped = false;
        breaker.trippedAt = null;
        breaker.consecutiveErrors = 0;
        this.logger.log(`MT5 circuit breaker released after cooldown (broker ${brokerId ?? 'default'})`);
        this.logBridgeEvent('reconnected', 'Circuit breaker released', brokerId);
        this.notifications?.send({
          title: '✅ MT5 Bridge Reconnected',
          body: `Circuit breaker released for broker ${brokerId ?? 'default'} — the bridge is responding again.`,
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
        if (!isClientError) breaker.consecutiveErrors++;
        const errorBody = await this.readBridgeErrorBody(res);
        const detail = `HTTP ${res.status}: ${errorBody}`;
        this.logBridgeDiag('GET', path, detail, undefined, brokerId);
        if (breaker.consecutiveErrors >= Mt5Adapter.MAX_ERRORS) {
          this.tripBreaker(detail, brokerId);
        }
        if (!isClientError) this.logBridgeState('disconnected', `HTTP ${res.status}`, brokerId);
        return null;
      }
      breaker.consecutiveErrors = 0;
      this.logBridgeState('connected', undefined, brokerId);
      return (await res.json()) as T;
    } catch (error: unknown) {
      const err = error as Error;
      const category = this.classifyBridgeError(err);
      // ── #866 (2026-10-09) — EVERY failure counts toward the breaker ──
      // refused/dns/network used to be EXEMPTED as "transient", so a bridge that was simply
      // GONE never tripped it: measured 2026-09-17, the counter stayed at 1 across ~10
      // consecutive connect-refused failures and the app polled a dead bridge at full rate
      // forever. A breaker that cannot trip on its own failure mode is a decoration.
      // Transience is handled by the RESET — one success clears the streak (line above) —
      // not by excusing the most common outage. Threshold unchanged (MAX_ERRORS = 10).
      breaker.consecutiveErrors++;
      this.logBridgeDiag('GET', path, `${category}: ${err.message}`, undefined, brokerId);
      if (breaker.consecutiveErrors >= Mt5Adapter.MAX_ERRORS) {
        this.tripBreaker(`${category}: ${err.message}`, brokerId);
      }
      this.logBridgeState('disconnected', err.message, brokerId);
      return null;
    }
  }

  /**
   * Open the breaker for ONE broker (#846).
   *
   * ⚠️ The notification names the broker. It previously said "Trading via MT5 is
   * unavailable until the bridge recovers", which was a GLOBAL claim made from a
   * per-bridge failure — and false, because the other bridge was up.
   */
  private tripBreaker(reason: string, brokerId?: number): void {
    const breaker = this.breakerFor(brokerId);
    breaker.tripped = true;
    breaker.trippedAt = Date.now();
    const who = brokerId !== undefined ? `broker ${brokerId}` : 'the default bridge';
    this.logger.warn(
      `MT5 bridge circuit breaker TRIPPED for ${who} (${Mt5Adapter.MAX_ERRORS} errors): ${reason}`,
    );
    this.logBridgeEvent('disconnected', reason, brokerId);
    this.notifications?.send({
      title: '🚨 MT5 Bridge Disconnected',
      body:
        `Circuit breaker tripped for ${who} — ${reason}. Trading via ${who} is unavailable ` +
        `until it recovers; other brokers are unaffected.`,
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
      // #1085 — parsed only when present; `undefined` (old bridge) and `null` (no tick time)
      // must stay distinguishable from a real Date, because the sizing check refuses both
      // while NAMING which one it was.
      tickTime: data.tickTime ? new Date(data.tickTime) : (data.tickTime === null ? null : undefined),
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
            // #843 — sizing inputs. `undefined` (old bridge) and `null` both mean UNKNOWN; the
            // sizing path refuses on unknown rather than guessing a step or a tick value.
            volumeStep: typeof s.volumeStep === 'number' ? s.volumeStep : null,
            tickValue: typeof s.tickValue === 'number' ? s.tickValue : null,
            tickSize: typeof s.tickSize === 'number' ? s.tickSize : null,
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

  /**
   * listBrokerInstruments() — the FULL symbol list for CATALOGUING, not for validation (#958).
   *
   * ⚠️ WHY THIS DOES NOT REUSE `loadSymbols()`. That method projects each record down to
   * `{name}` plus tradability and keeps the result in a 5-minute in-memory cache. It throws
   * away `path` (the broker's own grouping — `Nasdaq\GRML`, `Forex\AUDCAD`) and `digits`, which
   * are exactly the fields a catalogue needs to classify and filter 12,000+ instruments. Two
   * callers wanting different projections is fine; one caller silently losing fields is not.
   *
   * ⚠️ RETURNS `null` WHEN THE BROKER CANNOT BE REACHED — never an empty array. The distinction
   * is load-bearing: "the broker listed nothing" and "the broker never answered" lead to
   * opposite conclusions, and a caller that collapses them will mark a live catalogue stale.
   * `symbolsCacheByBroker` is deliberately NOT written here, so a catalogue sync cannot change
   * what the availability gate (#723) sees.
   */
  async listBrokerInstruments(brokerId?: number): Promise<Array<{
    name: string;
    path: string | null;
    tradeMode: number | null;
    digits: number | null;
    volumeMin: number | null;
    volumeMax: number | null;
  }> | null> {
    const key = brokerId ?? this.symbolRouter?.primaryBrokerId() ?? 0;
    try {
      const route = this.symbolRouter?.routeForBroker(key);
      const data = await this.bridgeGet<BridgeSymbolListResponse>('/symbols', route);
      if (!data?.symbols?.length) {
        this.logger.warn(`MT5: broker ${key} returned no symbol list (unreachable or empty)`);
        return null;
      }
      return data.symbols.map((s) => ({
        name: String(s.name).toUpperCase(),
        path: s.path ? String(s.path) : null,
        tradeMode: typeof s.tradeMode === 'number' ? s.tradeMode : null,
        digits: typeof s.digits === 'number' ? s.digits : null,
        volumeMin: typeof s.volumeMin === 'number' ? s.volumeMin : null,
        volumeMax: typeof s.volumeMax === 'number' ? s.volumeMax : null,
      }));
    } catch (error) {
      this.logger.warn(`MT5: symbol list for broker ${key} failed — ${(error as Error).message}`);
      return null;
    }
  }

  async healthCheck(): Promise<boolean> {
    const data = await this.bridgeGet<BridgeHealthResponse>('/health');
    if (!data) return false;
    return data.connected === true;
  }



  /**
   * Per-broker circuit-breaker state for health/diagnostic surfaces (#846).
   *
   * ⚠️ Exposed because the state was previously INVISIBLE: the only way to discover that a
   * broker was gated was to watch `bridge_event` fill with `circuit breaker active
   * (skipped)` rows and infer which broker they belonged to from the account column — and
   * that column falls back to `MT5_ACTIVE_ACCOUNT` when no route is present, so it does not
   * reliably identify the key. A mechanism that exists but cannot be seen is
   * indistinguishable from one that does not work.
   */
  circuitBreakerSnapshot(): Array<{
    brokerKey: number | 'default';
    tripped: boolean;
    trippedAt: string | null;
    consecutiveErrors: number;
    cooldownRemainingMs: number;
  }> {
    const now = Date.now();
    return [...this.breakers.entries()].map(([key, s]) => ({
      // `0` is the no-route / single-default-bridge key, named rather than printed as 0.
      brokerKey: key === 0 ? 'default' : key,
      tripped: s.tripped,
      trippedAt: s.trippedAt ? new Date(s.trippedAt).toISOString() : null,
      consecutiveErrors: s.consecutiveErrors,
      cooldownRemainingMs:
        s.tripped && s.trippedAt
          ? Math.max(0, Mt5Adapter.COOLDOWN_MS - (now - s.trippedAt))
          : 0,
    }));
  }

  /**
   * Reset circuit breaker manually (e.g., after bridge restart).
   *
   * Pass a `brokerId` to clear ONE broker (#846); omit it to clear all of them, which is
   * what an operator restarting the whole stack means by "reset".
   */
  resetCircuitBreaker(brokerId?: number): void {
    if (brokerId === undefined) {
      this.breakers.clear();
      this.logger.log('MT5 circuit breaker manually reset for ALL brokers');
      return;
    }
    this.breakers.delete(brokerId);
    this.logger.log(`MT5 circuit breaker manually reset for broker ${brokerId}`);
  }

  // ── Brokerage Methods (IProviderAdapter) ─────────────────

  async getPositions(): Promise<BrokerPosition[]> {
    const { raw, authoritative } = await this.fetchAllBrokerPositions();
    this.lastPositionSnapshotAuthoritative = authoritative;

    return raw.map(({ p, brokerId }: { p: any; brokerId?: number }) => {
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
        // ⚠️ Tag every position with the ACCOUNT it came from (#883). One provider id (`mt5`)
        // covers several bridges, so without this the reconciler cannot tell which broker a
        // trade belongs to — and scoped writes land on the wrong account's rows.
        accountId: brokerId !== undefined ? this.brokerEnv(brokerId, 'MT5_ACCOUNT') ?? null : null,
      };
    });
  }

  /**
   * Ask EVERY active broker for its positions.
   *
   * ⚠️ WHY THIS IS NOT A SINGLE CALL (#883)
   * ---------------------------------------
   * `MT5_ACTIVE_BROKERS=2,3` runs two bridges — MetaQuotes (:5000) and Pepperstone (:5001). This
   * used to call `bridgeGet('/positions')` with NO route, which resolves to the DEFAULT bridge
   * only. The snapshot therefore held broker 2's positions and nothing from broker 3.
   *
   * Downstream, `position-sync` closes any open `trade` whose ticket is absent from the snapshot.
   * Broker 3's tickets were absent from EVERY snapshot, so broker 2's sync closed broker 3's
   * trades. Measured 2026-09-18: two LIVE Pepperstone VIX positions (`90555750`, `90563535`) were
   * written `closed` with `exitPrice=NULL, pnl=0` while the broker still held them — the ledger
   * said flat going into a weekend.
   *
   * ⚠️ `authoritative` requires EVERY broker to answer.
   * It is true only when every broker returned a position list. If one bridge is down, the
   * snapshot is INCOMPLETE, and calling it authoritative would let the surviving broker's sync
   * close the missing broker's trades — the same defect, one bridge further out. A partial
   * snapshot must refuse to be authoritative, because downstream the only thing standing between
   * "missing" and "closed" is this flag.
   */
  private async fetchAllBrokerPositions(): Promise<{
    raw: Array<{ p: any; brokerId?: number }>;
    authoritative: boolean;
  }> {
    const brokerIds = this.symbolRouter?.brokerIds?.() ?? [];

    // No router (tests, or a single-bridge install): keep the original single-URL path.
    if (brokerIds.length === 0) {
      const data = await this.bridgeGet<{ positions: any[]; count: number }>('/positions');
      if (!data?.positions) return { raw: [], authoritative: false };
      return { raw: data.positions.map((p: any) => ({ p })), authoritative: true };
    }

    const raw: Array<{ p: any; brokerId?: number }> = [];
    let authoritative = true;

    for (const brokerId of brokerIds) {
      const route = this.symbolRouter?.routeForBroker(brokerId);
      const data = await this.bridgeGet<{ positions: any[]; count: number }>('/positions', route);
      if (!data?.positions) {
        // This broker did not answer. The union is incomplete, so closure detection must not run.
        authoritative = false;
        this.logger.warn(
          `MT5 broker ${brokerId} returned no position snapshot — the combined snapshot is ` +
          'INCOMPLETE and closure detection will be skipped for this pass',
        );
        continue;
      }
      for (const p of data.positions) raw.push({ p, brokerId });
    }

    return { raw, authoritative };
  }

  async getPositionSnapshot(): Promise<BrokerPositionSnapshot> {
    const positions = await this.getPositions();
    return { positions, authoritative: this.lastPositionSnapshotAuthoritative };
  }

  /**
   * getQueriedAccountIds() — the accounts a snapshot from THIS adapter covers (#1101).
   *
   * ⚠️ DERIVED FROM THE SAME SOURCE `fetchAllBrokerPositions()` ITERATES — `symbolRouter.brokerIds()`
   * mapped through the same `brokerEnv` the position rows are stamped with. A second derivation
   * would be a second answer to "which brokers were asked", free to drift from the one that
   * actually fetches.
   *
   * Empty when there is no router (single-bridge install): the caller then keeps its previous
   * single-account resolution.
   */
  getQueriedAccountIds(): string[] {
    const brokerIds = this.symbolRouter?.brokerIds?.() ?? [];
    return brokerIds
      .map((id) => this.brokerEnv(id, 'MT5_ACCOUNT'))
      .filter((a): a is string => !!a);
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
    const deals = await this.fetchAllBrokerDeals(days);
    if (deals.length === 0) return [];
    const sinceMs = since.getTime();
    return deals
      .map((d: any) => ({
        brokerTicket: d.ticket != null ? String(d.ticket) : '',
        positionId: d.positionId != null ? String(d.positionId) : undefined,
        // ⚠️ #1014 — the ORDER id, carried so a LEGACY row can still be reconciled. Rows written
        // before the write-site fix stored an ORDER ticket in `brokerTicket`, and the positional
        // lookup (`deal.positionId === brokerTicket`) can never match one. With `orderId` present,
        // the reconciler resolves order → position → deals, which repairs history instead of
        // leaving it permanently unexplained. The bridge has always sent it (`orderId: d.order`).
        orderId: d.orderId != null ? String(d.orderId) : undefined,
        symbol: d.symbol,
        side: d.type === 'buy' ? 'buy' as const : 'sell' as const,
        volume: Number(d.volume ?? 0),
        price: Number(d.price ?? 0),
        profit: Number(d.profit ?? 0),
        commission: Number(d.commission ?? 0),
        swap: Number(d.swap ?? 0),
        fee: Number(d.fee ?? 0),
        time: new Date(d.time),
        // ⚠️ The broker's OWN reason for the deal (mt5.DEAL_REASON_*), passed through so
        // PositionSyncService can record WHY a position closed (close-attribution, 2026-09-18).
        // ✅ 2026-09-20: the running bridge forwards it — verified 293/293 deals carried the field.
        // Passing an absent value through as undefined rather than coercing to 0 is deliberate:
        // closeReasonFromDealReason() maps undefined to `broker:unknown`, whereas 0 would claim
        // "the client terminal closed it" — a guess presented as knowledge.
        reason: typeof d.reason === 'number' ? d.reason : undefined,
        // Verbatim: the bridge stamps the CLOSER's identity here (#916).
        comment: typeof d.comment === 'string' ? d.comment : undefined,
      }))
      .filter((d: BrokerDeal) => d.time.getTime() >= sinceMs);
  }

  /**
   * Ask EVERY active broker for its deal history (#1089).
   *
   * ⚠️ WHY THIS IS NOT A SINGLE CALL — and it was, until 2026-10-08
   * -----------------------------------------------------------------
   * `getDeals()` used to call `bridgeGet('/history?days=N')` with NO route, which resolves to
   * `this.bridgeUrl` — the PRIMARY bridge (`MT5_BRIDGE_URL` = `:5000`, broker 2). With
   * `MT5_ACTIVE_BROKERS=2,3` every finalisation of a broker-3 position therefore read broker 2's
   * history, found no closing deal, and wrote the row from the stale snapshot:
   * `closeReason='broker:unknown'`, exit price = last snapshot, pnl = floating snapshot pnl.
   *
   * MEASURED 2026-10-08 — every symbol routed to broker 3 (`symbol_route` brokerId=3):
   *
   *   | symbol | closes | broker:unknown | any other reason |
   *   |--------|--------|----------------|------------------|
   *   | VIX / GER40 / FRA40 / US30 / UK100 / XAGUSD | 48 (all time) | **48** | **0** |
   *
   * while broker-2 FX families carry real `broker:sl` attributions. Four rows were traced to their
   * real closing deals on `:5001` — all `reason 4 (SL)` — with realised profit different from the
   * stored value (GER40: real −8.18 vs stored −7.19). One VIX row was written **6.5 hours after**
   * its deal existed, so this was never a timing race: the deal was simply never asked for at the
   * right bridge.
   *
   * This mirrors `fetchAllBrokerPositions()` (the #883 fix) deliberately — a second, differently
   * shaped fan-out would be a second thing to drift, and this exact single-URL defect has already
   * been fixed in three other services (stop-guardian, position-time-stop, positions).
   *
   * ⚠️ A broker that answers with NO deals list is warned about, not silently skipped: its
   * positions would fall back to the snapshot exactly as this defect did, so the incompleteness is
   * made visible. Finalisation is NOT refused here (behaviour preserved) — see #1089 for the
   * open decision on whether a missing broker's deals should defer a close entirely.
   */
  // ── DECISION (2026-10-08, primary) ──
  // WHAT:      `getDeals()` fans out across EVERY active broker and merges; a broker that
  //            answers no deals is WARNED about, and finalisation is NOT deferred for it.
  // WHY:       The single-URL call read broker 2's history for every broker-3 position, so
  //            48 of 48 broker-3 closes were stored `broker:unknown` with the SNAPSHOT price
  //            and pnl (GER40 −7.19 stored vs −8.18 real, deal reason 4). Measured 2026-10-08.
  // INSTEAD OF: Mirroring #883's refusal for THIS path — refusing to finalise while a
  //            broker's deals are missing. That question stays OPEN in #1089 rather than
  //            being decided by default here.
  // REVERSE BY: Reverting `fetchAllBrokerDeals` to the single `bridgeGet('/history')` call.
  // REGISTER:  docs/SETTLED-DECISIONS.md row 69
  // GUARD:     src/modules/providers/adapters/mt5-adapter-multibroker.spec.ts (3 cases) ·
  //            logs/canary-1089-getdeals-fanout.ps1 (mutated: 2 failed · restored: 8 passed) ·
  //            BUILD GATE rule 5 in nest/scripts/validate-single-bridge-position-io.cjs —
  //            getDeals() delegating + the fan-out enumerating brokerIds and passing a route;
  //            tree canary observed both ways (mutated → exit 1, restored → exit 0)
  private async fetchAllBrokerDeals(days: number): Promise<any[]> {
    const brokerIds = this.symbolRouter?.brokerIds?.() ?? [];

    // No router (tests, or a single-bridge install): keep the original single-URL path.
    if (brokerIds.length === 0) {
      const data = await this.bridgeGet<{ deals: any[] }>(`/history?days=${days}`);
      return data?.deals ?? [];
    }

    const merged: any[] = [];
    for (const brokerId of brokerIds) {
      const route = this.symbolRouter?.routeForBroker(brokerId);
      const data = await this.bridgeGet<{ deals: any[] }>(`/history?days=${days}`, route);
      if (!data?.deals) {
        this.logger.warn(
          `MT5 broker ${brokerId} returned no deal history — a close on this broker may be ` +
          'finalised against the last snapshot instead of its real closing deal (#1089)',
        );
        continue;
      }
      merged.push(...data.deals);
    }
    return merged;
  }

  /**
   * recoverDeals() — ask EVERY active broker's terminal to serve deals it has not returned yet (#1093).
   *
   * ⚠️ WHY THIS IS A SEPARATE CALL FROM `getDeals()` (#1093)
   * -------------------------------------------------------
   * `getDeals()` READS the terminal's local history. This one REQUESTS: the bridge re-asks the
   * range and then asks PER TICKET (`history_deals_get(position=…)` AND `history_deals_get(ticket=…)`)
   * with bounded retries — the app's only lever over terminal-side history depth.
   *
   * MEASURED 2026-10-08, the day it was built: for three deals dated 2026-09-16/23 that broker 3's
   * terminal no longer serves, this call returned **0 recovered of 3** — so it is the honest probe
   * too. When the terminal DOES hold the deals (any recent close, and every broker-2 close) the
   * ordinary fan-out already finds them; this exists for the case where it did not.
   *
   * ⚠️ WHAT THE FIRST LIVE RUN TAUGHT IT (same day, and both are fixed here):
   *   1. A 404 from a bridge on an older script aborted the whole fan-out — the second broker was
   *      never asked. Each target is now caught individually and a refusal is recorded in `failed`.
   *   2. `trade.brokerTicket` matched a deal's ORDER id in 20 of 20 sampled rows (only 8 of those
   *      20 also matched a position id), so a position-only "served" check under-reported. The
   *      bridge now indexes both and answers with `recoveredIds`, keyed by the ids sent.
   *
   * The ticket list goes to EVERY active broker deliberately: a ticket only resolves on the
   * broker that owns it, so a broader ask costs one cheap call and needs no account→broker map.
   *
   * `failed` is not decoration: the caller's honest note must be able to say "broker 2 could not be
   * asked" instead of claiming its terminal served nothing.
   */
  async recoverDeals(
    positions: string[],
    from: Date,
    to?: Date,
    opts: { attempts?: number; delaySec?: number } = {},
  ): Promise<{
    deals: any[];
    recovered: string[];
    stillMissing: string[];
    byBroker: Record<number, { recovered: number; stillMissing: number }>;
    failed: Record<string, string>;
  }> {
    const brokerIds = this.symbolRouter?.brokerIds?.() ?? [];
    const targets: Array<{ brokerId?: number; route?: ResolvedSymbolRoute }> =
      brokerIds.length === 0
        ? [{ brokerId: undefined }]
        : brokerIds.map((b) => ({ brokerId: b, route: this.symbolRouter?.routeForBroker(b) }));

    const all: any[] = [];
    const recovered = new Set<string>();
    const byBroker: Record<number, { recovered: number; stillMissing: number }> = {};
    const failed: Record<string, string> = {};
    for (const t of targets) {
      const label = String(t.brokerId ?? 'default');
      let data: any = null;
      try {
        data = await this.bridgePost<any>(
          '/history/recover',
          {
            positions,
            from: from.toISOString(),
            ...(to ? { to: to.toISOString() } : {}),
            attempts: opts.attempts ?? 2,
            delaySec: opts.delaySec ?? 1.5,
          },
          t.route,
          // The bridge may legitimately spend attempts × delaySec inside the call; the default 10 s
          // budget would abort a request that is doing exactly what it was asked to do.
          45_000,
        );
      } catch (err) {
        // ── PER-BROKER ISOLATION (#1093, measured on the first live use — 2026-10-08) ──
        // `bridgePost` THROWS on any non-OK response. That contract is deliberate — an order path
        // must never read a refusal as silence — but this is a FAN-OUT, and without this catch the
        // FIRST bridge that refuses aborts the loop. Measured live: broker 2 was still running a
        // bridge script older than this route, answered 404 `not found`, and broker 3 was never
        // asked at all — while the caller's note said "the terminals did not serve any of the 81
        // missing exit records", a statement about terminals that had not been consulted.
        //
        // A ticket resolves on the broker that owns it, so one broker's refusal must not hide
        // another's answer — the #1089 rule, in the other direction. The refusal is RECORDED
        // rather than swallowed, because "not asked" and "asked and empty" are different facts.
        const message = (err as Error).message;
        failed[label] = message;
        this.logger.warn(`MT5: recoverDeals — broker ${label} could not be asked: ${message}`);
        continue;
      }
      if (!data) {
        failed[label] = 'no response (circuit breaker open or route is not an active MT5 bridge)';
        continue;
      }
      all.push(...(data.deals ?? []));
      // `recoveredIds` is keyed by the ids WE sent (the shape every current bridge returns).
      // The `perPosition` fallback covers a bridge on the intermediate script, and is only
      // consulted when `recoveredIds` is absent.
      const servedIds: string[] = Array.isArray(data.recoveredIds)
        ? data.recoveredIds
        : Object.keys(data.perPosition ?? {});
      for (const p of servedIds) recovered.add(String(p));
      if (t.brokerId !== undefined) {
        byBroker[t.brokerId] = {
          recovered: Number(data.recovered ?? 0),
          stillMissing: Array.isArray(data.stillMissing) ? data.stillMissing.length : 0,
        };
      }
    }
    return {
      deals: all,
      recovered: [...recovered],
      stillMissing: positions.filter((p) => !recovered.has(p)),
      byBroker,
      failed,
    };
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
    // Route the order to the broker that serves this symbol (#747). `forOrder` is #1002: it lets
    // the router prefer a broker that can actually TRADE the symbol when the default one cannot.
    const route = this.resolveRoute(params.symbol, undefined, true);

    // ── ROUTE INTEGRITY (#914) — the same check the feasibility library and the direct
    //    /api/trading/mt5/order path run, because THIS is the path manual trades and the
    //    automation loop actually use. It refuses a route that does not reach an active MT5
    //    bridge, and (for crypto) any route whose broker-native name is unverified — MT5
    //    fuzzy-matches names, so the bare ticker `BTC` selects `Nasdaq\ETF\BTC` and FILLS.
    //    Placing the refusal HERE means an auto-mode crypto bot has no path to that fill.
    const routeProblems = orderRouteProblems(
      params.symbol,
      route,
      this.symbolRouter?.brokerIds?.() ?? [],
      // #1002 — the broker's OWN symbol list is the authority on whether it can trade this
      // symbol. Without this the check could only ask "is the broker active?", which is true of a
      // broker whose list reports tradeMode=0 for the symbol — the US30 case.
      this.symbolRouter ? (b, s) => this.symbolRouter!.canTradeOn(b, s) : undefined,
    );
    if (routeProblems.length > 0) {
      const error =
        `Refusing to send ${params.symbol} to MT5: ${routeProblems.join('; ')}. ` +
        "A symbol may only travel a route whose broker is an active MT5 bridge" +
        (venueForSymbol(params.symbol).kind === 'crypto'
          ? " and whose brokerSymbol is the broker's real symbol (e.g. BTCUSD) — until the crypto" +
            ' execution route is decided and verified, crypto stays score-only (#903)'
          : '') +
        '.';
      this.logger.warn(error);
      this.syslog?.warn('MT5Adapter', `ORDER REFUSED ${params.symbol} ${params.side} ×${params.quantity} — ${error}`, 'trading');
      // The audit trail records the attempt — a refusal that never reaches the bridge is still
      // a decision the operator should be able to find (#885 persists refusals).
      this.prisma?.order.create({
        data: {
          symbol: params.symbol,
          type: 'market',
          side: params.side === 'BUY' ? 'buy' : 'sell',
          quantity: params.quantity,
          status: 'rejected',
          provider: 'mt5',
          error,
          errorCode: 'TCS-RISK-001',
        },
      }).catch(() => {});
      return { success: false, error, status: 'REJECTED', code: 'TCS-RISK-001' };
    }

    const body = {
      symbol: route.brokerSymbol,
      type: params.side === 'BUY' ? 'buy' : 'sell',
      volume: params.quantity,
      sl: params.sl ?? null,
      tp: params.tp ?? null,
      comment: safeComment,
      // #1018 — the position's identity for life. ABSENT is omitted from the payload entirely, so
      // the bridge applies DEFAULT_MAGIC; sending 0 would look like a real id that no bot owns.
      ...(params.magic != null ? { magic: params.magic } : {}),
      clientOrderId: params.clientOrderId,
    };

    this.logger.log(`MT5 order [broker ${route.brokerId}]: ${body.type} ${body.symbol} ×${body.volume} sl=${body.sl} tp=${body.tp} [tripped=${this.isTripped(route.brokerId)} errors=${this.breakerFor(route.brokerId).consecutiveErrors}]`);

    let data: any;
    try {
      data = await this.bridgePost<any>('/order', body, route);
    } catch (err) {
      const message = (err as Error).message;
      const rejection = err instanceof BridgeRejectedError ? err : null;
      this.logger.warn(`MT5 order FAILED: ${message}${rejection?.code ? ` [${rejection.code}]` : ''}`);
      this.syslog?.error('MT5Adapter', `ORDER REJECTED ${route.brokerSymbol} ${params.side} ×${params.quantity} — ${message} [broker ${route.brokerId}]${rejection?.code ? ` code=${rejection.code}` : ''}`, 'trading');
      this.prisma?.order.create({
        data: {
          symbol: params.symbol,
          type: 'market',
          side: params.side === 'BUY' ? 'buy' : 'sell',
          quantity: params.quantity,
          status: 'rejected',
          provider: 'mt5',
          // ⚠️ #885 — the refusal's diagnostic, persisted. The bridge sends it
          // (external.code = MT5 retcode, external.name = TRADE_RETCODE_*, params.fillingMode =
          // the broker's negotiation input) and the API previously dropped all of it.
          error: message,
          errorCode: rejection?.code ?? null,
          retcode: typeof (rejection as any)?.external?.code === 'number' ? (rejection as any).external.code : null,
          externalName: (rejection as any)?.external?.name ?? null,
          fillingMode: (rejection as any)?.params?.fillingMode ?? null,
        },
      }).catch(() => {});
      // #826 Phase 3 — pass the code/params on so the API layer and the UI can render the notice
      // rather than a bare broker sentence.
      return {
        success: false,
        error: message,
        status: 'REJECTED',
        code: rejection?.code,
        params: rejection?.params,
        external: rejection?.external,
      };
    }

    if (!data) {
      // bridgePost returns null for BOTH a tripped breaker (cooldown skip)
      // and a network-level failure. Label the two honestly — "circuit
      // breaker active" means the cooldown is holding; anything else is the
      // bridge simply not responding.
      //
      // ⚠️ #846 — read the breaker for THIS order's broker. Reading a global flag here
      // is how a broker-3 order came to report a broker-2 trip.
      const tripped = this.isTripped(route.brokerId);
      const reason = tripped
        ? `Bridge unreachable (circuit breaker active for broker ${route.brokerId})`
        : 'Bridge unreachable (no response)';
      this.logger.warn(`MT5 order FAILED — ${reason} [url=${route.url} broker=${route.brokerId} tripped=${tripped} consecutiveErrors=${this.breakerFor(route.brokerId).consecutiveErrors}]`);
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
          // ⚠️ #885 — an unknown outcome is a refusal of sorts: record WHY it is unknown.
          error: reason,
          errorCode: tripped ? 'TCS-INTEG-002' : 'TCS-INTEG-001',
        },
      }).catch(() => {});
      return {
        success: false,
        error: reason,
        status: 'UNKNOWN',
        // #826 Phase 3 — the two causes are DIFFERENT conditions, so they get different codes.
        // The distinction is read from the breaker's own state, not from the message text.
        code: tripped ? 'TCS-INTEG-002' : 'TCS-INTEG-001',
        params: { detail: reason },
      };
    }

    const result: BrokerOrderResult = {
      success: data.success === true,
      ticket: data.ticket ?? undefined,
      // ⚠️ #1014 — read the POSITION id, not just the order ticket. The bridge has always returned
      // it (`positionId: d.position_id`); this adapter dropped it, so every caller could only see
      // the ORDER ticket — and storing that as `brokerTicket` is what made the reconciler find
      // zero closing deals and finalise real positions as "vanished".
      positionId: data.positionId != null ? String(data.positionId) : undefined,
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
        // ⚠️ #885 — a rejection that arrived as a 200-with-success:false still carries its reason
        // (and the structured fields when the bridge included them).
        error: result.error ?? null,
        errorCode: (data as any).code ?? null,
        retcode: typeof (data as any).external?.code === 'number' ? (data as any).external.code : null,
        externalName: (data as any).external?.name ?? null,
        fillingMode: (data as any).params?.fillingMode ?? null,
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

  /**
   * Close an open position by broker ticket.
   *
   * `origin` names the CLOSER and rides in the query (`/close` reads `q.get('origin')`) so the
   * closing deal is stamped `TCS:<origin>` (#916). Default 'manual': an unstamped close is now
   * ASSUMED to be the owner (owner direction 2026-10-07, R46) — an app close must name itself
   * deliberately. Enforced by `validate-bridge-order-choke-point.cjs` R5.
   */
  async closePosition(ticket: string, volume?: number, brokerId?: number, origin = 'manual'): Promise<BrokerOrderResult> {
    return this.positionAction(`/close/${encodeURIComponent(ticket)}?origin=${encodeURIComponent(origin)}`, volume !== undefined ? { volume } : {}, brokerId, 'CLOSE');
  }

  /** Partially close an open position by broker ticket. `origin` rides in the body → `TCS:<origin>`. */
  async closePartial(ticket: string, volume: number, brokerId?: number, origin = 'manual'): Promise<BrokerOrderResult> {
    return this.positionAction(`/close/partial/${encodeURIComponent(ticket)}`, { volume, origin }, brokerId, 'CLOSE_PARTIAL');
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

  private async bridgePost<T>(path: string, body: unknown, route?: ResolvedSymbolRoute, timeoutMs = 10_000): Promise<T | null> {
    // ⚠️ #914 — see bridgeGet. A non-MT5 route must never be answered by the default bridge.
    if (route && !route.mt5) {
      this.logger.warn(
        `MT5: refusing POST ${path} — broker ${route.brokerId}` +
          `${route.provider ? ` (${route.provider})` : ''} is not an active MT5 bridge (#914)`,
      );
      return null;
    }
    const url = route?.url ?? this.bridgeUrl;
    const brokerId = route?.brokerId;
    // ⚠️ Per-broker breaker state (#846) — see the field comment on `breakers`.
    const breaker = this.breakerFor(brokerId);
    if (breaker.tripped) {
      const cooldownMs = Mt5Adapter.COOLDOWN_MS;
      if (breaker.trippedAt && Date.now() - breaker.trippedAt >= cooldownMs) {
        breaker.tripped = false;
        breaker.trippedAt = null;
        breaker.consecutiveErrors = 0;
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
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const isClientError = res.status >= 400 && res.status < 500 && res.status !== 429;
        if (!isClientError) breaker.consecutiveErrors++;
        const errorBody = await this.readBridgeErrorBody(res);
        const detail = `HTTP ${res.status}: ${errorBody}`;
        this.logBridgeDiag('POST', path, detail, body, brokerId);
        if (breaker.consecutiveErrors >= Mt5Adapter.MAX_ERRORS) {
          this.tripBreaker(detail, brokerId);
        }
        if (!isClientError) this.logBridgeState('disconnected', `HTTP ${res.status}`, brokerId);
        // Surface the bridge's real error (e.g. "No prices", "Insufficient margin")
        // instead of a generic "Bridge unreachable" so callers can act on it.
        // #826 Phase 3 — carry the notice code + params through with it.
        const rejection = this.extractBridgeRejection(errorBody);
        throw new BridgeRejectedError(
          rejection.message ?? detail,
          rejection.code,
          rejection.params,
          rejection.external,
        );
      }
      breaker.consecutiveErrors = 0;
      this.logBridgeState('connected', undefined, brokerId);
      return (await res.json()) as T;
    } catch (err) {
      const error = err as Error;
      if (error instanceof BridgeRejectedError) throw error;
      const category = this.classifyBridgeError(error);
      this.logBridgeDiag('POST', path, `${category}: ${error.message}`, body, brokerId);
      if (category !== 'refused' && category !== 'dns' && category !== 'network') {
        breaker.consecutiveErrors++;
      }
      if (breaker.consecutiveErrors >= Mt5Adapter.MAX_ERRORS) {
        this.tripBreaker(`${category}: ${error.message}`, brokerId);
      }
      this.logBridgeState('disconnected', error.message, brokerId);
      return null;
    }
  }
}
