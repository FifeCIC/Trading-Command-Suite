import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Mt5ConnectionManager } from './mt5-connection-manager.service';

/** Result of resolving a symbol to a specific MT5 broker bridge. */
export interface ResolvedSymbolRoute {
  /** MT5 account slot (2 = MetaQuotes :5000, 3 = Pepperstone :5001, …). */
  brokerId: number;
  /** Bridge base URL for that broker. */
  url: string;
  /** Broker-native symbol name to send to the bridge (falls back to the ticker). */
  brokerSymbol: string;
  /** True when the route came from an explicit symbol_route row (vs an asset default). */
  explicit: boolean;
}

/**
 * Mt5SymbolRouter — resolves which MT5 bridge instance serves a given symbol.
 *
 * Source of truth = the `symbol_route` table (GH #747). It is loaded into an
 * in-memory map at boot and refreshed on demand, so the hot path (bar refresh,
 * per-tick scoring, quotes) resolves in O(1) with **zero DB hits**.
 *
 * Fallback order when no explicit row exists:
 *   1. asset-type default   (env `MT5_ASSET_BROKER_DEFAULTS`, e.g. "index:3,forex:2")
 *   2. primary broker       (first entry of MT5_ACTIVE_BROKERS)
 *
 * This exists so a symbol like UK100 can be sourced from Pepperstone (:5001,
 * current feed) while forex majors stay on MetaQuotes (:5000) — and it scales to
 * hundreds of symbols because routes live in a queryable table, not inline config.
 */
@Injectable()
export class Mt5SymbolRouter implements OnModuleInit {
  private readonly logger = new Logger(Mt5SymbolRouter.name);

  /** symbol(UPPER) → { brokerId, brokerSymbol } */
  private readonly routes = new Map<string, { brokerId: number; brokerSymbol: string | null }>();
  /** assetType(lower) → brokerId */
  private readonly assetDefaults = new Map<string, number>();
  private loadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conn: Mt5ConnectionManager,
  ) {
    // Parse asset-type default brokers: MT5_ASSET_BROKER_DEFAULTS="index:3,forex:2"
    const raw = process.env.MT5_ASSET_BROKER_DEFAULTS || '';
    for (const pair of raw.split(',')) {
      const [type, idStr] = pair.split(':').map((s) => s.trim());
      const id = parseInt(idStr, 10);
      if (type && !isNaN(id)) this.assetDefaults.set(type.toLowerCase(), id);
    }
  }

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  /** Load/reload all routes from the DB into the in-memory map. */
  async refresh(): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      const rows = await (this.prisma as any).symbolRoute.findMany({
        where: { enabled: true },
        orderBy: { priority: 'asc' },
      });
      this.routes.clear();
      for (const r of rows) {
        const key = String(r.symbol).toUpperCase();
        if (!this.routes.has(key)) {
          this.routes.set(key, { brokerId: Number(r.brokerId), brokerSymbol: r.brokerSymbol ?? null });
        }
      }
      this.loadedAt = Date.now();
      this.logger.log(`Mt5SymbolRouter: ${this.routes.size} explicit route(s) cached`);
    } catch (err) {
      this.logger.warn(`Mt5SymbolRouter: could not load symbol_route — using defaults (${(err as Error).message})`);
    }
  }

  /** Drop cached routes (all, or a single symbol) after a DB change. */
  invalidate(symbol?: string): void {
    if (symbol) this.routes.delete(symbol.toUpperCase());
    else this.routes.clear();
  }

  /** The primary broker (first configured) — the fallback when nothing else matches. */
  primaryBrokerId(): number {
    return this.conn.getBrokerIds()[0] ?? 2;
  }

  /** Resolve the brokerId for a symbol without building the full route. */
  getBrokerId(symbol: string, assetType?: string): number {
    const key = (symbol || '').toUpperCase();
    const explicit = this.routes.get(key);
    if (explicit) return explicit.brokerId;
    if (assetType) {
      const byType = this.assetDefaults.get(assetType.toLowerCase());
      if (byType !== undefined) return byType;
    }
    return this.primaryBrokerId();
  }

  /** Resolve a symbol to { brokerId, url, brokerSymbol } for bridge calls. */
  resolve(symbol: string, assetType?: string): ResolvedSymbolRoute {
    const key = (symbol || '').toUpperCase();
    const explicit = this.routes.get(key);
    const brokerId = this.getBrokerId(symbol, assetType);
    return {
      brokerId,
      url: this.conn.getUrl(brokerId),
      brokerSymbol: explicit?.brokerSymbol || symbol,
      explicit: explicit !== undefined,
    };
  }

  /** Map a canonical ticker to its broker-native name (identity when unmapped). */
  getBrokerSymbol(symbol: string): string {
    return this.routes.get((symbol || '').toUpperCase())?.brokerSymbol || symbol;
  }

  /** Build a route for a specific broker — used by broker-level calls (e.g. /symbols). */
  routeForBroker(brokerId: number): ResolvedSymbolRoute {
    return { brokerId, url: this.conn.getUrl(brokerId), brokerSymbol: '', explicit: false };
  }

  /** Diagnostics snapshot (for health/API surfaces). */
  snapshot(): { loadedAt: number; count: number; routes: Array<{ symbol: string; brokerId: number; brokerSymbol: string | null }> } {
    return {
      loadedAt: this.loadedAt,
      count: this.routes.size,
      routes: [...this.routes.entries()].map(([symbol, v]) => ({ symbol, brokerId: v.brokerId, brokerSymbol: v.brokerSymbol })),
    };
  }
}
