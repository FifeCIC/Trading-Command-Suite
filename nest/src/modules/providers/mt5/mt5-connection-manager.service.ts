import { Injectable, Logger } from '@nestjs/common';

/**
 * MT5 Connection Manager — wraps the Python MT5 bridge HTTP API.
 * Provides multi-account awareness and connection state tracking.
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
}

const BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:5001';

@Injectable()
export class Mt5ConnectionManager {
  private readonly logger = new Logger(Mt5ConnectionManager.name);
  private cacheAccounts: Mt5Account[] = [];
  private lastFetch = 0;

  private async fetch(url: string, options?: RequestInit) {
    try {
      const res = await fetch(`${BRIDGE_URL}${url}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options?.headers },
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: (err as Error).message } };
    }
  }

  async getAccounts(): Promise<Mt5Account[]> {
    const now = Date.now();
    if (this.cacheAccounts.length && now - this.lastFetch < 30000) {
      return this.cacheAccounts;
    }

    const { ok, data } = await this.fetch('/accounts');
    if (!ok) return [];

    const accounts: Mt5Account[] = (data.accounts || []).map((a: any) => ({
      number: a.number,
      login: a.login || '',
      server: a.server || '',
      active: a.active || false,
      connected: data.connected && a.active,
    }));

    // Enrich active account with balance info
    const health = await this.getHealth();
    if (health?.connected) {
      const active = accounts.find((a) => a.active);
      if (active) {
        active.balance = health.balance ?? undefined;
        active.equity = health.equity ?? undefined;
      }
    }

    this.cacheAccounts = accounts;
    this.lastFetch = now;
    return accounts;
  }

  async getHealth(): Promise<Mt5BridgeHealth | null> {
    const { ok, data } = await this.fetch('/health');
    return ok ? data : null;
  }

  async switchAccount(accountNum: number) {
    const { ok, data } = await this.fetch(`/switch/${accountNum}`, { method: 'POST' });
    this.cacheAccounts = [];
    return { ok, ...data };
  }

  async testAccount(login: string, password: string, server: string) {
    const { ok, data } = await this.fetch('/accounts/test', {
      method: 'POST',
      body: JSON.stringify({ login, password, server }),
    });
    return { ok, ...data };
  }

  async addAccount(login: string, password: string, server: string, label?: string) {
    const { ok, data } = await this.fetch('/accounts/add', {
      method: 'POST',
      body: JSON.stringify({ login, password, server, label }),
    });
    return { ok, ...data };
  }

  async getPositions() {
    const { ok, data } = await this.fetch('/positions');
    return ok ? data.positions || [] : [];
  }

  async getAccountInfo() {
    const { ok, data } = await this.fetch('/account');
    return ok ? data : null;
  }

  async getHistory(days = 7) {
    const { ok, data } = await this.fetch(`/history?days=${days}`);
    return ok ? data : { orders: [], deals: [], orderCount: 0, dealCount: 0 };
  }

  async getDealHistory(days = 30, symbol?: string) {
    const url = symbol
      ? `/history/deals?days=${days}&symbol=${encodeURIComponent(symbol)}`
      : `/history/deals?days=${days}`;
    const { ok, data } = await this.fetch(url);
    return ok ? data.deals || [] : [];
  }

  async getTerminalInfo() {
    const { ok, data } = await this.fetch('/terminal/info');
    return ok ? data : null;
  }

  async getSymbolInfo(symbol: string) {
    const { ok, data } = await this.fetch(`/symbol/${encodeURIComponent(symbol)}/info`);
    return ok ? data : null;
  }

  async getCalendar(currency?: string) {
    const url = currency ? `/calendar?currency=${encodeURIComponent(currency)}` : '/calendar';
    const { ok, data } = await this.fetch(url);
    return ok ? data.events || [] : [];
  }

  async placeOrder(params: {
    symbol: string; type: string; volume: number;
    price?: number; sl?: number; tp?: number; comment?: string;
  }) {
    const { ok, data } = await this.fetch('/order', {
      method: 'POST',
      body: JSON.stringify(params),
    });
    return { ok, ...data };
  }

  async closePosition(ticket: number) {
    const { ok, data } = await this.fetch(`/close/${ticket}`, { method: 'POST' });
    return { ok, ...data };
  }

  async closePartial(ticket: number, volume: number) {
    const { ok, data } = await this.fetch(`/close/partial/${ticket}`, {
      method: 'POST',
      body: JSON.stringify({ volume }),
    });
    return { ok, ...data };
  }

  async modifyOrder(ticket: number, sl?: number, tp?: number) {
    const { ok, data } = await this.fetch('/order/modify', {
      method: 'POST',
      body: JSON.stringify({ ticket, sl, tp }),
    });
    return { ok, ...data };
  }
}
