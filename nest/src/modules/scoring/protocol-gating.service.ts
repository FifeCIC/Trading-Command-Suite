import { Injectable, Logger } from '@nestjs/common';
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
import { AdapterFactory } from '../providers/adapter-factory';
import { MacroSnapshotService } from './macro-snapshot.service';
import { EurUsdCacheService } from './eurusd-cache.service';
import { ProtocolDbService } from './protocol-db.service';
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
  rarity?: RarityInfo;
  riskGate?: {
    hardGateTriggered: boolean;
    hardGateReason: string | null;
    multiplierChain: import('./risk-gating-engine.service').MultiplierStep[];
    warnings: string[];
    riskScore: number;
  };
  meta: {
    additiveEquivalent: number;
    gatingDelta: number;
    directiveCount: number;
    gatedCount: number;
    riskDirectiveCount: number;
    weightStrategy: 'group-weighted' | 'maxscore-weighted';
  };
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

const ENTRY_THRESHOLD = 40;
const HOLD_FLOOR = 20;

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
  ) {}

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
    // Select protocol groups first — DB-first with hardcoded fallback (#388)
    const protocolConfig = protocolId ? (await this.protocolDb.findBySlug(protocolId)) : null;
    const activeGroups = protocolId
      ? (protocolConfig?.groups ?? DIRECTIVE_GROUPS)
      : DIRECTIVE_GROUPS;

    // ── Fetch EURUSD for DXY proxy (cached per tick) — only if needed ──
    let eurusdValue: number | undefined;
    if (protocolNeedsEurUsd(activeGroups)) {
      eurusdValue = await this.eurusdCache.getValue();

      // ── Persist macro snapshot ──────────────────────────
      if (eurusdValue !== undefined && eurusdValue > 0) {
        const proxyDxy = eurusdValue >= 1.15 ? 98 : eurusdValue >= 1.08 ? 103 : 108;
        this.macroSnapshot.capture({
          eurusdValue,
          dxyValue: proxyDxy,
          source: 'eurusd-proxy',
        }).catch(err => this.logger.warn(`Snapshot: ${(err as Error).message}`));
      }
    }

    const input: DirectiveInput = {
      symbol,
      bars,
      eurusdValue,
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

    // 2. Run ONLY directives in the active protocol (not all 100+ registered directives)
    const allResults = await this.directivesService.runAll(input, protocolDirectiveIds);

    // 3. Group results with maxScore from directive registry
    const groups = new Map<string, { results: DirectiveResult[]; config: DirectiveGroup; maxScores: Map<string, number> }>();

    for (const group of activeGroups) {
      const groupResults: DirectiveResult[] = [];
      const maxScores = new Map<string, number>();

      for (const directiveId of group.directiveIds) {
        const result = allResults.get(directiveId);
        if (!result) continue;
        // Filter by directionBias: don't include opposite-direction directives
        const directive = this.directivesService.get(directiveId);
        const bias = directive?.directionBias ?? 'neutral';
        if (directionMode === 'LONG_ONLY' && bias === 'bearish') continue;
        if (directionMode === 'SHORT_ONLY' && bias === 'bullish') continue;
        groupResults.push(result);
        maxScores.set(directiveId, directive?.maxScore ?? 100);
      }

      groups.set(group.id, { results: groupResults, config: group, maxScores });
    }

    // 3. Compute group sub-scores (raw-total percentage of max possible)
    // Each directive contributes its RAW score (not normalized to 0-100 first).
    // Group score = (sum of raw scores / sum of maxScores) × 100.
    // This preserves directive weight: a maxScore=180 directive naturally
    // contributes more than a maxScore=90 one.
    const subScores: Record<string, number> = {};
    const subRawTotals: Record<string, number> = {};
    const subMaxTotals: Record<string, number> = {};
    const breakouts: Record<string, DirectiveBreakout[]> = {};

    for (const [groupId, { results, config, maxScores }] of groups) {
      breakouts[groupId] = [];

      if (results.length === 0) {
        subScores[groupId] = 0; // No active directives = no contribution
        subRawTotals[groupId] = 0;
        subMaxTotals[groupId] = 0;
        continue;
      }

      let rawSum = 0;
      let maxSum = 0;

      for (const result of results) {
        const directiveId = this.findDirectiveId(allResults, result);
        const maxScore = directiveId ? (maxScores.get(directiveId) ?? 100) : 100;
        rawSum += result.score;
        maxSum += maxScore;

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
        });
      }

      // Group percentage = sum of raw scores / sum of maxScores × 100
      const groupPct = maxSum > 0 ? (rawSum / maxSum) * 100 : 0;
      subScores[groupId] = Math.round(groupPct);
      subRawTotals[groupId] = rawSum;
      subMaxTotals[groupId] = maxSum;
    }

    // 4. Apply tiered risk gating via RiskGatingEngine
    const riskDirectives: RiskDirectiveResult[] = (breakouts['risk'] ?? []).map((b) => ({
      directiveId: b.directiveId,
      name: b.name,
      score: b.score,
      maxScore: b.maxScore,
      reason: b.reason,
    }));

    // 5. Compute composite based on weightStrategy
    let rawBeforeRisk: number;
    if (weightStrategy === 'maxscore-weighted') {
      // MAXSCORE-WEIGHTED: ignore group weights, use all directive scores proportionally
      // Composite = (sum of all raw scores / sum of all maxScores) × 100
      let totalRaw = 0;
      let totalMax = 0;
      for (const groupId of Object.keys(subRawTotals)) {
        totalRaw += subRawTotals[groupId] ?? 0;
        totalMax += subMaxTotals[groupId] ?? 0;
      }
      rawBeforeRisk = totalMax > 0 ? (totalRaw / totalMax) * 100 : 0;
    } else {
      // GROUP-WEIGHTED (default): group weights determine category balance
      rawBeforeRisk = (subScores['technical'] ?? 0) * 0.40 + (subScores['sentiment'] ?? 0) * 0.35;
    }
    const riskResult = this.riskEngine.apply(rawBeforeRisk, riskDirectives);

    const composite = riskResult.hardGateTriggered
      ? 0
      : Math.round(Math.max(0, Math.min(100, riskResult.finalScore)));

    // directionMode is extracted earlier — see protocol selection above
    // #337: Strong Buy/Sell thresholds from scoring history
    const STRONG_THRESHOLD = 80; // >= 80% of max possible → strong signal
    let signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
    const isLongDirection = directionMode !== 'SHORT_ONLY';

    if (composite >= STRONG_THRESHOLD) {
      signal = isLongDirection ? 'STRONG_BUY' : 'STRONG_SELL';
    } else if (composite >= ENTRY_THRESHOLD) {
      signal = isLongDirection ? 'BUY' : 'SELL';
    } else if (composite >= HOLD_FLOOR) {
      signal = 'HOLD';
    } else {
      signal = directionMode === 'LONG_ONLY' ? 'HOLD' : 'SELL';
    }

    // Meta: show what additive would have given
    const riskScore = subScores['risk'] ?? 50; // 50 = neutral risk baseline
    const additiveEquivalent = Math.round(
      ((subScores['technical'] ?? 0) + (subScores['sentiment'] ?? 0) + riskScore) / 3,
    );

    // Rarity: compute percentile against historical scores for this protocol
    const rarity = await this.computeRarity(protocolId ?? 'default', symbol, composite);

    // Store snapshot for future rarity computation (fire-and-forget)
    this.storeSnapshot(protocolId ?? 'default', symbol, composite, signal, rarity?.percentile ?? null);

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
      rarity,
      riskGate: {
        hardGateTriggered: riskResult.hardGateTriggered,
        hardGateReason: riskResult.hardGateReason,
        multiplierChain: riskResult.multiplierChain,
        warnings: riskResult.warnings,
        riskScore: riskResult.riskScore,
      },
      meta: {
        additiveEquivalent,
        gatingDelta: composite - additiveEquivalent,
        directiveCount: allResults.size,
        gatedCount: allResults.size,
        riskDirectiveCount: breakouts['risk']?.length ?? 0,
        weightStrategy,
      },
    };
  }

  /**
   * Score multiple symbols with gating. Runs in parallel.
   */
  async scorePortfolio(
    holdings: Array<{ symbol: string; bars: import('../directives/interfaces/directive.interface').MarketBar[] }>,
    protocolId?: string,
  ): Promise<GatedScore[]> {
    const results = await Promise.all(
      holdings.map((h) => this.scoreWithGating(h.symbol, h.bars, protocolId)),
    );
    // Sort by composite descending for stable ladder display (#432)
    return results.sort((a, b) => b.composite - a.composite);
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
   * Store a score snapshot for future rarity computations.
   * Fire-and-forget — failures are logged but don't block the response.
   */
  private storeSnapshot(
    protocolId: string,
    symbol: string,
    composite: number,
    signal: string,
    rarityPct: number | null,
  ): void {
    this.prisma.scoreSnapshot.create({
      data: {
        protocolId,
        symbol,
        composite,
        tradingSignal: signal,
        rarityPct,
      },
    }).then(() => {
      // Snapshot stored
    }).catch((err: any) => {
      this.logger.warn(`Failed to store score snapshot: ${err.message}`);
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
