import { Injectable, Logger } from '@nestjs/common';
import { DirectivesService } from '../directives/directives.service';
import {
  DirectiveInput,
  DirectiveResult,
} from '../directives/interfaces/directive.interface';
import {
  DIRECTIVE_GROUPS,
  DirectiveGroup,
} from '../directives/directive-groups';

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

export interface GatedScore {
  symbol: string;
  composite: number;
  signal: 'BUY' | 'HOLD' | 'SELL';
  subScores: Record<string, number>;
  riskMultiplier: number;
  breakouts: Record<string, DirectiveBreakout[]>;
  gatingActive: boolean;
  meta: {
    additiveEquivalent: number;
    gatingDelta: number;
    directiveCount: number;
    gatedCount: number;
    riskDirectiveCount: number;
  };
}

// ─── Thresholds ──────────────────────────────────────────

const ENTRY_THRESHOLD = 65;
const HOLD_FLOOR = 35;

// ─── Service ─────────────────────────────────────────────

@Injectable()
export class ProtocolGatingService {
  private readonly logger = new Logger(ProtocolGatingService.name);

  constructor(private readonly directivesService: DirectivesService) {}

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
  ): Promise<GatedScore> {
    const input: DirectiveInput = { symbol, bars };

    // 1. Run ALL directives
    const allResults = this.directivesService.runAll(input);

    // 2. Group results with maxScore from directive registry
    const groups = new Map<string, { results: DirectiveResult[]; config: DirectiveGroup; maxScores: Map<string, number> }>();

    for (const group of DIRECTIVE_GROUPS) {
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
    const riskGroup = DIRECTIVE_GROUPS.find((g) => g.id === 'risk')!;
    let riskMultiplier = riskScore / 100;

    // Apply floor/ceiling
    if (riskMultiplier < riskGroup.minMultiplier) {
      riskMultiplier = riskGroup.minMultiplier;
    } else if (riskMultiplier > riskGroup.maxMultiplier) {
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

    return {
      symbol,
      composite,
      signal,
      subScores,
      riskMultiplier: Number(riskMultiplier.toFixed(2)),
      breakouts,
      gatingActive: true,
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
  ): Promise<GatedScore[]> {
    return Promise.all(
      holdings.map((h) => this.scoreWithGating(h.symbol, h.bars)),
    );
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
