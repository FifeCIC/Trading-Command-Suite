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
import { DirectivesService } from '../directives/directives.service';
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
import { DirectiveConfigService } from './directive-config.service';
import { isScoringDemo } from '../../config/scoring-mode';
import {
  RiskGatingEngine,
  RiskDirectiveResult,
  RiskGateResult,
} from './risk-gating-engine.service';

/**
 * Weighting Systems
 * =================
 * The scoring engine supports two weighting approaches. They are NOT competing —
 * they operate at different levels and can be selected per MetaStack:
 *
 * 1. GROUP-WEIGHTED (default):
 *    Group weights (Technical=0.40, Sentiment=0.35, Risk=0.25) determine how much
 *    each group contributes to the composite. Within a group, directive maxScores
 *    determine relative influence (a maxScore=180 directive naturally contributes
 *    more than a maxScore=90 one). Composite = (technical×0.40 + sentiment×0.35) × riskMultiplier.
 *    Best for: protocols with mixed directive types where you want to control
 *    category balance (e.g. "I want technicals to matter 40% regardless of which
 *    directives fire").
 *
 * 2. MAXSCORE-WEIGHTED:
 *    Group weights are ignored. The composite is derived solely from directive maxScores
 *    across ALL active directives. Each directive contributes proportionally to its maxScore
 *    relative to the sum of all maxScores. No category preference — directives compete
 *    on their declared importance only.
 *    Best for: protocols where all directives are the same type and you want pure
 *    score-based ranking without category bias.
 *
 * The weightStrategy is stored on ScoringStrategy and defaults to 'group-weighted'.
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
  composite: number;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
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
  rarity?: RarityInfo;
  riskGate?: {
    hardGateTriggered: boolean;
    hardGateReason: string | null;
    multiplierChain: import('./risk-gating-engine.service').MultiplierStep[];
    warnings: string[];
    riskScore: number;
  };
  meta: {
    compositePct: number;
    maxScore: number;
    directiveCount: number;
    gatedCount: number;
    riskDirectiveCount: number;
    weightStrategy: 'group-weighted' | 'maxscore-weighted';
    /** Readiness tier counts: ready/beta/alpha. Alpha directives are excluded from scoring. */
    readinessBreakdown: { ready: number; beta: number; alpha: number; alphaExcluded: number };
  };
  /** Readiness gate (#627) — protocols are only eligible when every included directive is ready. */
  readinessGate?: {
    ready: boolean;
    blockers: { directiveId: string; name: string; readiness: string }[];
    reason?: string;
  };
  /** Market-open status (#638 phase A) — whether the symbol's market is producing fresh data. */
  marketStatus?: {
    open: boolean;
    asOf: string | null;
    reason?: string;
  };
  /** Directives excluded from the composite due to ALPHA readiness. */
  excludedBreakdown: { directiveId: string; name: string; reason: string }[];
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
  ) {}

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

    for (const [groupId, { results, config, maxScores }] of groups) {
      breakouts[groupId] = [];

      if (results.length === 0) {
        subScores[groupId] = 0; // No active directives = no contribution
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

      for (const result of results) {
        const directiveId = this.findDirectiveId(allResults, result);
        const maxScore = directiveId ? (maxScores.get(directiveId) ?? 100) : 100;
        const directional =
          result.signalClass === 'bullish' || result.signalClass === 'bearish';
        const inSignal = !isGateGroup && directional;

        // Opportunity: everything counts.
        oppRaw += result.score;
        oppMax += maxScore;

        // Signal: directional only.
        if (inSignal) {
          signalRaw += result.score;
          signalMax += maxScore;
        }

        const directive = directiveId ? this.directivesService.get(directiveId) : null;

        breakouts[groupId].push({
          directiveId: directiveId ?? 'unknown',
          name: directive?.name ?? directiveId ?? 'Unknown',
          score: result.score,
          maxScore,
          normalizedScore: maxScore > 0 ? Math.round((result.score / maxScore) * 100) : 0,
          signalClass: result.signalClass ?? 'neutral',
          reason: result.reason,
          groupId,
          inSignal,
        });
      }

      // Signal group % = directional raw / directional max.
      subScores[groupId] = signalMax > 0 ? Math.round((signalRaw / signalMax) * 100) : 0;
      subRawTotals[groupId] = signalRaw;
      subMaxTotals[groupId] = signalMax;
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
    }));

    // 5. Compute both scores (Phase C dual-score model).
    //
    // SIGNAL (composite): directional conviction, risk-gated. Drives the
    //   BUY/HOLD/SELL classification and the automation loop.
    // OPPORTUNITY: additive "everything counts", for screening/ranking.
    let totalRaw = 0;
    for (const groupId of Object.keys(subRawTotals)) {
      totalRaw += subRawTotals[groupId] ?? 0;
    }

    let opportunityScore = 0;
    for (const groupId of Object.keys(oppRawTotals)) {
      opportunityScore += oppRawTotals[groupId] ?? 0;
    }
    const opportunityMax = Object.values(oppMaxTotals).reduce((a, b) => a + (b ?? 0), 0);
    const opportunityPct = opportunityMax > 0 ? (opportunityScore / opportunityMax) * 100 : 0;

    const riskResult = this.riskEngine.apply(totalRaw, riskDirectives);

    const directionalSum = Math.max(0, totalRaw);
    const composite = riskResult.hardGateTriggered
      ? 0
      : Math.round(Math.max(0, riskResult.finalScore));

    // Signal-strength percentage: pre-gate directional sum against the
    // directional-only denominator (un-softened by the risk multiplier).
    const STRONG_PCT = 80; // % of maxScore for STRONG_BUY / STRONG_SELL
    const totalMax = Object.values(subMaxTotals).reduce((a, b) => a + (b ?? 0), 0);
    const compositePct = totalMax > 0 ? (directionalSum / totalMax) * 100 : 0;

    let signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    const isLongDirection = directionMode !== 'SHORT_ONLY';

    if (compositePct >= STRONG_PCT) {
      signal = isLongDirection ? 'STRONG_BUY' : 'STRONG_SELL';
    } else if (compositePct >= ENTRY_THRESHOLD) {
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

    // Rarity: compute percentile against historical scores for this protocol
    const rarity = await this.computeRarity(protocolId, symbol, composite);

    // Market status (#638 phase A) — whether the symbol's market is producing fresh data.
    const marketStatus = computeMarketStatus(bars);

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
    });

    return {
      symbol,
      composite,
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
      rarity,
      riskGate: {
        hardGateTriggered: riskResult.hardGateTriggered,
        hardGateReason: riskResult.hardGateReason,
        multiplierChain: riskResult.multiplierChain,
        warnings: riskResult.warnings,
        riskScore: riskResult.riskScore,
      },
      meta: {
        compositePct: Math.round(compositePct),
        maxScore: totalMax,
        directiveCount: allResults.size,
        gatedCount: allResults.size - alphaCount,
        riskDirectiveCount: breakouts['risk']?.length ?? 0,
        weightStrategy,
        // ── Readiness breakdown — see docs/readiness-tiers.md ──
        readinessBreakdown: { ready: readyCount, beta: betaCount, alpha: alphaCount, alphaExcluded: alphaCount },
      },
      // ── Directives excluded from scoring due to ALPHA readiness ──
      excludedBreakdown,
      // ── Readiness gate (#627) — protocol paused if any included directive is beta ──
      readinessGate,
      // ── Market status (#638 phase A) ──
      marketStatus,
    };
  }

  /**
   * Score multiple symbols with gating. Runs in parallel.
   */
  async scorePortfolio(
    holdings: Array<{ symbol: string; bars: import('../directives/interfaces/directive.interface').MarketBar[] }>,
    protocolId: string,
  ): Promise<GatedScore[]> {
    if (!protocolId) {
      throw new BadRequestException(
        'Portfolio scoring requires a protocol — unscoped default scoring was removed.',
      );
    }
    const results = await Promise.all(
      holdings.map((h) => this.scoreWithGating(h.symbol, h.bars, protocolId)),
    );
    // Sort by composite descending for stable ladder display (#432)
    return results.sort((a, b) => b.composite - a.composite);
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
        },
      }).catch((err: any) => {
        this.logger.warn(`Failed to store score snapshot: ${err.message}`);
      });

      // Write to canonical Score table — protocol scores identified by strategyId = protocolId
      try {
        const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol.toUpperCase() }, select: { id: true } });
        if (!sym) return;
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
              // Directional denominator (Phase C #638) — sum of maxScores of the
              // directives that actually counted. Used by the UI so `score/max`
              // stays consistent now that neutral/gate maxScores are excluded.
              rawMax: Object.values(breakdownData.subMaxTotals).reduce((a: number, b: number) => a + (b ?? 0), 0),
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
    })();
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
