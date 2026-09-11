/**
 * ProtocolGatingService — STAGE 1b of the META.Stack pipeline.
 * =============================================================
 * ROLE: Score a symbol using only the directives registered to a specific
 *       protocol. This is the SAME scoring stage as ScoringService, just
 *       filtered to protocol-specific directive groups. Still computes
 *       scores — does NOT apply ScoringStrategy gates or make trade decisions.
 *
 * PIPELINE POSITION:
 *   Protocol definition → ProtocolGatingService.scoreWithGating()
 *   → score returned (cached per tick) → ScoringStrategy applies gates later
 *
 * CONTRACT:
 *   INPUT:  symbol ticker + market bars + protocolId
 *   OUTPUT: GatedScore { composite, signal, subScores, riskMultiplier }
 *   NEVER:  evaluates thresholds, opens positions, or persists decisions
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DirectivesService, is24HourMarket } from '../directives/directives.service';
import { PrismaService } from '../../database/prisma.service';
import {
  DirectiveInput,
  DirectiveResult,
} from '../directives/interfaces/directive.interface';
import {
  DIRECTIVE_GROUPS,
  DirectiveGroup,
} from '../directives/directive-groups';
import { classifyDirectiveInclusion, isDirectiveReady } from '../directives/directive-inclusion';
import { computeMarketStatus } from '../directives/market-status';
import { AdapterFactory } from '../providers/adapter-factory';
import { MacroSnapshotService } from './macro-snapshot.service';
import { EurUsdCacheService } from './eurusd-cache.service';
import { ProtocolDbService } from './protocol-db.service';
import { MarketDataService } from '../market-data/market-data.service';
import { MarketCalendarService } from '../calendar/market-calendar.service';
import { DirectiveConfigService } from './directive-config.service';
import { isScoringDemo } from '../../config/scoring-mode';
import {
  RiskGatingEngine,
  RiskDirectiveResult,
  RiskGateResult,
} from './risk-gating-engine.service';
import { normalizeScorePercent, selectDirectionalEvidence } from './score-units';

/**
 * Weighting Systems
 * =================
 * ⚠️ READ THE CURRENT RULE FIRST — this header used to describe a formula the
 * code no longer implements, and that stale description is the most likely
 * reason three protocols were built unable to trade (2026-09-10).
 *
 * WHAT THE COMPOSITE ACTUALLY IS NOW
 * ----------------------------------
 *     composite = (directional raw / directional capacity) × riskMultiplier
 *
 * Only directives whose RUNTIME `signalClass` is `bullish` (in a LONG_ONLY or
 * BOTH protocol) or `bearish` (SHORT_ONLY or BOTH) contribute. A directive with
 * `directionBias: 'neutral'` scores, is reported in `breakouts`, and adds
 * EXACTLY ZERO to the composite — however high it scores. Groups marked
 * `isRiskGate` are excluded from the signal entirely.
 *
 * ⚠️ CONSEQUENCE — capacity is not tradable capacity. A protocol can declare
 * 1,075 points of maxScore and still be unable to reach its own threshold if
 * most of those points sit on neutral directives. Live proof: `ftse-speed-v1`,
 * `dax-speed-v1` and `cac-speed-v1` each carry ~815 points of NEUTRAL technical
 * directives around a single 80-point directional one (`analyst-adjustments`),
 * so their all-time maximum composite is **31** against a `minComposite` of 65.
 * Across their whole history they have cleared the gate **0 times**, while
 * `forex-session-v1` cleared it 1,168 times and `xau-speed-v1` 86 times.
 * Before adding a directive to a protocol, check whether it can emit a
 * `signalClass` — a neutral directive is a display metric, not a signal.
 *
 * (Historical note — the old formula was
 * `(technical × 0.40 + sentiment × 0.35) × riskMultiplier`, i.e. group weights
 * over NORMALIZED group scores, with gates multiplying. That was removed when
 * scoring moved to directional-only evidence. `weightStrategy` below now selects
 * between two DENOMINATOR conventions, not group weighting.)
 *
 * The engine supports two denominator conventions, selectable per MetaStack:
 * both operate on DIRECTIONAL evidence only — they differ in what they divide by:
 *
 * 1. 'group-weighted' (default, misleading name): normalizes the directional raw
 *    total against the protocol's CONFIGURED directional capacity
 *    (`capacityMaxTotal`, INV-STABLE-DENOMINATOR). Stable over time — the same
 *    market condition scores the same on every tick.
 *
 * 2. 'maxscore-weighted': divides by the OBSERVED evidence sum for this tick.
 *    Because that denominator moves whenever a directive goes quiet, the same
 *    reading scores differently between ticks; retained for A/B comparison and
 *    screening, not for execution decisions.
 *
 * ⚠️ NEITHER convention makes a neutral directive count. The distinction between
 * them is the DENOMINATOR only. If a protocol's compositor is too small to clear
 * its threshold, the fix is to give it directional directives, not to switch
 * weightStrategy.
 *
 * The weightStrategy is stored on ScoringStrategy and defaults to 'group-weighted'.
 *
 * ⚠️ IMPLEMENTATION NOTE (2026-09-03): the composite today is the RAW sum of
 * directional directive scores (risk-multiplied), NOT the weighted formula
 * above. `config.weight` is not applied in scoreWithGating's assembly — empty
 * or low-weight groups therefore cannot drag the composite, but the weights
 * shown in the registry are aspirational until #718 lands per-protocol gates.
 * Do not tune group weights expecting the documented formula to hold.
 */

// ─── Result Types ────────────────────────────────────────

export interface DirectiveBreakout {
  directiveId: string;
  name: string;
  score: number;
  maxScore: number;
  normalizedScore: number;
  signalClass: string;
  reason: string;
  groupId: string;
  /** True when this directive contributed to the directional Signal score (Phase C). */
  inSignal: boolean;
  /**
   * True when the directive could not take a reading this tick (stale data,
   * insufficient bars) — `score: 0` here means "no measurement", NOT "measured
   * zero". The risk engine MUST NOT derive severity from it: doing so turned
   * `liquidity-check`'s stale-data guard into a hard gate that vetoed the trade
   * and blamed illiquidity (2026-09-10). See `DirectiveResult.unmeasured`.
   */
  unmeasured?: boolean;
}

export type RarityBand = 'standard' | 'strong' | 'exceptional' | 'cyclical' | 'black-swan';

export interface RarityInfo {
  percentile: number;
  band: RarityBand;
  label: string;
  color: string;
  emoji: string;
  description: string;
  sizeMultiplier: number;
  sampleSize: number;
}

export interface GatedScore {
  symbol: string;
  /** Risk-adjusted raw directional score. Never compare this value to a percentage threshold. */
  composite: number;
  /** Pre-risk raw score for the selected evidence direction. */
  signalRaw: number;
  /** The DENOMINATOR for `signalPct` — the protocol's CONFIGURED directional capacity
   *  (`meta.configuredSignalMax`). Fixed by config, so it is stable between ticks and
   *  identical across symbols. `signalRaw / signalMax` is exactly `signalPct`, and it is the
   *  same pair the persisted `rawMax` uses.
   *
   *  ⚠️ This is NOT the observed evidence sum. That is `meta.observedSignalMax` and is
   *  diagnostic only — it shrinks when a directive reads neutral, which inflates the
   *  percentage. Do not divide by `subMaxTotals`/`observedSignalMax` (#758 follow-up). */
  signalMax: number;
  /** Unrounded normalized signal percentage. Round only at presentation boundaries. */
  signalPct: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  /** Group id → 0-100 directional percentage.
   *  CONTRACT: an ABSENT key means the group is not participating (empty config,
   *  no directional contribution, or a gate group) — it must read as NEUTRAL
   *  downstream (e.g. `subScores['risk'] ?? 50`), never as 0. A present 0 is a
   *  real "zero directional conviction", a distinct thing from "not scored".
   *  See inactiveGroupIds for the explicit list. */
  subScores: Record<string, number>;
  subRawTotals: Record<string, number>;
  subMaxTotals: Record<string, number>;
  riskMultiplier: number;
  breakouts: Record<string, DirectiveBreakout[]>;
  gatingActive: boolean;
  /** Opportunity score (Phase C dual-score model) — the additive "everything counts"
   *  total used for SCREENING / ranking across symbols. Includes gates + conditions. */
  opportunityScore: number;
  opportunityMax: number;
  opportunityPct: number;
  /** Group ids that produced NO directive results this run (empty groups in config,
   *  all-alpha exclusions, or no data). They are omitted from subScores so they read
   *  as neutral (not 0) downstream — a missing group must not manufacture divergences
   *  or depress composites (#716 follow-up, 2026-09-03). */
  inactiveGroupIds: string[];
  rarity?: RarityInfo;
  riskGate?: {
    hardGateTriggered: boolean;
    hardGateReason: string | null;
    multiplierChain: import('./risk-gating-engine.service').MultiplierStep[];
    warnings: string[];
    riskScore: number;
  };
  meta: {
    /** @deprecated Compatibility alias for signalPct. Do not use for new code. */
    compositePct: number;
    maxScore: number;
    directiveCount: number;
    gatedCount: number;
    riskDirectiveCount: number;
    weightStrategy: 'group-weighted' | 'maxscore-weighted';
    /** Readiness tier counts: ready/beta/alpha. Alpha directives are excluded from scoring. */
    readinessBreakdown: { ready: number; beta: number; alpha: number; alphaExcluded: number };
    /** Direction-separated runtime evidence. Added 2026-09-08 to prevent bearish points becoming BUY strength. */
    directionalEvidence: {
      bullishRaw: number;
      bullishMax: number;
      bullishPct: number;
      bearishRaw: number;
      bearishMax: number;
      bearishPct: number;
      selected: 'bullish' | 'bearish' | 'none';
    };
    // ── #758 stable denominator — see docs/scoring-architecture.md ──
    /** How `signalPct` was derived. Always 'configured-capacity': `signalPct` divides by the
     *  protocol's configured directional capacity, which is fixed by config and therefore
     *  stable between ticks and identical across symbols. */
    denominatorMode: 'configured-capacity';
    /** Configured directional capacity: sum of maxScores of every non-gate directive admitted
     *  into the protocol. Independent of what fired this tick. THIS is the denominator for BOTH
     *  the classification percentage (`signalPct`) and the persisted `rawMax`. */
    configuredSignalMax: number;
    /** Observed directional capacity: sum of maxScores of directives that actually produced
     *  directional evidence this tick. DIAGNOSTIC ONLY — it shrinks when a directive reads
     *  neutral, so dividing by it inflates the percentage. Never use it as a denominator. */
    observedSignalMax: number;
    /** Count of directives eligible to express direction (matches `configuredSignalMax`). */
    directionEligibleDirectives: number;
  };
  /** Readiness gate (#627) — protocols are only eligible when every included directive is ready. */
  readinessGate?: {
    ready: boolean;
    blockers: { directiveId: string; name: string; readiness: string }[];
    reason?: string;
  };
  /** Market-open status (#638 phase A). `open` = safe to trade (calendar open
   *  AND data fresh); `stale` = market open but data stale (#732). */
  marketStatus?: {
    open: boolean;
    /** True when the market is open per the calendar but the data feed is stale. */
    stale?: boolean;
    asOf: string | null;
    reason?: string;
  };
  /** Directives excluded from the composite due to ALPHA readiness. */
  excludedBreakdown: { directiveId: string; name: string; reason: string }[];
  /**
   * Protocol direction intent (#684): 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH'.
   * BUY/SELL labels already encode this — the raw mode is returned so the
   * Signals UI can distinguish "open short (CFD)" from "close long (stock)".
   */
  directionMode: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH';
}

// ─── Rarity Bands ────────────────────────────────────────

const RARITY_BANDS: Record<RarityBand, Omit<RarityInfo, 'percentile' | 'sampleSize'>> = {
  'standard': {
    band: 'standard', label: 'Standard', color: '#22c55e', emoji: '🟢',
    description: 'Common opportunity — trade with base size', sizeMultiplier: 1.0,
  },
  'strong': {
    band: 'strong', label: 'Strong', color: '#3b82f6', emoji: '🔵',
    description: 'Above-average convergence — scale up 1.5×', sizeMultiplier: 1.5,
  },
  'exceptional': {
    band: 'exceptional', label: 'Exceptional', color: '#8b5cf6', emoji: '🟣',
    description: 'Rare alignment — scale up 2×', sizeMultiplier: 2.0,
  },
  'cyclical': {
    band: 'cyclical', label: 'Cyclical', color: '#f59e0b', emoji: '🟡',
    description: 'Multi-year event — maximum conviction', sizeMultiplier: 2.5,
  },
  'black-swan': {
    band: 'black-swan', label: 'Black Swan', color: '#ef4444', emoji: '🔴',
    description: 'Unprecedented — verify data before trading', sizeMultiplier: 0,
  },
};

// ─── Directive IDs that need EURUSD/DXY ────────────────────

/** Directives that read `eurusdValue` from DirectiveInput for DXY proxy logic. */
const EURUSD_DEPENDENT_DIRECTIVES = new Set([
  'dxy-regime',
  'cad-usd-oil-correlation',
  'gold-macro-correlation',
]);

/** Returns true if any of the active directive groups includes a EURUSD-dependent directive. */
function protocolNeedsEurUsd(groups: DirectiveGroup[]): boolean {
  for (const group of groups) {
    for (const id of group.directiveIds) {
      if (EURUSD_DEPENDENT_DIRECTIVES.has(id)) return true;
    }
  }
  return false;
}

// ─── Thresholds ──────────────────────────────────────────

/**
 * Signal classification thresholds — PERCENTAGE-BASED (2026-08-13).
 *
 * The composite is a simple additive sum of all directive raw scores.
 * Signal labels are derived from the percentage of the protocol's own
 * maxScore, so protocols of any size (maxScore=200 or maxScore=2000)
 * share identical semantics.
 *
 *   compositePct = (composite / protocolMaxScore) × 100
 *   ≥ 80% → STRONG_BUY / STRONG_SELL
 *   ≥ 40% → BUY / SELL
 *   ≥ 20% → HOLD
 *   < 20% → SELL (LONG_ONLY → HOLD)
 *
 * ⚠️ HISTORICAL NOTE ⚠️
 * The previous design used ABSOLUTE constants (ENTRY_THRESHOLD=40,
 * HOLD_FLOOR=20) calibrated for an old 0-100 percentage scale. When the
 * composite moved to raw scores (hundreds), those constants silently broke
 * — every composite ≥ 40 was classified BUY/SELL. That caused the
 * over-production of BUY signals reported on 2026-08-12.
 *
 * Absolute thresholds cannot serve custom protocols with wildly different
 * maxScores. Percentage-based classification is the only scalable design.
 * The constants below are now percentage points (not absolute scores).
 */
const ENTRY_THRESHOLD = 40;   // % of maxScore — BUY/SELL above this; below = HOLD (no directional edge)

/**
 * The pre-gate raw composite for Adaptive Target purposes — the sum of the per-group RAW
 * totals (directional + non-directional), which is the same figure persisted as
 * `breakdown.rawComposite`.
 *
 * Takes `breakdownData` rather than a number so the Adaptive Target path and the persisted
 * `rawComposite` cannot drift apart: both read `subRawTotals` through this one function.
 */
function rawCompositeForAdaptiveTarget(breakdownData: { subRawTotals?: Record<string, number> }): number {
  return Object.values(breakdownData?.subRawTotals ?? {}).reduce((a, b) => a + (b ?? 0), 0);
}

// ─── Service ─────────────────────────────────────────────

@Injectable()
export class ProtocolGatingService {
  private readonly logger = new Logger(ProtocolGatingService.name);

  constructor(
    private readonly directivesService: DirectivesService,
    private readonly prisma: PrismaService,
    private readonly riskEngine: RiskGatingEngine,
    private readonly adapterFactory: AdapterFactory,
    private readonly macroSnapshot: MacroSnapshotService,
    private readonly eurusdCache: EurUsdCacheService,
    private readonly protocolDb: ProtocolDbService,
    private readonly configService: DirectiveConfigService,
    private readonly marketData: MarketDataService,
    private readonly marketCalendar: MarketCalendarService,
  ) {}

  /**
   * Load the higher-timeframe bundle (1d/1h/15m) for a symbol, sized to the
   * protocol's declared min-bars. Callers that only have base bars pass the
   * result as `higherTfBars` so multi-timeframe directives receive real data
   * instead of silently scoring from base bars only (MST-004).
   */
  async loadHigherTfBundle(
    symbolId: string,
    protocolId?: string,
  ): Promise<{
    dayBars: import('../directives/interfaces/directive.interface').MarketBar[];
    hourBars: import('../directives/interfaces/directive.interface').MarketBar[];
    min15Bars: import('../directives/interfaces/directive.interface').MarketBar[];
  }> {
    const requiredBars = protocolId ? this.protocolDb.getRequiredBars(protocolId) : {};
    const [dayBars, hourBars, min15Bars] = await Promise.all([
      this.marketData.getBars(symbolId, '1d', requiredBars['1d'] || 200),
      this.marketData.getBars(symbolId, '1h', requiredBars['1h'] || 200),
      this.marketData.getBars(symbolId, '15m', requiredBars['15m'] || 200),
    ]);
    return { dayBars, hourBars, min15Bars };
  }

  /**
   * Resolve the effective maxScore for every directive in a protocol.
   * Precedence: protocol override → global config → directive class.
   *
   * This is the runtime bridge for #609 (per-protocol config UI) and #637
   * (timeframe-importance matrix): without this, overrides persist in the DB
   * but never change the score. The config UI's source badge and this method
   * MUST stay in agreement — both use the same precedence order.
   */
  private async resolveEffectiveMaxScores(
    protocolId: string | undefined,
    directiveIds: Set<string>,
  ): Promise<Map<string, number>> {
    const effective = new Map<string, number>();
    if (directiveIds.size === 0) return effective;

    const globalConfigs = await this.configService.getAllConfigs();
    const overrides = protocolId
      ? await this.configService.getProtocolOverrides(protocolId)
      : new Map<string, { maxScore?: number }>();

    for (const directiveId of directiveIds) {
      const classMax = this.directivesService.get(directiveId)?.maxScore;
      const globalMax = globalConfigs.get(directiveId)?.maxScore;
      const overrideMax = overrides.get(directiveId)?.maxScore;
      effective.set(directiveId, overrideMax ?? globalMax ?? classMax ?? 100);
    }

    return effective;
  }

  /**
   * Score a single symbol with multiplicative risk gating.
   *
   * Pipeline:
   * 1. Run all directives
   * 2. Group results into Technical / Sentiment / Risk
   * 3. Normalize each group to 0-100
   * 4. Apply risk multiplier (risk score / 100, clamped to floor/ceiling)
   * 5. Compute composite using selected weightStrategy:
   *    - group-weighted: (technical × 0.40 + sentiment × 0.35) × riskMultiplier
   *    - maxscore-weighted: (sum of ALL raw scores / sum of ALL maxScores) × 100 × riskMultiplier
   *
   * @param weightStrategy - 'group-weighted' (default) | 'maxscore-weighted'
   */
  async scoreWithGating(
    symbol: string,
    bars: import('../directives/interfaces/directive.interface').MarketBar[],
    protocolId?: string,
    higherTfBars?: {
      dayBars?: import('../directives/interfaces/directive.interface').MarketBar[];
      hourBars?: import('../directives/interfaces/directive.interface').MarketBar[];
      min15Bars?: import('../directives/interfaces/directive.interface').MarketBar[];
    },
    weightStrategy: 'group-weighted' | 'maxscore-weighted' = 'group-weighted',
    /**
     * Cadence of `bars` (e.g. '5m', '1d'). Passed to directives and to
     * `computeMarketStatus` so a freshness check measures staleness against the
     * REAL cadence rather than inferring it from a possibly-mixed array — the
     * mismatch that made fresh data read as closed and hard-gated every tick of
     * `spy-day-v1`/`qqq-day-v1` (2026-09-10).
     */
    timeframe?: string,
  ): Promise<GatedScore> {
    // Scoring REQUIRES a protocol — the unscoped 'default' pipeline was removed
    // (2026-08-22). Without a protocol, scoring would run every directive as a
    // kitchen-sink and persist risky data. Refuse instead.
    //
    // ⚠️ For future callers: resolve a real protocol BEFORE calling this
    // (speed-scan uses symbol_protocol_assignment; ladder/portfolio SKIP
    // unassigned symbols rather than scoring them). Never pass a fallback slug —
    // that recreates the problem this guard fixes.
    if (!protocolId) {
      throw new BadRequestException(
        'Scoring requires a protocol — unscoped default scoring was removed. Pass a protocolId.',
      );
    }
    const protocolConfig = await this.protocolDb.findBySlug(protocolId);
    if (!protocolConfig || !protocolConfig.groups || protocolConfig.groups.length === 0) {
      throw new NotFoundException(
        `Protocol "${protocolId}" not found or has no directive groups — refusing unscoped scoring.`,
      );
    }
    const activeGroups = protocolConfig.groups;

    // ── DXY data provisioning (EURUSD proxy) ─────────────────────
    // MT5 always provides EURUSD. DXY futures (ICE index) are rarely available
    // on retail brokers. EURUSD is 57.6% of the DXY basket — strong inverse.
    // We derive DXY proxy: ≥1.15→98 (weak USD), ≥1.08→103 (neutral), <1.08→108 (strong).
    // Both eurusdValue and dxyValue are attached to DirectiveInput so directives
    // don't each re-derive the proxy. See EurUsdCacheService (60s TTL).
    let eurusdValue: number | undefined;
    let dxyValue: number | undefined;
    if (protocolNeedsEurUsd(activeGroups)) {
      eurusdValue = await this.eurusdCache.getValue();
      if (eurusdValue !== undefined && eurusdValue > 0) {
        dxyValue = eurusdValue >= 1.15 ? 98 : eurusdValue >= 1.08 ? 103 : 108;
        this.macroSnapshot.capture({
          eurusdValue,
          dxyValue,
          source: 'eurusd-proxy',
        }).catch(err => this.logger.warn(`Snapshot: ${(err as Error).message}`));
      }
    }

    const input: DirectiveInput = {
      symbol,
      bars,
      // Cadence of `bars`, when the caller declared it. Directives that judge
      // freshness (liquidity-check) pass this to computeMarketStatus so the
      // staleness window is relative to the real cadence (2026-09-10).
      timeframe,
      // The evaluated candle, not the process clock, defines scoring time.
      // This keeps live, replay, and backtest calculations reproducible.
      asOf: bars.length ? bars[bars.length - 1].timestamp : new Date(),
      eurusdValue,
      dxyValue,
      ...(higherTfBars ?? {}),
    } as DirectiveInput;

    const directionMode = protocolConfig?.directionMode ?? 'LONG_ONLY';

    // 1. Collect directive IDs from active protocol groups (#389)
    const protocolDirectiveIds = new Set<string>();
    for (const group of activeGroups) {
      for (const directiveId of group.directiveIds) {
        protocolDirectiveIds.add(directiveId);
      }
    }

    // 1b. Resolve effective maxScores (protocol override → global → class).
    //     This is what makes the per-protocol config UI (#609) and the
    //     timeframe matrix (#637) actually change scoring output.
    const effectiveMaxScores = await this.resolveEffectiveMaxScores(
      protocolId,
      protocolDirectiveIds,
    );

    // 2. Run ONLY directives in the active protocol (not all 100+ registered directives)
    const allResults = await this.directivesService.runAll(input, protocolDirectiveIds);

    // 3. Group results with maxScore from directive registry
    const groups = new Map<string, { results: DirectiveResult[]; config: DirectiveGroup; maxScores: Map<string, number> }>();
    const excludedBreakdown: { directiveId: string; name: string; reason: string }[] = [];
    const readinessBlockers: { directiveId: string; name: string; readiness: string }[] = [];
    let alphaCount = 0;
    let betaCount = 0;
    let readyCount = 0;

    for (const group of activeGroups) {
      const groupResults: DirectiveResult[] = [];
      const maxScores = new Map<string, number>();

      for (const directiveId of group.directiveIds) {
        const result = allResults.get(directiveId);
        if (!result) continue;
        const directive = this.directivesService.get(directiveId);

        // Single source of truth for inclusion (directionBias + readiness).
        const verdict = classifyDirectiveInclusion(directive, directionMode);
        if (verdict === 'readiness-alpha') {
          // Alpha = mock/stub/placeholder → excluded, reported for transparency.
          excludedBreakdown.push({
            directiveId,
            name: directive?.name ?? directiveId,
            reason: 'mock — excluded from composite (readiness: alpha)',
          });
          alphaCount++;
          continue;
        }
        if (verdict === 'direction-bias') continue;

        // Included: count readiness tier for reporting.
        const readiness = (directive as any)?.readiness ?? 'alpha';
        if (readiness === 'beta') {
          betaCount++;
          readinessBlockers.push({ directiveId, name: directive?.name ?? directiveId, readiness });
        }
        if (readiness === 'ready') readyCount++;

        groupResults.push(result);
        maxScores.set(directiveId, effectiveMaxScores.get(directiveId) ?? directive?.maxScore ?? 100);
      }

      groups.set(group.id, { results: groupResults, config: group, maxScores });
    }

    // 3. Compute group sub-scores. Two scores coexist (Phase C dual-score model):
    //
    //   SIGNAL      — directional conviction (the timing number). Only
    //                 directives emitting a directional signalClass (bullish/
    //                 bearish) in a non-gate group contribute. Gates and
    //                 direction-neutral conditions are excluded.
    //   OPPORTUNITY — additive "everything counts" (the screening number).
    //                 Every directive (including gates + neutral conditions)
    //                 contributes, like the pre-Phase-C composite. Used to
    //                 rank attractiveness across a universe.
    const subScores: Record<string, number> = {};
    const subRawTotals: Record<string, number> = {};
    const subMaxTotals: Record<string, number> = {};
    const oppRawTotals: Record<string, number> = {};
    const oppMaxTotals: Record<string, number> = {};
    const breakouts: Record<string, DirectiveBreakout[]> = {};
    const inactiveGroupIds: string[] = [];

    // #758 — stable-denominator accumulators. `capacityMaxTotal` is the CONFIGURED
    // directional capacity (sum of maxScores of direction-eligible, non-gate directives);
    // `observedMaxTotal` is what actually read directional this tick; `directionEligibleTotal`
    // counts eligible directives so callers can distinguish "no directional evidence at all"
    // from a genuine neutral reading.
    let capacityMaxTotal = 0;
    let observedMaxTotal = 0;
    let directionEligibleTotal = 0;
    let bullishRaw = 0;
    let bullishMax = 0;
    let bearishRaw = 0;
    let bearishMax = 0;

    // ── Directive de-duplication across groups (2026-09-10) ────────────────
    //
    // A directive belongs to exactly ONE group. When the same `directiveId`
    // appears in two groups the scoring loop below runs it twice and adds its
    // score AND its maxScore twice — phantom capacity that inflates the
    // denominator and weights the directive double.
    //
    // ProtocolHealthService already calls this an error and SKIPS the second
    // occurrence (`duplicate-directive` / "appears in more than one group —
    // double-counted"). The scorer had no such guard, so the two disagreed and
    // the schema let the fault through silently.
    //
    // Measured before this guard: `session-open-effect` (maxScore 60) was the
    // only offender, across 6 ACTIVE protocols — 60 phantom maxScore each, and
    // 120 for forex-session-v1 which listed it in three groups.
    //
    // We keep the FIRST occurrence (group order is the protocol's own ordering)
    // and skip later ones, mirroring the health check exactly so a protocol's
    // audit and its score can no longer disagree.
    const seenDirectiveIds = new Set<string>();

    for (const [groupId, { results, config, maxScores }] of groups) {
      breakouts[groupId] = [];

      if (results.length === 0) {
        // Inactive group — NOT a zero score. The group isn't participating
        // (empty directiveIds in config, all directives excluded, or no data).
        // Omit it from subScores so divergence detection and risk baselines
        // read it as neutral; a config with an empty group should be flagged
        // by ProtocolHealthService, not silently score 0 forever.
        inactiveGroupIds.push(groupId);
        subRawTotals[groupId] = 0;
        subMaxTotals[groupId] = 0;
        oppRawTotals[groupId] = 0;
        oppMaxTotals[groupId] = 0;
        continue;
      }

      const isGateGroup = config.isRiskGate === true;
      let signalRaw = 0;
      let signalMax = 0;
      let oppRaw = 0;
      let oppMax = 0;
      // ── Stable denominator (#758) ──────────────────────────────────────────
      // `signalMax` above is the OBSERVED directional capacity: only directives whose
      // RUNTIME signalClass is directional and direction-allowed contribute to it. That
      // made the denominator flip tick to tick — a protocol scored `/80` at 11:55 and
      // `/90` at 11:53 — so the stored percentage was not comparable over time, and when
      // every group happened to read neutral the numerator AND denominator both went to 0,
      // producing `0/0 → 0` with `signal: 'HOLD'`: a phantom zero written as if it were a
      // reading.
      //
      // `capacityMax` is the CONFIGURED directional capacity: the sum of maxScores of the
      // directives in this group that are *eligible* to carry direction, independent of
      // what fired this minute. maxScore expresses importance, so the protocol's maximum
      // belongs to its config, not to what happened to be directional at 11:48. This is
      // the theory in docs/scoring-architecture.md applied to the denominator.
      //
      // `directionEligibleCount` records how many directives COULD have contributed, so a
      // caller can tell "no directional evidence at all" (0 eligible → not a reading) from
      // "directional directives present but all neutral" (real 0).
      let capacityMax = 0;
      let directionEligibleCount = 0;

      for (const result of results) {
        const directiveId = this.findDirectiveId(allResults, result);

        // Skip a directive already counted in an earlier group — see the
        // `seenDirectiveIds` note above. Checked BEFORE any accumulation so the
        // duplicate contributes neither score nor capacity.
        if (directiveId && seenDirectiveIds.has(directiveId)) {
          this.logger.warn(
            `Protocol ${protocolId}: directive "${directiveId}" appears in multiple groups ` +
            `(group "${groupId}") — skipping the duplicate so it is not double-counted. ` +
            `Fix the protocol config; ProtocolHealthService reports this as duplicate-directive.`,
          );
          continue;
        }
        if (directiveId) seenDirectiveIds.add(directiveId);

        const maxScore = directiveId ? (maxScores.get(directiveId) ?? 100) : 100;
        const directional =
          result.signalClass === 'bullish' || result.signalClass === 'bearish';
        // Runtime evidence direction is authoritative. A LONG_ONLY protocol may
        // observe bearish evidence, but that evidence must never increase BUY
        // strength (and vice versa for SHORT_ONLY). BOTH protocols retain the
        // two sides separately until the winner is selected below.
        const directionAllowed =
          directionMode === 'BOTH' ||
          (directionMode === 'LONG_ONLY' && result.signalClass === 'bullish') ||
          (directionMode === 'SHORT_ONLY' && result.signalClass === 'bearish');
        const inSignal = !isGateGroup && directional && directionAllowed;

        // Configured capacity: this directive can legitimately carry direction in this
        // protocol (right mode for it) and is not a gate.
        //
        // ⚠️ WHY THIS NO LONGER READS `result.signalClass` (#758, second pass)
        // -------------------------------------------------------------------
        // The first fix still consulted `result.signalClass` here — a RUNTIME value —
        // so the denominator remained market-dependent rather than configured:
        //
        //     LONG_ONLY + directive reading bearish  → excluded from capacity
        //     BOTH                                → always counted
        //
        // Measured live after that fix deployed: `forex-session-v1` wrote FIVE
        // different denominators in 30 minutes (470/560/390/480/410), and `xau-speed-m15`
        // wrote four. A percentage whose denominator drifts with the market is not
        // comparable over time — which is the exact defect #758 exists to remove. It
        // also made capacity depend on the SYMBOL, because each symbol reaches a
        // different directional reading, so the same protocol scored two symbols
        // against two different maxima in the same tick.
        //
        // Direction-ELEGIBILITY is a property of the CONFIG (which mode the protocol
        // declares, and what `classifyDirectiveInclusion` admitted), not of the tick.
        // A directive admitted into a BOTH protocol is eligible to carry direction;
        // whether it happens to read neutral or bullish THIS minute changes the
        // numerator only. That is what "stable denominator" has to mean to be worth
        // anything, and it is what the issue's own analysis describes: "Denominator =
        // sum of maxScores of all included, direction-eligible directives from
        // **config**, not from what fired."
        //
        // Gate groups stay excluded — a gate expresses a hurdle, not conviction.
        //
        // ⚠️ `!isGateGroup` ALONE IS CORRECT HERE — DO NOT ADD A `directionBias` TEST (#761)
        // --------------------------------------------------------------------------------
        // #761 proposed making capacity require `directionBias ∈ {bullish, bearish}`, on the
        // grounds that a directive which can never emit a direction is unreachable
        // denominator. **That was tried (2026-09-10) and reverted**, because the premise is
        // false: declared bias massively UNDERSTATES what directives actually emit.
        //
        // Measured over 7 days of recorded breakdowns:
        //
        //     directive                  declares    directional hits at runtime
        //     support-resistance-levels  ?            11,129
        //     analyst-adjustments        ?             8,746
        //     macd-crossover             neutral       5,252
        //     gold-macro-correlation     neutral       4,703
        //     gold-round-numbers         neutral       3,890
        //     speed-momentum             neutral       2,854
        //
        // Gating capacity on `directionBias` therefore EXCLUDES the directives doing most of
        // the real work and shrinks every denominator — making the percentages worse, not
        // better. `ProtocolHealthService` documents the same trap in its own
        // `low-declared-directional-capacity` check, which is deliberately reported at
        // `warning` and worded as "go and look", precisely because declared bias is not
        // trustworthy as a capacity measure.
        //
        // The genuine question in #761 — "does capacity include points the numerator cannot
        // reach?" — is real, but it cannot be answered from config. Measure it from OUTCOMES:
        // `scripts/analyse-unreachable-capacity.cjs`. Any future fix must be driven by that,
        // not by declaration. See ADR-011.
        if (!isGateGroup) {
          capacityMax += maxScore;
          directionEligibleCount++;
        }

        // Opportunity: everything counts.
        oppRaw += result.score;
        oppMax += maxScore;

        // Signal: directional only.
        if (inSignal) {
          signalRaw += result.score;
          signalMax += maxScore;
        }
        if (!isGateGroup && result.signalClass === 'bullish') {
          bullishRaw += result.score;
          bullishMax += maxScore;
        } else if (!isGateGroup && result.signalClass === 'bearish') {
          bearishRaw += result.score;
          bearishMax += maxScore;
        }

        const directive = directiveId ? this.directivesService.get(directiveId) : null;

        breakouts[groupId].push({
          directiveId: directiveId ?? 'unknown',
          name: directive?.name ?? directiveId ?? 'Unknown',
          score: result.score,
          maxScore,
          normalizedScore: Math.round(normalizeScorePercent(result.score, maxScore)),
          signalClass: result.signalClass ?? 'neutral',
          reason: result.reason,
          groupId,
          inSignal,
          // Carry the measured/unmeasured distinction through to the risk engine.
          unmeasured: result.unmeasured,
        });
      }

      // Signal group % = directional raw / directional max.
      // A group with NO directional contribution (all-neutral outcomes,
      // insufficient data, or a gate group) is NOT a zero score — it is
      // not participating in the signal. Omitting it keeps divergence
      // detection honest: data absence must not read as disagreement.
      if (signalMax === 0) {
        inactiveGroupIds.push(groupId);
        subRawTotals[groupId] = 0;
        subMaxTotals[groupId] = 0;
      } else {
        subScores[groupId] = Math.round(normalizeScorePercent(signalRaw, signalMax));
        subRawTotals[groupId] = signalRaw;
        subMaxTotals[groupId] = signalMax;
      }
      // #758 — accumulate the CONFIGURED capacity separately from the observed max. The
      // signal percentage is computed against `capacityMax` at the end (when > 0), giving a
      // denominator that does not move between ticks. `signalMax` is still reported so the
      // observed/configured pair is auditable.
      capacityMaxTotal += capacityMax;
      observedMaxTotal += signalMax;
      directionEligibleTotal += directionEligibleCount;
      oppRawTotals[groupId] = oppRaw;
      oppMaxTotals[groupId] = oppMax;
    }

    // 4. Apply tiered risk gating via RiskGatingEngine
    const riskDirectives: RiskDirectiveResult[] = (breakouts['risk'] ?? []).map((b) => ({
      directiveId: b.directiveId,
      name: b.name,
      score: b.score,
      maxScore: b.maxScore,
      reason: b.reason,
      // Propagate "could not measure" so the engine skips it instead of
      // computing severity 1.0 and tripping a hard gate (2026-09-10).
      unmeasured: b.unmeasured,
    }));

    // 5. Compute both scores (Phase C dual-score model).
    //
    // SIGNAL (composite): directional conviction, risk-gated. Drives the
    //   BUY/HOLD/SELL classification and the automation loop.
    // OPPORTUNITY: additive "everything counts", for screening/ranking.
    const bullishPct = normalizeScorePercent(bullishRaw, bullishMax);
    const bearishPct = normalizeScorePercent(bearishRaw, bearishMax);
    const selectedEvidence = selectDirectionalEvidence(directionMode, {
      bullishRaw, bullishMax, bearishRaw, bearishMax,
    });
    const selectedDirection = selectedEvidence.direction;
    const totalRaw = selectedEvidence.raw;
    const totalMax = selectedEvidence.maximum;

    // ── #758 — stable denominator + explicit no-data ───────────────────────────
    //
    // `totalRaw/totalMax` above are the OBSERVED evidence pair, and `totalMax` moves tick to
    // tick (it is only the direction-eligible directives that happened to read directional).
    // A percentage over a moving denominator is not comparable across the stored series, so
    // the reported percentage denominator prefers the protocol's CONFIGURED capacity.
    //
    // ⚠️ THE CONFIGURED DENOMINATOR IS ALSO THE CLASSIFICATION DENOMINATOR (#758 follow-up).
    //
    // #758 built `capacityMaxTotal` and wired it into the PERSISTED `rawMax`, but left
    // `signalPct` dividing by `selectedEvidence.maximum` (the OBSERVED directional max). That
    // made ONE reading carry TWO percentages: the card showed `raw / configured` (e.g. 17%)
    // while the BUY/STRONG_BUY label and the pre-trade gate were decided from
    // `raw / observed` (e.g. 82%) — so a card could read `STRONG_BUY 17%`. Both numbers were
    // internally consistent; they simply answered the question against different bars.
    //
    // The observed max is NOT a legitimate classification denominator because it SHRINKS
    // when a directive reads neutral this tick — a quieter tick inflates the percentage.
    // `capacityMaxTotal` is fixed by config, is per-protocol (not per-symbol), and is the
    // denominator the stored series already uses. One authoritative denominator.
    //
    // When there is no directional evidence at all (no direction-eligible directive produced a
    // reading, so numerator and denominator are both 0), that is NOT a score — it is an
    // absence. Previously it persisted as `rawMax: 0, composite: 0, signal: 'HOLD'`, which is
    // indistinguishable from a genuine neutral reading and silently inflated the 'scored'
    // counts that drove `protocol_score_status` to claim 'scoring' for hours (#758).
    //
    // The `: totalMax` fallback is load-bearing and was investigated during #761: it can only
    // trigger when a protocol has NO non-gate directives at all, because capacity does NOT
    // test `directionBias` (see the note at the capacity accumulation). A `directionBias`-based
    // capacity test was tried and reverted precisely because it would have made this fallback
    // reachable for real protocols — handing them `totalMax`, the OBSERVED max that ADR-011
    // bans. Left as-is; the fallback is unreachable in practice.
    const signalDenominator = capacityMaxTotal > 0 ? capacityMaxTotal : totalMax;
    const hasDirectionalEvidence = capacityMaxTotal > 0
      ? directionEligibleTotal > 0 && observedMaxTotal > 0
      : totalMax > 0;

    let opportunityScore = 0;
    for (const groupId of Object.keys(oppRawTotals)) {
      opportunityScore += oppRawTotals[groupId] ?? 0;
    }
    const opportunityMax = Object.values(oppMaxTotals).reduce((a, b) => a + (b ?? 0), 0);
    const opportunityPct = normalizeScorePercent(opportunityScore, opportunityMax);

    const riskResult = this.riskEngine.apply(totalRaw, riskDirectives);

    const directionalSum = Math.max(0, totalRaw);
    const composite = riskResult.hardGateTriggered
      ? 0
      : Math.round(Math.max(0, riskResult.finalScore));

    // Signal-strength percentage: pre-gate directional sum against the CONFIGURED directional
    // capacity (un-softened by the risk multiplier). This is the ONE number used for the
    // BUY/HOLD/SELL classification AND displayed on the card, so the label and the percentage
    // can never disagree. See the `signalDenominator` note above for why the observed max is
    // not acceptable here (#758 follow-up).
    const STRONG_PCT = 80; // % of configured capacity for STRONG_BUY / STRONG_SELL
    const signalPct = normalizeScorePercent(selectedEvidence.raw, signalDenominator);

    let signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    const isLongDirection = selectedDirection === 'bullish';

    if (selectedDirection !== 'none' && signalPct >= STRONG_PCT) {
      signal = isLongDirection ? 'STRONG_BUY' : 'STRONG_SELL';
    } else if (selectedDirection !== 'none' && signalPct >= ENTRY_THRESHOLD) {
      signal = isLongDirection ? 'BUY' : 'SELL';
    } else {
      // Below entry threshold = no directional edge, for EVERY direction mode.
      // HOLD means "no trade right now" — NOT position advice. (Previously
      // SHORT_ONLY/BOTH emitted SELL below HOLD_FLOOR, which mislabelled
      // "nothing is firing" as a short signal.)
      signal = 'HOLD';
    }

    // Meta: composite is the plain sum — no gating reduction to report.
    // compositePct is the normalized signal strength used for classification.
    const riskScore = subScores['risk'] ?? 50; // 50 = neutral risk baseline

    // #758 — a tick with NO directional evidence is a no-data outcome, not a HOLD reading.
    // `score: 0` with `signal: 'HOLD'` was a phantom zero: it looked like a real neutral
    // reading, and it counted toward `symbolsScored`, so a protocol stuck in this state
    // reported 'scoring' while producing nothing usable. Callers that persist or count
    // scores can now skip this rather than storing it as a result.
    if (!hasDirectionalEvidence) {
      const signal = 'NO_DATA' as any;
      return {
        symbol,
        protocolId,
        composite: 0,
        maxPossible: 0,
        signal,
        signalRaw: 0,
        signalMax: 0,
        signalPct: 0,
        confidence: 0,
        subScores,
        subRawTotals,
        subMaxTotals,
        oppRawTotals,
        oppMaxTotals,
        opportunityScore,
        opportunityMax,
        opportunityPct,
        breakouts,
        riskGate: { hardGateTriggered: false, multiplier: 1, severity: 0, warnings: [], reasons: [], chain: [], active: false, triggered: false } as any,
        rarity: null,
        noData: true,
        noDataReason: 'No directional evidence this tick — no direction-eligible directive produced a reading. This is data absence, not a neutral score (#758).',
        marketStatus: undefined,
        // Diagnostics for the denominator decision (#758).
        denominatorMode: 'configured-capacity',
        observedSignalMax: totalMax,
        configuredSignalMax: capacityMaxTotal,
      } as any;
    }

    // Rarity: compute percentile against historical scores for this protocol
    const rarity = await this.computeRarity(protocolId, symbol, composite);

    // Market status (#638 phase A). Bar freshness alone cannot distinguish
    // "market closed" from "data stale" — for US equities a stale feed during
    // market hours was mislabelled "Market closed" (#732). Fix: `open` means
    // "safe to trade" (calendar open AND data fresh), and a separate `stale`
    // flag reports "market open but data stale" so the UI can label it "Stale"
    // instead of "Market closed" while execution still blocks on `open=false`.
    const freshness = computeMarketStatus(bars, new Date(), timeframe);
    let marketStatus: { open: boolean; stale?: boolean; asOf: string | null; reason?: string };
    if (is24HourMarket(symbol)) {
      marketStatus = { ...freshness, stale: !freshness.open };
    } else {
      const cal = this.marketCalendar.getMarketStatus('US');
      const stale = cal.isOpen && !freshness.open;
      marketStatus = {
        open: cal.isOpen && freshness.open,
        stale,
        asOf: freshness.asOf,
        reason: !cal.isOpen
          ? `US market ${cal.status}${cal.holidayName ? ` — ${cal.holidayName}` : ''}`
          : stale
            ? `US market open — ${freshness.reason ?? 'data may be stale'}`
            : 'US market open',
      };
    }

    // Readiness gate (#627): a protocol is only eligible when every included
    // directive is 'ready'. Beta directives are blockers.
    const readinessGate = {
      ready: readinessBlockers.length === 0,
      blockers: readinessBlockers,
      reason: readinessBlockers.length
        ? `protocol contains non-ready directives: ${readinessBlockers.map(b => `${b.directiveId} (${b.readiness})`).join(', ')}`
        : undefined,
    };

    // Store snapshot for future rarity computation (fire-and-forget)
    this.storeSnapshot(protocolId, symbol, composite, signal, rarity?.percentile ?? null, {
      subScores,
      subRawTotals,
      subMaxTotals,
      breakouts,
      riskMultiplier: Number(riskResult.multiplier),
      directionMode,
      readinessGate,
      marketStatus,
      opportunityScore: Math.round(opportunityScore),
      opportunityMax,
      opportunityPct: Math.round(opportunityPct),
      compositePct: signalPct,
      // #758 — stable-denominator diagnostics.
      denominatorMode: 'configured-capacity',
      observedSignalMax: totalMax,
      configuredSignalMax: capacityMaxTotal,
    });

    return {
      symbol,
      composite,
      signalRaw: directionalSum,
      // The CONFIGURED denominator — `signalRaw / signalMax === signalPct`. Carrying the
      // observed `totalMax` here was the second half of the original defect: a consumer that
      // computed `signalRaw / signalMax` would get a different percentage from `signalPct`.
      signalMax: signalDenominator,
      signalPct,
      signal,
      subScores,
      subRawTotals,
      subMaxTotals,
      riskMultiplier: Number(riskResult.multiplier),
      breakouts,
      gatingActive: true,
      opportunityScore: Math.round(opportunityScore),
      opportunityMax,
      opportunityPct: Math.round(opportunityPct),
      inactiveGroupIds,
      rarity,
      riskGate: {
        hardGateTriggered: riskResult.hardGateTriggered,
        hardGateReason: riskResult.hardGateReason,
        multiplierChain: riskResult.multiplierChain,
        warnings: riskResult.warnings,
        riskScore: riskResult.riskScore,
      },
      meta: {
        compositePct: signalPct,
        // The denominator behind `compositePct`/`signalPct`. Must be the configured capacity —
        // pairing a configured percentage with an observed max silently breaks every consumer
        // that recomputes `raw / maxScore`.
        maxScore: signalDenominator,
        directiveCount: allResults.size,
        gatedCount: allResults.size - alphaCount,
        riskDirectiveCount: breakouts['risk']?.length ?? 0,
        weightStrategy,
        // ── #758 stable denominator ──
        // `configuredSignalMax` is the protocol's CONFIGURED directional capacity and is the
        // denominator BOTH for `signalPct` (classification + UI) and for the persisted `rawMax`,
        // so `score / rawMax` is comparable between ticks and across symbols. `observedSignalMax`
        // remains the observed evidence pair for diagnostics only — dividing by it makes the same
        // market condition score differently just because a directive went quiet.
        denominatorMode: 'configured-capacity',
        configuredSignalMax: capacityMaxTotal,
        observedSignalMax: totalMax,
        directionEligibleDirectives: directionEligibleTotal,
        // ── Readiness breakdown — see docs/readiness-tiers.md ──
        readinessBreakdown: { ready: readyCount, beta: betaCount, alpha: alphaCount, alphaExcluded: alphaCount },
        directionalEvidence: {
          bullishRaw,
          bullishMax,
          bullishPct,
          bearishRaw,
          bearishMax,
          bearishPct,
          selected: selectedDirection,
        },
      },
      // ── Directives excluded from scoring due to ALPHA readiness ──
      excludedBreakdown,
      // ── Readiness gate (#627) — protocol paused if any included directive is beta ──
      readinessGate,
      // ── Market status (#638 phase A) ──
      marketStatus,
      // ── Direction (#684) — protocol's intent, needed so the Signals UI can
      // distinguish "open a short" from "close a long". Defaults to LONG_ONLY. ──
      directionMode,
    };
  }

  /**
   * Score multiple symbols with gating. Runs in parallel.
   *
   * `timeframe` is the cadence `holdings[].bars` were loaded on, and is forwarded to
   * every `scoreWithGating()` call so the freshness check measures staleness against the
   * REAL interval rather than inferring it from the array's median. Omitting it was the
   * second half of the #783 follow-up defect: the batch endpoint loaded bars at the
   * protocol's cadence but left the scorer guessing, so a 1h protocol could still be
   * judged against a daily-derived window.
   */
  async scorePortfolio(
    holdings: Array<{ symbol: string; bars: import('../directives/interfaces/directive.interface').MarketBar[] }>,
    protocolId: string,
    timeframe?: string,
  ): Promise<GatedScore[]> {
    if (!protocolId) {
      throw new BadRequestException(
        'Portfolio scoring requires a protocol — unscoped default scoring was removed.',
      );
    }
    // Bound concurrency (issue #21): a large watchlist no longer fires N simultaneous
    // directive runs + DB queries (which exhausted the connection pool and caused
    // cascading timeouts). One symbol's failure is also isolated (issue #33) so it
    // doesn't fail the whole portfolio — failed symbols are skipped with a warning.
    const CONCURRENCY = 5;
    const results: GatedScore[] = [];
    let cursor = 0;

    // Resolve the higher-timeframe bundle ONCE per symbol, before the workers start
    // (#735 / MST-004). Doing it inside the loop would issue three extra bar queries
    // per symbol *per worker*, which is exactly the connection-pool pressure the
    // concurrency bound above exists to prevent. Bundles are keyed by the symbol's own
    // name here because `holdings` carries no symbol row id.
    const bundleBySymbol = new Map<string, {
      dayBars: import('../directives/interfaces/directive.interface').MarketBar[];
      hourBars: import('../directives/interfaces/directive.interface').MarketBar[];
      min15Bars: import('../directives/interfaces/directive.interface').MarketBar[];
    }>();
    await Promise.all(
      holdings.map(async (h) => {
        try {
          const row = await this.prisma.symbol.findFirst({
            where: { ticker: h.symbol.toUpperCase() },
            select: { id: true },
          });
          bundleBySymbol.set(
            h.symbol,
            row
              ? await this.loadHigherTfBundle(row.id, protocolId)
              : { dayBars: [], hourBars: [], min15Bars: [] },
          );
        } catch {
          bundleBySymbol.set(h.symbol, { dayBars: [], hourBars: [], min15Bars: [] });
        }
      }),
    );

    const worker = async (): Promise<void> => {
      while (cursor < holdings.length) {
        const idx = cursor++;
        const h = holdings[idx];
        try {
          const gated = await this.scoreWithGating(
            h.symbol,
            h.bars,
            protocolId,
            bundleBySymbol.get(h.symbol),
            'group-weighted',
            timeframe,
          );
          if (gated) results[idx] = gated;
        } catch (err) {
          this.logger.warn(`scorePortfolio: ${h.symbol} failed — skipping: ${(err as Error).message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, holdings.length) }, () => worker()));
    // Sort by composite descending for stable ladder display (#432)
    return results.filter(Boolean).sort((a, b) => b.composite - a.composite);
  }

  /**
   * Assess whether a protocol is READY to score (readiness gate #627).
   * A protocol is only eligible when every INCLUDED directive has
   * `readiness === 'ready'` — beta directives are blockers, alpha directives
   * are already excluded from scoring and are NOT blockers.
   */
  async assessReadiness(protocolId: string): Promise<{
    ready: boolean;
    blockers: { directiveId: string; name: string; readiness: string }[];
  }> {
    const config = protocolId ? await this.protocolDb.findBySlug(protocolId) : null;
    const groups = protocolId ? (config?.groups ?? DIRECTIVE_GROUPS) : DIRECTIVE_GROUPS;
    const directionMode = config?.directionMode ?? 'LONG_ONLY';
    const blockers: { directiveId: string; name: string; readiness: string }[] = [];

    for (const group of groups) {
      for (const directiveId of group.directiveIds) {
        const directive = this.directivesService.get(directiveId);
        if (!directive) continue;
        // Only consider directives that would actually participate in scoring.
        if (classifyDirectiveInclusion(directive, directionMode) !== 'included') continue;
        if (!isDirectiveReady(directive)) {
          blockers.push({
            directiveId,
            name: directive.name ?? directiveId,
            readiness: (directive as any).readiness ?? 'alpha',
          });
        }
      }
    }

    return { ready: blockers.length === 0, blockers };
  }

  /**
   * Compute rarity percentile for a composite score against historical data.
   */
  private async computeRarity(
    protocolId: string,
    symbol: string,
    composite: number,
  ): Promise<RarityInfo | undefined> {
    try {
      const history = await this.prisma.scoreSnapshot.findMany({
        where: {
          protocolId,
          snappedAt: { gte: new Date(Date.now() - 365 * 86400000) },
        },
        select: { composite: true },
        orderBy: { composite: 'asc' },
      });

      if (history.length < 10) {
        // Not enough data — return undefined (no rarity yet)
        return undefined;
      }

      const scores = history.map(h => h.composite);
      let countBelow = 0;
      for (const s of scores) {
        if (s < composite) countBelow++;
      }

      const percentile = Math.round((countBelow / scores.length) * 100);
      const band = this.classifyRarityBand(percentile);
      const config = RARITY_BANDS[band];

      return {
        ...config,
        percentile,
        sampleSize: scores.length,
      };
    } catch (err: any) {
      this.logger.warn(`Rarity computation failed: ${err.message}`);
      return undefined;
    }
  }

  private classifyRarityBand(percentile: number): RarityBand {
    if (percentile >= 99) return 'black-swan';
    if (percentile >= 95) return 'cyclical';
    if (percentile >= 85) return 'exceptional';
    if (percentile >= 70) return 'strong';
    return 'standard';
  }

  /**
   * Store a score snapshot for future rarity computations AND write
   * to the canonical Score table so protocol scores appear in the runs API.
   * Fire-and-forget — failures are logged but don't block the response.
   *
   * Stores the directive-level breakdown so the Protocol Trail page can
   * show WHY each directive scored the way it did.
   */
  /** TTL cache of protocol → resolved symbols for the canonical-persist guard. */
  private resolvedSymbolCache = new Map<string, { at: number; symbols: string[] }>();

  /**
   * Canonical-symbol guard: ad-hoc evaluation (batch / A-B / explorer) scores
   * arbitrary tickers through a protocol. Persisting those rows pollutes the
   * runs feed and rarity history (e.g. JBL appearing under vix-spike-v1).
   * Only symbols the protocol actually resolves are canonical.
   */
  private async isCanonicalProtocolSymbol(protocolId: string, symbol: string): Promise<boolean> {
    const cached = this.resolvedSymbolCache.get(protocolId);
    let symbols: string[];
    if (cached && Date.now() - cached.at < 60_000) {
      symbols = cached.symbols;
    } else {
      try {
        symbols = (await this.protocolDb.resolveSymbols(protocolId)).map((s) => s.toUpperCase());
        this.resolvedSymbolCache.set(protocolId, { at: Date.now(), symbols });
      } catch {
        return true; // resolution unavailable — let the write attempt proceed
      }
    }
    if (symbols.length === 0) return false; // unresolvable protocol has no canonical symbols
    return symbols.includes(symbol.toUpperCase());
  }

  /**
   * Fold a reading into a protocol's Adaptive Target peak (2026-09-10).
   *
   * MONOTONIC — the peak only ever rises. See `adaptive-target.ts` for why a falling
   * target is not acceptable. The UPDATE is therefore guarded in SQL (`adaptiveTargetMax < ?`)
   * as well as in JS, so two concurrent scoring runs cannot lower it through a race.
   *
   * Only the peak and sample count move. `adaptiveTargetEnabled` is NEVER touched here —
   * enabling is an explicit operator action (the registry toggle), so a protocol cannot
   * silently switch itself onto a different scale.
   *
   * Fire-and-forget: called without `await` from `storeSnapshot`, so a failure degrades to
   * "target not yet established" rather than breaking a scoring tick.
   */
  private observeAdaptiveTargetPeak(protocolId: string, rawComposite: number): void {
    if (!Number.isFinite(rawComposite) || rawComposite <= 0) return; // absence is not evidence
    void (async () => {
      try {
        // ONE statement, deliberately. Doing "raise the peak" and "count the sample" as two
        // UPDATEs would increment `adaptiveTargetSamples` twice on every new high, so a
        // protocol would reach the sample floor at half the real observation count.
        //
        // The peak only moves via the guarded CASE — `GREATEST` alone would still allow a
        // lower value to win if the row were read and written non-atomically, whereas the
        // CASE evaluates against the stored value inside the same statement.
        await (this.prisma as any).$executeRawUnsafe(
          `UPDATE protocol
              SET adaptiveTargetMax = CASE
                    WHEN adaptiveTargetMax IS NULL OR adaptiveTargetMax < ? THEN ?
                    ELSE adaptiveTargetMax
                  END,
                  adaptiveTargetSamples = adaptiveTargetSamples + 1,
                  adaptiveTargetSince = CASE
                    WHEN adaptiveTargetSince IS NULL THEN ?
                    ELSE adaptiveTargetSince
                  END
            WHERE slug = ?`,
          rawComposite,
          rawComposite,
          new Date(),
          protocolId,
        );
      } catch (err: any) {
        this.logger.debug?.(`Adaptive target observation skipped for ${protocolId}: ${err?.message ?? err}`);
      }
    })();
  }

  private storeSnapshot(
    protocolId: string,
    symbol: string,
    composite: number,
    signal: string,
    rarityPct: number | null,
    breakdownData: {
      subScores: Record<string, number>;
      subRawTotals: Record<string, number>;
      subMaxTotals: Record<string, number>;
      breakouts: Record<string, DirectiveBreakout[]>;
      riskMultiplier: number;
      directionMode: string;
      readinessGate: { ready: boolean; blockers: { directiveId: string; name: string; readiness: string }[]; reason?: string };
      marketStatus: { open: boolean; asOf: string | null; reason?: string };
      opportunityScore: number;
      opportunityMax: number;
      opportunityPct: number;
      compositePct: number;
      // ── #758 stable denominator ──
      /** Always 'configured-capacity' today. Present so a future mode can be told apart. */
      denominatorMode?: string;
      /** Sum of maxScores for directives that actually produced directional evidence. */
      observedSignalMax?: number;
      /** Sum of maxScores for ALL directives eligible to express direction this tick. */
      configuredSignalMax?: number;
    },
  ): void {
    (async () => {
      // Canonical-symbol guard — only persist symbols this protocol resolves.
      const canonical = await this.isCanonicalProtocolSymbol(protocolId, symbol);
      if (!canonical) return;

      // Write to score_snapshot (rarity history)
      this.prisma.scoreSnapshot.create({
        data: {
          protocolId,
          symbol,
          composite,
          tradingSignal: signal,
          rarityPct,
          // #726 — normalised percentages so the ceiling distribution is queryable.
          signalPct: breakdownData.compositePct,
          opportunityPct: breakdownData.opportunityPct,
        },
      }).catch((err: any) => {
        this.logger.warn(`Failed to store score snapshot: ${err.message}`);
      });

      // Write to canonical Score table — protocol scores identified by strategyId = protocolId
      try {
        const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol.toUpperCase() }, select: { id: true } });
        if (!sym) return;

        // ── Adaptive Target observation (2026-09-10) ────────────────────────────
        // Fold this reading into the protocol's observed-peak RAW composite.
        //
        // Uses the PRE-GATE raw composite, not `composite`: a closed market hard-gates the
        // composite to 0, so feeding it here would make the peak depend on whether the
        // market happened to be open — reintroducing the tick-varying denominator that
        // #758 removed.
        //
        // Fire-and-forget like the score write: a failure here must never break scoring.
        this.observeAdaptiveTargetPeak(protocolId, rawCompositeForAdaptiveTarget(breakdownData));

        await (this.prisma as any).score.create({
          data: {
            symbolId: sym.id,
            strategyId: protocolId, // protocol-scored: strategyId IS the protocolId
            value: composite,
            breakdown: {
              protocolId,
              signal,
              rarityPct: rarityPct ?? null,
              source: 'protocol-gating',
              timestamp: new Date().toISOString(),
              directionMode: breakdownData.directionMode,
              riskMultiplier: breakdownData.riskMultiplier,
              // Pre-gate raw composite — the actual signal strength before any
              // hard gate (e.g. closed-market liquidity) forces composite to 0.
              // The gate is a tradability check, not part of the score itself.
              rawComposite: Object.values(breakdownData.subRawTotals).reduce((a: number, b: number) => a + (b ?? 0), 0),
              // ⚠️ STABLE DENOMINATOR (#758, 2026-09-10) — do NOT recompute this from
              // `subMaxTotals` at persist time.
              //
              // That is exactly what this line used to do, and it silently undid the stable
              // denominator computed in `scoreWithGating()`: `subMaxTotals` is the OBSERVED
              // directional capacity (only directives that read directional this tick), so
              // the persisted `rawMax` moved tick to tick — `forex-session-v1` wrote NINE
              // different denominators in six hours (1,928 rows), and `spy-day-v1` alternated
              // 90/80/0/null. `score / rawMax` on a moving denominator is not comparable over
              // time, so the stored history was unusable as a series.
              //
              // Use the configured capacity when the scorer supplied one, falling back to the
              // observed sum only for legacy paths that do not set it.
              rawMax: breakdownData.configuredSignalMax && breakdownData.configuredSignalMax > 0
                ? breakdownData.configuredSignalMax
                : Object.values(breakdownData.subMaxTotals).reduce((a: number, b: number) => a + (b ?? 0), 0),
              // Diagnostics — make the denominator decision auditable from the row alone.
              denominatorMode: breakdownData.denominatorMode ?? 'observed-fallback',
              observedSignalMax: breakdownData.observedSignalMax ?? null,
              configuredSignalMax: breakdownData.configuredSignalMax ?? null,
              // Opportunity score (Phase C dual-score model) — additive
              // "everything counts" total for SCREENING / ranking. Kept
              // alongside the directional signal.
              opportunityScore: breakdownData.opportunityScore,
              opportunityMax: breakdownData.opportunityMax,
              opportunityPct: breakdownData.opportunityPct,
              subScores: breakdownData.subScores,
              subRawTotals: breakdownData.subRawTotals,
              subMaxTotals: breakdownData.subMaxTotals,
              breakouts: breakdownData.breakouts,
              readinessGate: breakdownData.readinessGate,
              marketStatus: breakdownData.marketStatus,
            },
          },
        });
      } catch (err: any) {
        this.logger.warn(`Failed to store canonical score: ${err.message}`);
      }
    })().catch((err: any) => {
      // Fire-and-forget snapshot write — never emit an unhandled rejection.
      this.logger.warn(`storeSnapshot failed: ${err?.message ?? err}`);
    });
  }

  /**
   * Find which directive ID produced a given result.
   * Compares by reference since runAll() stores the exact object.
   */
  private findDirectiveId(
    allResults: Map<string, DirectiveResult>,
    target: DirectiveResult,
  ): string | undefined {
    for (const [id, result] of allResults) {
      if (result === target) return id;
    }
    return undefined;
  }
}
