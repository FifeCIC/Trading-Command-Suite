/**
 * PLACEHOLDER — implement per SPRINT.md Task 4.
 *
 * Directives Service
 * ==================
 * Registry and runner for all scoring directives.
 * - Registers directive implementations at module init.
 * - Runs all (or a filtered subset of) directives against input.
 * - Aggregates results for the scoring pipeline.
 *
 * Contract: directives are stateless — this service orchestrates them.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  ConditionVector,
  DirectiveInput,
  DirectiveResult,
  IDirective,
  SuitabilityProfile,
  TimeModifier,
  TimeWindow,
} from './interfaces/directive.interface';
import { ConditionDetectorService } from './condition-detector.service';
import { getDirectiveSuitability } from './directive-suitability.registry';
import { isScoringDemo } from '../../config/scoring-mode';

@Injectable()
export class DirectivesService {
  private readonly logger = new Logger(DirectivesService.name);
  private readonly registry = new Map<string, IDirective>();
  private lastConditionVector: ConditionVector | null = null;

  constructor(
    private readonly conditionDetector: ConditionDetectorService,
    private readonly prisma: PrismaService,
  ) {}

  getLastConditionVector(): ConditionVector | null {
    return this.lastConditionVector;
  }

  register(directive: IDirective): void {
    if (this.registry.has(directive.id)) {
      this.logger.warn(
        `Directive ${directive.id} already registered — overwriting.`,
      );
    }
    this.registry.set(directive.id, directive);
    this.logger.log(
      `Registered directive: ${directive.id} (${directive.name})`,
    );
  }

  get(id: string): IDirective | undefined {
    return this.registry.get(id);
  }

  list(): IDirective[] {
    return Array.from(this.registry.values());
  }

  listRegistered(): Array<{ id: string; name: string }> {
    return Array.from(this.registry.entries()).map(([id, d]) => ({ id, name: d.name }));
  }

  /** Run a single directive by ID — used by per-directive backtest coverage (#106). */
  async runSingle(id: string, input: any): Promise<DirectiveResult | null> {
    const directive = this.registry.get(id);
    if (!directive) return null;
    try {
      return await directive.calculate(input);
    } catch (err) {
      this.logger.warn(`runSingle ${id} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Run all registered directives against the same input, with activation gates. Supports async directives. */
  async runAll(input: DirectiveInput): Promise<Map<string, DirectiveResult>> {
    const results = new Map<string, DirectiveResult>();

    // ── Step 1: Run condition detector ──
    const cv = this.conditionDetector.detect(input);
    this.lastConditionVector = cv;

    for (const [id, directive] of this.registry) {
      try {
        // ── Time-gate check (activeWindow) ──
        if (directive.activeWindow) {
          const inWindow = this.isInTimeWindow(directive.activeWindow);
          if (!inWindow) {
            results.set(id, {
              score: 0,
              confidence: 0,
              reason: `Outside active window (${directive.activeWindow.start}-${directive.activeWindow.end} ${directive.activeWindow.timezone})`,
              signalClass: 'neutral',
              timeGated: true,
            });
            continue;
          }
        }

        // ── Activation Gate (Q301) — suitability check ──
        const suitability = directive.suitability ?? getDirectiveSuitability(id);
        const gateResult = this.evaluateGate(suitability, cv);

        if (gateResult.muted) {
          results.set(id, {
            score: 0,
            confidence: 0,
            reason: `Muted — ${gateResult.reason}`,
            signalClass: 'neutral',
            gated: true,
            gatedReason: gateResult.reason,
          });
          continue;
        }

        // ── Run the directive (supports async for Finnhub-backed directives) ──
        let result = await directive.calculate(input);

        // ── Apply session/volatility weight adjustments ──
        if (gateResult.weightMultiplier < 1.0) {
          result = {
            ...result,
            score: Math.round(result.score * gateResult.weightMultiplier),
            reason: result.reason
              ? `${result.reason}. ${gateResult.reason}`
              : gateResult.reason,
          };
        }

        // ── Apply time modifiers (timeModifiers) ──
        if (directive.timeModifiers && directive.timeModifiers.length > 0) {
          const applied = this.evaluateTimeModifiers(directive.timeModifiers);
          if (applied.length > 0) {
            const totalAdjustment = applied.reduce((sum, m) => sum + m.adjustment, 0);
            const modifierReasons = applied.map((m) => m.reason).join('; ');
            result = {
              ...result,
              score: Math.max(0, result.score + totalAdjustment),
              reason: result.reason
                ? `${result.reason}. Time modifiers: ${modifierReasons}`
                : `Time modifiers applied: ${modifierReasons}`,
              timeModifiersApplied: applied,
            };
          }
        }

        results.set(id, result);
      } catch (error) {
        this.logger.error(`Directive ${id} threw: ${String(error)}`);
        results.set(id, {
          score: 0,
          confidence: 0,
          reason: `Error: ${String(error)}`,
        });
      }
    }

    return results;
  }

  /**
   * Evaluate activation gate — checks suitability profile against the
   * current ConditionVector. Returns whether to mute and/or adjust weight.
   */
  private evaluateGate(
    s: SuitabilityProfile,
    cv: ConditionVector,
  ): { muted: boolean; reason: string; weightMultiplier: number } {
    let weightMultiplier = 1.0;

    // In demo mode: reduce weight on mismatch
    // In live mode: MUTE — directive is unsuitable for current conditions
    const demo = isScoringDemo();

    // ── Regime mismatch → MUTE (or -30% in demo) ──
    if (s.regimeType !== 'any' && s.regimeType !== cv.regime) {
      if (demo) {
        weightMultiplier -= 0.30;
      } else {
        return {
          muted: true,
          reason: `${s.regimeType} regime required, current regime is ${cv.regime}`,
          weightMultiplier: 0,
        };
      }
    }

    // ── Volatility mismatch → -30% weight ──
    if (s.volatilityLevel !== 'any' && s.volatilityLevel !== cv.volatility) {
      weightMultiplier -= 0.30;
    }

    // ── Session mismatch → -50% weight ──
    if (
      s.preferredSessions.length > 0 &&
      !s.preferredSessions.includes(cv.activeSession) &&
      !s.preferredSessions.includes('off-hours') // don't penalize if off-hours is explicitly preferred
    ) {
      weightMultiplier -= 0.50;
    }

    if (weightMultiplier < 1.0) {
      const parts: string[] = [];
      if (s.volatilityLevel !== 'any' && s.volatilityLevel !== cv.volatility) {
        parts.push(`volatility mismatch (${s.volatilityLevel} vs ${cv.volatility}, -30%)`);
      }
      if (
        s.preferredSessions.length > 0 &&
        !s.preferredSessions.includes(cv.activeSession) &&
        !s.preferredSessions.includes('off-hours')
      ) {
        parts.push(`session mismatch (prefers ${s.preferredSessions.join('/')}, in ${cv.activeSession}, -50%)`);
      }
      return {
        muted: false,
        reason: `Weight adjusted: ${parts.join('; ')}`,
        weightMultiplier,
      };
    }

    return { muted: false, reason: '', weightMultiplier: 1.0 };
  }

  /**
   * Check if the current time falls within an activeWindow.
   * Uses Node.js Intl.DateTimeFormat with IANA timezone strings (no external lib needed).
   */
  private isInTimeWindow(window: TimeWindow): boolean {
    try {
      const now = new Date();

      // Check daysOfWeek if specified
      if (window.daysOfWeek && window.daysOfWeek.length > 0) {
        const localDay = this.getDayInTimezone(now, window.timezone);
        if (!window.daysOfWeek.includes(localDay)) {
          return false;
        }
      }

      // Get current time in the target timezone
      const localTime = this.getTimeInTimezone(now, window.timezone);
      const [hours, minutes] = localTime.split(':').map(Number);

      const [startH, startM] = window.start.split(':').map(Number);
      const [endH, endM] = window.end.split(':').map(Number);

      const currentMinutes = hours * 60 + minutes;
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;

      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } catch (err) {
      this.logger.warn(`Time window check failed for ${window.timezone}: ${(err as Error).message}`);
      return true; // On error, let the directive run (fail-open)
    }
  }

  /**
   * Get the current HH:mm in a specific IANA timezone.
   */
  private getTimeInTimezone(date: Date, timezone: string): string {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return formatter.format(date); // "HH:mm"
  }

  /**
   * Get the day of week (0=Sun, 6=Sat) in a specific IANA timezone.
   */
  private getDayInTimezone(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
    });
    const dayMap: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3,
      Thu: 4, Fri: 5, Sat: 6,
    };
    return dayMap[formatter.format(date)] ?? new Date().getDay();
  }

  /**
   * Evaluate which time modifiers are currently active.
   * Returns the list of modifiers whose time windows contain the current time.
   */
  private evaluateTimeModifiers(modifiers: TimeModifier[]): { adjustment: number; reason: string }[] {
    const applied: { adjustment: number; reason: string }[] = [];
    const now = new Date();
    const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    for (const modifier of modifiers) {
      const [afterH, afterM] = modifier.after.split(':').map(Number);
      const afterMinutes = afterH * 60 + afterM;

      if (modifier.before) {
        const [beforeH, beforeM] = modifier.before.split(':').map(Number);
        const beforeMinutes = beforeH * 60 + beforeM;
        if (currentMinutes >= afterMinutes && currentMinutes <= beforeMinutes) {
          applied.push({ adjustment: modifier.adjustment, reason: modifier.reason });
        }
      } else {
        if (currentMinutes >= afterMinutes) {
          applied.push({ adjustment: modifier.adjustment, reason: modifier.reason });
        }
      }
    }

    return applied;
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Fork Management (Q301b)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * Create a fork of an existing directive for a specific strategy.
   * If a fork already exists for this directive+strategy, returns it.
   * Otherwise copies the parent and applies overrides.
   */
  async forkDirective(
    parentId: string,
    strategyId: string,
    overrides?: { weight?: number; config?: any; reason?: string },
  ) {
    if (!this.prisma.isAvailable) {
      throw new Error('Database unavailable — cannot create fork.');
    }

    // Check if fork already exists
    const existing = await this.prisma.directive.findFirst({
      where: { parentId, strategyId, isDefault: false },
    });
    if (existing) return existing;

    // Load parent
    const parent = await this.prisma.directive.findUnique({
      where: { id: parentId },
    });
    if (!parent) throw new Error(`Parent directive ${parentId} not found.`);

    // Create fork
    const fork = await this.prisma.directive.create({
      data: {
        name: overrides?.reason
          ? `${parent.name} (${overrides.reason})`
          : `${parent.name} (Custom)`,
        type: parent.type,
        weight: overrides?.weight ?? parent.weight,
        config: overrides?.config ?? (parent.config as any),
        active: parent.active,
        strategyId,
        parentId,
        isDefault: false,
        forkReason: overrides?.reason ?? null,
      },
    });

    this.logger.log(
      `Forked directive ${parentId} → ${fork.id} for strategy ${strategyId}`,
    );
    return fork;
  }

  /**
   * Resolve the effective directive for a strategy.
   * Returns the fork if one exists, otherwise the original.
   */
  async getEffectiveDirective(directiveId: string, strategyId: string) {
    if (!this.prisma.isAvailable) return null;

    // Look for a fork first
    const fork = await this.prisma.directive.findFirst({
      where: { parentId: directiveId, strategyId, isDefault: false },
    });
    if (fork) return fork;

    // Fall back to original
    return this.prisma.directive.findUnique({ where: { id: directiveId } });
  }

  /**
   * Revert a fork: delete it so the strategy falls back to the parent.
   */
  async revertFork(forkId: string) {
    if (!this.prisma.isAvailable) return;

    const fork = await this.prisma.directive.findUnique({
      where: { id: forkId },
    });
    if (!fork || fork.isDefault) {
      throw new Error(`Directive ${forkId} is not a fork.`);
    }

    await this.prisma.directive.delete({ where: { id: forkId } });
    this.logger.log(`Reverted fork ${forkId} → parent ${fork.parentId}`);
    return { reverted: true, parentId: fork.parentId };
  }

  /**
   * Upsert a directive's active status in the DB.
   * Enables runtime toggling without restarting the server.
   */
  async upsertDirective(id: string, active: boolean) {
    if (!this.prisma.isAvailable) return null;

    const existing = await this.prisma.directive.findUnique({ where: { id } });
    if (existing) {
      return this.prisma.directive.update({
        where: { id },
        data: { active, updatedAt: new Date() },
      });
    }

    // Get registered directive info
    const reg = this.registry.get(id);
    return this.prisma.directive.create({
      data: {
        id,
        name: reg?.name ?? id,
        type: id,
        weight: reg?.priority ?? 50,
        config: {},
        active,
        isDefault: true,
      },
    });
  }

  /**
   * Get recent scores with breakdown data for stats computation.
   */
  async getRecentScores(limit = 200) {
    if (!this.prisma.isAvailable) return [];
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Score query timed out')), 5000),
    );
    return Promise.race([
      this.prisma.score.findMany({
        orderBy: { timestamp: 'desc' },
        take: limit,
        select: { breakdown: true, strategyId: true, timestamp: true },
      }),
      timeout,
    ]);
  }

  /**
   * Get all DB directive records for active-status lookup.
   */
  async getDbStatuses() {
    if (!this.prisma.isAvailable) return [];
    return this.prisma.directive.findMany({
      select: { id: true, active: true },
      where: { isDefault: true },
    });
  }

  /**
   * Get all forks with parent and strategy info.
   */
  async getForks() {
    if (!this.prisma.isAvailable) return [];

    const forks = await this.prisma.directive.findMany({
      where: { isDefault: false },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with parent name
    const enriched = [];
    for (const f of forks) {
      const parent = f.parentId
        ? await this.prisma.directive.findUnique({
            where: { id: f.parentId },
            select: { name: true },
          })
        : null;
      enriched.push({
        ...f,
        parentName: parent?.name ?? 'Unknown',
      });
    }
    return enriched;
  }
}
