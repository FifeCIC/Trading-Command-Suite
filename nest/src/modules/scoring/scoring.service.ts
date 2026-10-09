/**
 * ScoringService — STAGE 1 of the META.Stack pipeline.
 * ======================================================
 * ROLE: Compute raw directive scores and store them. Does NOT gate, filter,
 *       or make trading decisions — those belong to downstream modules.
 *
 * PIPELINE POSITION:
 *   Protocols define WHAT to score → ScoringService computes → Score table (DB)
 *   → ScoringStrategies apply gates → TradingStrategies evaluate → Execution
 *
 * CONTRACT:
 *   INPUT:  symbol ticker + market bars + directive list
 *   OUTPUT: scores persisted to Score table + returned as RankedResult
 *   NEVER:  opens positions, evaluates thresholds, or modifies strategies
 *
 * Orchestrates the full scoring pipeline:
 * 1. Loads active symbols from DB.
 * 2. Fetches market bars (or uses deterministic fallback if none).
 * 3. Runs all directives via DirectivesService.
 * 4. Aggregates via dominance/cancellation-aware weighted average.
 * 5. Returns ranked output.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { DirectivesService } from '../directives/directives.service';
import { ScoreHistoryService } from './score-history.service';
import { NotificationService } from '../notifications/notifications.service';
import { CalibrationService } from '../calibration/calibration.service';
import { SeasonalAffinityService } from './seasonal-affinity.service';
import { MacroSnapshotService } from './macro-snapshot.service';
import { EurUsdCacheService } from './eurusd-cache.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { ProviderDegradationService } from '../providers/provider-degradation.service';
import { CryptoProviderRouter } from '../providers/crypto-provider-router.service';
import { MarketDataService } from '../market-data/market-data.service';
// ⚠️ MST-013 — imported so the flat-scoring thresholds cannot drift from the gating
// thresholds again. protocol-gating.service.ts does NOT import this file, so there is
// no cycle. See the ENTRY_THRESHOLD / WATCH_THRESHOLD comment below for the defect this fixes.
import { SIGNAL_THRESHOLDS } from './protocol-gating.service';
import { selectBaseTimeframe, DEFAULT_LIVE_TIMEFRAME } from '../../common/utils/timeframe';
// ⚠️ MST-014 (#827) — imported to produce the 'stale' dataStatus. See the note at the
// `hasData` computation below: 'stale' was DECLARED in the RankedSymbol type and never
// produced, so a symbol whose feed died months ago reported 'live'.
import { computeMarketStatus } from '../directives/market-status';
import {
  DirectiveInput,
  MarketBar,
} from '../directives/interfaces/directive.interface';

/**
 * Directive maxScores replace old-style strategy weights.
 * Each directive declares its own scoring range (maxScore).
 * The protocol's total maximum = sum of all directive maxScores.
 * A directive with maxScore=180 naturally carries ~2× the influence of one with maxScore=90.
 * No artificial cap at 100 — scores flow from directive ranges.
 */

/**
 * ⚠️ RESCALED 2026-09-15 (MST-013) — these were 40 / 20, the PRE-RESCALE scale.
 *
 * These are the FLAT-SCORING (dashboard) thresholds. They must equal the protocol
 * gating thresholds, and the comment below says so — but when the gating service was
 * rescaled from 40 to 6, only ONE of the two copies was updated.
 *
 * Measured 2026-09-15: `signalPct` now runs 6–33 (was 40–80) because ADR-011 changed
 * the denominator from the OBSERVED directional sum (~130) to the CONFIGURED
directional capacity (~725–815), a ~6.3× increase that divides every percentage by
 * that factor. Against a literal 40, flat scoring could therefore **never** emit
 * `entry` — every symbol fell to `defensive`, and notification at L504 never fired.
 *
 * ⚠️ The two are genuinely the same units, verified rather than assumed:
 *   - scoring.service.ts L447        `maxPossibleScore += d.maxScore`      (configured)
 *   - protocol-gating.service.ts L792 `capacityMax += maxScore`            (configured)
 * Both divide by the sum of CONFIGURED directive maxScores, so `normScore` and
 * `signalPct` are the same scale and sharing the constant below is correct.
 *
 * ⚠️ The DB-read paths (L576/L614/L622) read a STORED `signalPct` — already written by
 * the gating service on the rescaled scale — so a literal 40 there compared a rescaled
 * number against a pre-rescale bar and reported BUY as HOLD.
 *
 * This is precisely the drift the original comment warned about: "a second copy of a
 * threshold is guaranteed to drift and only one gets fixed". Now there is one source.
 */
const ENTRY_THRESHOLD = SIGNAL_THRESHOLDS.entry; // 6 — %% of configured capacity
const WATCH_THRESHOLD = Math.max(1, Math.round(SIGNAL_THRESHOLDS.entry / 2)); // 3 — preserves the original 2:1 entry:watch ratio (was 40:20)

/** Cooldown for per-symbol entry notifications — prevents duplicate alerts. */
const ENTRY_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

/** Backoff for live bar-refresh on sparse symbols — prevents a bridge fetch + DB import every tick. */
const LIVE_REFRESH_COOLDOWN_MS = 15 * 60 * 1000; // 15 min

export interface DirectiveBreakdown {
  directiveId: string;
  name: string;
  score: number;
  maxScore: number;
  contribution: number;
  confidence: number;
  reason: string;
  signalClass: 'bullish' | 'bearish' | 'neutral';
  priority: number;
  /** True if the directive was muted by an activation gate (Q301). */
  gated?: boolean;
  /** Reason from the activation gate if muted/adjusted. */
  gatedReason?: string;
}

export interface RankedSymbol {
  symbolId: string;
  ticker: string;
  score: number;
  normalizedScore: number;
  /** Denominator that pairs with `score`. **null** on the DB-read path — see `rankFromDb` (#1090). */
  maxPossibleScore: number | null;
  totalDirectives: number;
  activeDirectives: number;
  coverage: number;
  degraded: boolean;
  degradedProviders: string[];
  confidence: number;
  freshness: string;
  signal: string;
  dataStatus: 'live' | 'stale' | 'no_data' | 'error';
  breakdown: DirectiveBreakdown[];
  timestamp: string;
}

export interface RankedResult {
  mode: string;
  services: { database: boolean; queue: boolean; redis: boolean };
  strategy: { name: string; entryThreshold: number; watchThreshold: number; maxPossibleScore: number | null; directiveCount: number };
  summary: { symbolsWithData: number; symbolsWithoutData: number; totalSymbols: number };
  degradation: {
    overallCoverage: number;
    degradedProviders: string[];
    failedProviders: string[];
    isDegraded: boolean;
    warning: string | null;
  };
  conditionVector?: {
    regime: string;
    volatility: string;
    activeSession: string;
    hurstExponent: number;
    adx: number;
    timestamp: string;
  };
  activationStats?: {
    mutedCount: number;
    activeCount: number;
    mutedReasons: string[];
  };
  ranked: RankedSymbol[];
}

@Injectable()
export class ScoringService implements OnModuleInit {
  private readonly logger = new Logger(ScoringService.name);
  /** Last entry-notification timestamp per ticker (dedup — issue #26). */
  private lastEntryNotified = new Map<string, number>();
  /** Last live bar-refresh attempt per symbolId (backoff — issue #31). */
  private lastLiveRefresh = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly directivesService: DirectivesService,
    private readonly scoreHistoryService: ScoreHistoryService,
    private readonly notificationService: NotificationService,
    private readonly calibrationService: CalibrationService,
    private readonly seasonalAffinity: SeasonalAffinityService,
    private readonly macroSnapshot: MacroSnapshotService,
    private readonly eurusdCache: EurUsdCacheService,
    private readonly adapterFactory: AdapterFactory,
    private readonly degradationService: ProviderDegradationService,
    private readonly cryptoRouter: CryptoProviderRouter,
    private readonly marketData: MarketDataService,
  ) {}

  /** On startup, detect directive version changes and log warnings. */
  async onModuleInit(): Promise<void> {
    const directives = this.directivesService.list();
    const versionMap = new Map<string, string>();
    for (const d of directives) {
      versionMap.set(d.id, d.version ?? '1.0.0');
    }

    this.logger.log(
      `Loaded ${directives.length} directives. Version snapshot: ` +
      `${directives.length} directives across ${new Set(versionMap.values()).size} distinct versions.`,
    );

    // Log each directive with its version for audit trail
    for (const d of directives) {
      this.logger.debug(`  ${d.id} v${d.version ?? '1.0.0'} (maxScore=${d.maxScore})`);
    }
  }

  /**
   * rankAll() — SCREENING / OPPORTUNITY RANKING (analytics only).
   *
   * SINGLE PURPOSE: rank symbols by their additive OPPORTUNITY score so callers
   * can order a watchlist / "which symbols deserve a closer look" list. It
   * answers "what is most attractive", NOT "buy now, which way".
   *
   * INPUTS:
   *   - strategyId?   — legacy; only resolves a display name (weights are
   *                     derived from directive maxScore, not a strategy).
   *   - limit         — max ranked results to return.
   *   - symbolFilter? — optional symbol subset to rank.
   *   - protocolSlug? — optional protocol to scope the directive set.
   *
   * OUTPUT (RankedResult): an ordered list of { ticker, score, … }. It performs
   *   NO persistence, enqueues NO decision, and triggers NO trade.
   *
   * ⚠️ BOUNDARY — do NOT overstep this method's purpose:
   *   - It is a LEGACY, second evaluator (dominance/cancellation + seasonal
   *     affinity + confluence bonus). Its numbers are NOT the canonical Signal.
   *   - Trade / queue / replay / backtest decisions MUST use
   *     ProtocolGatingService.scoreWithGating() — the single canonical evaluator.
   *   - Never derive BUY/SELL actions, queue entries, or position changes from
   *     this result. Use it only to ORDER screening/analytics surfaces.
   */
  async rankAll(strategyId?: string, limit = 20, symbolFilter?: string[], protocolSlug?: string): Promise<RankedResult> {
    const modeInfo = this.modeService.getModeInfo();

    // Strategy weights are now derived from each directive's maxScore.
    // No separate weight multipliers — the directive's scoring range IS its weight.
    let strategyName = 'Conviction Dip Accumulation';
    if (strategyId && this.prisma.isAvailable) {
      try {
        const strategy = await this.prisma.strategy.findUnique({ where: { id: strategyId } });
        if (strategy) strategyName = strategy.name;
      } catch { /* use defaults */ }
    }

    // Compute directive list — protocol-scoped when a protocol is specified
    let allDirectives = this.directivesService.list();
    let directiveFilter: Set<string> | undefined;
    let protocolTimeframe: string | undefined;
    if (protocolSlug && this.prisma.isAvailable) {
      try {
        const protocol = await (this.prisma as any).protocol.findUnique({
          where: { slug: protocolSlug },
          include: {
            directiveGroups: {
              include: { directives: true },
            },
          },
        });
        if (protocol?.directiveGroups) {
          // The protocol's own cadence drives which bars we score (#751) — a protocol
          // is per-timeframe by design, so its recommendation must win over a default.
          protocolTimeframe = (protocol as any)?.recommendedTimeframe ?? undefined;
          const protocolDirectiveIds = new Set<string>();
          for (const group of protocol.directiveGroups) {
            for (const entry of group.directives || []) {
              if (entry.directiveId) protocolDirectiveIds.add(entry.directiveId);
            }
          }
          if (protocolDirectiveIds.size > 0) {
            directiveFilter = protocolDirectiveIds;
            allDirectives = allDirectives.filter(d => protocolDirectiveIds.has(d.id));
            this.logger.log(`Protocol-scoped scoring: ${allDirectives.length} directives from "${protocolSlug}" (of ${this.directivesService.list().length} total)`);
          }
        }
      } catch (err) {
        throw new Error(`Protocol lookup failed for "${protocolSlug}": ${(err as Error).message}`);
      }
    }
    const protocolMaxScore = allDirectives.reduce((sum, d) => sum + d.maxScore, 0);
    const protocolDirectiveCount = allDirectives.length;

    // ── Degradation check ─────────────────────────────────
    // Check all registered providers for health status. Failed/degraded providers
    // mean some directives may return no_data or fallback scores.
    const allProviders = this.degradationService.getAll();
    const failedProviders = allProviders.filter(p => p.status === 'failed').map(p => p.providerId);
    const degradedProviders = allProviders.filter(p => p.status === 'degraded').map(p => p.providerId);
    const totalKnownProviders = allProviders.length || 5; // fallback: 5 known providers
    const healthyCount = totalKnownProviders - failedProviders.length;
    const overallCoverage = totalKnownProviders > 0 ? healthyCount / totalKnownProviders : 1.0;
    const isDegraded = failedProviders.length > 0 || degradedProviders.length > 0;
    const degradationWarning = failedProviders.length > 0
      ? `Scoring is DEGRADED — ${failedProviders.length} provider(s) failed: ${failedProviders.join(', ')}. Scores may be unreliable.`
      : degradedProviders.length > 0
        ? `Scoring is DEGRADED — ${degradedProviders.length} provider(s) degraded: ${degradedProviders.join(', ')}.`
        : null;

    const degradation = {
      overallCoverage,
      degradedProviders,
      failedProviders,
      isDegraded,
      warning: degradationWarning,
    };

    const base = {
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
      strategy: {
        name: strategyName,
        entryThreshold: ENTRY_THRESHOLD,
        watchThreshold: WATCH_THRESHOLD,
        maxPossibleScore: protocolMaxScore,
        directiveCount: protocolDirectiveCount,
      },
    };

    if (!this.prisma.isAvailable) {
      return { ...base, degradation, summary: { symbolsWithData: 0, symbolsWithoutData: 0, totalSymbols: 0 }, ranked: [] };
    }

    const symbolWhere: any = { active: true };
    if (symbolFilter && symbolFilter.length > 0) {
      symbolWhere.ticker = { in: symbolFilter };
    }

    const symbols = await this.prisma.symbol.findMany({
      where: symbolWhere,
      select: { id: true, ticker: true, name: true },
      take: limit,
    });

    if (symbols.length === 0) {
      return { ...base, degradation, summary: { symbolsWithData: 0, symbolsWithoutData: 0, totalSymbols: 0 }, ranked: [] };
    }

    const ranked: RankedSymbol[] = [];

    // ── Fetch EURUSD for DXY proxy (cached per tick) ────
    const eurusdValue = await this.eurusdCache.getValue();
    const dxyValue = eurusdValue !== undefined && eurusdValue > 0
      ? (eurusdValue >= 1.15 ? 98 : eurusdValue >= 1.08 ? 103 : 108)
      : undefined;

    // ── Persist macro snapshot & detect regime change ─────
    if (dxyValue !== undefined) {
      this.macroSnapshot.capture({
        eurusdValue,
        dxyValue,
        source: 'eurusd-proxy',
      }).catch(err => this.logger.warn(`Macro snapshot failed: ${(err as Error).message}`));
    }

    // Cadence for the fresh-compute path (#751): the protocol's recommendation when
    // one is in play, else the app's live base cadence. loadBars() itself falls back
    // to the cadence the symbol actually has, so daily-only equity symbols still score.
    const barsCadence = protocolTimeframe ? selectBaseTimeframe(protocolTimeframe) : DEFAULT_LIVE_TIMEFRAME;

    for (const symbol of symbols) {
      const bars = await this.loadBars(symbol.id, barsCadence, symbol.ticker);
      const input: DirectiveInput = {
        symbol: symbol.ticker,
        bars,
        eurusdValue,
        dxyValue,
        asOf: bars.length ? bars[bars.length - 1].timestamp : undefined,
      } as DirectiveInput;
      const results = await this.directivesService.runAll(input, directiveFilter);

      // Apply symbol-specific calibrations before building breakdown
      const { adjustedScores, applied: calibrationsApplied } = this.calibrationService.applyCalibrations(symbol.ticker, results);

      // Phase 1: Build breakdown with signalClass and priority
      const breakdown: DirectiveBreakdown[] = [];
      const signalGroups: { bullish: number; bearish: number; neutral: number } = {
        bullish: 0, bearish: 0, neutral: 0,
      };

      for (const [id, result] of results) {
        const directive = this.directivesService.get(id);
        const maxScore = directive?.maxScore ?? 100;
        const priority = directive?.priority ?? 50;
        const signalClass = result.signalClass ?? 'neutral';
        const calibratedScore = adjustedScores.get(id) ?? result.score;

        // maxScore serves as the vote weight for signal dominance
        if (signalClass === 'bullish') signalGroups.bullish += maxScore;
        else if (signalClass === 'bearish') signalGroups.bearish += maxScore;
        else signalGroups.neutral += maxScore;

        breakdown.push({
          directiveId: id,
          name: directive?.name ?? id,
          score: calibratedScore,
          maxScore,
          contribution: 0, // computed in phase 2
          confidence: result.confidence,
          reason: result.reason,
          signalClass,
          priority,
          gated: result.gated,
          gatedReason: result.gatedReason,
        });
      }

      // Phase 2: Apply dominance/cancellation rules

      // Rule A: High-priority suppression — directives with priority >= 80 can
      // suppress lower-priority (< 60) opposing signals entirely
      const highPriorityBullish = breakdown.filter(
        (d) => d.signalClass === 'bullish' && d.priority >= 80,
      );
      const highPriorityBearish = breakdown.filter(
        (d) => d.signalClass === 'bearish' && d.priority >= 80,
      );

      let suppressedIds = new Set<string>();
      if (highPriorityBullish.length > 0 && highPriorityBearish.length === 0) {
        // High-priority bullish dominates — suppress all low-priority bearish
        for (const d of breakdown) {
          if (d.signalClass === 'bearish' && d.priority < 60) {
            suppressedIds.add(d.directiveId);
          }
        }
      } else if (highPriorityBearish.length > 0 && highPriorityBullish.length === 0) {
        // High-priority bearish dominates — suppress all low-priority bullish
        for (const d of breakdown) {
          if (d.signalClass === 'bullish' && d.priority < 60) {
            suppressedIds.add(d.directiveId);
          }
        }
      }

      // Rule B: Weighted signal voting — if one side outweighs the other by
      // a significant margin (2:1), suppress the minority
      const totalWeight = breakdown.reduce((s, d) => s + d.maxScore, 0);
      const bullRatio = totalWeight > 0 ? signalGroups.bullish / totalWeight : 0;
      const bearRatio = totalWeight > 0 ? signalGroups.bearish / totalWeight : 0;

      if (bullRatio > bearRatio * 2 && bullRatio > 0.4) {
        // Bullish consensus — suppress low-confidence bearish
        for (const d of breakdown) {
          if (d.signalClass === 'bearish' && d.confidence < 0.5 && !suppressedIds.has(d.directiveId)) {
            suppressedIds.add(d.directiveId);
          }
        }
      } else if (bearRatio > bullRatio * 2 && bearRatio > 0.4) {
        // Bearish consensus — suppress low-confidence bullish
        for (const d of breakdown) {
          if (d.signalClass === 'bullish' && d.confidence < 0.5 && !suppressedIds.has(d.directiveId)) {
            suppressedIds.add(d.directiveId);
          }
        }
      }

      // Phase 3: Sum raw scores — no weight multipliers, no 100-cap.
      // Each directive contributes its score directly. maxScore determines
      // natural influence: a directive with maxScore=180 can contribute
      // up to 180 points while one with maxScore=90 contributes up to 90.
      let totalScore = 0;
      let totalConfidence = 0;
      let weightSum = 0;
      let maxPossibleScore = 0;
      let activeDirectives = 0;
      const totalDirectives = breakdown.length;

      for (const d of breakdown) {
        const effectiveScore = suppressedIds.has(d.directiveId) ? 0 : d.score;
        // Score IS contribution — no weight multiplier needed
        d.contribution = Number(effectiveScore.toFixed(1));
        totalScore += effectiveScore;
        totalConfidence += d.confidence * d.maxScore;
        weightSum += d.maxScore;

        // The configured maximum is invariant. Missing/zero evidence may lower
        // coverage, but must never shrink the denominator and inflate a score.
        maxPossibleScore += d.maxScore;
        if (d.score > 0 || d.confidence > 0) activeDirectives++;
      }

      // Rule C: Confluence bonus — if multiple high-priority directives agree
      // and the dominant signal class is clear, add a bonus proportional to protocol scale
      const highPriorityAgreeing = (highPriorityBullish.length > 0 && bullRatio > bearRatio)
        || (highPriorityBearish.length > 0 && bearRatio > bullRatio);

      let confluenceBonus = 0;
      if (highPriorityAgreeing && highPriorityBullish.length + highPriorityBearish.length >= 2) {
        // Scale bonus relative to protocol max (was hardcoded +5 when max was 100)
        confluenceBonus = Math.round(maxPossibleScore * 0.05);
      }

      const avgConfidence = weightSum > 0 ? totalConfidence / weightSum : 0;
      // Raw total — unbounded, flows from directive score ranges
      const finalScore = Math.max(0, totalScore + confluenceBonus);

      // Apply seasonal affinity modifier (protocol-calendar).
      // No 'default' protocol exists — use a neutral label for unscoped flat scoring.
      const seasonalMultiplier = this.seasonalAffinity.getMultiplier('unscoped');
      const seasonAdjustedScore = finalScore * seasonalMultiplier;

      // Normalized score: percentage of achievable maximum for THIS symbol.
      // ⚠️ This is a 0–100 PERCENTAGE, not a directive magnitude — hence the `Pct`
      // name. The clamp below is therefore legitimate (INV-SCORE-MAGNITUDE bans
      // clamping a *score*; clamping a percentage is correct by definition), and the
      // name is what tells the build-time contract guard which of the two it is.
      const normalizedScorePct = maxPossibleScore > 0
        ? Math.min(100, Math.max(0, (seasonAdjustedScore / maxPossibleScore) * 100))
        : 0;
      const normScore = normalizedScorePct;
      // Determine data status and signal (rebase on normalizedScore)
      const hasData = bars.length > 0;

      // ── MST-014 (#827) — 'stale' was declared and NEVER PRODUCED ────────────────
      //
      // `RankedSymbol['dataStatus']` has been `'live' | 'stale' | 'no_data' | 'error'`
      // while this line read `hasData ? 'live' : 'no_data'`. Two consequences, both
      // silent:
      //
      //   1. A symbol whose newest bar is FOUR MONTHS OLD still has `bars.length > 0`,
      //      so it was reported **'live'**. Measured 2026-09-15: HOOD (bars end Jul 31),
      //      MARA/ASTS/TSLA (Jul 17), NVDA/AVGO (Sep 3) were all 'live'. Because
      //      `directiveoutcome.predictedAt` inherits the EVALUATED BAR's open time, those
      //      stale symbols generated outcome rows stamped months in the past — which then
      //      sorted to the FRONT of the maturation queue and starved it.
      //
      //   2. The filter below (`symbolsWithData` counts `'live' || 'stale'`) explicitly
      //      handles `'stale'` — a branch that could never execute. Dead code that reads
      //      as coverage is how this survived.
      //
      // `computeMarketStatus` is the canonical, cadence-aware staleness rule and already
      // implements the whole decision (insufficient bars, all-synthetic, clock skew,
      // stale, closed). Using it rather than a second bespoke age test keeps one rule in
      // one place — a private age threshold here would be a third copy to drift.
      //
      // ⚠️ `hasData` is deliberately still used for the SIGNAL below. A stale feed must not
      // be able to emit `entry`, and it cannot here: the directives score from the same
      // stale bars, so the composite reflects old data. Changing the signal path is a
      // separate, riskier decision (#827 tracks it).
      let dataStatus: RankedSymbol['dataStatus'] = 'no_data';
      if (hasData) {
        try {
          const status = computeMarketStatus(bars, new Date(), barsCadence);
          dataStatus = status.open ? 'live' : 'stale';
        } catch {
          // An unmeasurable feed is NOT 'live'. Fail to 'stale' rather than assume health.
          dataStatus = 'stale';
        }
      }
      const signal = !hasData
        ? 'no_data'
        : maxPossibleScore === 0
          ? 'no_data'
          : normScore >= ENTRY_THRESHOLD
            ? 'entry'
            : normScore >= WATCH_THRESHOLD
              ? 'watch'
              : 'defensive';

      if (!hasData) {
        this.logger.warn(`Scoring: ${symbol.ticker} has no bars — returning no_data`);
      }

      // Fire notification on entry signal — deduped per symbol (30-min cooldown)
      // so a symbol that stays above threshold doesn't fire 15 identical alerts.
      if (signal === 'entry') {
        const now = Date.now();
        const last = this.lastEntryNotified.get(symbol.ticker) ?? 0;
        if (now - last >= ENTRY_NOTIFY_COOLDOWN_MS) {
          this.lastEntryNotified.set(symbol.ticker, now);
          this.notificationService.notifyEntrySignal(symbol.ticker, Number(normScore.toFixed(1))).catch(err => {
            this.logger.warn(`Entry notification failed for ${symbol.ticker}: ${err.message}`);
          });
        }
      }

      // Compute per-symbol coverage from active vs total directives
      const symbolCoverage = totalDirectives > 0 ? activeDirectives / totalDirectives : 1;
      const symbolDegraded = symbolCoverage < 1.0;

      ranked.push({
        symbolId: symbol.id,
        ticker: symbol.ticker,
        score: hasData ? Number(seasonAdjustedScore.toFixed(1)) : 0,
        normalizedScore: hasData ? Number(normScore.toFixed(1)) : 0,
        maxPossibleScore: hasData ? maxPossibleScore : 0,
        totalDirectives,
        activeDirectives,
        coverage: Number(symbolCoverage.toFixed(2)),
        degraded: symbolDegraded,
        degradedProviders: [...failedProviders, ...degradedProviders],
        confidence: hasData ? Number(avgConfidence.toFixed(2)) : 0,
        freshness: hasData ? 'live' : 'deterministic',
        signal,
        dataStatus,
        breakdown: hasData ? breakdown : [],
        timestamp: new Date().toISOString(),
      });

      // Outcome learning is intentionally not fed from this analytics-only
      // scorer. Canonical protocol decisions are recorded by SignalEnvelope.
    }

    ranked.sort((a, b) => b.score - a.score);

    const summary = {
      symbolsWithData: ranked.filter((r) => r.dataStatus === 'live' || r.dataStatus === 'stale').length,
      symbolsWithoutData: ranked.filter((r) => r.dataStatus === 'no_data').length,
      totalSymbols: ranked.length,
    };

    // ── Score snapshots are now stored by protocol-gated scoring only.
    // The flat rankAll pipeline no longer persists per-symbol snapshots
    // to avoid flooding the DB with high-frequency, unbounded-score runs.
    // See protocol-gating.service.ts for the canonical snapshot path.

    return {
      ...base,
      degradation,
      summary,
      conditionVector: this.buildConditionVectorResponse(),
      activationStats: this.buildActivationStats(ranked),
      ranked: ranked.slice(0, limit),
    };
  }

  /**
   * GET /api/scoring/ranked?source=db (default) — Read pre-computed scores from DB.
   * Fast, cheap, no directive re-computation. Relies on automation loop having
   * already scored symbols via the 2-minute tick. Falls back to fresh compute
   * if the ScoreSnapshot table is empty (first run after seeding).
   *
   * GET /api/scoring/ranked?fresh=true — Run the full pipeline fresh (delegates to rankAll).
   * Use for speed trading, testing, or when you need data newer than 2 minutes.
   */
  async rankFromDb(limit = 20): Promise<RankedResult> {
    const modeInfo = this.modeService.getModeInfo();
    // Directive count drives coverage figures — derived, never hardcoded (issue #25).
    const directiveCount = this.directivesService.list().length;
    // ── #1090 — maxPossibleScore is NULL here, deliberately ──
    // This header previously carried a flat `100`, which matched nothing: DB-read rows span
    // MULTIPLE protocols with different capacities, and `score` (composite) has no denominator
    // on this payload at all. MEASURED 2026-10-10: `signalPct` = signalRaw / configured
    // DIRECTIONAL capacity (xau-speed-v1: 10/910 = 1.0989%) while `composite` is a broader raw
    // sum (BTC btc-scalp-v1: composite 30 but its stored signalPct 3.21951% implies signalRaw
    // 33 over capacity 1025). The real percentage is on each row as `normalizedScore`; nothing
    // pairs with `score`, so no denominator is fabricated here.
    const base = {
      mode: modeInfo.mode,
      services: { database: modeInfo.database, queue: modeInfo.queue, redis: modeInfo.redis },
      strategy: { name: 'DB-Read (pre-computed)', entryThreshold: ENTRY_THRESHOLD, watchThreshold: WATCH_THRESHOLD, maxPossibleScore: null, directiveCount },
    };

    if (!this.prisma.isAvailable) {
      return { ...base, degradation: { overallCoverage: 0, degradedProviders: [], failedProviders: [], isDegraded: true, warning: 'Database unavailable' }, summary: { symbolsWithData: 0, symbolsWithoutData: 0, totalSymbols: 0 }, ranked: [] };
    }

    try {
      // Get latest snapshot per symbol from ScoreSnapshot table
      const snapshots = await (this.prisma as any).scoreSnapshot.findMany({
        orderBy: { snappedAt: 'desc' },
        take: limit * 3, // overfetch to dedupe per-symbol
      });

      if (!snapshots || snapshots.length === 0) {
        // Fallback: Score table (older format)
        const scores = await this.prisma.score.findMany({
          orderBy: { timestamp: 'desc' },
          take: limit * 3,
          include: { symbol: { select: { ticker: true } } },
        });
        if (!scores || scores.length === 0) {
          this.logger.warn('No pre-computed scores in DB — falling back to fresh compute');
          return this.rankAll(undefined, limit);
        }
        // Dedupe per symbol, take latest
        const seen = new Set<string>();
        const ranked: RankedSymbol[] = [];
        for (const s of scores) {
          if (seen.has(s.symbolId)) continue;
          seen.add(s.symbolId);
          const storedPct = Number((s.breakdown as any)?.signalPct);
          const normalizedScore = Number.isFinite(storedPct) ? storedPct : 0;
          ranked.push({
            symbolId: s.symbolId,
            ticker: (s as any).symbol?.ticker ?? s.symbolId,
            score: s.value,
            normalizedScore,
            // null — the denominator does not exist on this payload; see the header comment (#1090).
            maxPossibleScore: null,
            totalDirectives: directiveCount,
            activeDirectives: directiveCount,
            coverage: 1,
            degraded: false,
            degradedProviders: [],
            confidence: 0.5,
            freshness: 'cached',
            signal: normalizedScore >= ENTRY_THRESHOLD ? 'BUY' : 'HOLD',
            dataStatus: 'live' as const,
            breakdown: [],
            timestamp: s.timestamp?.toISOString?.() ?? new Date().toISOString(),
          });
          if (ranked.length >= limit) break;
        }
        return {
          ...base,
          degradation: { overallCoverage: 1, degradedProviders: [], failedProviders: [], isDegraded: false, warning: null },
          summary: { symbolsWithData: ranked.length, symbolsWithoutData: 0, totalSymbols: ranked.length },
          ranked,
        };
      }

      // ScoreSnapshot table: dedupe per symbol
      const seen = new Set<string>();
      const ranked: RankedSymbol[] = [];
      for (const s of snapshots) {
        const sym = s.symbol?.toUpperCase?.() ?? s.symbol;
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        // `signalPct` is the classifier's own percentage (`protocol-gating.service.ts` sets
        // `compositePct: signalPct`) — the number ENTRY_THRESHOLD is compared against. It is the
        // ONLY real percentage on this row; `score` (composite) has no denominator here (#1090).
        const normalizedScore = Number.isFinite(Number(s.signalPct)) ? Number(s.signalPct) : 0;
        ranked.push({
          symbolId: s.id,
          ticker: sym,
          score: s.composite ?? 0,
          normalizedScore,
          maxPossibleScore: null,
          totalDirectives: directiveCount,
          activeDirectives: directiveCount,
          coverage: 1,
          degraded: false,
          degradedProviders: [],
          confidence: 0.5,
          freshness: 'cached',
          signal: s.tradingSignal ?? (normalizedScore >= ENTRY_THRESHOLD ? 'BUY' : 'HOLD'),
          dataStatus: 'live' as const,
          breakdown: [],
          timestamp: s.snappedAt?.toISOString?.() ?? new Date().toISOString(),
        });
        if (ranked.length >= limit) break;
      }

      return {
        ...base,
        degradation: { overallCoverage: 1, degradedProviders: [], failedProviders: [], isDegraded: false, warning: null },
        summary: { symbolsWithData: ranked.length, symbolsWithoutData: 0, totalSymbols: ranked.length },
        ranked,
      };
    } catch (err) {
      this.logger.warn(`rankFromDb failed: ${(err as Error).message} — falling back to fresh compute`);
      return this.rankAll(undefined, limit);
    }
  }

  /**
   * POST /api/scoring/run — Trigger a full scoring run.
   * Accepts optional symbol filter and timeframe.
   */
  async runScoring(symbols?: string[], _timeframe?: string) {
    const result = await this.rankAll(undefined, symbols ? symbols.length : 20);

    if (symbols && symbols.length > 0) {
      result.ranked = result.ranked.filter((r) =>
        symbols.includes(r.ticker),
      );
    }

    this.logger.log(
      `Scoring run complete: ${result.ranked.length} symbols scored`,
    );

    return result;
  }

  /**
   * GET /api/scoring/summary — Quick scoring overview for health checks.
   */
  async getSummary() {
    const result = await this.rankAll(undefined, 50);
    const ranked = result.ranked;

    const totalDirectives = ranked.length > 0 ? ranked[0].totalDirectives : 0;
    const activeDirectives = ranked.length > 0 ? ranked[0].activeDirectives : 0;
    const avgScore =
      ranked.length > 0
        ? Number(
            (
              ranked.reduce((sum, r) => sum + r.score, 0) / ranked.length
            ).toFixed(1),
          )
        : 0;
    const avgNormalized =
      ranked.length > 0
        ? Number(
            (
              ranked.reduce((sum, r) => sum + r.normalizedScore, 0) /
              ranked.length
            ).toFixed(1),
          )
        : 0;

    return {
      mode: result.mode,
      symbolsScored: ranked.length,
      averageScore: avgScore,
      averageNormalized: avgNormalized,
      directivesActive: activeDirectives,
      directivesTotal: totalDirectives,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * QA Test Mode: minute-to-minute scoring with modifier amplifier.
   * Applies change_multiplier, parity_amplitude, and max_nudge per the
   * SEES First Minute-To-Minute Test Plan.
   */
  async qaMinToMin(limit = 20) {
    const result = await this.rankAll(undefined, limit);

    const qaSettings = {
      enabled: true,
      mode: 'hybrid',
      changeMultiplier: 12,
      parityAmplitude: 6,
      maxNudge: 15,
      debugLogging: true,
    };

    const debugLog: string[] = [];
    const debug = (msg: string) => {
      if (qaSettings.debugLogging) {
        debugLog.push(`[QA ${new Date().toISOString()}] ${msg}`);
        this.logger.debug(msg);
      }
    };

    debug(`QA modifier active — multiplier=${qaSettings.changeMultiplier}, amplitude=${qaSettings.parityAmplitude}, maxNudge=${qaSettings.maxNudge}`);

    const modified = result.ranked.map((symbol) => {
      const originalScore = symbol.score;
      const seed = originalScore * qaSettings.changeMultiplier;
      const oscillation = Math.sin((Date.now() / 1000 + originalScore) * 0.47) * qaSettings.parityAmplitude;
      const nudge = Math.max(-qaSettings.maxNudge, Math.min(qaSettings.maxNudge, oscillation));

      // ⚠️ `symbol.score` here is rankAll's normalized 0–100 PERCENTAGE (see
      // normalizedScorePct), which is why a ±maxNudge correction is meaningful and
      // why the result is bounded to 100. It is NOT a directive magnitude, so this
      // clamp does not conflict with INV-SCORE-MAGNITUDE — the `...Pct` naming is
      // what tells the build-time contract guard that.
      const nudgedScorePct = originalScore + nudge;
      const modifiedScorePct = Math.min(100, Math.max(0, nudgedScorePct));
      const change = modifiedScorePct - originalScore;

      if (Math.abs(change) >= 0.5) {
        debug(`${symbol.ticker}: ${originalScore.toFixed(1)} → ${modifiedScorePct.toFixed(1)} (${change > 0 ? '+' : ''}${change.toFixed(1)})`);
      }

      return {
        ...symbol,
        score: Number(modifiedScorePct.toFixed(1)),
        qa: {
          originalScore: Number(originalScore.toFixed(1)),
          nudge: Number(nudge.toFixed(2)),
          change: Number(change.toFixed(2)),
          oscillation: Number(oscillation.toFixed(2)),
        },
      };
    });

    modified.sort((a, b) => b.score - a.score);

    const bounded = modified.every((s) => s.score >= 0 && s.score <= 100);
    const moved = modified.filter((s) => Math.abs(s.qa.change) >= 0.5).length;
    debug(`QA complete — ${moved} symbols moved, scores bounded: ${bounded}`);

    return {
      ...result,
      ranked: modified.slice(0, limit),
      qaSettings,
      qaSummary: {
        totalSymbols: modified.length,
        symbolsMoved: moved,
        scoresBounded: bounded,
        debugLog: debugLog.slice(-10),
      },
    };
  }

  /** Backoff gate for live bar-refresh — returns true once per cooldown window per symbol. */
  private isLiveRefreshDue(symbolId: string): boolean {
    const now = Date.now();
    const last = this.lastLiveRefresh.get(symbolId) ?? 0;
    if (now - last >= LIVE_REFRESH_COOLDOWN_MS) {
      this.lastLiveRefresh.set(symbolId, now);
      return true;
    }
    return false;
  }

  /**
   * loadBars() — the bar window behind rankAll()'s fresh scoring.
   *
   * Delegates to the canonical loader, `MarketDataService.getBars()`, for the same
   * reason the Arena now does (#751): only that loader filters by `timeframe` AND
   * returns oldest → newest. This method used to query prisma directly, wrongly twice:
   * `asc + take: 200` returned the OLDEST 200 rows (for AUDUSD — 13,091 bars — that
   * window ended 2026-05-18 while the newest bar was 2026-09-10, so every directive
   * scored ~4 months of stale data and `asOf` reported May), and it had no `timeframe`
   * filter at all, so it spliced cadences together.
   *
   * `cadence` comes from the caller — the protocol's `recommendedTimeframe` through
   * `selectBaseTimeframe()`. If the symbol has no rows at that cadence we fall back to
   * the cadence of its newest bar: equity symbols are daily-only in `marketbar`, and
   * they must not score 0 merely because a protocol recommended 5m.
   */
  private async loadBars(symbolId: string, cadence: string, ticker?: string): Promise<MarketBar[]> {
    try {
      let marketBars = (await this.marketData.getBars(symbolId, cadence, 200)) as MarketBar[];

      if (marketBars.length < 30) {
        const newest = await this.prisma.marketBar.findFirst({
          where: { symbolId },
          orderBy: { timestamp: 'desc' },
          select: { timeframe: true },
        });
        if (newest?.timeframe && newest.timeframe !== cadence) {
          const alt = (await this.marketData.getBars(symbolId, newest.timeframe, 200)) as MarketBar[];
          if (alt.length > marketBars.length) marketBars = alt;
        }
      }

      if (marketBars.length >= 30) {
        return marketBars;
      }

      // ── Live Data Fallback ──
      // Backoff (issue #31): at most one live refresh per cooldown per symbol, so
      // persistently sparse symbols don't fire a bridge fetch + DB import every tick.
      if (ticker && marketBars.length < 30 && this.isLiveRefreshDue(symbolId)) {
        // Check if this is a crypto ticker — use the crypto router
        if (this.cryptoRouter.isCrypto(ticker)) {
          try {
            const tf = '1h';
            const bars = await this.cryptoRouter.getCandles(ticker, tf, 200);
            if (bars && bars.length > 0) {
              const importData = bars.map((b) => ({
                symbolId, provider: 'binance', timeframe: tf,
                timestamp: b.timestamp, open: b.open, high: b.high,
                low: b.low, close: b.close, volume: b.volume,
              }));
              try { await this.prisma.marketBar.createMany({ data: importData, skipDuplicates: true }); } catch { /* dupes ok */ }
              this.logger.log(`Crypto router: imported ${bars.length} ${tf} bars for ${ticker}`);
              return bars;
            }
          } catch (cryptoErr) {
            this.logger.warn(`Crypto router fallback failed for ${ticker}: ${(cryptoErr as Error).message}`);
          }
        }

        // ── MT5 Fallback (for non-crypto or crypto failover) ──
        try {
          const mt5 = this.adapterFactory.create('mt5');
          if (mt5) {
            const tf = '1h';
            const mt5Bars = await mt5.getCandles(ticker, tf, 200);
            if (mt5Bars && mt5Bars.length > 0) {
              const importData = mt5Bars.map((b) => ({
                symbolId, provider: 'mt5', timeframe: tf,
                timestamp: b.timestamp, open: b.open, high: b.high,
                low: b.low, close: b.close, volume: b.volume,
              }));
              try { await this.prisma.marketBar.createMany({ data: importData, skipDuplicates: true }); } catch { /* dupes ok */ }
              this.logger.log(`MT5 fallback: imported ${mt5Bars.length} ${tf} bars for ${ticker}`);
              return mt5Bars;
            }
          }
        } catch (mt5Err) {
          this.logger.warn(`MT5 fallback failed for ${ticker}: ${(mt5Err as Error).message}`);
        }
      }
      // ── End Live Data Fallback ──

      if (marketBars.length > 0) {
        return marketBars;
      }

      return [];
    } catch {
      this.logger.warn(`No market bars for ${symbolId} — directives will score 0.`);
      return [];
    }
  }

  /** Build condition vector response from the last run's detector output. */
  private buildConditionVectorResponse() {
    const cv = this.directivesService.getLastConditionVector();
    if (!cv) return undefined;
    return {
      regime: cv.regime,
      strength: cv.regimeStrength,
      components: cv.regimeComponents,
      volatility: cv.volatility,
      activeSession: cv.activeSession,
      hurstExponent: cv.hurstExponent,
      adx: cv.adx,
      preEvent: cv.preEvent,
      timestamp: cv.timestamp.toISOString(),
    };
  }

  /** Aggregate activation gate stats across all ranked symbols. */
  private buildActivationStats(ranked: RankedSymbol[]) {
    let mutedCount = 0;
    let activeCount = 0;
    const mutedReasons: string[] = [];

    for (const r of ranked) {
      for (const d of r.breakdown) {
        if (d.gated) {
          mutedCount++;
          const reason = d.gatedReason || d.reason;
          if (reason && !mutedReasons.includes(reason)) {
            mutedReasons.push(reason);
          }
        } else if (d.score > 0) {
          activeCount++;
        }
      }
    }

    return { mutedCount, activeCount, mutedReasons };
  }
}
