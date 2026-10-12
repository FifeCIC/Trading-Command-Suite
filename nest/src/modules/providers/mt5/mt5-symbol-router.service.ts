import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Mt5ConnectionManager } from './mt5-connection-manager.service';
import { venueForSymbol } from '../../calendar/market-patterns';

/** Result of resolving a symbol to a specific MT5 broker bridge. */
export interface ResolvedSymbolRoute {
  /** MT5 account slot (2 = MetaQuotes :5000, 3 = Pepperstone :5001, …). */
  brokerId: number;
  /**
   * Bridge base URL for that broker — **null when `mt5` is false**.
   *
   * ⚠️ #914. A route that targets a NON-MT5 broker (the four crypto rows: `provider=binance`,
   * `brokerId 0`) has no bridge behind it. Returning the DEFAULT bridge's URL here is the lie
   * that produced a BTC refusal quoting `Nasdaq\ETF\BTC`'s lot floor: `getUrl(0)` fell back to
   * MetaQuotes because `0` is falsy, and the bare ticker matched an ETF. A caller holding a
   * non-MT5 route must see `null` and refuse — never a URL to somebody else's bridge.
   */
  url: string | null;
  /** Broker-native symbol name to send to the bridge (falls back to the ticker). */
  brokerSymbol: string;
  /** True when the route came from an explicit symbol_route row (vs an asset default). */
  explicit: boolean;
  /**
   * True when the route targets an ACTIVE MT5 bridge (see `Mt5ConnectionManager.isBroker`).
   * When false there is no bridge to call and the bare ticker must never be sent anywhere.
   */
  mt5: boolean;
  /** Provider from the route row (`mt5`, `binance`, …); null when no explicit row exists. */
  provider: string | null;
}

/**
 * orderRouteProblems() — THE order-route integrity check (#903, unified #914).
 * ====================================================================
 *
 * Answers one question: **may an ORDER travel this route to MT5?** Returns the list of reasons
 * it may not (empty = allowed). It exists because MT5 resolves an order symbol BY NAME with
 * fuzzy matching: the measured hazard is the bare ticker `BTC` selecting `Nasdaq\ETF\BTC`
 * (~$35.86) — a different instrument that FILLS.
 *
 * ⚠️ ONE implementation, THREE call sites — do not fork it:
 *   1. `ExecutionFeasibilityService.assess()` — both phases, so the card explains the refusal
 *      BEFORE the click instead of the operator meeting it after.
 *   2. `Mt5Adapter.placeOrder()` — the path used by manual trades and the automation loop.
 *   3. `Mt5TradingService.placeOrder()` — the direct `/api/trading/mt5/order` path.
 *
 * `route === null` means the router itself is unavailable: crypto FAILS CLOSED (an unverifiable
 * broker-native name must never reach MT5); every other symbol keeps its established identity
 * mapping, because that fallback predates the hazard and is how single-bridge installs work.
 *
 * The non-MT5 check applies to EVERY asset class (a misroute is a misroute). The explicit-row
 * and bare-ticker rules apply to CRYPTO only — non-crypto symbols have always travelled the
 * bare ticker to their broker as the identity mapping.
 */
export function orderRouteProblems(
  symbol: string,
  route: ResolvedSymbolRoute | null,
  activeBrokerIds: number[] = [],
  /**
   * #1002 — capability lookup. `false` when the broker's OWN symbol list says it cannot trade this
   * symbol (`broker_symbol.tradeMode = 0`), `true` when it can, `undefined` when unknown.
   *
   * ⚠️ ONLY a known `false` refuses. A broker whose symbol list has never been synced must keep
   * working — treating UNKNOWN as "cannot trade" would refuse every order on a fresh install, which
   * is a worse failure than the one being fixed.
   *
   * ⚠️ `brokerSymbol` is the route's mapped broker-native name and is passed THROUGH to the lookup
   * (added 2026-10-12): `broker_symbol.name` is keyed by the BROKER's name, so a mapped route
   * (USTEC → NAS100) must ask with the mapped name or a tradeable route reports `false`.
   */
  canTrade?: (brokerId: number, symbol: string, brokerSymbol?: string | null) => boolean | undefined,
): string[] {
  const ticker = (symbol || '').toUpperCase();
  const isCrypto = venueForSymbol(ticker).kind === 'crypto';

  if (!route) {
    return isCrypto
      ? ['the MT5 symbol router is unavailable, so the broker-native name cannot be verified']
      : [];
  }

  const problems: string[] = [];

  // ⚠️ Guarded on a non-empty registry: an empty list means "no multi-broker registry exists"
  // (single-bridge installs, unit tests), where the route's brokerId IS the default bridge.
  if (activeBrokerIds.length > 0 && !activeBrokerIds.includes(route.brokerId)) {
    problems.push(
      `the route targets broker ${route.brokerId}` +
        `${route.provider ? ` (${route.provider})` : ''}, which is not an active MT5 bridge ` +
        `(active: ${activeBrokerIds.join(', ') || 'none'})`,
    );
  }

  // ── Capability (#1002) ────────────────────────────────────────────────────────────────────
  // The broker LISTS the symbol and still refuses to trade it. This is the US30 case: the symbol
  // had no `symbol_route` row, so it fell back to the primary bridge, whose own symbol list
  // reports tradeMode=0 — and the order was refused by the broker with nothing naming the real
  // reason. Measured 2026-09-25: broker 2 has 925 such symbols, broker 3 has 1.
  //
  // ⚠️ Guarded on `route.mt5`: a non-MT5 route (crypto → broker 0) is not in any MT5 symbol list,
  // so asking would return `false` and mislabel a crypto route problem as a capability problem.
  // The crypto rules above already refuse those for the right reason.
  if (route.mt5 && canTrade) {
    const allowed = canTrade(route.brokerId, ticker, route.brokerSymbol);
    if (allowed === false) {
      problems.push(
        `broker ${route.brokerId} cannot trade ${ticker} — its own symbol list reports ` +
          `tradeMode=0 (the symbol is listed with trading disabled on that broker)`,
      );
    }
  }

  if (isCrypto) {
    if (route.explicit !== true) {
      problems.push(`no explicit symbol_route row exists for ${ticker}`);
    }
    const brokerSymbol = String(route.brokerSymbol ?? '');
    if (!brokerSymbol) {
      problems.push('the symbol_route row carries no brokerSymbol');
    } else if (brokerSymbol.toUpperCase() === ticker) {
      problems.push(
        `the route's brokerSymbol is the BARE ticker '${brokerSymbol}' — MT5 resolves names ` +
          `fuzzily and '${brokerSymbol}' matches a different instrument (measured: '${brokerSymbol}' → Nasdaq\\ETF\\BTC, ~$35.86)`,
      );
    }
  }

  return problems;
}

/**
 * Mt5SymbolRouter — resolves which MT5 bridge instance serves a given symbol.
 *
 * Source of truth = the `symbol_route` table (GH #747). It is loaded into an
 * in-memory map at boot and refreshed on demand, so the hot path (bar refresh,
 * per-tick scoring, quotes) resolves in O(1) with **zero DB hits**.
 *
 * Fallback order when no explicit row exists:
 *   1. capability selection  (a broker whose OWN symbol list permits it — #1002)
 *   2. primary broker        (first entry of MT5_ACTIVE_BROKERS)
 *
 * ⚠️ A THIRD, EARLIER STEP WAS REMOVED 2026-09-25 (#1002): an asset-type → broker map read from
 * `MT5_ASSET_BROKER_DEFAULTS`. It RETURNED EARLY, before any capability consideration, so setting
 * it would route a symbol to a broker whose own list refuses it (`SYMBOL_TRADE_MODE = 0`) — the
 * exact failure #1002 exists to prevent. It was also never configured: a scan of the repo found no
 * non-comment `MT5_ASSET_BROKER_DEFAULTS=`. Dead AND a trap, so it was removed, not documented.
 * REVERSE BY: restore the map and the branch, placed AFTER the capability check.
 *
 * This exists so a symbol like UK100 can be sourced from Pepperstone (:5001,
 * current feed) while forex majors stay on MetaQuotes (:5000) — and it scales to
 * hundreds of symbols because routes live in a queryable table, not inline config.
 */
@Injectable()
export class Mt5SymbolRouter implements OnModuleInit {
  private readonly logger = new Logger(Mt5SymbolRouter.name);

  /** symbol(UPPER) → { brokerId, brokerSymbol, provider } */
  private readonly routes = new Map<string, { brokerId: number; brokerSymbol: string | null; provider: string | null }>();

  /**
   * SYMBOL → the brokerIds whose OWN symbol list says they can trade it (#1002).
   *
   * Source: `broker_symbol.tradeMode`. `tradeMode = 0` means the broker LISTS the symbol and still
   * refuses to trade it.
   *
   * ⚠️ This is what lets the router answer "can this broker trade this symbol?" instead of
   * assuming the fallback broker can. Before it, an unrouted symbol went to `primaryBrokerId()` and
   * the broker refused the order — the US30 story, recorded verbatim in that row's own `note` as
   * "silent fallback to :5000, tradeMode 0".
   */
  private readonly tradeableOn = new Map<string, Set<number>>();

  /**
   * True once `broker_symbol` has been read. Absent data must read as UNKNOWN, never as "no".
   * A capability that has not loaded is not a capability that says no — conflating them would
   * refuse every order on a fresh install.
   */
  private capabilityLoaded = false;
  private loadedAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly conn: Mt5ConnectionManager,
  ) {
    // NOTE: an asset-type → broker default map (`MT5_ASSET_BROKER_DEFAULTS`) was parsed here until
    // 2026-09-25 (#1002). It was removed — see the class docstring: it returned EARLY, bypassing the
    // capability check, and was never configured. Nothing to parse means no constructor work here.
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
          this.routes.set(key, {
            brokerId: Number(r.brokerId),
            brokerSymbol: r.brokerSymbol ?? null,
            provider: r.provider != null ? String(r.provider) : null,
          });
        }
      }
      this.loadedAt = Date.now();
      this.logger.log(`Mt5SymbolRouter: ${this.routes.size} explicit route(s) cached`);

      // ── Capability (#1002) ──────────────────────────────────────────────────────────────────
      // Loaded alongside the routes so it shares their freshness: a capability outliving a
      // symbol-list refresh is exactly the stale-but-plausible figure this repo keeps finding.
      // ⚠️ Failure here must NOT break routing. It only means the questions below answer
      // "unknown", which is the pre-#1002 behaviour — hence a scoped catch rather than letting it
      // fall into the outer one, where it would look like a `symbol_route` failure.
      try {
        const rows: Array<{ brokerId: number; name: string }> = await (this.prisma as any).brokerSymbol.findMany({
          where: { tradeMode: { not: 0 } },
          select: { brokerId: true, name: true },
        });
        this.tradeableOn.clear();
        for (const r of rows) {
          const key = String(r.name).toUpperCase();
          let set = this.tradeableOn.get(key);
          if (!set) {
            set = new Set<number>();
            this.tradeableOn.set(key, set);
          }
          set.add(Number(r.brokerId));
        }
        this.capabilityLoaded = true;
        this.logger.log(
          `Mt5SymbolRouter: ${this.tradeableOn.size} tradeable symbol(s) cached across ` +
            `${new Set(rows.map((r) => Number(r.brokerId))).size} broker(s) (#1002)`,
        );
      } catch (err) {
        this.capabilityLoaded = false;
        this.logger.warn(
          'Mt5SymbolRouter: could not load broker_symbol capability — capability stays UNKNOWN ' +
            `(never assumed tradeable) (${(err as Error).message})`,
        );
      }
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

  /**
   * Every active broker slot, in declaration order (`MT5_ACTIVE_BROKERS`).
   *
   * WHY (#883): the adapter needs to ask EACH bridge for its positions. Without this, a
   * provider-wide call resolved to the default bridge only, so a second broker's positions were
   * absent from every snapshot — and `position-sync` closes any open trade absent from the
   * snapshot. The result was one broker's sync closing the other broker's live trades.
   */
  brokerIds(): number[] {
    return this.conn.getBrokerIds();
  }

  /**
   * Resolve the brokerId for a symbol without building the full route.
   *
   * ⚠️ `assetType` IS RETAINED IN THE SIGNATURE BUT NO LONGER SELECTS A BROKER (2026-09-25, #1002).
   * It used to consult an `MT5_ASSET_BROKER_DEFAULTS` map and return EARLY — before any capability
   * consideration — so setting it could route a symbol to a broker whose own symbol list refuses it.
   * It was also never configured anywhere. The parameter stays because `resolve()` and its callers
   * pass it, and removing it would ripple for no benefit.
   * REVERSE BY: restore the map and the branch, placed AFTER the capability check.
   */
  getBrokerId(symbol: string, assetType?: string): number {
    void assetType; // no longer selects a broker — see note above
    const key = (symbol || '').toUpperCase();
    const explicit = this.routes.get(key);
    if (explicit) return explicit.brokerId;
    return this.primaryBrokerId();
  }

  /**
   * Can `brokerId` trade `symbol`, per `broker_symbol`? (#1002)
   *
   * `undefined` = UNKNOWN (no capability data loaded). `false` = the broker's own list says no.
   * The distinction is the whole point: unknown must not be read as a refusal.
   *
   * ⚠️ `brokerSymbol` IS THE BROKER-NATIVE NAME AND IT MUST BE PASSED WHEN THE ROUTE MAPS ONE
   * (added 2026-10-12). `tradeableOn` is keyed by `broker_symbol.name` — the BROKER's name, not
   * the canonical ticker — so `canTradeOn(3, 'USTEC')` finds nothing (broker 3 lists `NAS100`)
   * and returns a DEFINITE `false` for a route that is fully tradeable. Latent since #1002 because
   * every route until then had brokerSymbol == ticker; **USTEC → broker 3 / `NAS100` is the first
   * mapped route**, and it was refused on sight.
   */
  canTradeOn(brokerId: number, symbol: string, brokerSymbol?: string | null): boolean | undefined {
    if (!this.capabilityLoaded) return undefined;
    const key = (brokerSymbol || symbol || '').toUpperCase();
    const set = this.tradeableOn.get(key);
    // Loaded, and NO broker lists it — so it cannot be traded on any configured bridge.
    if (!set) return false;
    return set.has(brokerId);
  }

  /** Active brokers that can trade `symbol`, in `MT5_ACTIVE_BROKERS` order. `null` = unknown. */
  tradeableBrokers(symbol: string): number[] | null {
    if (!this.capabilityLoaded) return null;
    const set = this.tradeableOn.get((symbol || '').toUpperCase());
    if (!set) return [];
    return this.brokerIds().filter((id) => set.has(id));
  }

  /**
   * `resolve()` for an ORDER (#1002).
   *
   * Identical to `resolve()` except that, when an UNROUTED symbol's default broker is known to be
   * unable to trade it, it prefers an active bridge that can. An explicit `symbol_route` row is
   * never second-guessed — a row records a capability fact someone verified by hand, and the whole
   * point of this change is that facts like that should not have to be hand-maintained.
   *
   * ⚠️ Deliberately NOT folded into `resolve()`: that method also serves bars and quotes, where the
   * question is which broker has the better FEED. Changing data routing to fix an execution problem
   * would be a silent behaviour change in a path that has nothing to do with this defect.
   */
  resolveForOrder(symbol: string, assetType?: string): ResolvedSymbolRoute {
    const base = this.resolve(symbol, assetType);
    if (base.explicit) return base;

    const tradeable = this.tradeableBrokers(symbol);
    // `null` = capability unknown → keep the established route. `[]` = nobody can trade it → also
    // keep it, so the order-route check produces a NAMED refusal instead of a send the broker
    // will reject for reasons the operator has to go and find.
    if (tradeable === null || tradeable.includes(base.brokerId)) return base;
    const alternate = tradeable[0];
    if (alternate === undefined) return base;

    this.logger.warn(
      `Mt5SymbolRouter: ${String(symbol).toUpperCase()} defaults to broker ${base.brokerId}, which ` +
        `reports tradeMode=0 for it — routing the ORDER to broker ${alternate} instead (#1002)`,
    );
    return {
      ...this.routeForBroker(alternate),
      brokerSymbol: base.brokerSymbol,
      explicit: false,
      provider: base.provider,
    };
  }

  /** Resolve a symbol to { brokerId, url, brokerSymbol } for bridge calls. */
  resolve(symbol: string, assetType?: string): ResolvedSymbolRoute {
    const key = (symbol || '').toUpperCase();
    const explicit = this.routes.get(key);
    const brokerId = this.getBrokerId(symbol, assetType);
    // ⚠️ #914 — only an ACTIVE MT5 bridge may be addressed. This used to call getUrl(brokerId)
    // unconditionally, and getUrl's `brokerId && …` test treated `0` (the crypto/binance rows)
    // as "not specified", answering with the DEFAULT bridge. That is how a binance-routed BTC
    // was measured against a Nasdaq ETF quoted on MetaQuotes.
    const mt5 = this.conn.isBroker(brokerId);
    return {
      brokerId,
      url: mt5 ? this.conn.getUrl(brokerId) : null,
      brokerSymbol: explicit?.brokerSymbol || symbol,
      explicit: explicit !== undefined,
      mt5,
      provider: explicit?.provider ?? null,
    };
  }

  /** Map a canonical ticker to its broker-native name (identity when unmapped). */
  getBrokerSymbol(symbol: string): string {
    return this.routes.get((symbol || '').toUpperCase())?.brokerSymbol || symbol;
  }

  /** Build a route for a specific broker — used by broker-level calls (e.g. /symbols). */
  routeForBroker(brokerId: number): ResolvedSymbolRoute {
    const mt5 = this.conn.isBroker(brokerId);
    return {
      brokerId,
      url: mt5 ? this.conn.getUrl(brokerId) : null,
      brokerSymbol: '',
      explicit: false,
      mt5,
      provider: mt5 ? 'mt5' : null,
    };
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
