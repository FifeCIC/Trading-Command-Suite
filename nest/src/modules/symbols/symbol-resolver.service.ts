/**
 * SymbolResolverService
 * =====================
 * Shared symbol resolution for all subsystems — news import, bar refresh,
 * scoring pipeline, and automation loop.  Replaces the scattered,
 * per-service resolution logic with a single injectable service.
 *
 * ── Tier System ───────────────────────────────────────────────────
 *
 *   positions         Open positions from all brokers
 *   active-strategies Symbols from active TradingStrategy records
 *   active-protocols  Symbols from symbol-protocol assignments
 *   watchlist-starred Symbols in watchlists linked to active strategies
 *   macro             Global market proxy symbols (SPY, QQQ, VIX, etc.)
 *   sector            Sector-representative ETFs
 *   forex-floor       Always-needed forex/CFD pairs for directive ops
 *   all-active        Every active Symbol row in the DB (optionally capped)
 *
 * ── Feature Mapping ───────────────────────────────────────────────
 *
 *   news         → positions + active-protocols + macro + sector + all-active
 *   bar-refresh  → positions + active-strategies + forex-floor
 *   scoring      → active-strategies (symbolFilter passed to rankAll)
 *   automation   → positions + active-strategies + watchlist-starred
 *
 * Every method accepts an optional `limit` to cap the returned set.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { deriveSingleSymbolFromSlug, WATCHLIST_HINTS } from '../scoring/protocol-db.service';

// ── Static reference lists ────────────────────────────────────────

/** Macro/global market proxy symbols — always relevant regardless of positions. */
export const MACRO_SYMBOLS = [
  'SPY', 'QQQ', 'IWM', 'DIA',        // US equity indices
  'TLT', 'SHY', 'LQD', 'HYG',        // bonds / credit
  'GLD', 'SLV', 'USO', 'UNG',        // commodities
  'UUP', 'FXY',                       // currencies
  'VIX',                              // volatility
];

/** Sector-representative ETFs for broad sector coverage. */
export const SECTOR_SYMBOLS = [
  'XLK', 'XLF', 'XLE', 'XLV', 'XLI', // tech, financials, energy, healthcare, industrials
  'XLY', 'XLP', 'XLB', 'XLU', 'XLRE', // consumer disc, staples, materials, utilities, real estate
  'SMH', 'SOXX',                      // semiconductors
  'IBB', 'XBI',                       // biotech
];

/** Forex/CFD floor — always needed for directive operation regardless of positions. */
export const FOREX_FLOOR = ['EURUSD', 'GBPUSD', 'USDCAD', 'XAUUSD', 'US500'];

// ── Types ─────────────────────────────────────────────────────────

export type SymbolTier =
  | 'positions'
  | 'active-strategies'
  | 'active-protocols'
  | 'protocol-symbols'
  | 'watchlist-starred'
  | 'macro'
  | 'sector'
  | 'forex-floor'
  | 'all-active';

export type ResolutionFeature = 'news' | 'bar-refresh' | 'scoring' | 'automation';

export interface SymbolSelection {
  symbols: string[];
  tiers: SymbolTier[];
  limit: number;
  reason: string;
}

// ── Service ───────────────────────────────────────────────────────

@Injectable()
export class SymbolResolverService {
  private readonly logger = new Logger(SymbolResolverService.name);

  /** Default cap when no explicit limit is given. */
  private static readonly DEFAULT_LIMIT = 200;

  constructor(private readonly prisma: PrismaService) {}

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Resolve symbols for a single tier.
   * The tier name matches the internal resolution method.
   */
  async getSymbolsByTier(tier: SymbolTier, limit?: number): Promise<string[]> {
    const symbols = await this.resolveTier(tier);
    return this.applyLimit(symbols, limit);
  }

  /**
   * Resolve symbols for a named feature (news, bar-refresh, scoring, automation).
   * Returns a SymbolSelection with metadata suitable for debugging.
   */
  async getSymbolsForFeature(
    feature: ResolutionFeature,
    limit?: number,
  ): Promise<SymbolSelection> {
    const tiers = FEATURE_TIER_MAP[feature];
    const symbolSet = new Set<string>();

    for (const tier of tiers) {
      const symbols = await this.resolveTier(tier);
      for (const s of symbols) symbolSet.add(s);
    }

    const capped = this.applyLimit([...symbolSet], limit);

    return {
      symbols: capped,
      tiers,
      limit: limit ?? SymbolResolverService.DEFAULT_LIMIT,
      reason: `Feature "${feature}" → tiers [${tiers.join(', ')}] → ${capped.length} symbols`,
    };
  }

  /**
   * Convenience: resolve all tiers combined, deduplicated, with an optional cap.
   */
  async getAllSymbols(limit?: number): Promise<string[]> {
    const allTiers: SymbolTier[] = [
      'positions',
      'active-strategies',
      'active-protocols',
      'watchlist-starred',
      'macro',
      'sector',
      'forex-floor',
    ];
    const symbolSet = new Set<string>();
    for (const tier of allTiers) {
      const symbols = await this.resolveTier(tier);
      for (const s of symbols) symbolSet.add(s);
    }
    return this.applyLimit([...symbolSet], limit);
  }

  // ── Tier resolvers ──────────────────────────────────────────────

  private async resolveTier(tier: SymbolTier): Promise<string[]> {
    switch (tier) {
      case 'positions':
        return this.resolvePositions();
      case 'active-strategies':
        return this.resolveActiveStrategies();
      case 'active-protocols':
        return this.resolveActiveProtocols();
      case 'protocol-symbols':
        return this.resolveProtocolSymbols();
      case 'watchlist-starred':
        return this.resolveWatchlistStarred();
      case 'macro':
        return [...MACRO_SYMBOLS];
      case 'sector':
        return [...SECTOR_SYMBOLS];
      case 'forex-floor':
        return [...FOREX_FLOOR];
      case 'all-active':
        return this.resolveAllActive();
      default:
        return [];
    }
  }

  /**
   * Tier: symbols active protocols resolve — mirrors ProtocolDbService.resolveSymbols
   * paths without a scoring-module dependency: assignments → watchlist.protocolId
   * → single-symbol/named-watchlist hints from protocol-db.service (#665).
   * This is what keeps protocol symbols fed with market bars.
   */
  private async resolveProtocolSymbols(): Promise<string[]> {
    const set = new Set<string>();
    try {
      if (!this.prisma.isAvailable) return [];
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, slug FROM protocol WHERE active = 1`,
      );
      const slugs: string[] = rows.map((r: any) => r.slug).filter(Boolean);
      if (!slugs.length) return [];
      // DB rows key protocol refs by UUID (FK) while the loop passes slugs — match
      // BOTH forms or the DB paths never hit and everything falls back to the
      // hard-coded derivation hints below (#747).
      const ids: string[] = rows.map((r: any) => r.id).filter(Boolean);
      const candidates = [...new Set([...ids, ...slugs])];
      const ph = candidates.map(() => '?').join(',');

      // Path 1 — symbol-protocol assignments
      try {
        const assigns: any[] = await (this.prisma as any).$queryRawUnsafe(
          `SELECT symbol FROM symbol_protocol_assignment WHERE protocolId IN (${ph})`,
          ...candidates,
        );
        for (const a of assigns) set.add(String(a.symbol).toUpperCase());
      } catch { /* table may not exist */ }

      // Path 2 — watchlist linked via watchlist.protocolId
      try {
        const wls: any[] = await (this.prisma as any).$queryRawUnsafe(
          `SELECT symbols FROM watchlist WHERE protocolId IN (${ph})`,
          ...candidates,
        );
        for (const w of wls) this.collectWatchlistSymbols(w.symbols, set);
      } catch { /* column may not exist */ }

      // Path 3 — derivation hints (shared with ProtocolDbService)
      for (const slug of slugs) {
        const single = deriveSingleSymbolFromSlug(slug);
        if (single) set.add(single);
        for (const hint of WATCHLIST_HINTS) {
          if (slug.toLowerCase().includes(hint.match)) {
            await this.collectNamedWatchlist(hint.watchlist, set);
            break;
          }
        }
      }
    } catch { /* best effort */ }
    return [...set];
  }

  /** Parse a watchlist `symbols` JSON value into tickers. */
  private collectWatchlistSymbols(symbolsRaw: any, set: Set<string>): void {
    try {
      const parsed = typeof symbolsRaw === 'string' ? JSON.parse(symbolsRaw) : symbolsRaw;
      if (!Array.isArray(parsed)) return;
      for (const s of parsed) {
        const ticker = typeof s === 'string' ? s : s?.ticker || s?.symbol;
        if (ticker) set.add(String(ticker).toUpperCase());
      }
    } catch { /* best effort */ }
  }

  /** Resolve a named watchlist (fuzzy match, same query as ProtocolDbService). */
  private async collectNamedWatchlist(name: string, set: Set<string>): Promise<void> {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT symbols FROM watchlist WHERE LOWER(REPLACE(REPLACE(name, '-', ' '), '_', ' ')) = LOWER(REPLACE(REPLACE(?, '-', ' '), '_', ' ')) LIMIT 1`,
        name,
      );
      if (rows[0]) this.collectWatchlistSymbols(rows[0].symbols, set);
    } catch { /* best effort */ }
  }

  /** Tier: open positions across all brokers. */
  private async resolvePositions(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) return [];
      const positions = await this.prisma.position.findMany({
        select: { symbol: true },
        distinct: ['symbol'],
      });
      return positions.map(p => p.symbol.toUpperCase());
    } catch {
      return [];
    }
  }

  /** Tier: symbols from active TradingStrategy records. */
  private async resolveActiveStrategies(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) return [];
      const strategies = await (this.prisma as any).tradingStrategy.findMany({
        where: { active: true },
        select: { symbol: true },
      });
      return strategies.map((s: any) => s.symbol.toUpperCase());
    } catch {
      return [];
    }
  }

  /** Tier: symbols assigned to active protocols via symbolProtocolAssignment. */
  private async resolveActiveProtocols(): Promise<string[]> {
    const set = new Set<string>();
    try {
      if (!this.prisma.isAvailable) return [];
      // symbol-protocol assignments
      const assignments = await (this.prisma as any).symbolProtocolAssignment.findMany({
        select: { symbol: true },
        distinct: ['symbol'],
      });
      for (const a of assignments) set.add(a.symbol.toUpperCase());
    } catch {
      // table may not exist
    }

    // Also pull symbols from watchlists (broad protocol coverage)
    try {
      const watchlists = await this.prisma.watchlist.findMany({
        select: { symbols: true },
      });
      for (const w of watchlists) {
        const syms = (w.symbols as any[]) || [];
        for (const s of syms) {
          if (typeof s === 'string') set.add(s.toUpperCase());
          if (typeof s === 'object' && s?.ticker) set.add(s.ticker.toUpperCase());
        }
      }
    } catch {
      // no watchlists
    }

    // Exclude positions (they're their own tier)
    try {
      const positions = await this.prisma.position.findMany({
        select: { symbol: true },
        distinct: ['symbol'],
      });
      for (const p of positions) set.delete(p.symbol.toUpperCase());
    } catch { /* ok */ }

    return [...set].sort();
  }

  /** Tier: symbols from watchlists that are linked to active scoring strategies. */
  private async resolveWatchlistStarred(): Promise<string[]> {
    const set = new Set<string>();
    try {
      if (!this.prisma.isAvailable) return [];

      // Get watchlist names from active scoring strategies
      const strats = await (this.prisma as any).scoringStrategy.findMany({
        where: { active: true },
        select: { watchlistName: true },
      });
      const wlNames = [...new Set(strats.map((s: any) => s.watchlistName).filter(Boolean))];

      for (const name of wlNames as string[]) {
        const rows = await this.prisma.$queryRawUnsafe<Array<{ symbols: string }>>(
          `SELECT symbols FROM watchlist WHERE LOWER(REPLACE(REPLACE(name, '-', ' '), '_', ' ')) = ? LIMIT 1`,
          name.toLowerCase().replace(/[-_]/g, ' '),
        );
        if (rows.length > 0 && rows[0].symbols) {
          const syms = typeof rows[0].symbols === 'string'
            ? JSON.parse(rows[0].symbols)
            : rows[0].symbols;
          if (Array.isArray(syms)) {
            for (const s of syms) {
              const ticker = typeof s === 'string' ? s : s?.ticker || s?.symbol;
              if (ticker) set.add(ticker.toUpperCase());
            }
          }
        }
      }
    } catch {
      // fallback: try JSON file (matching automation loop behavior)
    }

    return [...set].sort();
  }

  /** Tier: every Symbol row marked active in the DB. */
  private async resolveAllActive(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) return [];
      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });
      return symbols.map(s => s.ticker.toUpperCase()).sort();
    } catch {
      return [];
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private applyLimit(symbols: string[], limit?: number): string[] {
    const cap = limit && limit > 0 ? limit : SymbolResolverService.DEFAULT_LIMIT;
    if (symbols.length <= cap) return symbols.sort();
    this.logger.debug(`Capping symbols from ${symbols.length} → ${cap}`);
    return symbols.slice(0, cap).sort();
  }
}

// ── Feature → Tier mapping ────────────────────────────────────────

const FEATURE_TIER_MAP: Record<ResolutionFeature, SymbolTier[]> = {
  'news':         ['positions', 'active-protocols', 'macro', 'sector', 'all-active'],
  'bar-refresh':  ['positions', 'active-strategies', 'forex-floor', 'protocol-symbols'],
  'scoring':      ['active-strategies'],
  'automation':   ['positions', 'active-strategies', 'watchlist-starred'],
};
