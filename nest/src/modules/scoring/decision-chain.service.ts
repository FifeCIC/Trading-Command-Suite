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
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    // Resolve linked records in batches (avoids N+1)
    const scoringIds = [...new Set(trails.map(t => t.strategyId).filter(Boolean))];
    const snapshotIds = [...new Set(trails.map(t => t.scoreSnapshotId).filter(Boolean))];
    const evalIds = [...new Set(trails.map(t => t.strategyEvalId).filter(Boolean))];
    const tradeIds = [...new Set(trails.map(t => t.tradeId).filter(Boolean))];

    const [scoringMap, snapshotMap, evalMap, tradeMap] = await Promise.all([
      this.loadMap('scoringStrategy', scoringIds),
      this.loadMap('scoreSnapshot', snapshotIds),
      this.loadMap('strategyEvaluation', evalIds),
      this.loadMap('trade', tradeIds),
    ]);

    return trails.map(t => {
      const scoring = scoringMap.get(t.strategyId) as any;
      const snapshot = t.scoreSnapshotId ? snapshotMap.get(t.scoreSnapshotId) as any : null;
      const eval_ = t.strategyEvalId ? evalMap.get(t.strategyEvalId) as any : null;
      const trade = t.tradeId ? tradeMap.get(t.tradeId) as any : null;

      return {
        // Score Snapshot
        snapshotId: snapshot?.id ?? '',
        protocolId: scoring?.protocolId ?? t.longProtocolId ?? '',
        symbol: t.symbol,
        composite: snapshot?.composite ?? t.chosenComposite,
        signal: snapshot?.tradingSignal ?? t.finalSignal ?? '',
        rarityPct: snapshot?.rarityPct ?? null,
        snappedAt: snapshot?.snappedAt?.toISOString() ?? '',
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
        evalId: eval_?.id ?? null,
        evalComposite: eval_?.composite ?? null,
        evalSignal: eval_?.signal ?? null,
        traded: eval_?.traded ?? null,
        tradeTicket: eval_?.tradeTicket ?? t.tradeTicket ?? null,
        evaluatedAt: eval_?.evaluatedAt?.toISOString() ?? null,
        // Trade
        tradeId: trade?.id ?? null,
        tradeSide: trade?.side ?? null,
        tradeQuantity: trade?.quantity ?? null,
        entryPrice: trade?.entryPrice ?? null,
        exitPrice: trade?.exitPrice ?? null,
        pnl: trade?.pnl ?? null,
        tradeStatus: trade?.status ?? null,
      };
    });
  }

  /** Batch-load a table by ID list into a Map. */
  private async loadMap(table: string, ids: string[]): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    if (ids.length === 0) return map;
    // Use raw queries since we can't use Prisma model methods generically
    const rows = await (this.prisma as any).$queryRawUnsafe(
      `SELECT * FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    for (const row of rows as any[]) {
      map.set(row.id, row);
    }
    return map;
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
      take: 1000,
    });

    let matched = 0;
    for (const trail of trails) {
      // Look up scoring strategy to get protocolId
      const scoring = await (this.prisma as any).scoringStrategy.findUnique({
        where: { id: trail.strategyId },
        select: { protocolId: true },
      });
      const protocolId = scoring?.protocolId ?? trail.longProtocolId;
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
