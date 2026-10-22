/**
 * Protocols Controller
 * ====================
 * High-level view of all scoring protocols and their background activity.
 *
 * GET /api/scoring/protocols — list all protocols with activity data
 * GET /api/scoring/protocols/:id — single protocol detail with version history
 */

import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { classifyDirectiveInclusion } from '../directives/directive-inclusion';
import { DirectiveConfigService } from './directive-config.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';
import { resolveDirectiveCatalog } from '../strategies/strategies.controller';
import {
  resolveAdaptiveTarget,
  adaptiveTargetReasonText,
  ADAPTIVE_TARGET_MIN_SAMPLES,
} from './adaptive-target';

interface ProtocolSummary {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  directiveCount: number;
  maxPossibleScore: number;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
  lastRunSymbols: number;
  status: 'idle' | 'running' | 'error' | 'disabled';
  createdAt: string;
}

@Controller('scoring/protocols')
export class ProtocolsController {
  private readonly logger = new Logger(ProtocolsController.name);

  /** In-memory activity log of recent protocol runs */
  private readonly activityLog: Array<{
    timestamp: string;
    protocolId: string;
    protocolName: string;
    event: 'started' | 'completed' | 'failed';
    symbolsScored?: number;
    durationMs?: number;
    error?: string;
  }> = [];
  private readonly MAX_ACTIVITY = 200;

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
    private readonly configService: DirectiveConfigService,
    private readonly schedulerService: ScoringSchedulerService,
  ) {}

  /** Record a protocol run event — called by ScoringScheduler */
  recordActivity(
    protocolId: string,
    protocolName: string,
    event: 'started' | 'completed' | 'failed',
    detail?: { symbolsScored?: number; durationMs?: number; error?: string },
  ): void {
    this.activityLog.unshift({
      timestamp: new Date().toISOString(),
      protocolId,
      protocolName,
      event,
      ...detail,
    });
    if (this.activityLog.length > this.MAX_ACTIVITY) this.activityLog.pop();
  }

  @Get()
  async listProtocols(): Promise<{
    protocols: ProtocolSummary[];
    scheduler: {
      enabled: boolean;
      intervalMs: number | null;
      nextRunIn: number | null;
      isRunning: boolean;
    };
    recentActivity: Array<{
      timestamp: string;
      protocolId: string;
      protocolName: string;
      event: 'started' | 'completed' | 'failed';
      symbolsScored?: number;
      durationMs?: number;
      error?: string;
    }>;
  }> {
    const protocols: ProtocolSummary[] = [];

    if (this.prisma.isAvailable) {
      try {
        // Phase D.3: Read from Protocol DB model (replaces hardcoded PROTOCOL_REGISTRY)
        const dbProtocols = await (this.prisma as any).protocol.findMany({
          include: {
            directiveGroups: {
              include: { directives: true },
            },
          },
          orderBy: { name: 'asc' },
        });

        for (const p of dbProtocols) {
          let directiveCount = 0;
          let maxPossibleScore = 0;
          for (const dg of p.directiveGroups) {
            for (const de of dg.directives) {
              const impl = this.directivesService.get(de.directiveId);
              maxPossibleScore += impl?.maxScore ?? de.maxScore ?? 100;
              directiveCount++;
            }
          }

          protocols.push({
            id: p.slug,
            name: p.name,
            description: p.description,
            // ⚠️ READ the row (#904, 2026-09-19). This was hardcoded `active: true` — by
            // construction, not by data — so a list that should have shown `btc-speed-v1
            // active=0` showed it as active. Same class as the #886 header marquee: a surface
            // that computes its answer from the shape of the code rather than from the system.
            active: p.active !== false,
            directiveCount,
            maxPossibleScore,
            lastRunAt: null,
            lastRunDurationMs: null,
            lastRunSymbols: 0,
            status: 'idle' as const,
            createdAt: p.createdAt?.toISOString() ?? new Date().toISOString(),
          });
        }
      } catch (err) {
        this.logger.error(`Failed to load protocols: ${String(err)}`);
      }
    }

    // No synthetic 'default' protocol — unscoped default scoring was removed (2026-08-22).
    // When no protocols exist, return an empty list.
    const schedulerStatus = this.schedulerService.getStatus();

    return {
      protocols,
      scheduler: schedulerStatus,
      recentActivity: this.activityLog.slice(0, 50),
    };
  }

  @Get(':id')
  async getProtocol(@Param('id') id: string): Promise<{
    protocol: ProtocolSummary | null;
    directives: Array<{ id: string; name: string; maxScore: number; priority: number }>;
    versionHistory: Array<{ version: string; changedAt: string; changes: string }>;
  }> {
    let protocol: ProtocolSummary | null = null;
    const directiveList: Array<{ id: string; name: string; maxScore: number; priority: number }> = [];

    if (this.prisma.isAvailable) {
      try {
        const s = await this.prisma.strategy.findUnique({
          where: { id },
          include: { directives: true },
        });

        if (s) {
          let maxPossibleScore = 0;
          for (const d of s.directives) {
            if (d.active) {
              const impl = this.directivesService.get(d.type);
              const maxScore = impl?.maxScore ?? 100;
              maxPossibleScore += maxScore;
              directiveList.push({
                id: d.type,
                name: impl?.name ?? d.name,
                maxScore,
                priority: impl?.priority ?? 50,
              });
            }
          }

          protocol = {
            id: s.id,
            name: s.name,
            description: s.description,
            active: s.active,
            directiveCount: s.directives.filter((d) => d.active).length,
            maxPossibleScore,
            lastRunAt: null,
            lastRunDurationMs: null,
            lastRunSymbols: 0,
            status: s.active ? 'idle' : 'disabled',
            createdAt: s.createdAt.toISOString(),
          };
        }
      } catch (err) {
        this.logger.error(`Failed to load protocol ${id}: ${String(err)}`);
      }
    }

    // Version history — placeholder until DB model added
    const versionHistory: Array<{ version: string; changedAt: string; changes: string }> = [];

    return { protocol, directives: directiveList, versionHistory };
  }

  // ── Per-protocol directive config (Phase 5 — #609) ────

  /**
   * GET /api/scoring/protocols/:slug/adaptive-target
   *
   * Adaptive Target state for one protocol (2026-09-10). Returns the stored peak AND the
   * resolution against the protocol's configured capacity, so the UI never has to decide
   * for itself which denominator is in force.
   */
  @Get(':slug/adaptive-target')
  async getAdaptiveTarget(@Param('slug') slug: string) {
    if (!this.prisma.isAvailable) {
      return { slug, enabled: false, peak: null, samples: 0, since: null,
               configuredMax: 0, denominator: 0, applied: false, reasonText: 'Database unavailable.' };
    }
    const proto = await (this.prisma as any).protocol.findUnique({
      where: { slug },
      select: {
        adaptiveTargetEnabled: true, adaptiveTargetMax: true,
        adaptiveTargetSamples: true, adaptiveTargetSince: true,
      },
    });
    if (!proto) throw new NotFoundException(`Protocol ${slug} not found`);

    // Configured capacity is derived from the live directive config so the two numbers the
    // operator compares are measured the same way.
    const cfg = await this.getProtocolDirectiveConfig(slug).catch(() => null);
    const configuredMax = cfg?.totalWeight ?? 0;

    const state = {
      enabled: !!proto.adaptiveTargetEnabled,
      peak: proto.adaptiveTargetMax ?? null,
      samples: proto.adaptiveTargetSamples ?? 0,
      since: proto.adaptiveTargetSince ?? null,
    };
    const resolved = resolveAdaptiveTarget(state, configuredMax);

    return {
      slug,
      ...state,
      configuredMax: resolved.configuredMax,
      denominator: resolved.denominator,
      applied: resolved.applied,
      minSamples: ADAPTIVE_TARGET_MIN_SAMPLES,
      reasonText: adaptiveTargetReasonText(resolved),
    };
  }

  /**
   * PATCH /api/scoring/protocols/:slug/adaptive-target
   *
   * Enable/disable the Adaptive Target for one protocol. Body: `{ enabled: boolean }`.
   *
   * Enabling does NOT synthesise a peak — if the protocol has never been observed there is
   * nothing to measure against, and the scorer keeps using configured capacity until real
   * observations exist. Refuses to enable below the sample floor for the same reason.
   */
  @Patch(':slug/adaptive-target')
  async setAdaptiveTarget(
    @Param('slug') slug: string,
    @Body() body: { enabled?: boolean },
  ) {
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('Body must be { enabled: boolean }');
    }
    const proto = await (this.prisma as any).protocol.findUnique({
      where: { slug },
      select: { adaptiveTargetEnabled: true, adaptiveTargetSamples: true, adaptiveTargetMax: true },
    });
    if (!proto) throw new NotFoundException(`Protocol ${slug} not found`);

    // Refuse to enable a target that would change nothing. An operator who toggles this on
    // and sees no difference would reasonably conclude the feature is broken.
    if (body.enabled) {
      const samples = proto.adaptiveTargetSamples ?? 0;
      if (!proto.adaptiveTargetMax || samples < ADAPTIVE_TARGET_MIN_SAMPLES) {
        throw new BadRequestException(
          `Cannot enable Adaptive Target for ${slug}: it needs at least ${ADAPTIVE_TARGET_MIN_SAMPLES} ` +
          `scoring observations before a peak is meaningful (currently ${samples}). ` +
          `The target will be available once the protocol has scored enough.`,
        );
      }
    }

    await (this.prisma as any).$executeRawUnsafe(
      `UPDATE protocol SET adaptiveTargetEnabled = ? WHERE slug = ?`,
      body.enabled ? 1 : 0,
      slug,
    );
    this.logger.log(`Adaptive Target for ${slug} set to ${body.enabled ? 'enabled' : 'disabled'}`);
    return this.getAdaptiveTarget(slug);
  }

  /**
   * GET /api/scoring/protocols/:slug/directive-config
   * Effective directive weights for a protocol: global default vs protocol override.
   */
  @Get(':slug/directive-config')
  async getProtocolDirectiveConfig(@Param('slug') slug: string) {
    const directives: Array<{
      id: string;
      name: string;
      classMaxScore: number;
      globalMaxScore: number;
      effectiveMaxScore: number;
      source: 'override' | 'global';
    }> = [];

    if (!this.prisma.isAvailable) {
      return { slug, directives, totalWeight: 0 };
    }

    const proto = await (this.prisma as any).protocol.findUnique({
      where: { slug },
      include: { directiveGroups: { include: { directives: true } } },
    });

    if (!proto) return { slug, directives, totalWeight: 0 };

    const overrides = await this.configService.getProtocolOverrides(slug);

    // Flatten + dedupe directive ids across groups, preserving group order.
    const seen = new Set<string>();
    const entries: Array<{ id: string; maxScore: number }> = [];
    for (const dg of proto.directiveGroups) {
      for (const de of dg.directives) {
        if (seen.has(de.directiveId)) continue;
        seen.add(de.directiveId);
        entries.push({ id: de.directiveId, maxScore: de.maxScore });
      }
    }

    let totalWeight = 0;
    for (const e of entries) {
      const impl = this.directivesService.get(e.id);
      const classMaxScore = impl?.maxScore ?? e.maxScore ?? 100;
      const globalCfg = await this.configService.getConfig(e.id);
      const globalMaxScore = globalCfg.maxScore ?? classMaxScore;
      const override = overrides.get(e.id);
      const effectiveMaxScore = override?.maxScore ?? globalMaxScore;
      totalWeight += effectiveMaxScore;
      directives.push({
        id: e.id,
        name: impl?.name ?? e.id,
        classMaxScore,
        globalMaxScore,
        effectiveMaxScore,
        source: override?.maxScore !== undefined ? 'override' : 'global',
      });
    }

    return { slug, directives, totalWeight };
  }

  /**
   * PATCH /api/scoring/protocols/:slug/directive-config
   * Write a per-protocol override: { directiveId, config: { maxScore, ... } }
   */
  @Patch(':slug/directive-config')
  async updateProtocolDirectiveConfig(
    @Param('slug') slug: string,
    @Body() body: { directiveId: string; config: Record<string, any> },
  ) {
    await this.configService.updateProtocolConfig(slug, body.directiveId, body.config as any);
    const result = await this.getProtocolDirectiveConfig(slug);

    // ⚠️ SETTABLE BUT INERT (#1133). The store accepts five fields; the SCORER applies only
    // `maxScore` per protocol (see `resolveEffectiveMaxScores()` — `overrides.get(id)?.maxScore`).
    // The other four are persisted and served, and change no score. Measured 2026-10-22 by grepping
    // every consumer: the GLOBAL versions are applied in `directives.service.ts`, the per-protocol
    // ones nowhere.
    //
    // A caller who sets `directionBias` per protocol and sees the same scores has no way to tell
    // "the change did nothing" from "the change was measured and had no effect". So the response says
    // which fields it could not apply rather than leaving a silent no-op — the same rule that makes
    // an empty list and a failed query render differently.
    const APPLIED_PER_PROTOCOL = new Set(['maxScore']);
    const notApplied = Object.keys(body.config ?? {}).filter((k) => !APPLIED_PER_PROTOCOL.has(k));
    if (notApplied.length === 0) return result;

    return {
      ...result,
      warning:
        `⚠️ STORED BUT NOT APPLIED: ${notApplied.join(', ')}. Only \`maxScore\` is honoured as a `
        + 'per-protocol override; the other fields are written and returned but no scoring path reads '
        + 'them per protocol (the GLOBAL values still apply). Treat this change as recorded, not live. '
        + 'Deciding whether to wire or remove these fields is step 1 of #1133.',
      notApplied,
    };
  }

  /**
   * DELETE /api/scoring/protocols/:slug/directive-config/:directiveId
   * Remove the override — the directive falls back to its global default.
   */
  @Delete(':slug/directive-config/:directiveId')
  async resetProtocolDirectiveConfig(
    @Param('slug') slug: string,
    @Param('directiveId') directiveId: string,
  ) {
    await this.configService.deleteProtocolConfig(slug, directiveId);
    return this.getProtocolDirectiveConfig(slug);
  }

  /**
   * POST /api/scoring/protocols
   * Create or update a protocol. Uses upsert — idempotent.
   */
  @Post()
  async upsertProtocol(@Body() body: {
    slug: string;
    name: string;
    description?: string;
    directionMode?: string;
    tradingStyle?: string;
    recommendedTimeframe?: string;
    groups?: Array<{
      groupId: string;
      name: string;
      description?: string;
      weight: number;
      isRiskGate: boolean;
      minMultiplier: number;
      maxMultiplier: number;
      directiveIds: string[];
      directiveMaxScores?: Record<string, number>;
    }>;
  }): Promise<{ success: boolean; protocolId?: string; error?: string }> {
    if (!this.prisma.isAvailable) {
      return { success: false, error: 'Database not available' };
    }
    try {
      const existing = await (this.prisma as any).protocol.findUnique({ where: { slug: body.slug } });

      // Direction-contract guard (#620): reject composition that would be
      // silently excluded at scoring time. A `bearish` directive must not be
      // added to a LONG_ONLY protocol (and a `bullish` one to SHORT_ONLY).
      // This is the runtime enforcement mirror of the seed validation script
      // (scripts/validate-protocol-directions.cjs) and uses the same single
      // source of truth: classifyDirectiveInclusion().
      if (body.groups && body.groups.length > 0) {
        const effectiveMode = body.directionMode ?? existing?.directionMode ?? 'LONG_ONLY';
        const conflicts: string[] = [];
        for (const g of body.groups) {
          for (const directiveId of g.directiveIds ?? []) {
            const impl = this.directivesService.get(directiveId);
            if (classifyDirectiveInclusion(impl, effectiveMode) === 'direction-bias') {
              conflicts.push(`${directiveId} (${impl?.directionBias ?? 'unknown'})`);
            }
          }
        }
        if (conflicts.length > 0) {
          const unique = [...new Set(conflicts)];
          return {
            success: false,
            error: `Direction-contract conflict: ${unique.join(', ')} cannot be in a ${effectiveMode} protocol`,
          };
        }
      }

      let protocolId: string;
      if (existing) {
        await (this.prisma as any).protocol.update({
          where: { slug: body.slug },
          data: {
            name: body.name,
            description: body.description ?? existing.description,
            directionMode: body.directionMode ?? existing.directionMode,
            tradingStyle: body.tradingStyle ?? existing.tradingStyle,
            recommendedTimeframe: body.recommendedTimeframe ?? existing.recommendedTimeframe,
          },
        });
        protocolId = existing.id;
      } else {
        const created = await (this.prisma as any).protocol.create({
          data: {
            slug: body.slug,
            name: body.name,
            description: body.description ?? null,
            directionMode: body.directionMode ?? 'LONG_ONLY',
            tradingStyle: body.tradingStyle ?? null,
            recommendedTimeframe: body.recommendedTimeframe ?? null,
          },
        });
        protocolId = created.id;
      }

      // Upsert directive groups if provided
      if (body.groups && body.groups.length > 0) {
        for (let i = 0; i < body.groups.length; i++) {
          const g = body.groups[i];
          const dg = await (this.prisma as any).protocolDirectiveGroup.upsert({
            where: { protocolId_groupId: { protocolId, groupId: g.groupId } },
            create: {
              protocolId,
              groupId: g.groupId,
              name: g.name,
              description: g.description ?? null,
              weight: g.weight,
              isRiskGate: g.isRiskGate,
              minMultiplier: g.minMultiplier,
              maxMultiplier: g.maxMultiplier,
              sortOrder: i,
            },
            update: {
              name: g.name,
              description: g.description ?? null,
              weight: g.weight,
              isRiskGate: g.isRiskGate,
              minMultiplier: g.minMultiplier,
              maxMultiplier: g.maxMultiplier,
              sortOrder: i,
            },
          });

          // Delete old directive entries, re-insert
          await (this.prisma as any).protocolDirectiveEntry.deleteMany({ where: { groupId: dg.id } });
          for (const directiveId of g.directiveIds) {
            await (this.prisma as any).protocolDirectiveEntry.create({
              data: {
                groupId: dg.id,
                directiveId,
                maxScore: g.directiveMaxScores?.[directiveId] ?? 100,
              },
            });
          }
        }
      }

      this.logger.log(`Protocol "${body.slug}" upserted successfully`);
      return { success: true, protocolId };
    } catch (err) {
      this.logger.error(`Protocol upsert failed: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  /**
   * GET /api/scoring/protocols/:slug/usage
   * Returns whether the protocol is in use by any enabled ScoringStrategy.
   */
  @Get(':slug/usage')
  async getProtocolUsage(@Param('slug') slug: string) {
    if (!this.prisma.isAvailable) return { inUse: false, strategyIds: [], strategyNames: [] };
    try {
      const strategies = await (this.prisma as any).scoringStrategy.findMany({
        where: { enabled: true, OR: [{ protocolId: slug }, { shortProtocolId: slug }] },
        select: { id: true, name: true },
      });
      return {
        inUse: strategies.length > 0,
        strategyIds: strategies.map((s: any) => s.id),
        strategyNames: strategies.map((s: any) => s.name),
      };
    } catch (err) {
      this.logger.error(`Protocol usage check failed for ${slug}: ${String(err)}`);
      return { inUse: false, strategyIds: [], strategyNames: [], error: String(err) };
    }
  }

  /**
   * GET /api/scoring/protocols/:slug/directives
   * Returns grouped directives for a protocol, enriched with directive registry info.
   * Replaces the broken /api/strategies/:id/directives for protocol-backed strategies.
   */
  @Get(':slug/directives')
  async getProtocolDirectives(@Param('slug') slug: string) {
    if (!this.prisma.isAvailable) {
      return { protocol: null, groups: [] };
    }

    try {
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
        // Fall back to resolveDirectiveCatalog for non-DB protocols
        const catalog = await resolveDirectiveCatalog({ identifier: slug, prisma: this.prisma as any });
        if (!catalog.directives.length) {
          return { protocol: null, groups: [] };
        }
        // Return flat structure as a single group
        return {
          protocol: {
            slug,
            name: catalog.strategyName,
            directionMode: 'LONG_ONLY',
          },
          groups: [{
            groupId: 'all',
            name: 'All Directives',
            weight: 1.0,
            isRiskGate: false,
            directives: catalog.directives.map((d: any) => {
              const impl = this.directivesService.get(d.id);
              return {
                id: d.id,
                name: impl?.name ?? d.name,
                maxScore: impl?.maxScore ?? d.weight ?? 100,
                description: impl?.description ?? '',
                active: d.active ?? true,
              };
            }),
          }],
        };
      }

      const groups = protocol.directiveGroups.map((dg: any) => ({
        groupId: dg.groupId,
        name: dg.name,
        description: dg.description,
        weight: dg.weight,
        isRiskGate: dg.isRiskGate,
        minMultiplier: dg.minMultiplier,
        maxMultiplier: dg.maxMultiplier,
        directives: (dg.directives || []).map((de: any) => {
          const impl = this.directivesService.get(de.directiveId);
          return {
            id: de.directiveId,
            name: impl?.name ?? de.directiveId,
            maxScore: impl?.maxScore ?? de.maxScore ?? 100,
            description: impl?.description ?? '',
            active: de.active ?? true,
          };
        }),
      }));

      return {
        protocol: {
          slug: protocol.slug,
          name: protocol.name,
          directionMode: protocol.directionMode,
          description: protocol.description,
        },
        groups,
      };
    } catch (err) {
      this.logger.error(`Failed to load directives for protocol ${slug}: ${String(err)}`);
      return { protocol: null, groups: [], error: String(err) };
    }
  }

  /**
   * PATCH /api/scoring/protocols/:slug/directives/:directiveId
   * Toggle a directive's active state in a protocol's directive groups.
   */
  @Delete(':slug/directives/:directiveId')
  async removeProtocolDirective(
    @Param('slug') slug: string,
    @Param('directiveId') directiveId: string,
  ) {
    if (!this.prisma.isAvailable) return { success: false, error: 'Database not available' };
    try {
      const protocol = await (this.prisma as any).protocol.findUnique({ where: { slug } });
      if (!protocol) return { success: false, error: `Protocol "${slug}" not found` };
      const entry = await (this.prisma as any).protocolDirectiveEntry.findFirst({
        where: { directiveId, group: { protocolId: protocol.id } },
      });
      if (!entry) return { success: false, error: `Directive "${directiveId}" not linked to "${slug}"` };
      await (this.prisma as any).protocolDirectiveEntry.delete({ where: { id: entry.id } });
      return { success: true, directiveId, protocolSlug: slug, message: 'Directive removed from protocol' };
    } catch (err) {
      this.logger.error(`Failed to remove directive ${directiveId} from ${slug}: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  @Patch(':slug/directives/:directiveId')
  async updateProtocolDirective(
    @Param('slug') slug: string,
    @Param('directiveId') directiveId: string,
    @Body() body: { active?: boolean; maxScore?: number },
  ) {
    if (!this.prisma.isAvailable) {
      return { success: false, error: 'Database not available' };
    }

    try {
      const protocol = await (this.prisma as any).protocol.findUnique({
        where: { slug },
      });

      if (!protocol) {
        return { success: false, error: `Protocol "${slug}" not found` };
      }

      // Find the directive entry across all groups of this protocol
      const entry = await (this.prisma as any).protocolDirectiveEntry.findFirst({
        where: {
          directiveId,
          group: { protocolId: protocol.id },
        },
        include: { group: true },
      });

      if (!entry) {
        // Directive not linked to this protocol — return an informative error
        return {
          success: false,
          error: `Directive "${directiveId}" is not linked to protocol "${slug}". It may need to be added via the protocol upsert endpoint.`,
        };
      }

      const updateData: any = {};
      if (body.active !== undefined) {
        updateData.active = body.active;
      }
      if (body.maxScore !== undefined) {
        updateData.maxScore = body.maxScore;
      }

      await (this.prisma as any).protocolDirectiveEntry.update({
        where: { id: entry.id },
        data: updateData,
      });

      return {
        success: true,
        directiveId,
        protocolSlug: slug,
        active: body.active !== undefined ? body.active : entry.active,
        maxScore: body.maxScore !== undefined ? body.maxScore : entry.maxScore,
      };
    } catch (err) {
      this.logger.error(`Failed to update directive ${directiveId} for protocol ${slug}: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }
}
