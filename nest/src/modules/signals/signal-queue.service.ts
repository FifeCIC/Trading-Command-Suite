import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { resolveEffectiveRole, directionAllowed } from '../../common/utils/signal-direction';
// #882 — the ONE freshness bound, shared with the consumer gate (AutomationLoopService).
import { getMaxSignalAgeMinutes } from '../../common/utils/signal-freshness';
// #974 — persists WHY a signalled symbol was blocked, so the reason is queryable rather than
// living only in a log line. AutomationModule is @Global(), so this needs no module import.
import { AuditLogService } from '../automation/audit-log.service';

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

  constructor(
    private readonly prisma: PrismaService,
    /**
     * #974 — OPTIONAL on purpose. `signal-queue-expiry.spec.ts` constructs this service with a
     * prisma stub alone (`new SignalQueueService({ isAvailable: true })`), and a required second
     * parameter would break that test for a reason unrelated to what it asserts. At runtime
     * `AutomationModule` is `@Global()` so the provider is always present; the `?` exists for the
     * test edge, not for production.
     */
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  /** Sync queues from this run's routing records + all scored pairs.
   *
   * @param actionable  envelopes that passed every pre-queue check
   * @param scoredPairs every `protocolId|symbol` scored this run
   * @param notRouteable `protocolId|symbol` → WHY it was not routeable. Without
   *   this the void pass cannot tell "the protocol never signalled" from "it
   *   signalled and the pre-trade gate blocked it", and it used to report both
   *   as `dropped non-signalling symbol(s)` — which blamed the protocol for a
   *   decision the gate made, and cost real investigation time.
   */
  async syncQueues(
    actionable: RoutableSignal[],
    scoredPairs: Set<string>,
    notRouteable?: Map<string, string>,
  ) {
    if (!this.prisma.isAvailable) return;
    if (actionable.length === 0 && scoredPairs.size === 0) return;
    const directionSkips: string[] = [];
    try {
      // Subscriptions joined to the bot config (symbol scope + active flag).
      //
      // ⚠️ `sp.role` and `ts.requireDirection` are SELECTED and used below. They were not even
      // selected before, so a `role: 'short'` subscription received long signals while a bot whose
      // only purpose was to sell had no direction constraint in the live path. Measured
      // 2026-09-17: 24 subscriptions `role='long'`, 1 `role='short'`, and the routing filter matched
      // on protocol + symbol only.
      const subs: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT sp.strategyId, sp.protocolId, sp.role, ts.requireDirection, ts.symbol AS strategySymbol
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
          // Gate 0 — DIRECTION PERMISSION. ONE decision, via the single authority.
          const role = resolveEffectiveRole(sub.role, sub.requireDirection);
          if (!directionAllowed(role, rec.direction)) {
            directionSkips.push(`${rec.symbol}(${rec.direction} not in role=${role ?? 'any'})`);
            continue;
          }
          await this.upsertEntry(sub.strategyId, rec);
        }
      }
      if (directionSkips.length > 0) {
        // Named, not silent: a direction skip and "no signal" must not look alike in the log.
        this.logger.log(
          `Queue direction filter: dropped ${directionSkips.length} entry(ies) whose role does not permit the direction — ` +
            [...new Set(directionSkips)].join(', '),
        );
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

        // Split the dropped symbols by CAUSE so the log states what actually
        // happened. `blocked` = the protocol DID signal but the envelope was not
        // pre-trade ready (gate/risk/conflict); `silent` = no signal at all.
        const blocked: string[] = [];
        // The same blocks, UNFORMATTED. `blocked` above is display text for the log line;
        // parsing the cause back out of it would make a second source of truth for one fact.
        const blockedPairs: Array<{ sym: string; why: string }> = [];
        const silent: string[] = [];
        for (const sym of dead) {
          const why = notRouteable?.get(`${pid}|${sym}`);
          if (why) {
            blocked.push(`${sym} (${why})`);
            blockedPairs.push({ sym, why });
          } else silent.push(sym);
        }

        if (blocked.length > 0) {
          this.logger.log(
            `Queue skip: ${pid} signalled but blocked pre-trade [${blocked.join(' | ')}]`,
          );
          // ── Persist what the log just said (#974) ────────────────────────────────────────
          // Until this existed the cause was LOG-ONLY, so "why didn't this symbol trade?" was
          // answerable only by grepping api-out.log — while AuditLogService's own stated
          // contract is that it answers exactly that question with a query. That gap is the
          // reason the only observable symptom was "nothing happened".
          //
          // ⚠️ Step is `pre_trade_blocked`, NOT the duplicate guard's `duplicate_check`
          // (`logBlocked`). Same `decision`, DIFFERENT cause — merging them would recreate the
          // very defect the 'Queue skip' / 'Queue void' split was introduced to fix.
          for (const { sym, why } of blockedPairs) {
            this.auditLog?.logPreTradeBlocked(pid, sym, why);
          }
        }
        if (silent.length === 0) continue;

        const placeholders = silent.map(() => '?').join(',');
        await (this.prisma as any).$executeRawUnsafe(
          `DELETE FROM strategy_signal_queue
           WHERE protocolId = ? AND status = 'pending' AND symbol IN (${placeholders})`,
          pid, ...silent,
        );
        this.logger.log(`Queue void: ${pid} dropped non-signalling symbol(s) [${silent.join(', ')}]`);
      }

      // ── Expiry sweep (#882) — the void pass's missing counterpart ──────────────────────────
      //
      // The void pass above only sees pairs scored THIS run, so an entry whose pair stops being
      // scored is never voided by it — it is IMMORTAL. On 2026-09-21 one such entry executed 120
      // hours after it was first queued. Two rules close the hole. Both ARCHIVE
      // (`status = 'expired'`), never delete: the row is evidence of what the pipeline saw, and
      // a later re-signal resurrects it to `pending` through the existing upsert.
      //
      // ⚠️ The log MUST distinguish the two causes from each other and from 'Queue void':
      //   void   = the protocol re-scored and did not signal;
      //   expire = we stopped looking (stale) OR nothing can ever consume it (unconsumable).
      // Conflating these is how this defect stayed invisible; do not merge the messages.
      //
      // No local `.catch` here on purpose: if the sweep cannot read or write, the OUTER handler
      // logs `Signal queue sync failed` and a human can see it. A swallowed error would make the
      // sweep a silent no-op — worse than no sweep, because the guard would appear to exist.
      const maxAgeMin = getMaxSignalAgeMinutes();

      // Rule 1 — STALENESS: last confirmation older than the bound. `updatedAt`, never
      // `createdAt`: a live, re-signalling entry keeps a fresh `updatedAt` while its `createdAt`
      // ages, and must NOT expire (see signal-freshness.ts for why the default is 360m).
      const staleRows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, symbol, protocolId, TIMESTAMPDIFF(MINUTE, updatedAt, UTC_TIMESTAMP()) AS ageMin
           FROM strategy_signal_queue
          WHERE status = 'pending' AND updatedAt < UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
        maxAgeMin,
      );
      if (Array.isArray(staleRows) && staleRows.length > 0) {
        await (this.prisma as any).$executeRawUnsafe(
          `UPDATE strategy_signal_queue
              SET status = 'expired', updatedAt = UTC_TIMESTAMP()
            WHERE status = 'pending' AND updatedAt < UTC_TIMESTAMP() - INTERVAL ? MINUTE`,
          maxAgeMin,
        );
        this.logger.log(
          `Queue expire: ${staleRows.length} pending entry(ies) no longer observed — last confirmed > ${maxAgeMin}m ago ` +
          `[${staleRows.map((r: any) => `${r.symbol} ${Math.round(Number(r.ageMin))}m`).join(', ')}]`,
        );
      }

      // Rule 2 — UNCONSUMABLE: no active bot+subscription can EVER drain this entry (bot
      // deactivated or its subscription removed). The consumer selects with `ts.active = 1`, so
      // these rows are invisible to it forever — they expire regardless of age, same pass.
      const unconsumable = await (this.prisma as any).$executeRawUnsafe(
        `UPDATE strategy_signal_queue q
            SET status = 'expired', updatedAt = UTC_TIMESTAMP()
          WHERE q.status = 'pending'
            AND NOT EXISTS (
              SELECT 1 FROM trading_strategy ts
              JOIN strategy_protocol sp ON sp.strategyId = ts.id
              WHERE ts.id = q.strategyId AND ts.active = 1 AND sp.protocolId = q.protocolId
            )`,
      );
      if (typeof unconsumable === 'number' && unconsumable > 0) {
        this.logger.log(
          `Queue expire: ${unconsumable} pending entry(ies) with no active bot subscription (bot/protocol deactivated)`,
        );
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
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE
           direction = VALUES(direction), \`signal\` = VALUES(\`signal\`),
           compositePct = VALUES(compositePct), signalPct = VALUES(signalPct),
           opportunityPct = VALUES(opportunityPct), combinedStrength = VALUES(combinedStrength),
           scoreId = VALUES(scoreId), status = 'pending', updatedAt = UTC_TIMESTAMP()`,
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
