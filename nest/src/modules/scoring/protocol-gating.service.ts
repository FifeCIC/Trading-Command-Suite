import { Injectable, Logger } from '@nestjs/common';
import { DirectivesService } from '../directives/directives.service';
import { PrismaService } from '../../database/prisma.service';
import {
  DirectiveInput,
  DirectiveResult,
} from '../directives/interfaces/directive.interface';
import {
  DIRECTIVE_GROUPS,
  BTC_SPEED_GROUPS,
  PROTOCOL_REGISTRY,
  DirectiveGroup,
} from '../directives/directive-groups';
import { AdapterFactory } from '../providers/adapter-factory';
import { MacroSnapshotService } from './macro-snapshot.service';
import { isScoringDemo } from '../../config/scoring-mode';
import {
  RiskGatingEngine,
  RiskDirectiveResult,
  RiskGateResult,
} from './risk-gating-engine.service';

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
  signal: 'BUY' | 'HOLD' | 'SELL';
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

// ─── Thresholds ──────────────────────────────────────────

const ENTRY_THRESHOLD = 65;
const HOLD_FLOOR = 35;

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
  ) {}

  /**
   * Score a single symbol with multiplicative risk gating.
   *
   * Pipeline:
   * 1. Run all directives
   * 2. Group results into Technical / Sentiment / Risk
   * 3. Normalize each group to 0-100
   * 4. Apply risk multiplier (risk score / 100, clamped to floor/ceiling)
   * 5. Compute composite = (technical × 0.40 + sentiment × 0.35) × riskMultiplier
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
  ): Promise<GatedScore> {
    // ── Fetch EURUSD for DXY proxy ────────────────────────
    let eurusdValue: number | undefined;
    try {
      const mt5 = this.adapterFactory.create('mt5');
      if (mt5) {
        const q = await mt5.getQuote('EURUSD');
        if (q?.last) eurusdValue = q.last;
      }
    } catch { /* MT5 offline — directive handles it */ }

    // ── Persist macro snapshot ────────────────────────────
    if (eurusdValue !== undefined && eurusdValue > 0) {
      const proxyDxy = eurusdValue >= 1.15 ? 98 : eurusdValue >= 1.08 ? 103 : 108;
      this.macroSnapshot.capture({
        eurusdValue,
        dxyValue: proxyDxy,
        source: 'eurusd-proxy',
      }).catch(err => this.logger.warn(`Snapshot: ${(err as Error).message}`));
    }

    const input: DirectiveInput = {
      symbol,
      bars,
      eurusdValue,
      ...(higherTfBars ?? {}),
    } as DirectiveInput;

    // Select protocol groups
    const protocolConfig = protocolId ? PROTOCOL_REGISTRY[protocolId] : null;
    const activeGroups = protocolId
      ? (protocolConfig?.groups ?? DIRECTIVE_GROUPS)
      : DIRECTIVE_GROUPS;
    const directionMode = protocolConfig?.directionMode ?? 'LONG_ONLY';

    // 1. Run ALL directives
    const allResults = await this.directivesService.runAll(input);

    // 2. Group results with maxScore from directive registry
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

    // Default to 0 for non-risk groups — no active directives = no contribution
    const rawBeforeRisk = (subScores['technical'] ?? 0) * 0.40 + (subScores['sentiment'] ?? 0) * 0.35;
    const riskResult = this.riskEngine.apply(rawBeforeRisk, riskDirectives);

    const composite = riskResult.hardGateTriggered
      ? 0
      : Math.round(Math.max(0, Math.min(100, riskResult.finalScore)));

    // directionMode is extracted earlier — see protocol selection above
    let signal: 'BUY' | 'HOLD' | 'SELL';
    if (composite >= ENTRY_THRESHOLD) {
      signal = 'BUY';
    } else if (composite >= HOLD_FLOOR) {
      signal = 'HOLD';
    } else {
      // Low composite: directionMode determines HOLD vs SELL
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
    return Promise.all(
      holdings.map((h) => this.scoreWithGating(h.symbol, h.bars, protocolId)),
    );
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
