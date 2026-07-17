/**
 * ProtocolDbService — DB-backed protocol lookup replacing hardcoded PROTOCOL_REGISTRY.
 *
 * Caches protocol configs for the duration of a tick (cleared per tick).
 * Returns the same DirectiveGroup[] shape as PROTOCOL_REGISTRY so consumers
 * don't need to change their interfaces.
 *
 * Phase D.1 of META.Stack DB-driven refactor.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectiveGroup } from '../directives/directive-groups';

// Keep PROTOCOL_REGISTRY as fallback during transition
import { PROTOCOL_REGISTRY, DIRECTIVE_GROUPS } from '../directives/directive-groups';

export interface ProtocolConfig {
  groups: DirectiveGroup[];
  name: string;
  description: string;
  directionMode?: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH';
  tradingStyle?: string;
  recommendedTimeframe?: string;
  avgHoldTime?: string;
  winRateTarget?: string;
  idealFor?: string;
  seasonalAffinity?: any;
}

@Injectable()
export class ProtocolDbService implements OnModuleInit {
  private readonly logger = new Logger(ProtocolDbService.name);
  private cache = new Map<string, ProtocolConfig | null>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Preload in background — don't block startup
    this.preloadAll().catch((err) => {
      this.logger.warn(`Background protocol preload failed: ${(err as Error).message}`);
    });
  }

  /** Clear the cache at start of each tick. */
  clearCache(): void {
    this.cache.clear();
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
        // Fall back to hardcoded registry
        const fallback = PROTOCOL_REGISTRY[slug];
        this.cache.set(slug, fallback ?? null);
        return fallback as ProtocolConfig | undefined;
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
        // Not in DB — try hardcoded fallback
        const fallback = PROTOCOL_REGISTRY[slug];
        this.cache.set(slug, fallback ?? null);
        if (!fallback) this.logger.warn(`Protocol "${slug}" not found in DB or hardcoded registry`);
        return fallback as ProtocolConfig | undefined;
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
        avgHoldTime: protocol.avgHoldTime ?? undefined,
        winRateTarget: protocol.winRateTarget ?? undefined,
        idealFor: protocol.idealFor ?? undefined,
        seasonalAffinity: protocol.seasonalAffinity ?? undefined,
      };

      this.cache.set(slug, config);
      return config;
    } catch (err) {
      this.logger.warn(`Protocol DB lookup failed for "${slug}": ${(err as Error).message} — using hardcoded fallback`);
      const fallback = PROTOCOL_REGISTRY[slug];
      this.cache.set(slug, fallback ?? null);
      return fallback as ProtocolConfig | undefined;
    }
  }

  /**
   * Get all protocol slugs. Falls back to hardcoded registry keys.
   */
  async getAllSlugs(): Promise<string[]> {
    try {
      if (!this.prisma.isAvailable) return Object.keys(PROTOCOL_REGISTRY);
      const protocols = await (this.prisma as any).protocol.findMany({ select: { slug: true } });
      return protocols.map((p: any) => p.slug);
    } catch {
      return Object.keys(PROTOCOL_REGISTRY);
    }
  }

  /**
   * Get all protocol configs. DB-first, falls back to hardcoded registry.
   * Used by controllers that need to iterate all protocols.
   */
  async getAllProtocols(): Promise<Record<string, ProtocolConfig>> {
    try {
      if (!this.prisma.isAvailable) return { ...PROTOCOL_REGISTRY };
      const dbProtocols = await (this.prisma as any).protocol.findMany({
        include: {
          directiveGroups: {
            orderBy: { sortOrder: 'asc' },
            include: { directives: true },
          },
        },
      });
      if (!dbProtocols?.length) return { ...PROTOCOL_REGISTRY };

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
          directionMode: (p.directionMode as any) || 'LONG_ONLY',
          tradingStyle: p.tradingStyle ?? undefined,
          recommendedTimeframe: p.recommendedTimeframe ?? undefined,
          avgHoldTime: p.avgHoldTime ?? undefined,
          winRateTarget: p.winRateTarget ?? undefined,
          idealFor: p.idealFor ?? undefined,
          seasonalAffinity: p.seasonalAffinity ?? undefined,
        };
      }
      // Merge in any hardcoded protocols not in DB
      for (const [slug, cfg] of Object.entries(PROTOCOL_REGISTRY)) {
        if (!result[slug]) result[slug] = cfg as ProtocolConfig;
      }
      return result;
    } catch (err) {
      this.logger.warn(`getAllProtocols failed: ${(err as Error).message} — using hardcoded`);
      return { ...PROTOCOL_REGISTRY };
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

  /** Sync lookup — returns from preloaded cache. Falls back to hardcoded. */
  getCached(slug: string): ProtocolConfig | undefined {
    if (this.preloadedCache) return this.preloadedCache[slug];
    return PROTOCOL_REGISTRY[slug] as ProtocolConfig | undefined;
  }

  /** Sync access to all cached protocols. Falls back to hardcoded. */
  getAllCached(): Record<string, ProtocolConfig> {
    if (this.preloadedCache) return this.preloadedCache;
    return { ...PROTOCOL_REGISTRY };
  }

  /** Check if any protocol needs EURUSD data for its directives. */
  protocolNeedsEurUsd(slug: string): boolean {
    const config = this.getCached(slug);
    if (!config) return false;
    for (const group of config.groups) {
      for (const did of group.directiveIds) {
        if (['dxy-regime', 'gold-macro-correlation', 'cad-usd-oil-correlation', 'vix-regime'].includes(did)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Convenience: get protocol name for display. Falls back to hardcoded name.
   */
  async getName(slug: string): Promise<string> {
    const config = await this.findBySlug(slug);
    return config?.name ?? slug;
  }
}
