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

  /**
   * #535 — reverse trace: given a trade ticket, assemble the full chain that
   * produced it (trade → scoring strategy → strategy evaluations → decision
   * trail → score snapshots → decision_log timeline → directive breakouts).
   */
  async getTradeTrail(ticket: string): Promise<any | null> {
    const ticketNum = parseInt(ticket, 10);
    const isNumeric = /^\d+$/.test(ticket);

    // 1. The trade itself — match by numeric ticket, brokerTicket, or row id.
    const trade = await this.prisma.trade.findFirst({
      where: {
        OR: [
          ...(isNumeric && Number.isFinite(ticketNum) ? [{ ticket: ticketNum }] : []),
          { brokerTicket: ticket },
          { id: ticket },
        ],
      },
    });
    if (!trade) return null;

    // 2. Scoring strategy — the params that sized/guarded the trade
    let scoringStrategy: any = null;
    if (trade.scoringStrategyId) {
      scoringStrategy = await this.prisma.scoringStrategy
        .findUnique({ where: { id: trade.scoringStrategyId } })
        .catch(() => null);
    }

    // 3. Strategy evaluations that produced this ticket — only when the ticket is a real one.
    //
    // 🛑 CORRECTED 2026-09-22. This previously read `trade.ticket === 2147483647` and described
    // that value as "the MT5 placeholder". It is NOT a placeholder. It is the INT32 CLAMP
    // artefact of a 12-digit ticket written into an `int` column on a non-strict MySQL, and
    // reading it as intentional is why the score→evaluation link was quietly skipped rather
    // than investigated. The column is BIGINT now, so new rows carry the true ticket; this
    // check is retained ONLY for historical rows, which genuinely still hold the clamped value.
    //
    // ⚠️ Compare against a BigInt literal. Prisma returns a JS `BigInt` for a BIGINT column and
    // `2147483647n === 2147483647` is FALSE — a number literal here would make the guard
    // silently stop working while still looking correct in review.
    const isPlaceholderTicket = trade.ticket === 2147483647n;
    const evaluations = !isPlaceholderTicket && trade.ticket != null
      ? await this.prisma.strategyEvaluation.findMany({
          where: { tradeTicket: trade.ticket },
          orderBy: { evaluatedAt: 'asc' },
        })
      : [];

    // 4. Decision-trail rows linked to this trade
    const trails = await this.prisma.decisionTrail.findMany({
      where: { OR: [{ tradeId: trade.id }, { tradeTicket: ticketNum }] },
      orderBy: { timestamp: 'asc' },
    });

    // 5. Score snapshots linked from those trail rows
    const snapshotIds = [...new Set(trails.map((t) => t.scoreSnapshotId).filter(Boolean))] as string[];
    const snapshots = snapshotIds.length
      ? await this.prisma.scoreSnapshot.findMany({ where: { id: { in: snapshotIds } }, orderBy: { snappedAt: 'asc' } })
      : [];

    // 6. decision_log timeline for the symbol + strategies involved, around the trade
    const strategyIds = [...new Set([
      ...trails.map((t) => t.strategyId),
      ...(trade.scoringStrategyId ? [trade.scoringStrategyId] : []),
    ].filter(Boolean))] as string[];
    const decisionLogs = strategyIds.length
      ? await this.prisma.decisionLog.findMany({
          where: {
            strategyId: { in: strategyIds },
            symbol: trade.symbol,
            timestamp: {
              gte: new Date(trade.openedAt.getTime() - 5 * 60_000),
              lte: new Date(trade.openedAt.getTime() + 60_000),
            },
          },
          orderBy: { timestamp: 'asc' },
        })
      : [];

    // 7. Directive-level breakdown: nearest Score row for protocol+symbol before open
    let directiveBreakdown: any = null;
    const protocolId = scoringStrategy?.protocolId ?? trade.strategy ?? null;
    if (protocolId) {
      const sym = await this.prisma.symbol.findFirst({ where: { ticker: trade.symbol.toUpperCase() } }).catch(() => null);
      if (sym) {
        const score = await this.prisma.score.findFirst({
          where: { strategyId: protocolId, symbolId: sym.id, timestamp: { lte: trade.openedAt } },
          orderBy: { timestamp: 'desc' },
        });
        if (score) directiveBreakdown = score.breakdown;
      }
    }

    return {
      ticket: trade.ticket ?? trade.brokerTicket ?? null,
      trade: {
        id: trade.id, symbol: trade.symbol, side: trade.side, quantity: trade.quantity,
        entryPrice: trade.entryPrice, exitPrice: trade.exitPrice, pnl: trade.pnl,
        status: trade.status, provider: trade.provider, origin: trade.origin, source: trade.source,
        sl: trade.sl, tp: trade.tp, brokerComment: trade.brokerComment,
        openedAt: trade.openedAt.toISOString(), closedAt: trade.closedAt?.toISOString() ?? null,
      },
      scoringStrategy: scoringStrategy ? {
        name: scoringStrategy.name, protocolId: scoringStrategy.protocolId,
        watchlistName: scoringStrategy.watchlistName, brokerId: scoringStrategy.brokerId,
        mode: scoringStrategy.mode, tradeThreshold: scoringStrategy.tradeThreshold,
        baseSize: scoringStrategy.baseSize, slPct: scoringStrategy.slPct, tpPct: scoringStrategy.tpPct,
      } : null,
      evaluations: evaluations.map((e) => ({
        id: e.id, composite: e.composite, signal: e.signal, traded: e.traded,
        tradeResult: e.tradeResult, evaluatedAt: e.evaluatedAt.toISOString(),
      })),
      decisionTrail: trails.map((t) => ({
        id: t.id, tickNumber: t.tickNumber, timestamp: t.timestamp.toISOString(), symbol: t.symbol,
        winner: t.winner, chosenComposite: t.chosenComposite, finalSignal: t.finalSignal,
        actionable: t.actionable, reason: t.reason,
        longProtocolId: t.longProtocolId, longComposite: t.longComposite,
        shortProtocolId: t.shortProtocolId, shortComposite: t.shortComposite,
        tradePrice: t.tradePrice, tradeVolume: t.tradeVolume,
      })),
      snapshots: snapshots.map((s) => ({
        id: s.id, protocolId: s.protocolId, symbol: s.symbol, composite: s.composite,
        tradingSignal: s.tradingSignal, signalPct: s.signalPct, opportunityPct: s.opportunityPct,
        rarityPct: s.rarityPct, snappedAt: s.snappedAt.toISOString(),
      })),
      decisionLog: decisionLogs.map((d) => ({
        id: d.id, timestamp: d.timestamp.toISOString(), tickNumber: d.tickNumber,
        decision: d.decision, reason: d.reason, signal: d.signal,
        // #909 — unit-explicit scores; `compositeLegacy` is the pre-split value (unit unrecorded).
        compositeRaw: d.compositeRaw ?? null,
        compositePct: d.compositePct ?? null,
        compositeLegacy: d.composite ?? null,
        ticket: d.ticket, price: d.price, quantity: d.quantity,
      })),
      directiveBreakdown,
    };
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
