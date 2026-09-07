import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { IsaService } from '../isa/isa.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import { CapitalComAdapter } from '../providers/adapters/capital-com.adapter';

/**
 * PortfolioAccountsService — unified multi-account portfolio account management.
 *
 * Enumerates every configured trading account across brokers (Trading212 live/
 * demo/ISA/CFD, MT5 bridge accounts, Capital.com), grouped into Live / Demo
 * categories. Each account and each category has an on/off toggle persisted in
 * `global_setting` (keys `accounts.<id>` and `accounts.category.<id>`).
 *
 * The overview total only counts ENABLED accounts inside ENABLED categories,
 * so the frontend simply renders what this service reports — all account
 * selection/totalling logic lives here.
 */

const SETTING_PREFIX = 'accounts.';
const CATEGORY_PREFIX = 'accounts.category.';

export interface PortfolioAccount {
  id: string;
  broker: string;
  label: string;
  kind: 'invest' | 'isa' | 'cfd' | 'mt5' | 'capital';
  category: 'live' | 'demo';
  enabled: boolean;
  connected: boolean;
  value?: number;
  positions?: number;
  currency?: string;
  note?: string;
}

export interface PortfolioCategory {
  id: 'live' | 'demo';
  label: string;
  enabled: boolean;
  accounts: PortfolioAccount[];
  total: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  live: 'Live',
  demo: 'Demo / Practice',
};

@Injectable()
export class PortfolioAccountsService {
  private readonly logger = new Logger(PortfolioAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly isaService: IsaService,
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly capitalAdapter: CapitalComAdapter,
  ) {}

  // ── Persistence ───────────────────────────────────────────

  private async readEnabled(key: string, def = true): Promise<boolean> {
    try {
      if (!this.prisma.isAvailable) return def;
      const row = await (this.prisma as any).globalSetting.findUnique({ where: { key } });
      if (!row?.value) return def;
      try {
        const parsed = JSON.parse(row.value);
        return parsed.enabled !== false;
      } catch {
        return row.value !== 'false';
      }
    } catch {
      return def;
    }
  }

  private async writeEnabled(key: string, enabled: boolean): Promise<void> {
    if (!this.prisma.isAvailable) return;
    const value = JSON.stringify({ enabled });
    await (this.prisma as any).globalSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  // ── Account enumeration ───────────────────────────────────

  private t212Connected(kind: 'invest' | 'isa' | 'cfd', category: 'live' | 'demo'): boolean {
    if (kind === 'isa') return !!process.env.TRADING212_ISA_API_KEY;
    if (kind === 'cfd') return false; // CFD API not available yet
    // invest account — live vs demo key
    if (category === 'live') return !!process.env.TRADING212_LIVE_API_KEY;
    return !!(process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY);
  }

  private async positionTotals(): Promise<Map<string, { value: number; positions: number }>> {
    const map = new Map<string, { value: number; positions: number }>();
    if (!this.prisma.isAvailable) return map;
    try {
      const rows = await this.prisma.position.findMany({
        select: { provider: true, accountId: true, quantity: true, currentPrice: true },
      });
      for (const r of rows) {
        const key = `${r.provider}:${r.accountId || ''}`;
        const cur = map.get(key) || { value: 0, positions: 0 };
        cur.value += (r.quantity || 0) * (r.currentPrice || 0);
        cur.positions += 1;
        map.set(key, cur);
      }
    } catch (err) {
      this.logger.warn(`positionTotals failed: ${(err as Error).message}`);
    }
    return map;
  }

  private async collectAccounts(): Promise<PortfolioAccount[]> {
    const accounts: PortfolioAccount[] = [];
    const totals = await this.positionTotals();

    // ── Trading212 accounts ──
    const t212Defs: Array<{ id: string; label: string; kind: 'invest' | 'isa' | 'cfd'; category: 'live' | 'demo' }> = [
      { id: 't212:live', label: 'Invest (Live)', kind: 'invest', category: 'live' },
      { id: 't212:demo', label: 'Practice (Demo)', kind: 'invest', category: 'demo' },
      { id: 't212:isa', label: 'Stocks ISA', kind: 'isa', category: 'live' },
      { id: 't212:cfd', label: 'CFD', kind: 'cfd', category: 'live' },
    ];
    for (const def of t212Defs) {
      const connected = this.t212Connected(def.kind, def.category);
      const accountKey = def.kind === 'invest'
        ? (def.category === 'live' ? 'trading212-live' : 'trading212-demo')
        : def.kind === 'isa' ? 'trading212-isa' : 'trading212-cfd';
      const tot = totals.get(`trading212:${accountKey}`);
      accounts.push({
        ...def,
        broker: 'Trading212',
        enabled: await this.readEnabled(`${SETTING_PREFIX}${def.id}`),
        connected,
        value: connected ? (tot?.value ?? null) : null,
        positions: connected ? (tot?.positions ?? 0) : 0,
        currency: 'GBP',
        note: !connected ? (def.kind === 'cfd' ? 'CFD API not available' : 'No API key configured') : undefined,
      });
    }

    // ── MT5 accounts (bridge) ──
    let mt5Accounts: any[] = [];
    try {
      mt5Accounts = await Promise.race([
        this.mt5Connection.getAccounts(),
        new Promise<any[]>((resolve) => setTimeout(() => resolve([]), 3000)),
      ]);
    } catch {
      mt5Accounts = [];
    }
    if (mt5Accounts.length > 0) {
      for (const a of mt5Accounts) {
        const id = `mt5:${a.login || a.number}`;
        accounts.push({
          id,
          broker: 'MT5',
          label: `MT5 · ${a.server || a.login} (${a.login || a.number})`,
          kind: 'mt5',
          category: a.isLive ? 'live' : 'demo',
          enabled: await this.readEnabled(`${SETTING_PREFIX}${id}`),
          connected: !!a.connected,
          value: a.connected ? (a.equity ?? a.balance ?? null) : null,
          positions: 0,
          currency: a.currency || 'USD',
        });
      }
    } else {
      // Bridge down — surface MT5 from DB positions so it isn't silently hidden.
      const mt5Db = totals.get('mt5:') || totals.get('mt5:none');
      accounts.push({
        id: 'mt5:bridge',
        broker: 'MT5',
        label: 'MetaTrader 5 (bridge offline)',
        kind: 'mt5',
        category: 'demo',
        enabled: await this.readEnabled(`${SETTING_PREFIX}mt5:bridge`),
        connected: false,
        value: mt5Db?.value ?? null,
        positions: mt5Db?.positions ?? 0,
        currency: 'USD',
        note: 'Bridge not reachable — showing last synced positions',
      });
    }

    // ── Capital.com ──
    let capital: any = null;
    try {
      capital = await Promise.race([
        this.capitalAdapter.getAccount(),
        new Promise<any>((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
    } catch {
      capital = null;
    }
    const capitalMode = (capital?.mode || process.env.CAPITAL_COM_MODE || 'demo').toLowerCase();
    const capitalCategory = capitalMode === 'live' ? 'live' : 'demo';
    accounts.push({
      id: `capital:${capitalCategory}`,
      broker: 'Capital.com',
      label: `Capital.com (${capitalMode})`,
      kind: 'capital',
      category: capitalCategory as 'live' | 'demo',
      enabled: await this.readEnabled(`${SETTING_PREFIX}capital:${capitalCategory}`),
      connected: capital?.connected === true,
      value: capital?.connected ? (capital.equity ?? capital.balance ?? null) : null,
      positions: 0,
      currency: capital?.currency || 'GBP',
      note: capital?.connected ? undefined : 'Not connected',
    });

    // ── ISA value (live fetch, not in DB) ──
    if (accounts.some((a) => a.id === 't212:isa' && a.connected)) {
      try {
        const dash = await Promise.race([
          this.isaService.getDashboard(),
          new Promise<any>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        const isa = accounts.find((a) => a.id === 't212:isa')!;
        if (dash?.summary?.totalValueGbp != null) isa.value = dash.summary.totalValueGbp;
        isa.positions = dash?.positions?.length ?? 0;
      } catch {
        /* best-effort */
      }
    }

    return accounts;
  }

  // ── Overview ──────────────────────────────────────────────

  async getOverview() {
    const accounts = await this.collectAccounts();

    const categories: PortfolioCategory[] = (['live', 'demo'] as const).map((cat) => {
      const list = accounts.filter((a) => a.category === cat);
      return {
        id: cat,
        label: CATEGORY_LABELS[cat],
        enabled: false, // patched below (async)
        accounts: list,
        total: 0,
      };
    });

    for (const cat of categories) {
      cat.enabled = await this.readEnabled(`${CATEGORY_PREFIX}${cat.id}`);
    }

    for (const cat of categories) {
      cat.total = cat.accounts.reduce((sum, a) => {
        if (!cat.enabled || !a.enabled || !a.connected || a.value == null) return sum;
        return sum + a.value;
      }, 0);
    }

    const grandTotal = categories.reduce((sum, c) => sum + c.total, 0);
    return { categories, grandTotal };
  }

  /** Toggle an account or a category. `id` = account id or `cat:live` / `cat:demo`. */
  async setEnabled(id: string, enabled: boolean) {
    if (id.startsWith('cat:')) {
      const cat = id.slice(4);
      if (cat !== 'live' && cat !== 'demo') {
        return { success: false, error: `Unknown category: ${cat}` };
      }
      await this.writeEnabled(`${CATEGORY_PREFIX}${cat}`, enabled);
      return { success: true, id, enabled };
    }

    const accounts = await this.collectAccounts();
    const match = accounts.find((a) => a.id === id);
    if (!match) {
      return { success: false, error: `Unknown account: ${id}` };
    }
    await this.writeEnabled(`${SETTING_PREFIX}${id}`, enabled);
    return { success: true, id, enabled };
  }
}
