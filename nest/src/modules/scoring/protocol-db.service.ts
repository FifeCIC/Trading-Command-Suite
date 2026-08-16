/**
 * ProtocolDbService — DB-backed protocol lookup replacing hardcoded PROTOCOL_REGISTRY.
 *
 * Caches protocol configs for the duration of a tick (cleared per tick).
 * Returns the same DirectiveGroup[] shape as PROTOCOL_REGISTRY so consumers
 * don't need to change their interfaces.
 *
 * Phase D.1 of META.Stack DB-driven refactor.
 */

import { Injectable, Logger, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectiveGroup } from '../directives/directive-groups';
import { DirectivesService } from '../directives/directives.service';
import { PROTOCOL_SEED_DATA } from './protocols-seed-data';

export interface ProtocolConfig {
  groups: DirectiveGroup[];
  name: string;
  description: string;
  active?: boolean;
  directionMode?: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH';
  tradingStyle?: string;
  recommendedTimeframe?: string;
  derivedFrom?: string | null;
  avgHoldTime?: string;
  winRateTarget?: string;
  idealFor?: string;
  seasonalAffinity?: any;
  /** How to resolve symbols for this protocol. If absent, derived from protocol ID. */
  symbolResolution?: { type: 'single'; symbol: string } | { type: 'watchlist'; name: string };
}

@Injectable()
export class ProtocolDbService implements OnModuleInit {
  private readonly logger = new Logger(ProtocolDbService.name);
  private cache = new Map<string, ProtocolConfig | null>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => DirectivesService))
    private readonly directivesService: DirectivesService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Preload in background — don't block startup
    this.preloadAll().catch((err) => {
      this.logger.warn(`Background protocol preload failed: ${(err as Error).message}`);
    });
  }

  /**
   * Compute the maximum bar requirement across all directives in this protocol.
   * Returns a map of timeframe → minimum bar count needed.
   *
   * For example, if a protocol has directives needing { '1d': 25 }, { '1d': 72 },
   * and { '1d': 16, '4h': 50 }, the result is { '1d': 72, '4h': 50 }.
   *
   * Used by the automation loop and manual scoring to dynamically size bar fetches.
   */
  getRequiredBars(protocolSlug: string): Record<string, number> {
    const cache = this.getAllCached();
    const protocol = cache[protocolSlug];
    if (!protocol) return { '1d': 100 }; // default fallback

    const required: Record<string, number> = {};

    // Collect all directive IDs across all groups in this protocol
    const allDirectiveIds = new Set<string>();
    for (const group of protocol.groups) {
      for (const did of group.directiveIds) {
        allDirectiveIds.add(did);
      }
    }

    // For each directive, look up its minBars and compute the max per timeframe
    for (const did of allDirectiveIds) {
      const directive = this.directivesService.get(did);
      if (!directive?.minBars) continue;

      for (const [tf, count] of Object.entries(directive.minBars)) {
        required[tf] = Math.max(required[tf] || 0, count);
      }
    }

    // Return defaults if nothing collected
    if (Object.keys(required).length === 0) {
      return { '1d': 100 };
    }

    return required;
  }

  /** Clear the cache at start of each tick. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Resolve which symbols a protocol scores. Three paths, in priority order:
   * 1. Database: SymbolProtocolAssignment records (single-symbol assignments)
   * 2. Database: Watchlist linked via watchlist_id on protocol
   * 3. Auto-derived from protocol ID (fallback)
   */
  async resolveSymbols(protocolId: string): Promise<string[]> {
    // Path 1: DB — SymbolProtocolAssignment records
    try {
      const assignments = await (this.prisma as any).symbolProtocolAssignment.findMany({
        where: { protocolId },
        select: { symbol: true },
      });
      if (assignments?.length > 0) {
        return assignments.map((a: any) => a.symbol.toUpperCase());
      }
    } catch { /* table may not exist yet */ }

    // Path 2: DB — Watchlist linked to this protocol
    try {
      const wl = await (this.prisma as any).watchlist.findFirst({
        where: { protocolId },
        select: { symbols: true },
      });
      if (wl?.symbols) {
        const parsed = typeof wl.symbols === 'string' ? JSON.parse(wl.symbols) : wl.symbols;
        if (Array.isArray(parsed)) {
          return parsed.map((s: any) => typeof s === 'string' ? s.toUpperCase() : (s.ticker || s.symbol || '').toUpperCase()).filter(Boolean);
        }
      }
    } catch { /* table may not exist yet */ }

    // Path 3: Auto-derived from protocol ID
    return this.deriveSymbolsFromId(protocolId);
  }

  /** Auto-derive symbols from a protocol ID when no explicit config exists. */
  private async deriveSymbolsFromId(protocolId: string): Promise<string[]> {
    const id = protocolId.toLowerCase();

    // Single-symbol protocols — obvious from their name
    if (id.includes('btc')) return ['BTCUSD'];
    if (id.includes('xau') || id.includes('gold')) return ['XAUUSD'];
    if (id.includes('oil')) return ['USOIL'];
    if (id.includes('spy') || id.includes('spx')) return ['SPY'];
    if (id.includes('qqq')) return ['QQQ'];
    if (id.includes('dow')) return ['US30'];
    if (id.includes('ftse')) return ['UK100'];
    if (id.includes('tsla')) return ['TSLA'];
    if (id.includes('doge')) return ['DOGEUSD'];
    if (id.includes('china')) return ['CHN50'];
    if (id.includes('vix')) return ['VIX'];

    // Multi-symbol protocols — linked to named watchlists
    if (id.includes('forex') || id.includes('session') || id.includes('dxy')) {
      return this.getWatchlistSymbols('forex-majors');
    }
    if (id.includes('momentum')) {
      return this.getWatchlistSymbols('momentum-stocks');
    }
    if (id.includes('pandemic')) {
      return this.getWatchlistSymbols('pandemics');
    }
    if (id.includes('leverage')) {
      return this.getWatchlistSymbols('leverage');
    }

    // Fallback: try a watchlist with matching name
    const wlSymbols = await this.getWatchlistSymbols(protocolId);
    if (wlSymbols.length > 0) return wlSymbols;

    return [];
  }

  /** Get symbols from a watchlist by name (fuzzy match). */
  private async getWatchlistSymbols(name: string): Promise<string[]> {
    try {
      const wl: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT symbols FROM watchlist WHERE LOWER(REPLACE(REPLACE(name, '-', ' '), '_', ' ')) = LOWER(REPLACE(REPLACE(?, '-', ' '), '_', ' ')) LIMIT 1`,
        name,
      );
      if (wl.length > 0 && wl[0].symbols) {
        const parsed = typeof wl[0].symbols === 'string' ? JSON.parse(wl[0].symbols) : wl[0].symbols;
        if (Array.isArray(parsed)) {
          return parsed.map((s: any) => typeof s === 'string' ? s.toUpperCase() : (s.ticker || s.symbol || '').toUpperCase()).filter(Boolean);
        }
      }
    } catch { /* best effort */ }
    return [];
  }

  /**
   * Find a protocol by slug. Returns the same shape as PROTOCOL_REGISTRY[slug].
   * Falls back to hardcoded registry if DB is unavailable.
   */
  async findBySlug(slug: string): Promise<ProtocolConfig | undefined> {
    // Check cache first
    const cached = this.cache.get(slug);
    if (cached !== undefined) return cached ?? undefined;

    try {
      if (!this.prisma.isAvailable) {
        this.cache.set(slug, null);
        return undefined;
      }

      const protocol = await (this.prisma as any).protocol.findUnique({
        where: { slug },
        include: {
          directiveGroups: {
            orderBy: { sortOrder: 'asc' },
            include: {
              directives: true,
            },
          },
        },
      });

      if (!protocol) {
        this.cache.set(slug, null);
        this.logger.warn(`Protocol "${slug}" not found in DB`);
        return undefined;
      }

      // Map DB shape → DirectiveGroup[] shape
      const groups: DirectiveGroup[] = protocol.directiveGroups.map((dg: any) => {
        const directiveMaxScores: Record<string, number> = {};
        const directiveIds: string[] = [];

        for (const entry of dg.directives) {
          directiveIds.push(entry.directiveId);
          if (entry.maxScore !== 100) {
            directiveMaxScores[entry.directiveId] = entry.maxScore;
          }
        }

        return {
          id: dg.groupId,
          name: dg.name,
          description: dg.description ?? '',
          weight: dg.weight,
          isRiskGate: dg.isRiskGate,
          minMultiplier: dg.minMultiplier,
          maxMultiplier: dg.maxMultiplier,
          directiveIds,
          ...(Object.keys(directiveMaxScores).length > 0 ? { directiveMaxScores } : {}),
        };
      });

      const config: ProtocolConfig = {
        groups,
        name: protocol.name,
        description: protocol.description ?? '',
        directionMode: (protocol.directionMode as 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH') || 'LONG_ONLY',
        tradingStyle: protocol.tradingStyle ?? undefined,
        recommendedTimeframe: protocol.recommendedTimeframe ?? undefined,
        derivedFrom: protocol.derivedFrom ?? null,
        avgHoldTime: protocol.avgHoldTime ?? undefined,
        winRateTarget: protocol.winRateTarget ?? undefined,
        idealFor: protocol.idealFor ?? undefined,
        seasonalAffinity: protocol.seasonalAffinity ?? undefined,
      };

      this.cache.set(slug, config);
      return config;
    } catch (err) {
      this.logger.warn(`Protocol DB lookup failed for "${slug}": ${(err as Error).message}`);
      this.cache.set(slug, null);
      return undefined;
    }
  }

  /**
   * Get all protocol slugs. Falls back to hardcoded registry keys.
   */
  async getAllSlugs(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) return [];
      const protocols = await (this.prisma as any).protocol.findMany({ select: { slug: true } });
      return protocols.map((p: any) => p.slug);
    } catch {
      return [];
    }
  }

  /**
   * Get all protocol configs. DB-first, falls back to hardcoded registry.
   * Used by controllers that need to iterate all protocols.
   */
  async getAllProtocols(): Promise<Record<string, ProtocolConfig>> {
    try {
      if (!this.prisma.isAvailable) return {};
      const dbProtocols = await (this.prisma as any).protocol.findMany({
        include: {
          directiveGroups: {
            orderBy: { sortOrder: 'asc' },
            include: { directives: true },
          },
        },
      });
      if (!dbProtocols?.length) return {};

      // Read active status via raw SQL — Prisma client may not have the column yet
      let activeMap: Record<string, boolean> = {};
      try {
        const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
          `SELECT slug, active FROM protocol`
        );
        for (const r of rows) activeMap[r.slug] = !!r.active;
      } catch { /* column may not exist yet */ }

      const result: Record<string, ProtocolConfig> = {};
      for (const p of dbProtocols) {
        result[p.slug] = {
          groups: p.directiveGroups.map((dg: any) => ({
            id: dg.groupId,
            name: dg.name,
            description: dg.description ?? '',
            weight: dg.weight,
            isRiskGate: dg.isRiskGate,
            minMultiplier: dg.minMultiplier,
            maxMultiplier: dg.maxMultiplier,
            directiveIds: dg.directives.map((e: any) => e.directiveId),
            directiveMaxScores: Object.fromEntries(
              dg.directives.filter((e: any) => e.maxScore !== 100).map((e: any) => [e.directiveId, e.maxScore])
            ),
          })),
          name: p.name,
          description: p.description ?? '',
          active: activeMap[p.slug] ?? true, // Raw SQL read — Prisma client may not have column
          directionMode: (p.directionMode as any) || 'LONG_ONLY',
          tradingStyle: p.tradingStyle ?? undefined,
          recommendedTimeframe: p.recommendedTimeframe ?? undefined,
          derivedFrom: p.derivedFrom ?? null,
          avgHoldTime: p.avgHoldTime ?? undefined,
          winRateTarget: p.winRateTarget ?? undefined,
          idealFor: p.idealFor ?? undefined,
          seasonalAffinity: p.seasonalAffinity ?? undefined,
        };
      }
      return result;
    } catch (err) {
      this.logger.warn(`getAllProtocols failed: ${(err as Error).message}`);
      return {};
    }
  }

  /**
   * Sync access to all protocols via preloaded cache.
   * Call preloadAll() at startup before using this.
   */
  private preloadedCache: Record<string, ProtocolConfig> | null = null;

  /** Preload all protocols into a sync-accessible cache. Call once at startup. */
  async preloadAll(): Promise<void> {
    this.preloadedCache = await this.getAllProtocols();
    this.logger.log(`Preloaded ${Object.keys(this.preloadedCache).length} protocols into sync cache`);
  }

  /** Sync lookup — returns from preloaded cache. */
  getCached(slug: string): ProtocolConfig | undefined {
    if (this.preloadedCache) return this.preloadedCache[slug];
    return undefined;
  }

  /** Sync access to all cached protocols. */
  getAllCached(): Record<string, ProtocolConfig> {
    if (this.preloadedCache) return this.preloadedCache;
    return {};
  }

  /**
   * Get all ACTIVE protocols as a flat list of slugs.
   * Used by the automation loop to iterate protocols for direct scoring
   * (NOT via scoring strategies — see DEVELOPMENT PHASE note in automation-loop.service.ts).
   *
   * Returns active slugs. Falls back to all cached slugs if DB is unavailable.
   */
  async findAllActive(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) {
        // Fallback: all cached protocols
        return Object.keys(this.getAllCached());
      }
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT slug FROM protocol WHERE active = 1`
      );
      return rows.map((r: any) => r.slug);
    } catch {
      // Column may not exist yet — return all cached
      return Object.keys(this.getAllCached());
    }
  }

  /**
   * Seed all protocols from the standalone seed data file into the DB.
   * Idempotent — uses upsert on all 3 tables. Safe to call multiple times.
   *
   * The seed data lives in protocols-seed-data.ts (generated from live DB via
   * scripts/dump-protocol-seed.cjs). It is NOT imported by any runtime consumer
   * — only by this seed method. This keeps it as an "installation file."
   *
   * Epic #510 Phase 4 — DB-Driven Architecture.
   */
  async seedProtocolsToDatabase(): Promise<{ seeded: number; groups: number; entries: number }> {
    let protocols = 0, groups = 0, entries = 0;
    for (const [slug, config] of Object.entries(PROTOCOL_SEED_DATA)) {
      try {
        const proto = await (this.prisma as any).protocol.upsert({
          where: { slug },
          create: {
            slug,
            name: config.name,
            description: config.description,
            directionMode: config.directionMode || 'LONG_ONLY',
            tradingStyle: config.tradingStyle,
            recommendedTimeframe: config.recommendedTimeframe,
            avgHoldTime: config.avgHoldTime,
            winRateTarget: config.winRateTarget,
            idealFor: config.idealFor,
            derivedFrom: (config as any).derivedFrom ?? null,
            isDefault: true,
          },
          update: {
            name: config.name,
            description: config.description,
            directionMode: config.directionMode || 'LONG_ONLY',
            tradingStyle: config.tradingStyle,
            recommendedTimeframe: config.recommendedTimeframe,
            avgHoldTime: config.avgHoldTime,
            winRateTarget: config.winRateTarget,
            idealFor: config.idealFor,
            derivedFrom: (config as any).derivedFrom ?? null,
          },
        });
        protocols++;

        for (const [idx, group] of config.groups.entries()) {
          const dg = await (this.prisma as any).protocolDirectiveGroup.upsert({
            where: { protocolId_groupId: { protocolId: proto.id, groupId: group.id } },
            create: {
              protocolId: proto.id,
              groupId: group.id,
              name: group.name,
              description: group.description,
              weight: group.weight,
              isRiskGate: group.isRiskGate,
              minMultiplier: group.minMultiplier,
              maxMultiplier: group.maxMultiplier,
              sortOrder: idx,
            },
            update: {
              name: group.name,
              weight: group.weight,
              isRiskGate: group.isRiskGate,
              minMultiplier: group.minMultiplier,
              maxMultiplier: group.maxMultiplier,
              sortOrder: idx,
            },
          });
          groups++;

          for (const did of group.directiveIds) {
            // maxScore is single-sourced from the directive class (2026-08-13 refactor).
            // The seed file no longer carries per-protocol directiveMaxScores overrides.
            const maxScore = this.directivesService.get(did)?.maxScore ?? 100;
            await (this.prisma as any).protocolDirectiveEntry.upsert({
              where: { groupId_directiveId: { groupId: dg.id, directiveId: did } },
              create: {
                groupId: dg.id,
                directiveId: did,
                maxScore,
                active: true,
              },
              update: { maxScore },
            });
            entries++;
          }
        }
      } catch (err) {
        this.logger.warn(`Failed to seed protocol ${slug}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`Seeded ${protocols} protocols, ${groups} groups, ${entries} entries to DB`);
    return { seeded: protocols, groups, entries };
  }

  /** Check if any protocol needs EURUSD data for its directives. */
  protocolNeedsEurUsd(slug: string): boolean {
    const config = this.getCached(slug);
    if (!config) return false;
    for (const group of config.groups) {
      for (const did of group.directiveIds) {
        if (['dxy-regime', 'gold-macro-correlation', 'cad-usd-oil-correlation'].includes(did)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Convenience: get protocol name for display.
   */
  async getName(slug: string): Promise<string> {
    const config = await this.findBySlug(slug);
    return config?.name ?? slug;
  }
}
