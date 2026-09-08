import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** A per-protocol actionable signal record, ready for queue routing (#714). */
export interface RoutableSignal {
  protocolId: string;
  symbol: string;
  direction: string; // LONG | SHORT
  signal: string;    // BUY | SELL
  /** Canonical signal percentage (0..100). Kept for schema compatibility. */
  compositePct: number | null;
  signalPct: number | null;
  opportunityPct: number | null;
  combinedStrength: number | null;
  scoreId: string | null;
}

/**
 * SignalQueueService — #714 Stage 1 (additive).
 * ==============================================
 * Routes the ONE scoring line's per-protocol signal records into trading-bot
 * queues. The Signals ladder itself is untouched — this is downstream routing.
 *
 * Semantics (design #714, locked 2026-09-01):
 *  - One queue per trading bot listing signals from ALL its subscribed protocols.
 *  - Same protocol+symbol re-signal REPLACES the old entry (dedupe/refresh).
 *  - No symbol merging across protocols — the same symbol may appear multiple
 *    times per bot from different protocols.
 *  - Void rule: when a re-score of protocol+symbol does NOT signal, prior
 *    pending entries for that pair are deleted.
 *  - Dismissals propagate signal → queue (pending entries removed).
 */
@Injectable()
export class SignalQueueService {
  private readonly logger = new Logger(SignalQueueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sync queues from this run's routing records + all scored pairs. */
  async syncQueues(actionable: RoutableSignal[], scoredPairs: Set<string>) {
    if (!this.prisma.isAvailable) return;
    if (actionable.length === 0 && scoredPairs.size === 0) return;
    try {
      // Subscriptions joined to the bot config (symbol scope + active flag).
      const subs: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT sp.strategyId, sp.protocolId, ts.symbol AS strategySymbol
         FROM strategy_protocol sp
         JOIN trading_strategy ts ON ts.id = sp.strategyId
         WHERE ts.active = 1`,
      );

      // Upsert pending entries for each actionable record.
      for (const rec of actionable) {
        if (!rec.scoreId || !isPercentage(rec.compositePct) || !isPercentage(rec.signalPct)) {
          this.logger.warn(`Queue rejected ${rec.protocolId}/${rec.symbol}: missing lineage or invalid score units`);
          continue;
        }
        for (const sub of subs) {
          if (sub.protocolId !== rec.protocolId) continue;
          if (sub.strategySymbol && sub.strategySymbol !== rec.symbol) continue;
          await this.upsertEntry(sub.strategyId, rec);
        }
      }

      // Void pass — for every protocol scored this run, drop pending entries
      // whose symbol did NOT produce an actionable signal this run.
      const protoSymbols = new Map<string, Set<string>>();
      for (const pair of scoredPairs) {
        const [pid, sym] = pair.split('|');
        if (!pid || !sym) continue;
        if (!protoSymbols.has(pid)) protoSymbols.set(pid, new Set());
        protoSymbols.get(pid)!.add(sym);
      }
      const actionableByProto = new Map<string, Set<string>>();
      for (const rec of actionable) {
        if (!actionableByProto.has(rec.protocolId)) actionableByProto.set(rec.protocolId, new Set());
        actionableByProto.get(rec.protocolId)!.add(rec.symbol);
      }
      for (const [pid, scoredSyms] of protoSymbols) {
        const live = actionableByProto.get(pid) || new Set<string>();
        const dead = [...scoredSyms].filter(s => !live.has(s));
        if (dead.length === 0) continue;
        const placeholders = dead.map(() => '?').join(',');
        await (this.prisma as any).$executeRawUnsafe(
          `DELETE FROM strategy_signal_queue
           WHERE protocolId = ? AND status = 'pending' AND symbol IN (${placeholders})`,
          pid, ...dead,
        );
        this.logger.log(`Queue void: ${pid} dropped non-signalling symbol(s) [${dead.join(', ')}]`);
      }
    } catch (err) {
      this.logger.warn(`Signal queue sync failed: ${(err as Error).message}`);
    }
  }

  /** Dismissal propagation (#714): signal dismissed → pending queue entries removed. */
  async removePendingForSignal(symbol: string, protocolId?: string) {
    try {
      if (protocolId) {
        await (this.prisma as any).$executeRawUnsafe(
          `DELETE FROM strategy_signal_queue WHERE symbol = ? AND protocolId = ? AND status = 'pending'`,
          symbol, protocolId,
        );
      } else {
        await (this.prisma as any).$executeRawUnsafe(
          `DELETE FROM strategy_signal_queue WHERE symbol = ? AND status = 'pending'`,
          symbol,
        );
      }
    } catch {
      /* table may not exist yet — non-fatal */
    }
  }

  /** Pending queue for one trading bot, strongest first. */
  async getQueue(strategyId: string) {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, strategyId, symbol, protocolId, direction, \`signal\`,
                CAST(compositePct AS DECIMAL(10,4)) AS compositePct,
                CAST(signalPct AS DECIMAL(10,4)) AS signalPct,
                CAST(opportunityPct AS DECIMAL(10,4)) AS opportunityPct,
                CAST(combinedStrength AS DECIMAL(10,4)) AS combinedStrength,
                scoreId, status, createdAt, updatedAt
         FROM strategy_signal_queue
         WHERE strategyId = ? AND status = 'pending'
         ORDER BY COALESCE(combinedStrength, 0) DESC, createdAt ASC`,
        strategyId,
      );
      return rows.map((r: any) => ({
        ...r,
        compositePct: r.compositePct == null ? null : Number(r.compositePct),
        signalPct: r.signalPct == null ? null : Number(r.signalPct),
        opportunityPct: r.opportunityPct == null ? null : Number(r.opportunityPct),
        combinedStrength: r.combinedStrength == null ? null : Number(r.combinedStrength),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt ?? ''),
      }));
    } catch {
      return [];
    }
  }

  private async upsertEntry(strategyId: string, rec: RoutableSignal) {
    try {
      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO strategy_signal_queue
           (id, strategyId, symbol, protocolId, direction, \`signal\`, compositePct, signalPct, opportunityPct, combinedStrength, scoreId, status, createdAt, updatedAt)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           direction = VALUES(direction), \`signal\` = VALUES(\`signal\`),
           compositePct = VALUES(compositePct), signalPct = VALUES(signalPct),
           opportunityPct = VALUES(opportunityPct), combinedStrength = VALUES(combinedStrength),
           scoreId = VALUES(scoreId), status = 'pending', updatedAt = NOW()`,
        strategyId, rec.symbol, rec.protocolId, rec.direction, rec.signal,
        rec.compositePct ?? null, rec.signalPct ?? null, rec.opportunityPct ?? null,
        rec.combinedStrength ?? null, rec.scoreId ?? null,
      );
    } catch (err) {
      this.logger.warn(`Queue upsert failed for ${strategyId}/${rec.symbol}: ${(err as Error).message}`);
    }
  }
}

/** Persistence-boundary guard: raw scores must never enter percentage columns. */
function isPercentage(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}
