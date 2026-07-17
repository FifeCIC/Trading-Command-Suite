import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolGatingService, GatedScore, DirectiveBreakout } from '../scoring/protocol-gating.service';
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { MarketDataService } from '../market-data/market-data.service';
import { ScoreHistoryService } from '../scoring/score-history.service';

/** Strategy ID used when persisting Signals Workbench scores. */
const SIGNALS_WORKBENCH_STRATEGY_ID = 'signals-workbench';

/**
 * SignalEnvelopeService
 * =====================
 * Bridges the scoring pipeline (ProtocolGatingService) into rich signal envelopes
 * for the Signals Workbench UI.
 *
 * Produces per-symbol envelopes with:
 *  - Signal ladder (ranked by composite score)
 *  - Directive drilldown (which directives fired, why, and their individual scores)
 *  - Conflict detection (directives disagreeing on direction)
 *  - Confidence rails (risk gate severity, rarity, multi-timeframe agreement)
 *  - Pre-trade readiness flags
 */

export interface SignalEnvelope {
  symbol: string;
  composite: number;
  signal: 'BUY' | 'HOLD' | 'SELL';
  confidence: number;            // 0-100 confidence score
  rarity: string | null;         // e.g. "Exceptional", "Strong"
  rarityColor: string | null;
  riskGate: {
    active: boolean;
    multiplier: number;
    triggered: boolean;
    reason: string | null;
    chain: Array<{ rule: string; multiplier: number; severity: number }>;
    warnings: string[];
  };
  groups: Array<{
    groupId: string;
    groupName: string;
    score: number;               // 0-100 normalized group score
    weight: number;
    isRisk: boolean;
    topDirectives: Array<{
      id: string;
      name: string;
      score: number;
      maxScore: number;
      normalized: number;        // 0-100
      signalClass: string;       // bullish, bearish, neutral
      reason: string;
    }>;
  }>;
  conflicts: Array<{
    type: 'bull_bear' | 'score_divergence' | 'timeframe_mismatch';
    severity: 'low' | 'medium' | 'high';
    description: string;
    directives: string[];
  }>;
  preTradeReady: boolean;
  preTradeBlockers: string[];
  scoredAt: string;
}

export interface SignalLadder {
  generatedAt: string;
  protocolId: string | null;
  protocolName: string | null;
  totalSymbols: number;
  buyCount: number;
  sellCount: number;
  holdCount: number;
  envelopes: SignalEnvelope[];
  topConflicts: Array<{
    symbol: string;
    conflictCount: number;
    severity: 'low' | 'medium' | 'high';
  }>;
}

@Injectable()
export class SignalEnvelopeService {
  private readonly logger = new Logger(SignalEnvelopeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly protocolDb: ProtocolDbService,
    private readonly marketData: MarketDataService,
    private readonly scoreHistory: ScoreHistoryService,
  ) {}

  /**
   * Build a full signal ladder for a set of symbols.
   */
  async buildLadder(
    symbols: string[],
    protocolId?: string,
  ): Promise<SignalLadder> {
    const envelopes: SignalEnvelope[] = [];

    for (const ticker of symbols) {
      try {
        const envelope = await this.buildEnvelope(ticker, protocolId);
        envelopes.push(envelope);
      } catch (err) {
        this.logger.warn(`Skipping ${ticker}: ${(err as Error).message}`);
        envelopes.push(this.emptyEnvelope(ticker));
      }
    }

    // Sort by composite descending
    envelopes.sort((a, b) => b.composite - a.composite);

    const buyCount = envelopes.filter(e => e.signal === 'BUY').length;
    const sellCount = envelopes.filter(e => e.signal === 'SELL').length;
    const holdCount = envelopes.filter(e => e.signal === 'HOLD').length;

    // Collect top conflicts
    const topConflicts = envelopes
      .filter(e => e.conflicts.length > 0)
      .map(e => ({
        symbol: e.symbol,
        conflictCount: e.conflicts.length,
        severity: e.conflicts.some(c => c.severity === 'high') ? 'high' as const
          : e.conflicts.some(c => c.severity === 'medium') ? 'medium' as const
          : 'low' as const,
      }))
      .sort((a, b) => b.conflictCount - a.conflictCount)
      .slice(0, 10);

    const protocolName = protocolId ? this.getProtocolName(protocolId) : null;

    // ── Persist scores to DB so they appear in scoring-runs / scoring-activity-logs ──
    const strategyId = protocolId || SIGNALS_WORKBENCH_STRATEGY_ID;
    this.persistScores(envelopes, strategyId).catch(err =>
      this.logger.warn(`Failed to persist signal scores: ${(err as Error).message}`),
    );

    return {
      generatedAt: new Date().toISOString(),
      protocolId: protocolId ?? null,
      protocolName,
      totalSymbols: envelopes.length,
      buyCount,
      sellCount,
      holdCount,
      envelopes,
      topConflicts,
    };
  }

  /**
   * Build a single signal envelope for one symbol.
   */
  async buildEnvelope(
    ticker: string,
    protocolId?: string,
  ): Promise<SignalEnvelope> {
    const cleanTicker = ticker.toUpperCase();

    // Look up symbol
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: cleanTicker },
    });

    const marketBars = sym
      ? await this.marketData.getBars(sym.id, '1d', 100)
      : [];

    if (!marketBars || marketBars.length === 0) {
      return this.emptyEnvelope(cleanTicker);
    }

    // Score via ProtocolGatingService
    const gated = await this.protocolGating.scoreWithGating(
      cleanTicker,
      marketBars,
      protocolId,
    );

    return this.enrichEnvelope(cleanTicker, gated);
  }

  /**
   * Enrich a GatedScore into a SignalEnvelope with confidence rails,
   * directive grouping, and conflict detection.
   */
  private enrichEnvelope(symbol: string, gated: GatedScore): SignalEnvelope {
    // Build group panels from breakouts
    const groups = this.buildGroups(gated);

    // Compute confidence from multiple signals
    const confidence = this.computeConfidence(gated);

    // Detect conflicts
    const conflicts = this.detectConflicts(gated);

    // Pre-trade readiness
    const { preTradeReady, preTradeBlockers } = this.evaluatePreTrade(gated, conflicts);

    return {
      symbol,
      composite: gated.composite,
      signal: gated.signal,
      confidence,
      rarity: gated.rarity?.label ?? null,
      rarityColor: gated.rarity?.color ?? null,
      riskGate: {
        active: gated.gatingActive,
        multiplier: gated.riskMultiplier,
        triggered: gated.riskGate?.hardGateTriggered ?? false,
        reason: gated.riskGate?.hardGateReason ?? null,
        chain: (gated.riskGate?.multiplierChain ?? []).map(s => ({
          rule: s.name,
          multiplier: s.multiplier,
          severity: s.severity,
        })),
        warnings: gated.riskGate?.warnings ?? [],
      },
      groups,
      conflicts,
      preTradeReady,
      preTradeBlockers,
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * Build directive group panels from GatedScore breakouts.
   */
  private buildGroups(gated: GatedScore): SignalEnvelope['groups'] {
    const groupMap: Record<string, { name: string; weight: number; isRisk: boolean }> = {
      technical: { name: 'Technical', weight: 40, isRisk: false },
      sentiment: { name: 'Sentiment', weight: 35, isRisk: false },
      risk: { name: 'Risk Gate', weight: 25, isRisk: true },
      macro: { name: 'Macro', weight: 20, isRisk: false },
      fundamental: { name: 'Fundamental', weight: 15, isRisk: false },
      exit: { name: 'Exit Signals', weight: 10, isRisk: true },
    };

    const groups: SignalEnvelope['groups'] = [];

    for (const [groupId, breakouts] of Object.entries(gated.breakouts)) {
      if (!breakouts || breakouts.length === 0) continue;

      const meta = groupMap[groupId] || { name: groupId, weight: 0, isRisk: false };
      const score = gated.subScores[groupId] ?? 50;

      // Sort breakouts by normalized score descending, take top 5
      const sorted = [...breakouts]
        .sort((a, b) => b.normalizedScore - a.normalizedScore)
        .slice(0, 5);

      groups.push({
        groupId,
        groupName: meta.name,
        score: Math.round(score),
        weight: meta.weight,
        isRisk: meta.isRisk,
        topDirectives: sorted.map(b => ({
          id: b.directiveId,
          name: b.name,
          score: b.score,
          maxScore: b.maxScore,
          normalized: b.normalizedScore,
          signalClass: b.signalClass,
          reason: b.reason,
        })),
      });
    }

    // Sort: non-risk groups first by weight desc, risk groups last
    groups.sort((a, b) => {
      if (a.isRisk !== b.isRisk) return a.isRisk ? 1 : -1;
      return b.weight - a.weight;
    });

    return groups;
  }

  /**
   * Compute a 0-100 confidence score from multiple signals:
   *  - Rarity band bonus
   *  - Distance from threshold
   *  - Group agreement (low variance = higher confidence)
   *  - Risk gate severity penalty
   */
  private computeConfidence(gated: GatedScore): number {
    let confidence = 50; // base

    // Rarity bonus
    if (gated.rarity) {
      const rarityBonuses: Record<string, number> = {
        'standard': 0,
        'strong': 10,
        'exceptional': 20,
        'cyclical': 15,
        'black-swan': -30,
      };
      confidence += rarityBonuses[gated.rarity.band] ?? 0;
    }

    // Distance from threshold
    const distance = gated.composite - 65;
    if (distance > 0) confidence += Math.min(distance * 0.5, 15);
    else confidence -= Math.min(Math.abs(distance) * 0.3, 15);

    // Group agreement: lower variance = higher confidence
    const scores = Object.values(gated.subScores).filter(s => s !== 50);
    if (scores.length >= 2) {
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
      const stdDev = Math.sqrt(variance);
      if (stdDev < 10) confidence += 10;
      else if (stdDev < 20) confidence += 5;
      else if (stdDev > 30) confidence -= 10;
    }

    // Risk gate penalty
    if (gated.riskGate?.hardGateTriggered) {
      confidence -= 25;
    }
    if (gated.riskMultiplier < 0.5) {
      confidence -= 15;
    } else if (gated.riskMultiplier < 0.7) {
      confidence -= 5;
    }

    return Math.max(0, Math.min(100, Math.round(confidence)));
  }

  /**
   * Detect directive conflicts: bull vs bear disagreement,
   * score divergence, or timeframe mismatches.
   */
  private detectConflicts(gated: GatedScore): SignalEnvelope['conflicts'] {
    const conflicts: SignalEnvelope['conflicts'] = [];

    const allBreakouts = Object.values(gated.breakouts).flat();
    const bullish = allBreakouts.filter(b => b.signalClass === 'bullish');
    const bearish = allBreakouts.filter(b => b.signalClass === 'bearish');

    // Bull vs Bear conflict
    if (bullish.length > 0 && bearish.length > 0) {
      const bullAvg = bullish.reduce((s, b) => s + b.normalizedScore, 0) / bullish.length;
      const bearAvg = bearish.reduce((s, b) => s + b.normalizedScore, 0) / bearish.length;
      const gap = Math.abs(bullAvg - bearAvg);

      conflicts.push({
        type: 'bull_bear',
        severity: gap < 15 ? 'high' : gap < 30 ? 'medium' : 'low',
        description: `${bullish.length} bullish vs ${bearish.length} bearish directives (${gap.toFixed(0)}pt gap)`,
        directives: [
          ...bullish.map(b => b.name),
          ...bearish.map(b => b.name),
        ],
      });
    }

    // Score divergence: check if any group's score deviates significantly
    const scores = Object.entries(gated.subScores)
      .filter(([, v]) => v !== 50);
    if (scores.length >= 2) {
      const vals = scores.map(([, v]) => v);
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      if (max - min > 40) {
        const maxGroup = scores.find(([, v]) => v === max)?.[0] ?? '?';
        const minGroup = scores.find(([, v]) => v === min)?.[0] ?? '?';
        conflicts.push({
          type: 'score_divergence',
          severity: max - min > 60 ? 'high' : 'medium',
          description: `${maxGroup} (${max.toFixed(0)}) vs ${minGroup} (${min.toFixed(0)}) — ${(max - min).toFixed(0)}pt spread`,
          directives: [],
        });
      }
    }

    return conflicts;
  }

  /**
   * Evaluate pre-trade readiness: are all gates clear?
   */
  private evaluatePreTrade(gated: GatedScore, conflicts: SignalEnvelope['conflicts']): {
    preTradeReady: boolean;
    preTradeBlockers: string[];
  } {
    const blockers: string[] = [];

    if (gated.riskGate?.hardGateTriggered) {
      blockers.push(`Hard gate: ${gated.riskGate.hardGateReason}`);
    }
    if (gated.riskMultiplier < 0.3) {
      blockers.push(`Risk multiplier critically low (${(gated.riskMultiplier * 100).toFixed(0)}%)`);
    }
    if (conflicts.some(c => c.severity === 'high')) {
      blockers.push('High-severity directive conflict');
    }
    if (gated.composite < 65) {
      blockers.push(`Composite below entry threshold (${gated.composite.toFixed(0)}/65)`);
    }
    if (gated.signal === 'SELL' && gated.composite > 50) {
      blockers.push('Mixed signal — SELL but composite above midpoint');
    }

    return {
      preTradeReady: blockers.length === 0,
      preTradeBlockers: blockers,
    };
  }

  private getProtocolName(protocolId: string): string {
    return this.protocolDb.getCached(protocolId)?.name ?? protocolId;
  }

  private emptyEnvelope(symbol: string): SignalEnvelope {
    return {
      symbol,
      composite: 50,
      signal: 'HOLD',
      confidence: 0,
      rarity: null,
      rarityColor: null,
      riskGate: { active: false, multiplier: 1, triggered: false, reason: null, chain: [], warnings: [] },
      groups: [],
      conflicts: [],
      preTradeReady: false,
      preTradeBlockers: ['No market data available'],
      scoredAt: new Date().toISOString(),
    };
  }

  /**
   * Get a single symbol's envelope with full directive drilldown.
   */
  async getDrilldown(ticker: string, protocolId?: string): Promise<SignalEnvelope> {
    return this.buildEnvelope(ticker, protocolId);
  }

  /**
   * Persist scored envelopes to the Score table so they appear in
   * scoring-runs and scoring-activity-logs pages.
   */
  private async persistScores(
    envelopes: SignalEnvelope[],
    strategyId: string,
  ): Promise<void> {
    const strategy = await this.ensureStrategy(strategyId);

    for (const env of envelopes) {
      if (env.composite === 50 && env.signal === 'HOLD' && env.confidence === 0) {
        continue; // Skip empty/no-data envelopes
      }

      try {
        const sym = await this.prisma.symbol.findFirst({
          where: { ticker: env.symbol },
          select: { id: true },
        });
        if (!sym) continue;

        await this.scoreHistory.storeSnapshot(
          sym.id,
          strategy.id,
          env.composite,
          {
            signal: env.signal,
            confidence: env.confidence,
            rarity: env.rarity,
            source: 'signals-workbench',
            protocolId: strategyId !== SIGNALS_WORKBENCH_STRATEGY_ID ? strategyId : null,
            riskMultiplier: env.riskGate.multiplier,
            preTradeReady: env.preTradeReady,
            blockerCount: env.preTradeBlockers.length,
          },
        );
      } catch (err) {
        this.logger.warn(
          `Failed to persist score for ${env.symbol}: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Persisted ${envelopes.filter(e => e.confidence > 0).length} signal scores to DB (strategy: ${strategyId})`,
    );
  }

  /**
   * Find or create the strategy used to tag persisted scores.
   */
  private async ensureStrategy(strategyId: string): Promise<{ id: string; name: string }> {
    const existing = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      select: { id: true, name: true },
    });
    if (existing) return existing;

    // Create a placeholder strategy for signals-workbench
    const created = await this.prisma.strategy.create({
      data: {
        id: strategyId,
        name: strategyId === SIGNALS_WORKBENCH_STRATEGY_ID
          ? 'Signals Workbench'
          : `Signals Workbench — ${strategyId}`,
        description: 'Auto-created for Signals Workbench score persistence',
        config: {},
      },
      select: { id: true, name: true },
    });

    this.logger.log(`Created placeholder strategy "${created.name}" (${created.id})`);
    return created;
  }
}
