/**
 * DirectiveConfigService — DB-backed directive configuration.
 * ============================================================
 * Stores per-directive config in the existing global_setting table.
 *
 * Key pattern:
 *   directive:{id}:{field}  — global default (e.g. "directive:rsi-oversold:maxScore")
 *
 * Fields stored per directive:
 *   maxScore, category, minScore, directionBias, priority
 *
 * The directive class properties are the fallback defaults.
 * DB values override them when present.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface DirectiveConfig {
  maxScore?: number;
  category?: string;
  minScore?: number;
  directionBias?: string;
  priority?: number;
}

@Injectable()
export class DirectiveConfigService {
  private readonly logger = new Logger(DirectiveConfigService.name);
  private cache: Map<string, string> | null = null;
  private cacheTime = 0;
  private readonly CACHE_TTL = 30_000; // 30 seconds

  constructor(private readonly prisma: PrismaService) {}

  // ── Key helpers ──────────────────────────────────────

  private key(directiveId: string, field: string): string {
    return `directive:${directiveId}:${field}`;
  }

  // ── Read ─────────────────────────────────────────────

  async getConfig(directiveId: string): Promise<DirectiveConfig> {
    if (!this.prisma.isAvailable) return {};

    try {
      const prefix = `directive:${directiveId}:`;
      const rows = await this.prisma.globalSetting.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, value: true },
      });

      const config: DirectiveConfig = {};
      for (const row of rows) {
        const field = row.key.slice(prefix.length);
        const value = row.value;

        switch (field) {
          case 'maxScore': config.maxScore = parseInt(value, 10); break;
          case 'minScore': config.minScore = parseInt(value, 10); break;
          case 'priority': config.priority = parseInt(value, 10); break;
          case 'category': config.category = value; break;
          case 'directionBias': config.directionBias = value; break;
        }
      }
      return config;
    } catch (err) {
      this.logger.warn(`Failed to read config for ${directiveId}: ${(err as Error).message}`);
      return {};
    }
  }

  /** Batch-read all directive configs. Returns Map<directiveId, DirectiveConfig>. */
  async getAllConfigs(): Promise<Map<string, DirectiveConfig>> {
    if (!this.prisma.isAvailable) return new Map();

    try {
      const rows = await this.prisma.globalSetting.findMany({
        where: { key: { startsWith: 'directive:' } },
        select: { key: true, value: true },
      });

      const map = new Map<string, DirectiveConfig>();
      for (const row of rows) {
        // key format: "directive:{id}:{field}"
        const parts = row.key.split(':');
        if (parts.length !== 3) continue;
        const [, id, field] = parts;

        let config = map.get(id);
        if (!config) { config = {}; map.set(id, config); }

        switch (field) {
          case 'maxScore': config.maxScore = parseInt(row.value, 10); break;
          case 'minScore': config.minScore = parseInt(row.value, 10); break;
          case 'priority': config.priority = parseInt(row.value, 10); break;
          case 'category': config.category = row.value; break;
          case 'directionBias': config.directionBias = row.value; break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(`Failed to read all directive configs: ${(err as Error).message}`);
      return new Map();
    }
  }

  // ── Write ────────────────────────────────────────────

  async updateConfig(directiveId: string, config: Partial<DirectiveConfig>): Promise<void> {
    if (!this.prisma.isAvailable) return;

    const entries: Array<{ key: string; value: string }> = [];
    if (config.maxScore !== undefined) entries.push({ key: this.key(directiveId, 'maxScore'), value: String(config.maxScore) });
    if (config.minScore !== undefined) entries.push({ key: this.key(directiveId, 'minScore'), value: String(config.minScore) });
    if (config.priority !== undefined) entries.push({ key: this.key(directiveId, 'priority'), value: String(config.priority) });
    if (config.category !== undefined) entries.push({ key: this.key(directiveId, 'category'), value: config.category });
    if (config.directionBias !== undefined) entries.push({ key: this.key(directiveId, 'directionBias'), value: config.directionBias });

    for (const { key, value } of entries) {
      try {
        await this.prisma.globalSetting.upsert({
          where: { key },
          update: { value, updatedAt: new Date() },
          create: { key, value },
        });
      } catch (err) {
        this.logger.error(`Failed to update ${key}: ${(err as Error).message}`);
      }
    }
  }

  // ── Protocol-scoped overrides (Phase 5 — #609) ───────

  private protocolKey(slug: string, directiveId: string, field: string): string {
    return `protocol:${slug}:${directiveId}:${field}`;
  }

  /**
   * Read all per-protocol overrides for one protocol.
   * Returns Map<directiveId, DirectiveConfig>. Empty map when none exist.
   */
  async getProtocolOverrides(slug: string): Promise<Map<string, DirectiveConfig>> {
    if (!this.prisma.isAvailable) return new Map();

    try {
      const prefix = `protocol:${slug}:`;
      const rows = await this.prisma.globalSetting.findMany({
        where: { key: { startsWith: prefix } },
        select: { key: true, value: true },
      });

      const map = new Map<string, DirectiveConfig>();
      for (const row of rows) {
        // key format: "protocol:{slug}:{directiveId}:{field}"
        const parts = row.key.split(':');
        if (parts.length !== 4) continue;
        const directiveId = parts[2];
        const field = parts[3];

        let config = map.get(directiveId);
        if (!config) { config = {}; map.set(directiveId, config); }

        switch (field) {
          case 'maxScore': config.maxScore = parseInt(row.value, 10); break;
          case 'minScore': config.minScore = parseInt(row.value, 10); break;
          case 'priority': config.priority = parseInt(row.value, 10); break;
          case 'category': config.category = row.value; break;
          case 'directionBias': config.directionBias = row.value; break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(`Failed to read protocol overrides for ${slug}: ${(err as Error).message}`);
      return new Map();
    }
  }

  /** Write one directive's override for a protocol. */
  async updateProtocolConfig(slug: string, directiveId: string, config: Partial<DirectiveConfig>): Promise<void> {
    if (!this.prisma.isAvailable) return;

    const entries: Array<{ key: string; value: string }> = [];
    if (config.maxScore !== undefined) entries.push({ key: this.protocolKey(slug, directiveId, 'maxScore'), value: String(config.maxScore) });
    if (config.minScore !== undefined) entries.push({ key: this.protocolKey(slug, directiveId, 'minScore'), value: String(config.minScore) });
    if (config.priority !== undefined) entries.push({ key: this.protocolKey(slug, directiveId, 'priority'), value: String(config.priority) });
    if (config.category !== undefined) entries.push({ key: this.protocolKey(slug, directiveId, 'category'), value: config.category });
    if (config.directionBias !== undefined) entries.push({ key: this.protocolKey(slug, directiveId, 'directionBias'), value: config.directionBias });

    for (const { key, value } of entries) {
      try {
        await this.prisma.globalSetting.upsert({
          where: { key },
          update: { value, updatedAt: new Date() },
          create: { key, value },
        });
      } catch (err) {
        this.logger.error(`Failed to update ${key}: ${(err as Error).message}`);
      }
    }
  }

  /** Delete all override keys for one directive in one protocol (reset to global). */
  async deleteProtocolConfig(slug: string, directiveId: string): Promise<void> {
    if (!this.prisma.isAvailable) return;

    try {
      const prefix = this.protocolKey(slug, directiveId, '');
      await this.prisma.globalSetting.deleteMany({
        where: { key: { startsWith: prefix } },
      });
    } catch (err) {
      this.logger.warn(`Failed to delete protocol config for ${slug}/${directiveId}: ${(err as Error).message}`);
    }
  }

  /**
   * Batch-read ALL protocol-scoped overrides in one query.
   * Returns Map<slug, Map<directiveId, DirectiveConfig>>. Used by the registry
   * so its maxScore display stays in lockstep with the scoring engine.
   */
  async getAllProtocolOverrides(): Promise<Map<string, Map<string, DirectiveConfig>>> {
    if (!this.prisma.isAvailable) return new Map();

    try {
      const rows = await this.prisma.globalSetting.findMany({
        where: { key: { startsWith: 'protocol:' } },
        select: { key: true, value: true },
      });

      const map = new Map<string, Map<string, DirectiveConfig>>();
      for (const row of rows) {
        const parts = row.key.split(':');
        if (parts.length !== 4) continue;
        const [, slug, directiveId, field] = parts;

        let inner = map.get(slug);
        if (!inner) { inner = new Map(); map.set(slug, inner); }
        let config = inner.get(directiveId);
        if (!config) { config = {}; inner.set(directiveId, config); }

        switch (field) {
          case 'maxScore': config.maxScore = parseInt(row.value, 10); break;
          case 'minScore': config.minScore = parseInt(row.value, 10); break;
          case 'priority': config.priority = parseInt(row.value, 10); break;
          case 'category': config.category = row.value; break;
          case 'directionBias': config.directionBias = row.value; break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(`Failed to read all protocol overrides: ${(err as Error).message}`);
      return new Map();
    }
  }

  // ── Seed ─────────────────────────────────────────────

  /**
   * Seed directive config from class defaults. UPSERTS (overwrites) so the
   * global_setting table always mirrors the class — the class is the single
   * source of truth for maxScore/minScore/category/directionBias/priority.
   * This keeps installation seed data and live DB values in lockstep on boot.
   */
  async seedFromDefaults(directives: Array<{
    id: string;
    maxScore: number;
    category?: string;
    minScore?: number;
    directionBias?: string;
    priority?: number;
  }>): Promise<number> {
    if (!this.prisma.isAvailable) return 0;

    let seeded = 0;
    for (const d of directives) {
      const fields: Record<string, string> = {
        maxScore: String(d.maxScore),
        ...(d.category ? { category: d.category } : {}),
        ...(d.minScore !== undefined ? { minScore: String(d.minScore) } : {}),
        ...(d.directionBias ? { directionBias: d.directionBias } : {}),
        ...(d.priority ? { priority: String(d.priority) } : {}),
      };

      for (const [field, value] of Object.entries(fields)) {
        const key = this.key(d.id, field);
        try {
          // UPSERT — sync class defaults into DB so both stay in lockstep.
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO global_setting (\`key\`, value, updatedAt) VALUES (?, ?, NOW())
             ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = NOW()`,
            key, value,
          );
          seeded++;
        } catch (err) {
          this.logger.warn(`Seed ${key}: ${(err as Error).message}`);
        }
      }
    }

    this.logger.log(`Seeded ${seeded} directive config entries`);
    return seeded;
  }
}
