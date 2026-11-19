import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
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
  /**
   * Archived by the requirement. A removed account is still CONFIGURED (its credentials are unchanged and
   * the broker still holds it) — it is excluded from this app's lists and totals until restored.
   * Removal cannot reach into the broker, so the UI must say so rather than implying a deletion.
   */
  removed?: boolean;
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
  //
  // Each account and category is ONE `global_setting` row holding a JSON object. It carries two
  // independent facts, so it must be patched rather than rewritten: `writeEnabled()` used to
  // serialise `{ enabled }` wholesale, which would silently drop a `removed` flag the moment
  // someone toggled the account back on (and vice versa).

  private async readSetting(key: string): Promise<{ enabled?: boolean; removed?: boolean; raw?: string }> {
    try {
      if (!this.prisma.isAvailable) return {};
      const row = await (this.prisma as any).globalSetting.findUnique({ where: { key } });
      if (!row?.value) return {};
      try {
        return JSON.parse(row.value);
      } catch {
        return { raw: row.value };
      }
    } catch {
      return {};
    }
  }

  private async patchSetting(key: string, patch: { enabled?: boolean; removed?: boolean }): Promise<void> {
    if (!this.prisma.isAvailable) return;
    const current = await this.readSetting(key);
    const next: Record<string, unknown> = { ...current, ...patch };
    delete next.raw;
    const value = JSON.stringify(next);
    await (this.prisma as any).globalSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  private async readEnabled(key: string, def = true): Promise<boolean> {
    const s = await this.readSetting(key);
    if (s.enabled === undefined) return def;
    return s.enabled !== false;
  }

  private async readRemoved(key: string): Promise<boolean> {
    const s = await this.readSetting(key);
    return s.removed === true;
  }

  /**
   * readAccountFlags() — an account's toggles, honouring the PRE-RENAME key (#1205).
   *
   * ⚠️ WHY A FALLBACK RATHER THAN A MIGRATION. MT5 account ids gained the bridge
   * (`mt5:<brokerId>:<login>`) because one login can be configured on TWO bridges — measured
   * 2026-11-19, `GET /api/portfolio/accounts` returned `mt5:10011309743` twice, once per bridge.
   * Those toggles are persisted rows keyed `accounts.<id>`, so renaming the id makes every existing
   * toggle INERT without raising anything: the project's "removed" flag stops removing and an
   * excluded account silently reappears in the totals.
   *
   * A one-off rewrite would have to guess what a legacy row meant. It cannot: one legacy key
   * controlled BOTH bridges at once, so copying it to both per-bridge keys is a guess about intent
   * that happens to be right today and would be wrong the moment the two diverge. A READ fallback
   * needs no guess — the legacy value applies until the first write to the new key supersedes it,
   * and after that the new key owns the answer.
   *
   * ⚠️ The legacy row is left where it is. Deleting it is unrecoverable and buys nothing: it is read
   * only when the per-bridge key is absent, which stops being true after the first toggle.
   */
  private async readAccountFlags(
    primaryKey: string,
    legacyKey?: string,
  ): Promise<{ enabled: boolean; removed: boolean }> {
    const primary = await this.readSetting(primaryKey);
    const legacy =
      legacyKey && legacyKey !== primaryKey && primary.enabled === undefined && primary.removed === undefined
        ? await this.readSetting(legacyKey)
        : {};
    const source = primary.enabled === undefined && primary.removed === undefined ? legacy : primary;
    return {
      enabled: source.enabled === undefined ? true : source.enabled !== false,
      removed: source.removed === true,
    };
  }

  private async writeEnabled(key: string, enabled: boolean): Promise<void> {
    await this.patchSetting(key, { enabled });
  }

  // ── Account enumeration ───────────────────────────────────

  private t212Connected(kind: 'invest' | 'isa' | 'cfd', category: 'live' | 'demo'): boolean {
    if (kind === 'isa') return !!process.env.TRADING212_ISA_API_KEY;
    if (kind === 'cfd') return false; // CFD API not available yet
    // invest account — live vs demo key
    //
    // ⚠️ `TRADING212_API_KEY` IS A LIVE KEY AND THIS CHECK IGNORED IT (fixed 2026-11-18).
    // `Trading212Adapter` treats it as the live credential (`TRADING212_LIVE_API_KEY || TRADING212_API_KEY`),
    // and a direct call proved it: LIVE host + TRADING212_API_KEY returned the 17 Invest positions with
    // HTTP 200. But this method required `TRADING212_LIVE_API_KEY` ONLY, so a configured, working live
    // account reported `connected: false` with the note "No API key configured" — which then made the
    // page fall through to the DEMO account and label live holdings as "Practice (Demo)".
    //
    // Two readers of one fact (`resolveEndpoint` in the import service, this) must agree. The pairing
    // is asserted by the spec beside this file rather than trusted to stay in step.
    if (category === 'live') return !!(process.env.TRADING212_LIVE_API_KEY || process.env.TRADING212_API_KEY);
    return !!process.env.TRADING212_DEMO_API_KEY;
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
        removed: await this.readRemoved(`${SETTING_PREFIX}${def.id}`),
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
        // ── #1205 — THE ID MUST CARRY THE BRIDGE ────────────────────────────────────────────
        // Measured 2026-11-19: `GET /api/portfolio/accounts` returned six MT5 rows for three
        // logins, because the same login is configured on BOTH bridges and the id was
        // `mt5:<login>`. Consequences, all silent: duplicate React keys in Screen Options; a
        // toggle on one row flipping the same login on the other bridge; and the same toggle
        // changing the total for both.
        //
        // ⚠️ `brokerId` is optional on `Mt5Account`, and a row without it CANNOT be
        // disambiguated — so it keeps the legacy id rather than inventing `mt5:?:<login>`, which
        // would collide with any other unknown-bridge account and look unique.
        const login = a.login || a.number;
        const hasBridge = Number.isFinite(a.brokerId);
        const id = hasBridge ? `mt5:${a.brokerId}:${login}` : `mt5:${login}`;
        const legacyId = `mt5:${login}`;
        const flags = await this.readAccountFlags(`${SETTING_PREFIX}${id}`, `${SETTING_PREFIX}${legacyId}`);
        accounts.push({
          id,
          broker: 'MT5',
          label: hasBridge
            ? `MT5 · ${a.server || login} (${login}) · bridge ${a.brokerId}`
            : `MT5 · ${a.server || login} (${login})`,
          kind: 'mt5',
          category: a.isLive ? 'live' : 'demo',
          enabled: flags.enabled,
          removed: flags.removed,
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
        removed: await this.readRemoved(`${SETTING_PREFIX}mt5:bridge`),
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
      removed: await this.readRemoved(`${SETTING_PREFIX}capital:${capitalCategory}`),
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

    // ⚠️ Removed accounts are EXCLUDED from the categories and the totals, and returned separately.
    // Leaving them in place with `enabled: false` would not be equivalent: a disabled account is
    // still listed, still selectable and still described, so "removed" would look like "switched
    // off" — and the only way to tell them apart would be a flag the reader has to notice.
    const removed = accounts.filter((a) => a.removed);
    const active = accounts.filter((a) => !a.removed);

    const categories: PortfolioCategory[] = (['live', 'demo'] as const).map((cat) => {
      const list = active.filter((a) => a.category === cat);
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
    return { categories, grandTotal, removed };
  }

  /**
   * Toggle an account or a category. `id` = account id or `cat:live` / `cat:demo`.
   *
   * ⚠️ THROWS RATHER THAN RETURNING `{ success: false }` (fixed 2026-11-06, reported by the primary
   * agent). This used to return `{ success: false, error: … }` with HTTP **201 Created**, because
   * `@Post()` has no `@HttpCode` and Nest defaults POST to 201. So an UNKNOWN ACCOUNT came back as
   * `201 Created` and every caller checking `res.ok` — which is most of them — read a refusal as a
   * success. A status code is the contract; a body field is a convention each caller may not read.
   *
   * `400` for a malformed category id (the REQUEST is wrong), `404` for an account that does not
   * exist (the THING is missing) — the distinction tells the reader which side to fix.
   */
  async setEnabled(id: string, enabled: boolean) {
    if (id.startsWith('cat:')) {
      const cat = id.slice(4);
      if (cat !== 'live' && cat !== 'demo') {
        throw new BadRequestException(`Unknown account category: ${cat} (expected live or demo)`);
      }
      await this.writeEnabled(`${CATEGORY_PREFIX}${cat}`, enabled);
      return { success: true, id, enabled };
    }

    const accounts = await this.collectAccounts();
    const match = accounts.find((a) => a.id === id);
    if (!match) {
      throw new NotFoundException(`Unknown account: ${id}`);
    }
    await this.writeEnabled(`${SETTING_PREFIX}${id}`, enabled);
    return { success: true, id, enabled };
  }

  /**
   * Remove (archive) or restore an account.
   *
   * ⚠️ WHAT THIS CAN AND CANNOT DO — stated here because the UI must not overstate it:
   *   • Trading212 / Capital.com: the account is DEFINED BY CREDENTIALS in `nest/.env`. This app
   *     cannot delete a broker account, so removal means "stop showing and counting it here".
   *     The broker still holds it, the key is still in the environment, and portfolio imports will
   *     still be able to read it until that key is removed by hand.
   *   • MT5: do NOT route removal through here. An MT5 account is removed at the bridge, which
   *     rewrites the terminal's own `accounts.json` (`POST /api/providers/mt5/accounts/remove`).
   *     Archiving one here would hide a live connection while the terminal kept trading it — a
   *     plausible-looking result with no error, which is the defect class this repo designs against.
   *
   * Same contract as `setEnabled`: `400` for a malformed id, `404` for an account that is not there.
   */
  async setRemoved(id: string, removed: boolean) {
    if (id.startsWith('cat:')) {
      throw new BadRequestException(
        'A category cannot be removed — remove its accounts, or disable the category instead',
      );
    }

    const accounts = await this.collectAccounts();
    const match = accounts.find((a) => a.id === id);
    if (!match) {
      throw new NotFoundException(`Unknown account: ${id}`);
    }
    if (match.kind === 'mt5') {
      throw new BadRequestException(
        'MT5 accounts are removed at the bridge, which edits the terminal config. ' +
          'Use POST /api/providers/mt5/accounts/remove with the account number and brokerId.',
      );
    }
    await this.patchSetting(`${SETTING_PREFIX}${id}`, { removed });
    return { success: true, id, removed };
  }
}
