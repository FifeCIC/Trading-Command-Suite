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
// #849 (2026-09-17) — directive/protocol config is now read through the settings registry's key families.
// ⚠️ The family has NO default on purpose: `seedFromDefaults()` below is explicit that the directive
// CLASS is the single source of truth for these weights and the table is a mirror of it.
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsResolverService,
  ) {}

  // ── Key helpers ──────────────────────────────────────

  private key(directiveId: string, field: string): string {
    return `directive:${directiveId}:${field}`;
  }

  // ── Read ─────────────────────────────────────────────

  async getConfig(directiveId: string): Promise<DirectiveConfig> {
    if (!this.prisma.isAvailable) return {};

    try {
      // #849 — through the settings registry's key family, not the table. `field` comes from the
      // validated match rather than slicing the key string, so the field name and its type are declared
      // in exactly one place.
      const { members } = await this.settings.listFamily(
        'directive',
        directiveId,
      );

      const config: DirectiveConfig = {};
      for (const member of members) {
        if (member.source === 'invalid') {
          // DELIBERATE CHANGE, and a reported one: this previously assigned NaN silently. Skipping the
          // field leaves it undefined and logs why — a broken weight should not become a number.
          this.logger.warn(
            `directive ${directiveId} field ${member.field} is unusable: ${member.error}`,
          );
          continue;
        }
        // The switch below reads a local `value`, exactly as it did before the migration — the access
        // path changed here, the coercion did not.
        const field = member.field;
        const value = String(member.value ?? '');

        switch (field) {
          case 'maxScore':
            config.maxScore = parseInt(value, 10);
            break;
          case 'minScore':
            config.minScore = parseInt(value, 10);
            break;
          case 'priority':
            config.priority = parseInt(value, 10);
            break;
          case 'category':
            config.category = value;
            break;
          case 'directionBias':
            config.directionBias = value;
            break;
        }
      }
      return config;
    } catch (err) {
      this.logger.warn(
        `Failed to read config for ${directiveId}: ${(err as Error).message}`,
      );
      return {};
    }
  }

  /** Batch-read all directive configs. Returns Map<directiveId, DirectiveConfig>. */
  async getAllConfigs(): Promise<Map<string, DirectiveConfig>> {
    if (!this.prisma.isAvailable) return new Map();

    try {
      // #849 — one bulk family read replaces the raw prefix query.
      const { members } = await this.settings.listFamily('directive');

      const map = new Map<string, DirectiveConfig>();
      for (const member of members) {
        if (member.source === 'invalid') {
          this.logger.warn(
            `directive ${member.subject} field ${member.field} is unusable: ${member.error}`,
          );
          continue;
        }
        const id = member.subject;
        const field = member.field;
        const row = { value: String(member.value ?? '') };

        let config = map.get(id);
        if (!config) {
          config = {};
          map.set(id, config);
        }

        switch (field) {
          case 'maxScore':
            config.maxScore = parseInt(row.value, 10);
            break;
          case 'minScore':
            config.minScore = parseInt(row.value, 10);
            break;
          case 'priority':
            config.priority = parseInt(row.value, 10);
            break;
          case 'category':
            config.category = row.value;
            break;
          case 'directionBias':
            config.directionBias = row.value;
            break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `Failed to read all directive configs: ${(err as Error).message}`,
      );
      return new Map();
    }
  }

  // ── Write ────────────────────────────────────────────

  async updateConfig(
    directiveId: string,
    config: Partial<DirectiveConfig>,
  ): Promise<void> {
    if (!this.prisma.isAvailable) return;

    const entries: Array<{ key: string; value: string }> = [];
    if (config.maxScore !== undefined)
      entries.push({
        key: this.key(directiveId, 'maxScore'),
        value: String(config.maxScore),
      });
    if (config.minScore !== undefined)
      entries.push({
        key: this.key(directiveId, 'minScore'),
        value: String(config.minScore),
      });
    if (config.priority !== undefined)
      entries.push({
        key: this.key(directiveId, 'priority'),
        value: String(config.priority),
      });
    if (config.category !== undefined)
      entries.push({
        key: this.key(directiveId, 'category'),
        value: config.category,
      });
    if (config.directionBias !== undefined)
      entries.push({
        key: this.key(directiveId, 'directionBias'),
        value: config.directionBias,
      });

    for (const { key, value } of entries) {
      try {
        // #849 — through the resolver: the key is validated against its declared family rather than
        // written blind, so this path cannot create an undeclared key. The surrounding try/catch is
        // unchanged, so one bad entry still does not abort the rest.
        await this.settings.set(key, value);
      } catch (err) {
        this.logger.error(`Failed to update ${key}: ${(err as Error).message}`);
      }
    }
  }

  // ── Protocol-scoped overrides (Phase 5 — #609) ───────

  private protocolKey(
    slug: string,
    directiveId: string,
    field: string,
  ): string {
    return `protocol:${slug}:${directiveId}:${field}`;
  }

  /**
   * Read all per-protocol overrides for one protocol.
   * Returns Map<directiveId, DirectiveConfig>. Empty map when none exist.
   */
  async getProtocolOverrides(
    slug: string,
  ): Promise<Map<string, DirectiveConfig>> {
    if (!this.prisma.isAvailable) return new Map();

    try {
      // #849 — protocol overrides are a key family too; the subject is the slug:directiveId pair.
      // ⚠️ Measured 2026-09-17: this family has ZERO rows, so this read returns empty today.
      const { members } = await this.settings.listFamily('protocol', slug);

      const map = new Map<string, DirectiveConfig>();
      for (const member of members) {
        if (member.source === 'invalid') {
          this.logger.warn(
            `protocol ${slug} ${member.key} is unusable: ${member.error}`,
          );
          continue;
        }
        const directiveId = member.subject.split(':')[1] ?? member.subject;
        const field = member.field;
        const row = { value: String(member.value ?? '') };

        let config = map.get(directiveId);
        if (!config) {
          config = {};
          map.set(directiveId, config);
        }

        switch (field) {
          case 'maxScore':
            config.maxScore = parseInt(row.value, 10);
            break;
          case 'minScore':
            config.minScore = parseInt(row.value, 10);
            break;
          case 'priority':
            config.priority = parseInt(row.value, 10);
            break;
          case 'category':
            config.category = row.value;
            break;
          case 'directionBias':
            config.directionBias = row.value;
            break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `Failed to read protocol overrides for ${slug}: ${(err as Error).message}`,
      );
      return new Map();
    }
  }

  /** Write one directive's override for a protocol. */
  async updateProtocolConfig(
    slug: string,
    directiveId: string,
    config: Partial<DirectiveConfig>,
  ): Promise<void> {
    if (!this.prisma.isAvailable) return;

    const entries: Array<{ key: string; value: string }> = [];
    if (config.maxScore !== undefined)
      entries.push({
        key: this.protocolKey(slug, directiveId, 'maxScore'),
        value: String(config.maxScore),
      });
    if (config.minScore !== undefined)
      entries.push({
        key: this.protocolKey(slug, directiveId, 'minScore'),
        value: String(config.minScore),
      });
    if (config.priority !== undefined)
      entries.push({
        key: this.protocolKey(slug, directiveId, 'priority'),
        value: String(config.priority),
      });
    if (config.category !== undefined)
      entries.push({
        key: this.protocolKey(slug, directiveId, 'category'),
        value: config.category,
      });
    if (config.directionBias !== undefined)
      entries.push({
        key: this.protocolKey(slug, directiveId, 'directionBias'),
        value: config.directionBias,
      });

    for (const { key, value } of entries) {
      try {
        // #849 — same as updateConfig(): validated against the `protocol` family before writing.
        await this.settings.set(key, value);
      } catch (err) {
        this.logger.error(`Failed to update ${key}: ${(err as Error).message}`);
      }
    }
  }

  /** Delete all override keys for one directive in one protocol (reset to global). */
  async deleteProtocolConfig(slug: string, directiveId: string): Promise<void> {
    if (!this.prisma.isAvailable) return;

    try {
      // #849 — the prefix delete moves into the resolver, so the key shape is known in one place rather
      // than being re-derived here from `protocolKey(slug, directiveId, '')`.
      // ⚠️ The subject is the `slug:directiveId` pair, matching the `protocol` family's subject group —
      // clearFamily() derives the same prefix that `protocolKey(..., '')` used to build by hand.
      await this.settings.clearFamily('protocol', `${slug}:${directiveId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to delete protocol config for ${slug}/${directiveId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Batch-read ALL protocol-scoped overrides in one query.
   * Returns Map<slug, Map<directiveId, DirectiveConfig>>. Used by the registry
   * so its maxScore display stays in lockstep with the scoring engine.
   */
  async getAllProtocolOverrides(): Promise<
    Map<string, Map<string, DirectiveConfig>>
  > {
    if (!this.prisma.isAvailable) return new Map();

    try {
      // #849 — one bulk family read for every protocol override. Zero rows measured 2026-09-17.
      const { members } = await this.settings.listFamily('protocol');

      const map = new Map<string, Map<string, DirectiveConfig>>();
      for (const member of members) {
        if (member.source === 'invalid') {
          this.logger.warn(
            `protocol override ${member.key} is unusable: ${member.error}`,
          );
          continue;
        }
        const slug = member.subject.split(':')[0] ?? member.subject;
        const directiveId = member.subject.split(':')[1] ?? '';
        const field = member.field;
        const row = { value: String(member.value ?? '') };

        let inner = map.get(slug);
        if (!inner) {
          inner = new Map();
          map.set(slug, inner);
        }
        let config = inner.get(directiveId);
        if (!config) {
          config = {};
          inner.set(directiveId, config);
        }

        switch (field) {
          case 'maxScore':
            config.maxScore = parseInt(row.value, 10);
            break;
          case 'minScore':
            config.minScore = parseInt(row.value, 10);
            break;
          case 'priority':
            config.priority = parseInt(row.value, 10);
            break;
          case 'category':
            config.category = row.value;
            break;
          case 'directionBias':
            config.directionBias = row.value;
            break;
        }
      }
      return map;
    } catch (err) {
      this.logger.warn(
        `Failed to read all protocol overrides: ${(err as Error).message}`,
      );
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
  async seedFromDefaults(
    directives: Array<{
      id: string;
      maxScore: number;
      category?: string;
      minScore?: number;
      directionBias?: string;
      priority?: number;
    }>,
  ): Promise<number> {
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
            `INSERT INTO global_setting (\`key\`, value, updatedAt) VALUES (?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE value = VALUES(value), updatedAt = UTC_TIMESTAMP()`,
            key,
            value,
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
