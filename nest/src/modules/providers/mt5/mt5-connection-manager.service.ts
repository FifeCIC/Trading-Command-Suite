import { Injectable, Logger } from '@nestjs/common';

/**
 * MT5 Connection Manager — wraps the Python MT5 bridge HTTP API.
 * Multi-broker: maintains one HTTP client per broker instance.
 * Each bridge instance runs on its own port (5000, 5001, …).
 *
 * Broker IDs are the account slot numbers from .env (e.g. 2, 3).
 * URLs are derived from sequential ports starting at 5000, or from
 * MT5_BROKER_URL_{id} env vars for explicit overrides.
 */

export interface Mt5Account {
  number: number;
  login: string;
  server: string;
  label?: string;
  active: boolean;
  balance?: number;
  equity?: number;
  currency?: string;
  connected: boolean;
  lastSeen?: string;
  isLive?: boolean;
  /** Which MT5 bridge instance this account belongs to */
  brokerId?: number;
}

export interface Mt5BridgeHealth {
  connected: boolean;
  mt5Package: boolean;
  activeAccount: number;
  account: string | null;
  server: string | null;
  balance: number | null;
  equity: number | null;
  connectionErrors: number;
  /**
   * Broker server-clock offset measured by the bridge and applied inside `utc_iso()`
   * (broker server time − true UTC, e.g. 10800 = the server is 3h ahead). #750.
   *
   * ⚠️ Optional on purpose: its ABSENCE means the bridge is running a build from
   * before #750 — raw server-clock epochs are being stamped as UTC again, so every
   * MT5 timestamp lands ~3h in the future and `computeMarketStatus` fails OPEN on
   * stale data. `AlertTriggerService` raises `bridge-clock-skew` for exactly that.
   * If you change the field name, change it in mt5_bridge_v2.py and that check too.
   */
  serverUtcOffsetSeconds?: number;
  serverUtcOffsetHours?: number;
  /**
   * Effective risk limits the RUNNING bridge enforces (#901).
   *
   * ⚠️ These are read from `nest/.env` at the bridge's IMPORT, so editing the file does NOT
   * take effect until the bridge process is restarted. The app's own caps
   * (`risk.maxOpenPositions`, `risk.maxPositionSize`, `risk.maxDailyLoss`) are read LIVE from
   * settings — so the two can silently disagree and the LOWER of the two is what binds.
   * Measured 2026-09-19 (#901): app said 20, the running bridge still enforced 5 from a stale
   * import, and 28 orders were refused naming a control that could not clear the error.
   * `SystemHealthService.checkRiskCapAlignment()` compares these against the app caps.
   */
  riskLimits?: {
    maxOpenPositions?: number;
    maxPositionSize?: number;
    maxDailyLoss?: number;
  };
}

export interface Mt5BrokerInfo {
  brokerId: number;
  server: string;
  url: string;
  health: Mt5BridgeHealth | null;
  reachable: boolean;
}

const BASE_PORT = 5000;

@Injectable()
export class Mt5ConnectionManager {
  private readonly logger = new Logger(Mt5ConnectionManager.name);
  private readonly brokerUrls = new Map<number, string>();
  private readonly brokerIds: number[] = [];
  private readonly defaultBrokerId: number | null = null;
  private cacheAccounts: Mt5Account[] = [];
  private lastFetch = 0;

  constructor() {
    // Parse active brokers from env
    const activeBrokers = (process.env.MT5_ACTIVE_BROKERS || process.env.MT5_ACTIVE_ACCOUNT || '2')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    // Build URL map: sequential ports or explicit MT5_BROKER_URL_{id}
    activeBrokers.forEach((brokerId, idx) => {
      const explicitUrl = process.env[`MT5_BROKER_URL_${brokerId}`];
      const url = explicitUrl || `http://localhost:${BASE_PORT + idx}`;
      this.brokerUrls.set(brokerId, url);
      this.brokerIds.push(brokerId);
    });

    this.defaultBrokerId = this.brokerIds[0] ?? null;
    this.logger.log(
      `Multi-broker MT5: ${this.brokerIds.length} instance(s) — ` +
      this.brokerIds.map((id) => `#${id}→${this.brokerUrls.get(id)}`).join(', '),
    );
  }

  // ── Broker registry ──────────────────────────────────────

  /** All configured broker IDs (e.g. [2, 3]) */
  getBrokerIds(): number[] {
    return [...this.brokerIds];
  }

  /**
   * isBroker() — is this id an ACTIVE MT5 bridge slot?
   *
   * ⚠️ #914 — the `!= null` is the point of this method. `0` is a REAL broker id in
   * `symbol_route` (the four crypto rows carry `brokerId 0` / `provider=binance`), and every
   * `if (brokerId && …)` test in this file treated it as "not specified" — so a request for
   * broker 0 silently became a request for the DEFAULT bridge (MetaQuotes :5000), where the
   * bare ticker `BTC` matches `Nasdaq\ETF\BTC`. Distinguishing null/undefined from `0` is what
   * stops a non-MT5 route from being answered by an MT5 bridge that was never asked.
   */
  isBroker(brokerId: number | null | undefined): brokerId is number {
    return brokerId != null && this.brokerUrls.has(brokerId);
  }

  /**
   * Get the bridge URL for a specific broker (defaults to first active).
   *
   * ⚠️ An EXPLICIT id that is not a registered bridge THROWS — it must never be answered by
   * the default bridge (#914). Callers that may hold a non-MT5 route (see `Mt5SymbolRouter`)
   * check `isBroker()` first; a thrown error here is a programming error, not a fallback case.
   */
  getUrl(brokerId?: number | null): string {
    if (brokerId == null) return this.defaultUrl();
    const url = this.brokerUrls.get(brokerId);
    if (!url) {
      throw new Error(
        `Broker ${brokerId} is not an MT5 bridge (active: ${this.brokerIds.join(', ') || 'none'}) — ` +
          'refusing to answer as the default bridge',
      );
    }
    return url;
  }

  private defaultUrl(): string {
    return this.brokerUrls.get(this.defaultBrokerId!) || `http://localhost:${BASE_PORT}`;
  }

  /**
   * Resolve brokerId for REPORTING — never for addressing (that is `getUrl`).
   * A requested id is reported as-is: an unregistered id is a fact the caller needs to see,
   * not something to paper over with the default (#914).
   */
  private resolveBroker(brokerId?: number | null): number {
    if (brokerId != null) return brokerId;
    return this.defaultBrokerId!;
  }

  // ── Low-level fetch (broker-aware) ───────────────────────

  private async fetch(url: string, options?: RequestInit, brokerId?: number) {
    let base: string;
    try {
      base = this.getUrl(brokerId);
    } catch (err) {
      // The requested broker is not an MT5 bridge — NOTHING was consulted, and we must not
      // report a bridged answer under the default broker's id (#914).
      return { ok: false, status: 0, data: { error: (err as Error).message }, brokerId: this.resolveBroker(brokerId) };
    }
    try {
      const res = await fetch(`${base}${url}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, data, brokerId: this.resolveBroker(brokerId) };
    } catch (err) {
      return { ok: false, status: 0, data: { error: (err as Error).message }, brokerId: this.resolveBroker(brokerId) };
    }
  }

  // ── Multi-broker health ──────────────────────────────────

  /** Get health from ALL active brokers concurrently */
  async getAllBrokerHealths(): Promise<Mt5BrokerInfo[]> {
    const results = await Promise.all(
      this.brokerIds.map(async (brokerId) => {
        const url = this.brokerUrls.get(brokerId)!;
        const { ok, data } = await this.fetch('/health', undefined, brokerId);
        return {
          brokerId,
          server: data?.server || '?',
          url,
          health: ok ? (data as Mt5BridgeHealth) : null,
          reachable: ok && !!data?.connected,
        };
      }),
    );
    return results;
  }

  /** Get health from a specific broker (defaults to first active) */
  async getHealth(brokerId?: number): Promise<Mt5BridgeHealth | null> {
    const { ok, data } = await this.fetch('/health', undefined, brokerId);
    return ok ? data : null;
  }

  // ── Accounts (merged from all brokers) ───────────────────

  async getAccounts(): Promise<Mt5Account[]> {
    const now = Date.now();
    if (this.cacheAccounts.length && now - this.lastFetch < 30000) {
      return this.cacheAccounts;
    }

    // Fan out to all brokers
    const brokerInfos = await this.getAllBrokerHealths();
    const allAccounts: Mt5Account[] = [];

    for (const bi of brokerInfos) {
      const { ok, data } = await this.fetch('/accounts', undefined, bi.brokerId);
      if (!ok) continue;

      const accounts: Mt5Account[] = (data.accounts || []).map((a: any) => ({
        number: a.number,
        login: a.login || '',
        server: a.server || '',
        active: a.active || false,
        connected: bi.reachable && a.active,
        isLive: this.isLiveServer(a.server || '', a.login || ''),
        brokerId: bi.brokerId,
        balance: bi.reachable && a.active ? bi.health?.balance ?? undefined : undefined,
        equity: bi.reachable && a.active ? bi.health?.equity ?? undefined : undefined,
      }));

      allAccounts.push(...accounts);
    }

    this.cacheAccounts = allAccounts;
    this.lastFetch = now;
    return allAccounts;
  }

  private isLiveServer(server: string, login: string): boolean {
    const s = (server || '').toLowerCase();
    if (s.replace(/[^a-z]/g, '').includes('demo')) return false;
    if (s.includes('demo')) return false;
    return login.length > 0;
  }

  // ── Single-broker methods (default to first active) ──────

  async switchAccount(accountNum: number, brokerId?: number) {
    const { ok, data } = await this.fetch(`/switch/${accountNum}`, { method: 'POST' }, brokerId);
    this.cacheAccounts = [];
    return { ok, ...data };
  }

  async testAccount(login: string, password: string, server: string, brokerId?: number) {
    const { ok, data } = await this.fetch('/accounts/test', {
      method: 'POST', body: JSON.stringify({ login, password, server }),
    }, brokerId);
    return { ok, ...data };
  }

  async addAccount(login: string, password: string, server: string, label?: string, brokerId?: number) {
    const { ok, data } = await this.fetch('/accounts/add', {
      method: 'POST', body: JSON.stringify({ login, password, server, label }),
    }, brokerId);
    return { ok, ...data };
  }

  /** Get positions from a specific broker (defaults to first active) */
  async getPositions(brokerId?: number) {
    const { ok, data } = await this.fetch('/positions', undefined, brokerId);
    return ok ? data.positions || [] : [];
  }

  /** Get positions from ALL brokers (merged) */
  async getAllPositions(): Promise<Array<{ ticket: number; symbol: string; brokerId: number } & Record<string, any>>> {
    const results = await Promise.all(
      this.brokerIds.map(async (brokerId) => {
        const positions = await this.getPositions(brokerId);
        return positions.map((p: any) => ({ ...p, brokerId }));
      }),
    );
    return results.flat();
  }

  async getAccountInfo(brokerId?: number) {
    const { ok, data } = await this.fetch('/account', undefined, brokerId);
    return ok ? data : null;
  }

  async getHistory(days = 7, brokerId?: number) {
    const { ok, data } = await this.fetch(`/history?days=${days}`, undefined, brokerId);
    return ok ? data : { orders: [], deals: [], orderCount: 0, dealCount: 0 };
  }

  async getDealHistory(days = 30, symbol?: string, brokerId?: number) {
    const url = symbol
      ? `/history/deals?days=${days}&symbol=${encodeURIComponent(symbol)}`
      : `/history/deals?days=${days}`;
    const { ok, data } = await this.fetch(url, undefined, brokerId);
    return ok ? data.deals || [] : [];
  }

  async getTerminalInfo(brokerId?: number) {
    const { ok, data } = await this.fetch('/terminal/info', undefined, brokerId);
    return ok ? data : null;
  }

  async getSymbolInfo(symbol: string, brokerId?: number) {
    const { ok, data } = await this.fetch(`/symbol/${encodeURIComponent(symbol)}/info`, undefined, brokerId);
    return ok ? data : null;
  }

  async getCalendar(currency?: string, brokerId?: number) {
    const url = currency ? `/calendar?currency=${encodeURIComponent(currency)}` : '/calendar';
    const { ok, data } = await this.fetch(url, undefined, brokerId);
    return ok ? data.events || [] : [];
  }

  async placeOrder(params: {
    symbol: string; type: string; volume: number;
    price?: number; sl?: number; tp?: number; comment?: string;
  }, brokerId?: number) {
    const { ok, data } = await this.fetch('/order', {
      method: 'POST', body: JSON.stringify(params),
    }, brokerId);
    return { ok, ...data };
  }

  /**
   * Close a position. `origin` names the CLOSER and lands in the broker deal's comment as
   * `TCS:<origin>` (#916, 2026-09-20) — that comment is the only record that survives a restart,
   * so every caller should say who it is ('time-stop', 'manual', …). Defaults to 'manual'.
   */
  async closePosition(ticket: number, brokerId?: number, origin?: string) {
    const query = origin ? `?origin=${encodeURIComponent(origin)}` : '';
    const { ok, data } = await this.fetch(`/close/${ticket}${query}`, { method: 'POST' }, brokerId);
    return { ok, ...data };
  }

  async closePartial(ticket: number, volume: number, brokerId?: number) {
    const { ok, data } = await this.fetch(`/close/partial/${ticket}`, {
      method: 'POST', body: JSON.stringify({ volume }),
    }, brokerId);
    return { ok, ...data };
  }

  async modifyOrder(ticket: number, sl?: number, tp?: number, brokerId?: number) {
    const { ok, data } = await this.fetch('/order/modify', {
      method: 'POST', body: JSON.stringify({ ticket, sl, tp }),
    }, brokerId);
    return { ok, ...data };
  }

  /** Fetch candles from a specific broker bridge */
  async getCandles(symbol: string, timeframe = '1h', limit = 200, brokerId?: number) {
    const { ok, data } = await this.fetch(
      `/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${Math.min(limit, 1000)}`,
      undefined, brokerId,
    );
    if (!ok || !data?.bars?.length) return [];
    return data.bars.map((b: any) => ({
      timestamp: new Date(b.timestamp),
      open: Number(b.open), high: Number(b.high), low: Number(b.low),
      close: Number(b.close), volume: Number(b.volume),
    }));
  }

  /** Get a quote (bid/ask) from a specific broker */
  async getQuote(symbol: string, brokerId?: number) {
    const { ok, data } = await this.fetch(`/quote?symbol=${encodeURIComponent(symbol)}`, undefined, brokerId);
    return ok ? data : null;
  }
}
