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
import { isScoringDemo } from '../../config/scoring-mode';

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
  riskMultiplier: number;
  breakouts: Record<string, DirectiveBreakout[]>;
  gatingActive: boolean;
  rarity?: RarityInfo;
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
  ): Promise<GatedScore> {
    const input: DirectiveInput = { symbol, bars };

    // Select protocol groups
    const activeGroups = protocolId
      ? (PROTOCOL_REGISTRY[protocolId]?.groups ?? DIRECTIVE_GROUPS)
      : DIRECTIVE_GROUPS;

    // 1. Run ALL directives
    const allResults = this.directivesService.runAll(input);

    // 2. Group results with maxScore from directive registry
    const groups = new Map<string, { results: DirectiveResult[]; config: DirectiveGroup; maxScores: Map<string, number> }>();

    for (const group of activeGroups) {
      const groupResults: DirectiveResult[] = [];
      const maxScores = new Map<string, number>();

      for (const directiveId of group.directiveIds) {
        const result = allResults.get(directiveId);
        if (result) {
          groupResults.push(result);
          // Get maxScore from the directive instance
          const directive = this.directivesService.get(directiveId);
          maxScores.set(directiveId, directive?.maxScore ?? 100);
        }
      }

      groups.set(group.id, { results: groupResults, config: group, maxScores });
    }

    // 3. Compute group sub-scores (normalized to 0-100 within group)
    const subScores: Record<string, number> = {};
    const breakouts: Record<string, DirectiveBreakout[]> = {};

    for (const [groupId, { results, config, maxScores }] of groups) {
      breakouts[groupId] = [];

      if (results.length === 0) {
        subScores[groupId] = 50; // Neutral default when no directives match
        continue;
      }

      // Normalize each directive score to 0-100 based on its maxScore
      const normalized: number[] = [];
      for (const result of results) {
        // Find the directive ID by matching result in allResults
        const directiveId = this.findDirectiveId(allResults, result);
        const maxScore = directiveId ? (maxScores.get(directiveId) ?? 100) : 100;
        const normalizedScore = maxScore > 0 ? (result.score / maxScore) * 100 : 0;
        normalized.push(normalizedScore);

        const directive = directiveId ? this.directivesService.get(directiveId) : null;

        breakouts[groupId].push({
          directiveId: directiveId ?? 'unknown',
          name: directive?.name ?? directiveId ?? 'Unknown',
          score: result.score,
          maxScore,
          normalizedScore: Math.round(normalizedScore),
          signalClass: result.signalClass ?? 'neutral',
          reason: result.reason,
          groupId,
        });
      }

      // Group score = average of normalized directive scores
      const avg = normalized.reduce((a, b) => a + b, 0) / normalized.length;
      subScores[groupId] = Math.round(avg);
    }

    // 4. Apply risk gate (multiplicative)
    const riskScore = subScores['risk'] ?? 50;
    const riskGroup = activeGroups.find((g) => g.id === 'risk')!;
    let riskMultiplier = riskScore / 100;

    // Apply floor/ceiling — relaxed in demo mode
    const demo = isScoringDemo();
    const effectiveMin = demo ? Math.max(0.5, riskGroup.minMultiplier) : riskGroup.minMultiplier;
    const effectiveMax = demo ? Math.min(1.5, riskGroup.maxMultiplier * 1.2) : riskGroup.maxMultiplier;
    if (riskMultiplier < effectiveMin) {
      riskMultiplier = effectiveMin;
    } else if (riskMultiplier > effectiveMax) {
      riskMultiplier = riskGroup.maxMultiplier;
    }

    // 5. Compute composite
    const technicalContribution = (subScores['technical'] ?? 50) * 0.40;
    const sentimentContribution = (subScores['sentiment'] ?? 50) * 0.35;
    const rawComposite = (technicalContribution + sentimentContribution) * riskMultiplier;

    const composite = Math.round(Math.max(0, Math.min(100, rawComposite)));
    const signal: 'BUY' | 'HOLD' | 'SELL' =
      composite >= ENTRY_THRESHOLD ? 'BUY' : composite >= HOLD_FLOOR ? 'HOLD' : 'SELL';

    // Meta: show what additive would have given
    const additiveEquivalent = Math.round(
      ((subScores['technical'] ?? 50) + (subScores['sentiment'] ?? 50) + riskScore) / 3,
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
      riskMultiplier: Number(riskMultiplier.toFixed(2)),
      breakouts,
      gatingActive: true,
      rarity,
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
