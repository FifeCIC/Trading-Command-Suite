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
import { DirectiveConfigService } from '../scoring/directive-config.service';
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

/**
 * Detect symbols that trade 24 hours (forex, metals, crypto).
 * These markets don't have "off hours" — all sessions are valid.
 * Session mismatch penalties should NOT apply to these symbols.
 *
 * Detection:
 *  - 6-char pairs (EURUSD, GBPJPY) → forex
 *  - XAU/USD, XAG/USD etc. → metals (trade 23/5, essentially 24h)
 *  - BTC/USD, ETH/USD etc. → crypto (24/7)
 *  - US30, UK100, GER30 etc. → indices (NOT 24h — follow exchange hours)
 */
function is24HourMarket(symbol: string): boolean {
  const s = (symbol || '').toUpperCase();

  // Forex pairs: exactly 6 chars, first 3 and last 3 are currencies
  if (/^[A-Z]{6}$/.test(s)) {
    const base = s.substring(0, 3);
    const quote = s.substring(3, 6);
    const currencies = new Set([
      'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF',
      'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'TRY', 'ZAR', 'MXN',
      'PLN', 'HUF', 'CZK', 'CNH', 'ILS', 'THB', 'RUB', 'INR',
    ]);
    if (currencies.has(base) && currencies.has(quote)) return true;
  }

  // Metals: XAU, XAG, XPT, XPD
  if (/^X(AU|AG|PT|PD)/.test(s)) return true;

  // Crypto pairs
  if (/^(BTC|ETH|XRP|SOL|DOGE|ADA|AVAX|MATIC|LINK|DOT|LTC|BCH|UNI)/.test(s)) return true;

  return false;
}

@Injectable()
export class DirectivesService {
  private readonly logger = new Logger(DirectivesService.name);
  private readonly registry = new Map<string, IDirective>();
  private lastConditionVector: ConditionVector | null = null;
  /** DB-sourced active status cache — refreshed on module init. false = stubbed. */
  private dbActiveStatuses = new Map<string, boolean>();

  constructor(
    private readonly conditionDetector: ConditionDetectorService,
    private readonly prisma: PrismaService,
    private readonly configService: DirectiveConfigService,
  ) {}

  /** Merge DB-stored directive config over class defaults. Called after all directives registered. */
  async loadDbOverrides(): Promise<number> {
    const configs = await this.configService.getAllConfigs();
    let overridden = 0;
    for (const [id, directive] of this.registry) {
      const dbConfig = configs.get(id);
      if (!dbConfig) continue;
      let changed = false;
      if (dbConfig.maxScore !== undefined && directive.maxScore !== dbConfig.maxScore) {
        (directive as any).maxScore = dbConfig.maxScore;
        changed = true;
      }
      if (dbConfig.minScore !== undefined && (directive as any).minScore !== dbConfig.minScore) {
        (directive as any).minScore = dbConfig.minScore;
        changed = true;
      }
      if (dbConfig.priority !== undefined && directive.priority !== dbConfig.priority) {
        (directive as any).priority = dbConfig.priority;
        changed = true;
      }
      if (dbConfig.directionBias && directive.directionBias !== dbConfig.directionBias) {
        (directive as any).directionBias = dbConfig.directionBias;
        changed = true;
      }
      if (changed) {
        overridden++;
        this.logger.debug(`DB override applied to ${id}`);
      }
    }
    if (overridden > 0) this.logger.log(`Loaded DB overrides for ${overridden} directives`);
    return overridden;
  }

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

  /**
   * Seed all in-memory directives into the database.
   * Idempotent — uses upsert so it's safe to call multiple times.
   * Directives with isDefault=true are originals — protected from overwrite by user forks.
   *
   * Epic #510 Phase 1 — DB-Driven Architecture.
   */
  async seedToDatabase(): Promise<{ seeded: number; skipped: number }> {
    let seeded = 0;
    let skipped = 0;
    for (const [id, directive] of this.registry) {
      try {
        await (this.prisma as any).directive.upsert({
          where: { id },
          create: {
            id,
            name: directive.name,
            type: (directive as any).category || 'technical',
            weight: directive.maxScore || 100,
            config: {
              description: directive.description,
              directionBias: directive.directionBias || 'neutral',
              version: (directive as any).version || '1.0.0',
            },
            active: true,
            nature: directive.directionBias || 'neutral',
            readiness: directive.readiness || 'alpha',
            isDefault: true,
          },
          update: {
            // Only update non-user-customised fields
            name: directive.name,
            type: (directive as any).category || 'technical',
            weight: directive.maxScore || 100,
            readiness: directive.readiness || 'alpha',
            active: true,
            config: {
              description: directive.description,
              directionBias: directive.directionBias || 'neutral',
              version: (directive as any).version || '1.0.0',
            },
          },
        });
        seeded++;
      } catch (err) {
        this.logger.warn(`Failed to seed directive ${id}: ${(err as Error).message}`);
        skipped++;
      }
    }
    this.logger.log(`Seeded ${seeded} directives to DB (${skipped} skipped)`);
    return { seeded, skipped };
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

  /** Per-tick memoization cache: symbol+bars-signature → results */
  private tickCache = new Map<string, Map<string, DirectiveResult>>();

  /** Clear the per-tick cache. Call at start of each automation tick. */
  clearTickCache(): void {
    this.tickCache.clear();
  }

  /** Run all registered directives against the same input, with activation gates. Supports async directives.
   *  @param input - The directive input (symbol, bars, etc.)
   *  @param directiveFilter - Optional set of directive IDs to run. If omitted, runs ALL registered directives.
   *    Used by protocol-gating to avoid running directives not in the active protocol (#389). */
  async runAll(input: DirectiveInput, directiveFilter?: Set<string>): Promise<Map<string, DirectiveResult>> {
    // ── Per-tick memoization (#408) ──
    // Directives scoring is deterministic for a given (symbol, bars) combo.
    // Multiple callers (rankAll, protocol-gating, evaluateStrategy) ask for
    // the same symbol in the same tick. Cache the result per symbol.
    const cacheKey = `${input.symbol}|${input.bars?.[input.bars.length - 1]?.timestamp?.getTime?.() ?? 0}|${input.bars?.length ?? 0}`;
    const cached = this.tickCache.get(cacheKey);
    if (cached) return cached;

    const results = new Map<string, DirectiveResult>();

    // ── Step 1: Run condition detector ──
    const cv = this.conditionDetector.detect(input);
    this.lastConditionVector = cv;

    for (const [id, directive] of this.registry) {
      // ── Protocol-scoped filtering (#389) ──
      // Skip directives not in the active protocol if a filter is provided.
      if (directiveFilter && !directiveFilter.has(id)) continue;

      // ── DB active-status check (#288) ──
      // Directives marked inactive in the DB are "stubbed" — they return
      // a zero-score result without running their calculation. This allows
      // underperforming directives to be silenced without deleting code.
      if (this.dbActiveStatuses.has(id) && !this.dbActiveStatuses.get(id)) {
        results.set(id, {
          score: 0,
          confidence: 0,
          reason: `[STUBBED] ${id}: Marked inactive — under review from audit #283.`,
          signalClass: 'neutral',
          metadata: { performance: 'underperforming', status: 'stubbed', stubbedAt: '2026-07-17' },
        });
        continue;
      }

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

        // ── Activation Gate (Q301) — DISABLED for protocol-level scoring ──
        // Regime/volatility/session gating belongs in Scoring Strategies (Phase 2),
        // not at the directive level. Directives should score based on data alone.
        // See: https://github.com/FifeCIC/Trading-Command-Suite/issues/610
        //
        // const suitability = directive.suitability ?? getDirectiveSuitability(id);
        // const gateResult = this.evaluateGate(suitability, cv, input.symbol);
        //
        // if (gateResult.muted) { ... continue; }
        //
        // Weight multiplier is always 1.0 — no reduction.

        // ── Run the directive (supports async for Finnhub-backed directives) ──
        let result = await directive.calculate(input);

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

    // ── Meta-directive pass (#369) ──
    // Run directives that depend on other directives' outputs AFTER all
    // regular directives have been scored.
    for (const [id, directive] of this.registry) {
      if (!directive.dependsOn?.length) continue;
      // Skip if already filtered out by protocol scope
      if (directiveFilter && !directiveFilter.has(id)) continue;

      // Check gate conditions (same as regular directives)
      if (this.dbActiveStatuses.has(id) && !this.dbActiveStatuses.get(id)) continue;

      try {
        let result: DirectiveResult;
        if (directive.calculateWithPeers) {
          result = await directive.calculateWithPeers(results, input);
        } else {
          // Default meta-directive behavior: combine dependency results
          const depResults = directive.dependsOn
            .map(did => results.get(did))
            .filter(Boolean) as DirectiveResult[];
          
          if (depResults.length === 0) {
            result = { score: 0, confidence: 0, reason: `Meta: no dependency results available`, signalClass: 'neutral' };
          } else {
            const avgScore = depResults.reduce((s, r) => s + r.score, 0) / depResults.length;
            const allBullish = depResults.every(r => r.signalClass === 'bullish');
            const allBearish = depResults.every(r => r.signalClass === 'bearish');
            const rule = directive.combineRule || 'AND';
            
            if (rule === 'AND' && allBullish) {
              result = { score: Math.min(avgScore * 1.5, directive.maxScore), confidence: 0.8, reason: `Meta (AND): ${depResults.length} bullish dependencies`, signalClass: 'bullish' };
            } else if (rule === 'AND' && allBearish) {
              result = { score: Math.min(avgScore * 1.5, directive.maxScore), confidence: 0.8, reason: `Meta (AND): ${depResults.length} bearish dependencies`, signalClass: 'bearish' };
            } else if (rule === 'OR') {
              const best = depResults.reduce((a, b) => a.score > b.score ? a : b);
              result = { score: Math.min(best.score * 1.3, directive.maxScore), confidence: 0.7, reason: `Meta (OR): best from ${depResults.length} deps`, signalClass: best.signalClass };
            } else {
              result = { score: Math.min(avgScore, directive.maxScore), confidence: 0.6, reason: `Meta (${rule}): avg of ${depResults.length} dependencies`, signalClass: 'neutral' };
            }
          }
        }
        results.set(id, result);
      } catch (err) {
        results.set(id, { score: 0, confidence: 0, reason: `Meta error: ${String(err)}` });
      }
    }

    this.tickCache.set(cacheKey, results);
    return results;
  }

  /**
   * Evaluate activation gate — checks suitability profile against the
   * current ConditionVector. Returns whether to mute and/or adjust weight.
   */
  private evaluateGate(
    s: SuitabilityProfile,
    cv: ConditionVector,
    symbol?: string,
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
    // SKIPPED for 24-hour markets (forex, metals, crypto) — these have no
    // "off hours." A forex pair in the Asian session is still actively traded.
    // Only stocks/ETFs/indices with fixed exchange hours get this penalty.
    const is24h = is24HourMarket(symbol || '');
    if (
      !is24h &&
      s.preferredSessions.length > 0 &&
      !s.preferredSessions.includes(cv.activeSession) &&
      !s.preferredSessions.includes('off-hours')
    ) {
      weightMultiplier -= 0.50;
    }

    if (weightMultiplier < 1.0) {
      const parts: string[] = [];
      if (s.volatilityLevel !== 'any' && s.volatilityLevel !== cv.volatility) {
        parts.push(`volatility mismatch (${s.volatilityLevel} vs ${cv.volatility}, -30%)`);
      }
      if (
        !is24h &&
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
  async upsertDirective(id: string, active: boolean, nature?: string) {
    if (!this.prisma.isAvailable) return null;

    const existing = await this.prisma.directive.findUnique({ where: { id } });
    if (existing) {
      const updateData: any = { active, updatedAt: new Date() };
      if (nature !== undefined) updateData.nature = nature;
      return this.prisma.directive.update({
        where: { id },
        data: updateData,
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
  /**
   * Get recent scores with breakdown data for stats computation.
   * Defaults to last 24 hours to keep averages relevant.
   */
  async getRecentScores(limit = 500, hoursBack = 24) {
    if (!this.prisma.isAvailable) return [];
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Score query timed out')), 2000),
    );
    return Promise.race([
      this.prisma.score.findMany({
        where: { timestamp: { gte: since } },
        orderBy: { timestamp: 'desc' },
        take: limit,
        select: { breakdown: true, strategyId: true, timestamp: true },
      }),
      timeout,
    ]);
  }

  /**
   * Get total run count per directive from all Score records.
   * Used as fallback when recent-scores aggregation returns empty.
   * Queries the last 7 days and counts unique score rows where each
   * directive appears in the breakdown JSON.
   */
  async getDirectiveRunCounts(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (!this.prisma.isAvailable) return counts;
    try {
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Run count query timed out')), 2000),
      );
      // Load breakdowns from last 7 days (capped at 500 rows for perf)
      const rows = await Promise.race([
        this.prisma.score.findMany({
          where: { timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
          orderBy: { timestamp: 'desc' },
          take: 500,
          select: { breakdown: true },
        }),
        timeout,
      ]);
      for (const row of rows) {
        const breakdown = row.breakdown as Record<string, unknown>;
        if (!breakdown || typeof breakdown !== 'object') continue;
        for (const key of Object.keys(breakdown)) {
          counts.set(key, (counts.get(key) || 0) + 1);
        }
      }
    } catch (err) {
      this.logger.warn(`getDirectiveRunCounts failed: ${(err as Error).message}`);
    }
    return counts;
  }

  /**
   * Get all DB directive records for active-status lookup.
   */
  async getDbStatuses() {
    if (!this.prisma.isAvailable) return [];
    return this.prisma.directive.findMany({
      select: { id: true, active: true, nature: true, readiness: true },
      where: { isDefault: true },
    });
  }

  /**
   * Load directive metadata from DB and overlay onto the in-memory registry.
   * Called once at module init — DB is the source of truth for active status,
   * weight overrides, and config. Algorithm code (calculate()) stays in TypeScript.
   *
   * WHY OVERLAY INSTEAD OF REPLACE: The 102 this.register() calls in
   * directives.module.ts load directive CLASS INSTANCES into the registry Map.
   * Each instance carries its calculate() method — the actual algorithm code.
   * We cannot replace these instances with DB records because DB rows are data,
   * not executable code (and never will be — see Epic #510 non-goals).
   *
   * Instead, we overlay metadata: DB values for active, weight, and config
   * are patched onto the existing class instances. The calculate() method
   * and core logic remain untouched. This gives users DB-level control over
   * which directives run and at what weight, without putting code in the DB.
   *
   * PATTERN: DB is a property-overlay, not a replacement. Class instances
   * provide the algorithm; DB provides the configuration.
   *
   * Epic #510 Phase 2 — DB-Driven Architecture.
   */
  async loadDirectiveMetadata(): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      const dbDirectives = await this.prisma.directive.findMany({
        select: { id: true, active: true, weight: true, config: true, nature: true },
      });

      // Refresh active-status cache (used by runAll to skip inactive directives)
      this.dbActiveStatuses.clear();
      let overridden = 0;
      let inactive = 0;

      for (const db of dbDirectives) {
        this.dbActiveStatuses.set(db.id, db.active);

        // Overlay DB metadata onto in-memory directive instances
        const directive = this.registry.get(db.id);
        if (!directive) continue;

        if (!db.active) {
          inactive++;
        }

        // Override maxScore from DB weight (if different from class default)
        if (db.weight && (directive as any).maxScore !== db.weight) {
          (directive as any).maxScore = db.weight;
          overridden++;
        }

        // Merge DB config overrides
        if (db.config && typeof db.config === 'object') {
          const dbConfig = db.config as Record<string, any>;
          if (dbConfig.description && (directive as any).description !== dbConfig.description) {
            (directive as any).description = dbConfig.description;
          }
          if (dbConfig.directionBias && directive.directionBias !== dbConfig.directionBias) {
            (directive as any).directionBias = dbConfig.directionBias;
          }
        }
      }

      this.logger.log(
        `Directive metadata loaded from DB: ${dbDirectives.length} directives, ${overridden} weight overrides, ${inactive} inactive`,
      );
    } catch (err) {
      this.logger.warn(`Failed to load directive metadata from DB: ${(err as Error).message}`);
    }
  }

  /**
   * Refresh the in-memory active-status cache from the DB.
   * @deprecated Use loadDirectiveMetadata() instead (Epic #510 Phase 2).
   */
  async refreshActiveStatuses(): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      const statuses = await this.getDbStatuses();
      this.dbActiveStatuses.clear();
      for (const s of statuses) {
        this.dbActiveStatuses.set(s.id, s.active);
      }
      const inactiveCount = [...this.dbActiveStatuses.values()].filter((v) => !v).length;
      this.logger.log(`Active status cache refreshed: ${statuses.length} directives, ${inactiveCount} inactive`);
    } catch (err) {
      this.logger.warn(`Failed to refresh active statuses: ${(err as Error).message}`);
    }
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
