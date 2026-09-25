/**
 * AuditLogService
 * ===============
 * Writes step-by-step trace events to the automation_event table,
 * providing a queryable audit trail for every tick of the
 * automation loop. Each event records:
 *  - What tick number it belongs to
 *  - Which strategy/symbol is involved
 *  - The decision step (tick_start, bars_fetched, scored, gated, dispatch, order_sent, order_result)
 *  - The outcome (BUY/SELL/HOLD/SKIP/EXECUTED/FAILED/BLOCKED)
 *  - JSON detail payload with step-specific data
 *  - Duration in ms (when applicable)
 *
 * Use this to answer "why didn't X trade?" with a single SQL query
 * instead of grepping multiple log files.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface AuditEventInput {
  /** Omit to attribute the event to the tick in progress. See `AuditLogService.currentTick`. */
  tickNumber?: number;
  strategyId?: string;
  symbol?: string;
  step: string;
  decision?: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
}

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  /** Batch buffer to reduce DB writes. Flushed after each tick. */
  private buffer: AuditEventInput[] = [];

  /**
   * The tick currently in progress, set by `logTickStart()`.
   *
   * WHY (#974): a producer that is NOT the loop itself needs to attribute its event to a tick
   * but has no tick number of its own. `SignalQueueService` is exactly that case — it discovers
   * "this protocol signalled and the pre-trade gate blocked it" during the tick but is called
   * with only routing data. Threading a tick number down through the whole scoring chain to
   * satisfy a diagnostic would be the tail wagging the dog; `logTickStart()` already runs once
   * per tick, so the loop's own number is available here and is the correct value.
   *
   * `0` means "no tick has started in this process" — a real, visible value rather than a
   * guess, and such events are distinguishable from tick-attributed ones.
   */
  private currentTick = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enqueue an event for batch write at end of tick.
   *
   * `tickNumber` may be omitted; it then defaults to the tick in progress (see `currentTick`).
   */
  log(event: AuditEventInput): void {
    this.buffer.push({ ...event, tickNumber: event.tickNumber ?? this.currentTick });
  }

  /** Get count of buffered events (not yet written to DB). */
  get bufferSize(): number {
    return this.buffer.length;
  }

  /** Flush all buffered events to the automation_event table. */
  async flush(): Promise<number> {
    if (this.buffer.length === 0) return 0;
    const batch = [...this.buffer];
    this.buffer = [];

    if (!this.prisma.isAvailable) {
      this.logger.warn(`DB unavailable — discarding ${batch.length} audit events`);
      return 0;
    }

    try {
      let written = 0;
      // Write in chunks of 100 to avoid oversized queries
      for (let i = 0; i < batch.length; i += 100) {
        const chunk = batch.slice(i, i + 100);
        await (this.prisma as any).automationEvent.createMany({
          data: chunk.map(e => ({
            timestamp: new Date(),
            // `log()` always fills this; `?? 0` keeps the column's NOT NULL contract explicit
            // rather than relying on a type that says `number | undefined`.
            tickNumber: e.tickNumber ?? 0,
            strategyId: e.strategyId ?? null,
            symbol: e.symbol ?? null,
            step: e.step,
            decision: e.decision ?? null,
            detail: e.detail ? JSON.stringify(e.detail) : null,
            durationMs: e.durationMs ?? null,
          })),
        });
        written += chunk.length;
      }
      return written;
    } catch (err) {
      this.logger.warn(`Failed to flush audit events: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Log a tick-start boundary event. */
  logTickStart(tickNumber: number): void {
    // ⚠️ Order matters: record the tick BEFORE logging the boundary event, so that any producer
    // called during this tick attributes correctly even if it runs between these two statements.
    this.currentTick = tickNumber;
    this.log({ tickNumber, step: 'tick_start' });
  }

  /**
   * Log that the pre-trade gate blocked a signal that a protocol genuinely produced (#974).
   *
   * ⚠️ Deliberately NOT `logBlocked()` (step `duplicate_check`). The duplicate guard and the
   * pre-trade gate are DIFFERENT causes, and this codebase has already paid for reporting two
   * causes under one label — the next investigation is then sent after the wrong component. The
   * `decision` stays `'BLOCKED'` so existing queries still find it; the `step` is what separates
   * them, exactly as the 'Queue skip' / 'Queue void' split already does in the log.
   */
  logPreTradeBlocked(protocolId: string, symbol: string, reason: string): void {
    this.log({
      symbol,
      step: 'pre_trade_blocked',
      decision: 'BLOCKED',
      detail: { protocolId, reason },
    });
  }

  /** Log that bars were fetched for a symbol. */
  logBarsFetched(tickNumber: number, symbol: string, barCount: number, latestBar: string | null): void {
    this.log({
      tickNumber, symbol,
      step: 'bars_fetched',
      detail: { barCount, latestBar },
    });
  }

  /** Log a scored decision from protocol gating. */
  logScored(tickNumber: number, strategyId: string, symbol: string,
            longComposite: number, shortComposite: number | null,
            side: string, chosenComposite: number, passedThreshold: boolean): void {
    this.log({
      tickNumber, strategyId, symbol,
      step: 'gated',
      decision: side,
      detail: { longComposite, shortComposite, chosenComposite, passedThreshold },
    });
  }

  /** Log a duplicate-guard block. */
  logBlocked(tickNumber: number, strategyId: string, symbol: string, reason: string): void {
    this.log({
      tickNumber, strategyId, symbol,
      step: 'duplicate_check',
      decision: 'BLOCKED',
      detail: { reason },
    });
  }

  /** Log that an order was dispatched to the bridge. */
  logDispatch(tickNumber: number, strategyId: string, symbol: string,
              side: string, quantity: number, sl: number | null, tp: number | null,
              entryPrice: number): void {
    this.log({
      tickNumber, strategyId, symbol,
      step: 'order_sent',
      decision: side,
      detail: { side, quantity, sl, tp, entryPrice },
    });
  }

  /** Log the bridge's response to an order. */
  logOrderResult(tickNumber: number, strategyId: string, symbol: string,
                 success: boolean, ticket: number | undefined,
                 error: string | undefined, price: number | undefined): void {
    this.log({
      tickNumber, strategyId, symbol,
      step: 'order_result',
      decision: success ? 'EXECUTED' : 'FAILED',
      detail: { success, ticket, error, price },
    });
  }

  /** Log a cooldown/safety skip. */
  logSkip(tickNumber: number, strategyId: string, symbol: string, reason: string): void {
    this.log({
      tickNumber, strategyId, symbol,
      step: 'dispatch',
      decision: 'SKIP',
      detail: { reason },
    });
  }

  /**
   * Get recent activity for the activity feed.
   * Returns the latest events grouped by tick, with a phase summary.
   */
  async getRecentActivity(limit = 30): Promise<{
    events: Array<{
      id: string;
      tickNumber: number;
      timestamp: string;
      step: string;
      symbol: string | null;
      decision: string | null;
      detail: string | null;
      durationMs: number | null;
    }>;
    currentTick: number | null;
    currentPhase: string | null;
    phaseStartedAt: string | null;
    totalEventsToday: number;
  }> {
    if (!this.prisma.isAvailable) {
      return { events: [], currentTick: null, currentPhase: null, phaseStartedAt: null, totalEventsToday: 0 };
    }

    try {
      const events = await (this.prisma as any).automationEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: limit,
      });

      // Count today's events
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayCount = await (this.prisma as any).automationEvent.count({
        where: { timestamp: { gte: today } },
      });

      // Derive current tick + phase from the most recent event
      const latest = events[0] || null;
      const currentTick = latest?.tickNumber ?? null;
      const currentPhase = latest?.step ?? null;
      const phaseStartedAt = latest?.timestamp?.toISOString?.() ?? null;

      return {
        events: events.map((e: any) => ({
          id: e.id,
          tickNumber: e.tickNumber,
          timestamp: e.timestamp?.toISOString?.() ?? e.timestamp,
          step: e.step,
          symbol: e.symbol,
          decision: e.decision,
          detail: e.detail?.substring?.(0, 300) ?? e.detail,
          durationMs: e.durationMs,
        })),
        currentTick,
        currentPhase,
        phaseStartedAt,
        totalEventsToday: todayCount,
      };
    } catch {
      return { events: [], currentTick: null, currentPhase: null, phaseStartedAt: null, totalEventsToday: 0 };
    }
  }
}
