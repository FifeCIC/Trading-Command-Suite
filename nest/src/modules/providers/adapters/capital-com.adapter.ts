/**
 * Capital.com API Adapter
 * =======================
 * Supports DEMO and LIVE environments.
 *
 * ── Auth ──────────────────────────────────────────────────
 * POST /api/v1/session → returns CST and X-SECURITY-TOKEN.
 * All subsequent requests use:
 *   CST: <token>
 *   X-SECURITY-TOKEN: <token>
 *
 * ── Environment Variables ─────────────────────────────────
 * CAPITAL_COM_MODE        'live' | 'demo' (default: 'demo')
 * CAPITAL_COM_API_KEY     API key from platform settings
 * CAPITAL_COM_LOGIN       Account login/email
 * CAPITAL_COM_PASSWORD    Account password
 * CAPITAL_COM_BASE_URL    Override base URL
 *
 * ── Rate Limits ───────────────────────────────────────────
 * Capital.com allows up to 100 requests/sec for most endpoints.
 * Session tokens expire after 10 hours — auto-refreshed.
 *
 * ── Docs ──────────────────────────────────────────────────
 * https://capital.com/api/docs
 */

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

export interface CapitalSession {
  cst: string;
  xSecurityToken: string;
  accountId: string;
  clientId: string;
  expiresAt: number;
}

@Injectable()
export class CapitalComAdapter implements IProviderAdapter {
  readonly name = 'Capital.com';
  readonly id = 'capital.com';
  readonly supportsBrokerage = true;
  private readonly logger = new Logger(CapitalComAdapter.name);

  // ── Mode ──
  readonly mode: 'live' | 'demo' | 'none';

  // ── Credentials ──
  private readonly apiKey: string;
  private readonly login: string;
  private readonly password: string;
  private readonly baseUrl: string;

  // ── Session ──
  private session: CapitalSession | null = null;
  private sessionPromise: Promise<CapitalSession> | null = null;

  // ── Rate limiting ──
  private readonly rateTracker = new RateLimitTracker('capital-com', 'capital.com', 100);

  constructor() {
    this.mode = (process.env.CAPITAL_COM_MODE || 'demo').toLowerCase() as 'live' | 'demo';
    this.apiKey = process.env.CAPITAL_COM_API_KEY || '';
    this.login = process.env.CAPITAL_COM_LOGIN || '';
    this.password = process.env.CAPITAL_COM_PASSWORD || '';
    this.baseUrl = process.env.CAPITAL_COM_BASE_URL || 'https://demo-api-capital.backend-capital.com';

    if (this.apiKey && this.login && this.password) {
      this.logger.log(`Capital.com adapter initialised — mode=${this.mode} base=${this.baseUrl}`);
    } else {
      this.mode = 'none';
      this.logger.warn(`Capital.com adapter: missing credentials (need API_KEY + LOGIN + PASSWORD)`);
    }
  }

  // ── Session Management ───────────────────────────────────

  private async getSession(): Promise<CapitalSession | null> {
    if (this.session && Date.now() < this.session.expiresAt) return this.session;

    // Prevent concurrent session requests
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = this.createSession();
    try {
      const session = await this.sessionPromise;
      this.session = session;
      return session;
    } catch (err) {
      this.logger.warn(`Capital.com session failed: ${(err as Error).message}`);
      return null;
    } finally {
      this.sessionPromise = null;
    }
  }

  private async createSession(): Promise<CapitalSession> {
    const res = await fetch(`${this.baseUrl}/api/v1/session`, {
      method: 'POST',
      headers: {
        'X-CAP-API-KEY': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        identifier: this.login,
        password: this.password,
        encryptedPassword: false,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.substring(0, 200)}`);
    }

    const cst = res.headers.get('CST') || '';
    const xSecurityToken = res.headers.get('X-SECURITY-TOKEN') || '';

    if (!cst) throw new Error('No CST token in session response');

    const data = await res.json();
    return {
      cst,
      xSecurityToken,
      accountId: data.accountId || '',
      clientId: data.clientId || '',
      expiresAt: Date.now() + 9 * 60 * 60 * 1000, // 9 hour safety margin
    };
  }

  // ── Auth Headers ─────────────────────────────────────────

  private async authHeaders(): Promise<Record<string, string> | null> {
    const session = await this.getSession();
    if (!session) return null;
    return {
      'CST': session.cst,
      'X-SECURITY-TOKEN': session.xSecurityToken,
      'Content-Type': 'application/json',
    };
  }

  // ── API Helpers ──────────────────────────────────────────

  private async apiGet<T>(path: string): Promise<T | null> {
    if (this.mode === 'none') return null;
    const headers = await this.authHeaders();
    if (!headers) return null;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn(`Capital.com GET ${path} → HTTP ${res.status}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`Capital.com GET ${path} failed: ${(err as Error).message}`);
      return null;
    }
  }

  private async apiPost<T>(path: string, body: unknown): Promise<T | null> {
    if (this.mode === 'none') return null;
    const headers = await this.authHeaders();
    if (!headers) return null;

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const errorBody = await res.text().catch(() => '');
        this.logger.warn(`Capital.com POST ${path} → HTTP ${res.status}: ${errorBody.substring(0, 200)}`);
        return null;
      }
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`Capital.com POST ${path} failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── IProviderAdapter Implementation ──────────────────────

  async getProfile(symbol: string): Promise<ProviderProfile | null> {
    // Capital.com markets API doesn't provide sector/industry data.
    // Return basic profile from the symbol.
    return {
      symbol,
      name: symbol,
      exchange: 'Capital.com',
      sector: null,
      industry: null,
      marketCap: null,
    };
  }

  async healthCheck(): Promise<boolean> {
    const session = await this.getSession();
    return session !== null;
  }

  async getHealth(): Promise<boolean> {
    return this.healthCheck();
  }

  async getAccount(): Promise<BrokerAccount | null> {
    const data = await this.apiGet<any>('/api/v1/accounts');
    if (!data?.accounts?.length) return null;

    const acct = data.accounts[0];
    return {
      brokerId: this.id,
      brokerName: this.name,
      balance: acct.balance?.balance || 0,
      equity: acct.balance?.balance || 0,
      margin: acct.balance?.depositUsed || 0,
      marginFree: (acct.balance?.balance || 0) - (acct.balance?.depositUsed || 0),
      marginLevel: acct.balance?.depositUsed ? ((acct.balance?.balance || 0) / acct.balance.depositUsed) * 100 : null,
      currency: acct.currency || 'GBP',
      mode: (this.mode === 'live' ? 'live' : 'demo') as 'live' | 'demo',
      connected: true,
    };
  }

  async getPositions(): Promise<BrokerPosition[]> {
    const data = await this.apiGet<any>('/api/v1/positions');
    if (!data?.positions) return [];

    return data.positions.map((p: any) => ({
      symbol: p.position?.dealId || p.market?.epic || '',
      quantity: p.position?.size || 0,
      avgCost: p.position?.level || 0,
      currentPrice: p.market?.bid || 0,
      unrealizedPnl: p.position?.upl || 0,
      ticket: null, // Capital.com uses dealId not numeric tickets
      currency: p.position?.currency || 'GBP',
      openedAt: p.position?.createdUtc || new Date().toISOString(),
      sl: p.position?.stopLevel || null,
      tp: p.position?.limitLevel || null,
      comment: '',
    }));
  }

  async placeOrder(params: BrokerOrderRequest): Promise<BrokerOrderResult> {
    const direction = params.side === 'BUY' ? 'BUY' : 'SELL';
    const body = {
      epic: params.symbol,
      direction,
      size: params.quantity,
      orderType: 'MARKET',
      guaranteedStop: false,
      stopLevel: params.sl || null,
      limitLevel: params.tp || null,
    };

    const data = await this.apiPost<any>('/api/v1/positions', body);
    if (!data) {
      return { success: false, error: 'Capital.com order failed — no response' };
    }

    return {
      success: data.dealReference ? true : false,
      ticket: data.dealReference || undefined,
      price: data.level || undefined,
      error: data.error || undefined,
    };
  }

  async getQuote(symbol: string): Promise<ProviderQuote | null> {
    const data = await this.apiGet<any>(`/api/v1/prices/${encodeURIComponent(symbol)}`);
    if (!data) return null;

    return {
      symbol,
      bid: data.bid || null,
      ask: data.offer || null,
      last: (data.bid + data.offer) / 2 || null,
      timestamp: new Date(data.snapshotTimeUtc || Date.now()),
    };
  }

  async getCandles(symbol: string, timeframe = '1h', limit = 100): Promise<MarketBar[]> {
    // Capital.com uses different timeframe format and resolution parameter
    const resolution = timeframe === '1h' ? 'HOUR' : timeframe === '1d' ? 'DAY' : 'MINUTE';
    const max = Math.min(limit, 1000);
    const data = await this.apiGet<any>(
      `/api/v1/prices/${encodeURIComponent(symbol)}?resolution=${resolution}&max=${max}`
    );
    if (!data?.prices?.length) return [];

    return data.prices.map((p: any) => ({
      timestamp: new Date(p.snapshotTimeUtc || p.snapshotTime).toISOString(),
      open: p.openPrice?.bid || 0,
      high: p.highPrice?.bid || 0,
      low: p.lowPrice?.bid || 0,
      close: p.closePrice?.bid || 0,
      volume: p.lastTradedVolume || 0,
      symbol,
      timeframe,
    }));
  }

  async getSymbols(): Promise<string[]> {
    const data = await this.apiGet<any>('/api/v1/markets?pageSize=1000');
    if (!data?.markets) return [];
    return data.markets.map((m: any) => m.epic);
  }
}
