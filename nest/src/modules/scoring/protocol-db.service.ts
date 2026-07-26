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
import { PROTOCOL_SEED_DATA } from './protocols-seed-data';

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
            const maxScore = group.directiveMaxScores?.[did] ?? 100;
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
        if (['dxy-regime', 'gold-macro-correlation', 'cad-usd-oil-correlation', 'vix-regime'].includes(did)) {
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
