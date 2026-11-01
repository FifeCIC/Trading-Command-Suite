/**
 * Protocols Controller
 * ====================
 * High-level view of all scoring protocols and their background activity.
 *
 * GET /api/scoring/protocols — list all protocols with activity data
 * GET /api/scoring/protocols/:id — single protocol detail with version history
 */

import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { classifyDirectiveInclusion } from '../directives/directive-inclusion';
import { DirectiveConfigService } from './directive-config.service';
import { ScoringSchedulerService } from './scoring-scheduler.service';
import { ProtocolDbService } from './protocol-db.service';
import {
  ParamValidationError,
  defaultParams,
  resolveParams,
  validateSupplied,
} from '../directives/parameters';
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
    private readonly protocolDb: ProtocolDbService,
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
   * GET /api/scoring/protocols/:slug/directive-changes
   *
   * #1144 — THE HISTORY OF THIS PROTOCOL'S OVERRIDES. Write-only storage is the "buried ability" this
   * repo keeps paying for: a log nobody can read is indistinguishable from no log, and the reason the
   * log exists is to answer *"which configuration produced this run?"* after the second change.
   *
   * `BacktestRun.configVersion` points at one of these numbers, so `version` here is the join key.
   * ⚠️ An empty array means "no override has ever been recorded for this protocol" — that is version 0,
   * a real state, and it is NOT the same as the endpoint failing (which is a 500).
   */
  @Get(':slug/directive-changes')
  async getProtocolDirectiveChanges(
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limit ?? '50', 10) || 50, 1), 200);
    if (!this.prisma.isAvailable) return { slug, changes: [], version: null };
    const changes = await this.prisma.protocolDirectiveChange.findMany({
      where: { protocolSlug: slug },
      orderBy: [{ configVersion: 'desc' }],
      take,
    });
    const latest = changes[0]?.configVersion ?? 0;
    return {
      slug,
      version: latest,
      changes: changes.map((c) => ({
        version: c.configVersion,
        directiveId: c.directiveId,
        field: c.field,
        // ⚠️ null = the value was ABSENT (a first override, or a reset) — never read as "was 0".
        oldValue: c.oldValue,
        newValue: c.newValue,
        source: c.source,
        changedAt: c.changedAt.toISOString(),
      })),
    };
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

      // ── DECISION (2026-11-01, directives area) ──
      // WHAT:      the install endpoint REFUSES a `directiveIds` entry no registered class answers to.
      // WHY:       `runAll` skips an unresolvable id, so the protocol scores one directive fewer than
      //            its own configuration claims — plausible numbers, no error. The seed path has been
      //            guarded since #1169; this path could create exactly the entry that guard prevents.
      // INSTEAD OF: warning and installing anyway (which leaves the silent hole in place).
      // REVERSE BY: deleting this block and accepting that a protocol may name a phantom directive.
      // REGISTER:  docs/SETTLED-DECISIONS.md row 120
      // GUARD:     nest/src/modules/scoring/protocols-seed-integrity.spec.ts (seed path) —
      //            the install path is proven live: the request returns success:false and nothing is written.
      //
      // ── UNKNOWN-DIRECTIVE GUARD (#1169/#1165, added 2026-11-01) ──────────────────────────────
      // Same shape as the direction guard below, and for the same reason: a protocol composition
      // that CANNOT resolve is a lie that produces plausible numbers. `runAll` skips an id it cannot
      // find, so a protocol naming a deleted or misspelled directive scores one fewer directive than
      // its own configuration says it does, with no error anywhere.
      //
      // The SEED path has been guarded since #1169 (`validate-directive-id-references.cjs`, in
      // prebuild) — but the INSTALL path was not, so an API call could create exactly the entry the
      // seed validator exists to prevent. Measured 2026-11-01: this endpoint created entries for ANY
      // string, including ones no class answers to.
      if (body.groups && body.groups.length > 0) {
        const unknown: string[] = [];
        for (const g of body.groups) {
          for (const directiveId of g.directiveIds ?? []) {
            if (!this.directivesService.get(directiveId)) unknown.push(directiveId);
          }
        }
        if (unknown.length > 0) {
          return {
            success: false,
            error:
              `Unknown directive(s): ${[...new Set(unknown)].join(', ')} — no registered class answers to ` +
              `these ids, so they would install as entries that can never score. Register the class or ` +
              `remove the id.`,
          };
        }
      }

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

          // ⚠️ THIS DELETE IS WHY PARAMS AND NAMED INSTANCES MUST BE CARRIED FORWARD (#1165, measured
          // 2026-11-01). Re-saving a protocol from the UI deletes every entry in the group and
          // re-creates it, so a tuned `params` value — and any second configuration of a directive —
          // would be silently destroyed by an unrelated edit to the group's composition. Both are
          // read BEFORE the delete and re-applied afterwards.
          const priorRows = await (this.prisma as any).protocolDirectiveEntry.findMany({
            where: { groupId: dg.id },
            select: { directiveId: true, instanceLabel: true, params: true, maxScore: true },
          });
          const prior = new Map<string, { params: any; maxScore: number }>();
          for (const row of priorRows) {
            if (row.params && typeof row.params === 'object') {
              prior.set(`${row.directiveId}\u0000${row.instanceLabel ?? ''}`, { params: row.params, maxScore: row.maxScore });
            }
          }

          // Delete old directive entries, re-insert
          await (this.prisma as any).protocolDirectiveEntry.deleteMany({ where: { groupId: dg.id } });
          for (const directiveId of g.directiveIds) {
            const carried = prior.get(`${directiveId}\u0000`);
            await (this.prisma as any).protocolDirectiveEntry.create({
              data: {
                groupId: dg.id,
                directiveId,
                instanceLabel: '',
                maxScore: g.directiveMaxScores?.[directiveId] ?? 100,
                ...(carried ? { params: carried.params } : {}),
              },
            });
          }

          // NAMED instances (#1165). The body may declare them, and any that existed before are
          // re-created when their directive is still in the group — a group edit must not silently
          // delete a comparison the owner configured unless they removed the directive itself.
          const namedFromBody = new Map<string, any>();
          for (const inst of (g as any).directiveInstances ?? []) {
            if (inst?.directiveId && inst.label) {
              namedFromBody.set(`${inst.directiveId}\u0000${inst.label}`, inst);
            }
          }
          const namedFromPrior = priorRows
            .filter((r: any) => (r.instanceLabel ?? '') !== '' && g.directiveIds.includes(r.directiveId))
            .map((r: any) => `${r.directiveId}\u0000${r.instanceLabel}`);
          for (const key of new Set<string>([...namedFromBody.keys(), ...namedFromPrior])) {
            const [directiveId, instanceLabel] = key.split('\u0000');
            const carried = prior.get(key);
            const declared = namedFromBody.get(key);
            await (this.prisma as any).protocolDirectiveEntry.create({
              data: {
                groupId: dg.id,
                directiveId,
                instanceLabel,
                maxScore: declared?.maxScore ?? carried?.maxScore ?? g.directiveMaxScores?.[directiveId] ?? 100,
                ...(declared?.params ? { params: declared.params } : carried ? { params: carried.params } : {}),
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
            // #1165 — the ENTRY's own override, so the surface can show what will actually run
            // rather than the class default. `null` = "declared defaults", the pre-#1165 behaviour.
            maxScoreOverride: de.maxScore ?? 100,
            params: de.params ?? null,
            // The DECLARED spec for this directive, so an editor can render one control per knob
            // without a bespoke form per directive — and without an N+1 fetch per row. `[]` means the
            // directive declares nothing to tune, which a surface must render as "nothing to tune",
            // never as an empty form.
            paramSpec: this.directivesService.getParameterSpecs(de.directiveId) ?? [],
            // Which configured instance this row is. `''` is the primary; a named instance is a
            // second configuration of the same directive, AVERAGED with the primary at scoring time.
            instanceLabel: de.instanceLabel ?? '',
            entryId: de.id,
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
    @Query('instanceLabel') instanceLabel?: string,
  ) {
    if (!this.prisma.isAvailable) return { success: false, error: 'Database not available' };
    try {
      const protocol = await (this.prisma as any).protocol.findUnique({ where: { slug } });
      if (!protocol) return { success: false, error: `Protocol "${slug}" not found` };
      // #1165 — removing a NAMED instance must not remove the directive. Absent ⇒ the primary
      // instance, which is every entry that existed before instances were possible.
      const entry = await (this.prisma as any).protocolDirectiveEntry.findFirst({
        where: { directiveId, instanceLabel: instanceLabel ?? '', group: { protocolId: protocol.id } },
      });
      if (!entry) {
        return {
          success: false,
          error:
            instanceLabel === undefined
              ? `Directive "${directiveId}" not linked to "${slug}"`
              : `Directive "${directiveId}" has no instance "${instanceLabel}" in "${slug}"`,
        };
      }
      await (this.prisma as any).protocolDirectiveEntry.delete({ where: { id: entry.id } });
      // Group membership changed — the scorer's cached config must not keep serving the old list.
      this.protocolDb.clearCache();
      return { success: true, directiveId, instanceLabel: instanceLabel ?? '', protocolSlug: slug, message: 'Directive removed from protocol' };
    } catch (err) {
      this.logger.error(`Failed to remove directive ${directiveId} from ${slug}: ${String(err)}`);
      return { success: false, error: String(err) };
    }
  }

  /**
   * POST /api/scoring/protocols/:slug/directives/:directiveId/instances
   * Add a NAMED instance of a directive already in the protocol (#1165).
   *
   * This is the only way a second configuration comes into existence: the constraint on
   * `(groupId, directiveId, instanceLabel)` permits it, and the scorer AVERAGES the instances into one
   * directive slot. Adding one therefore changes WHICH view of the directive the protocol reads and
   * never its configured capacity — see `INV-STABLE-DENOMINATOR`.
   */
  @Post(':slug/directives/:directiveId/instances')
  async addProtocolDirectiveInstance(
    @Param('slug') slug: string,
    @Param('directiveId') directiveId: string,
    @Body() body: { instanceLabel?: string; params?: Record<string, number | boolean>; maxScore?: number },
  ) {
    if (!this.prisma.isAvailable) return { success: false, error: 'Database not available' };

    const instanceLabel = String(body.instanceLabel ?? '').trim();
    // `''` is the PRIMARY instance, which already exists for every linked directive. An empty label
    // here would be an attempt to create a second primary, which the constraint refuses with a raw
    // 1062 — so refuse it first, in words.
    if (!instanceLabel) {
      return {
        success: false,
        error: 'instanceLabel is required — the empty label is the PRIMARY instance, which already exists. Provide a name such as "fast" or "period-9".',
      };
    }
    if (instanceLabel.length > 60) {
      return { success: false, error: 'instanceLabel must be 60 characters or fewer.' };
    }
    if (!this.directivesService.get(directiveId)) {
      return { success: false, error: `Unknown directive "${directiveId}" — no registered class answers to that id.` };
    }

    try {
      const protocol = await (this.prisma as any).protocol.findUnique({
        where: { slug },
        include: { directiveGroups: { include: { directives: { select: { directiveId: true, maxScore: true } } } } },
      });
      if (!protocol) return { success: false, error: `Protocol "${slug}" not found` };

      const primary = await (this.prisma as any).protocolDirectiveEntry.findFirst({
        where: { directiveId, instanceLabel: '', group: { protocolId: protocol.id } },
        include: { group: true },
      });
      if (!primary) {
        return {
          success: false,
          error: `Directive "${directiveId}" is not in protocol "${slug}" — add the directive first, then a second instance of it.`,
        };
      }

      const specs = this.directivesService.getParameterSpecs(directiveId) ?? [];
      if (body.params) {
        if (!specs.length) {
          return { success: false, error: `Directive "${directiveId}" declares no tunable parameters — an instance of it would be an exact duplicate of the primary.` };
        }
        validateSupplied(directiveId, specs, body.params);
      }

      // ── DECISION (2026-11-01, primary — #1165) ──
      // WHAT:      an instance that is CONFIGURED IDENTICALLY to the primary is REFUSED.
      // WHY:       Instances are averaged, so a duplicate is not a harmless no-op — it pulls the mean
      //            toward the primary's own value, i.e. it silently HALVES that directive's weight. A
      //            control that looks like "add a comparison" and behaves as "reduce this directive's
      //            influence" is the worst kind of knob. MEASURED the same day: the first version of
      //            this endpoint accepted `{"instanceLabel":"dup"}` with no params on a directive with
      //            no tunables, which produced exactly that.
      // INSTEAD OF: allowing it and relying on the averaging being "obviously" a no-op. It is not.
      // REVERSE BY: deleting this block — a duplicate instance then halves the directive's weight.
      // REGISTER:  docs/SETTLED-DECISIONS.md row 122
      // GUARD:     nest/src/modules/directives/directive-instances.spec.ts (identical instances
      //            average to the same score) — the runtime refusal is proven live.
      // `{}` and `null` behave identically (both = "declared defaults"), so they must compare equal.
      // Without this, a caller sending `params: {}` slips past the duplicate check while producing an
      // instance identical to the primary — the exact silent weight-halving this refuses.
      const norm = (p: any) => (p && typeof p === 'object' && Object.keys(p).length > 0 ? p : null);
      const primaryParams = norm(primary.params);
      const requestedParams = norm(body.params);
      const sameParams = JSON.stringify(primaryParams) === JSON.stringify(requestedParams);
      const sameMax = (body.maxScore ?? primary.maxScore) === primary.maxScore;
      if (sameParams && sameMax) {
        return {
          success: false,
          error:
            `An instance of "${directiveId}" configured identically to the primary would be an exact ` +
            `duplicate — and because instances are AVERAGED, it would silently halve that directive's ` +
            `weight. Supply different params` +
            (specs.length ? ` (${specs.map((s) => s.key).join(', ')})` : '') +
            ` or a different maxScore.`,
        };
      }

      // Refuse a duplicate LABEL in words, before the database does it in a stack trace. The unique
      // key on (groupId, directiveId, instanceLabel) is the real guard; this only makes the refusal
      // readable. Measured 2026-11-01: without this, a repeated label returned the raw
      // `PrismaClientKnownRequestError … Unique constraint failed` text to the caller.
      const existing = await (this.prisma as any).protocolDirectiveEntry.findFirst({
        where: { directiveId, instanceLabel, groupId: primary.groupId },
        select: { id: true },
      });
      if (existing) {
        return {
          success: false,
          error: `Directive "${directiveId}" already has an instance "${instanceLabel}" in this protocol. Choose another label or edit the existing instance.`,
        };
      }

      const created = await (this.prisma as any).protocolDirectiveEntry.create({
        data: {
          groupId: primary.groupId,
          directiveId,
          instanceLabel,
          maxScore: body.maxScore ?? primary.maxScore,
          active: true,
          ...(body.params ? { params: body.params } : {}),
        },
      });

      this.protocolDb.clearCache();

      return {
        success: true,
        directiveId,
        instanceLabel,
        entryId: created.id,
        protocolSlug: slug,
        paramsUsed: body.params ?? defaultParams(specs),
        note: 'Instances of one directive are AVERAGED into a single directive slot when scoring — adding one changes the view, never the protocol\u2019s configured capacity.',
      };
    } catch (err) {
      const message = err instanceof ParamValidationError ? err.message : String(err);
      this.logger.warn(`Refused directive instance for ${slug}/${directiveId}: ${message}`);
      return { success: false, error: message };
    }
  }

  @Patch(':slug/directives/:directiveId')
  async updateProtocolDirective(
    @Param('slug') slug: string,
    @Param('directiveId') directiveId: string,
    @Body() body: {
      active?: boolean;
      maxScore?: number;
      params?: Record<string, number | boolean> | null;
      /**
       * Which configured instance to address (#1165). Absent ⇒ `''`, the primary instance, which is
       * every entry that existed before instances were possible — so an unchanged caller addresses
       * exactly what it addressed before. A named instance is a second configuration of the same
       * directive.
       */
      instanceLabel?: string;
    },
  ) {
    if (!this.prisma.isAvailable) {
      return { success: false, error: 'Database not available' };
    }

    const instanceLabel = body.instanceLabel ?? '';

    try {
      const protocol = await (this.prisma as any).protocol.findUnique({
        where: { slug },
      });

      if (!protocol) {
        return { success: false, error: `Protocol "${slug}" not found` };
      }

      // Find the CONFIGURED INSTANCE across all groups of this protocol (#1165).
      // A directive may hold several instances, so the selector must name WHICH one — otherwise this
      // would silently edit the first match, which is the same class of defect as the id collapse.
      const entry = await (this.prisma as any).protocolDirectiveEntry.findFirst({
        where: {
          directiveId,
          instanceLabel,
          group: { protocolId: protocol.id },
        },
        include: { group: true },
      });

      if (!entry) {
        // Directive not linked to this protocol — return an informative error
        const others = await (this.prisma as any).protocolDirectiveEntry.findMany({
          where: { directiveId, group: { protocolId: protocol.id } },
          select: { instanceLabel: true },
        });
        return {
          success: false,
          error:
            others.length > 0
              ? `Directive "${directiveId}" has no instance "${instanceLabel}" in protocol "${slug}" — ` +
                `existing instance(s): ${others.map((o: any) => o.instanceLabel || '(primary)').join(', ')}.`
              : `Directive "${directiveId}" is not linked to protocol "${slug}". It may need to be added via the protocol upsert endpoint.`,
        };
      }

      const updateData: any = {};
      if (body.active !== undefined) {
        updateData.active = body.active;
      }
      if (body.maxScore !== undefined) {
        updateData.maxScore = body.maxScore;
      }
      // Declared once, used by both the write validation and the resolution echo below.
      const specs = this.directivesService.getParameterSpecs(directiveId) ?? [];
      if (body.params !== undefined) {
        // #1165 — VALIDATE AT THE WRITE BOUNDARY, THROW, AND REFUSE. An unknown key or an
        // out-of-range value is not clamped here: silently storing a different number than the
        // caller asked for is the surprise `validateSupplied()` exists to prevent. The read path
        // (`resolveParams()`) clamps instead, because scoring must not die on stale data.
        if (!specs.length) {
          return {
            success: false,
            error: `Directive "${directiveId}" declares no tunable parameters — nothing to store.`,
          };
        }
        if (body.params === null) {
          // NULL means "use the declared defaults", which is exactly the pre-#1165 behaviour.
          //
          // ⚠️ `Prisma.DbNull`, NOT `null`. Prisma distinguishes an SQL NULL from a JSON `null`
          // document on a Json column, and a plain `null` writes the LATTER — measured 2026-11-01:
          // after a reset, `JSON_TYPE(params)` read `NULL` while `params IS NULL` was false. Both
          // read as unset to the scorer, so behaviour was right, but a column holding two spellings
          // of "nothing" makes `WHERE params IS NULL` quietly wrong for the next reader.
          updateData.params = Prisma.DbNull;
        } else {
          validateSupplied(directiveId, specs, body.params);
          updateData.params = body.params;
        }
      }

      await (this.prisma as any).protocolDirectiveEntry.update({
        where: { id: entry.id },
        data: updateData,
      });

      // ⚠️ The scorer reads groups from a cache in ProtocolDbService. Without this a params (or
      // group) edit is served the OLD configuration until the cache expires — the knob looks inert.
      this.protocolDb.clearCache();

      return {
        success: true,
        directiveId,
        instanceLabel,
        protocolSlug: slug,
        active: body.active !== undefined ? body.active : entry.active,
        maxScore: body.maxScore !== undefined ? body.maxScore : entry.maxScore,
        // Echo the RESOLVED values so a caller sees what will actually run, not what was sent.
        paramsUsed:
          body.params === undefined
            ? (entry.params ?? null)
            : body.params === null
              ? defaultParams(specs)
              : resolveParams(directiveId, specs, body.params).values,
      };
    } catch (err) {
      // A ParamValidationError carries every problem, not just the first — surface it as a refusal.
      const message = err instanceof ParamValidationError ? err.message : String(err);
      this.logger.warn(`Refused directive params for ${slug}/${directiveId}: ${message}`);
      return { success: false, error: message };
    }
  }
}
