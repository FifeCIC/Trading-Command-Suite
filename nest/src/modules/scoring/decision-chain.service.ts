import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface DecisionChainRow {
  // ── Score Snapshot ──
  snapshotId: string;
  protocolId: string;
  symbol: string;
  composite: number;
  signal: string;
  rarityPct: number | null;
  snappedAt: string;
  // ── Decision Trail ──
  trailId: string;
  tickNumber: number;
  trailTimestamp: string;
  winner: string | null;
  chosenComposite: number;
  finalSignal: string | null;
  actionable: boolean;
  reason: string | null;
  // ── Strategy Evaluation ──
  evalId: string | null;
  evalComposite: number | null;
  evalSignal: string | null;
  traded: boolean | null;
  tradeTicket: number | null;
  evaluatedAt: string | null;
  // ── Trade ──
  tradeId: string | null;
  tradeSide: string | null;
  tradeQuantity: number | null;
  entryPrice: number | null;
  exitPrice: number | null;
  pnl: number | null;
  tradeStatus: string | null;
}

export interface ChainQueryParams {
  symbol?: string;
  strategyId?: string;
  tickNumber?: number;
  actionable?: boolean;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

/**
 * DecisionChainService — joined queries across the full audit chain.
 *
 * Links: ScoreSnapshot → DecisionTrail → StrategyEvaluation → Trade
 *
 * #475 Phase 2: Link decision_trail → scoring → strategy → trade chain
 */
@Injectable()
export class DecisionChainService {
  private readonly logger = new Logger(DecisionChainService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Query the full decision chain via correlated joins.
   *
   * Link path:
   *   ScoreSnapshot  ←→  DecisionTrail  ←→  StrategyEvaluation  ←→  Trade
   *   (protocol+symbol  (strategyEvalId)    (tradeId or
   *    +time proximity)                      tradeTicket)
   */
  async queryChain(params: ChainQueryParams = {}): Promise<DecisionChainRow[]> {
    const limit = params.limit ?? 50;
    const trails = await this.prisma.decisionTrail.findMany({
      where: {
        ...(params.symbol ? { symbol: params.symbol } : {}),
        ...(params.strategyId ? { strategyId: params.strategyId } : {}),
        ...(params.tickNumber !== undefined ? { tickNumber: params.tickNumber } : {}),
        ...(params.actionable !== undefined ? { actionable: params.actionable } : {}),
        ...(params.fromDate || params.toDate ? {
          timestamp: {
            ...(params.fromDate ? { gte: new Date(params.fromDate) } : {}),
            ...(params.toDate ? { lte: new Date(params.toDate) } : {}),
          },
        } : {}),
      },
      include: {
        scoringStrategy: { select: { id: true, name: true, protocolId: true } },
        scoreSnapshot: true,
        strategyEval: true,
        trade: true,
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return trails.map(t => ({
      // Score Snapshot
      snapshotId: t.scoreSnapshot?.id ?? '',
      protocolId: t.scoringStrategy?.protocolId ?? t.longProtocolId ?? '',
      symbol: t.symbol,
      composite: t.scoreSnapshot?.composite ?? t.chosenComposite,
      signal: t.scoreSnapshot?.tradingSignal ?? t.finalSignal ?? '',
      rarityPct: t.scoreSnapshot?.rarityPct ?? null,
      snappedAt: t.scoreSnapshot?.snappedAt?.toISOString() ?? '',
      // Decision Trail
      trailId: t.id,
      tickNumber: t.tickNumber,
      trailTimestamp: t.timestamp.toISOString(),
      winner: t.winner,
      chosenComposite: t.chosenComposite,
      finalSignal: t.finalSignal,
      actionable: t.actionable,
      reason: t.reason,
      // Strategy Evaluation
      evalId: t.strategyEval?.id ?? null,
      evalComposite: t.strategyEval?.composite ?? null,
      evalSignal: t.strategyEval?.signal ?? null,
      traded: t.strategyEval?.traded ?? null,
      tradeTicket: t.strategyEval?.tradeTicket ?? t.tradeTicket ?? null,
      evaluatedAt: t.strategyEval?.evaluatedAt?.toISOString() ?? null,
      // Trade
      tradeId: t.trade?.id ?? null,
      tradeSide: t.trade?.side ?? null,
      tradeQuantity: t.trade?.quantity ?? null,
      entryPrice: t.trade?.entryPrice ?? null,
      exitPrice: t.trade?.exitPrice ?? null,
      pnl: t.trade?.pnl ?? null,
      tradeStatus: t.trade?.status ?? null,
    }));
  }

  /**
   * Backfill scoreSnapshotId on existing decision_trail rows.
   * Matches on: ScoringStrategy.protocolId = ScoreSnapshot.protocolId
   *            + DecisionTrail.symbol = ScoreSnapshot.symbol
   *            + timestamp within ±2 minutes
   */
  async backfillScoreSnapshots(): Promise<{ matched: number; total: number }> {
    const trails = await this.prisma.decisionTrail.findMany({
      where: { scoreSnapshotId: null },
      include: { scoringStrategy: { select: { protocolId: true } } },
      take: 1000,
    });

    let matched = 0;
    for (const trail of trails) {
      const protocolId = trail.scoringStrategy?.protocolId ?? trail.longProtocolId;
      if (!protocolId) continue;

      // Find closest score_snapshot within ±2 min
      const windowStart = new Date(trail.timestamp.getTime() - 120_000);
      const windowEnd = new Date(trail.timestamp.getTime() + 120_000);

      const snapshot = await this.prisma.scoreSnapshot.findFirst({
        where: {
          protocolId,
          symbol: trail.symbol,
          snappedAt: { gte: windowStart, lte: windowEnd },
        },
        orderBy: { snappedAt: 'desc' },
      });

      if (snapshot) {
        await this.prisma.decisionTrail.update({
          where: { id: trail.id },
          data: { scoreSnapshotId: snapshot.id },
        });
        matched++;
      }
    }

    this.logger.log(`Backfill: matched ${matched}/${trails.length} score snapshots`);
    return { matched, total: trails.length };
  }

  /**
   * Backfill tradeId on decision_trail rows that have tradeTicket set.
   * Matches: DecisionTrail.tradeTicket = Trade.ticket
   */
  async backfillTradeLinks(): Promise<{ matched: number; total: number }> {
    const trails = await this.prisma.decisionTrail.findMany({
      where: { tradeTicket: { not: null }, tradeId: null },
      take: 1000,
    });

    let matched = 0;
    for (const trail of trails) {
      const trade = await this.prisma.trade.findFirst({
        where: { ticket: trail.tradeTicket! },
      });

      if (trade) {
        await this.prisma.decisionTrail.update({
          where: { id: trail.id },
          data: { tradeId: trade.id },
        });
        matched++;
      }
    }

    this.logger.log(`Backfill: matched ${matched}/${trails.length} trade links`);
    return { matched, total: trails.length };
  }
}
