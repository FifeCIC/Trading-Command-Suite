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
  tickNumber: number;
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

  constructor(private readonly prisma: PrismaService) {}

  /** Enqueue an event for batch write at end of tick. */
  log(event: AuditEventInput): void {
    this.buffer.push(event);
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
            tickNumber: e.tickNumber,
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
    this.log({ tickNumber, step: 'tick_start' });
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
}
