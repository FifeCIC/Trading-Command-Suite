import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface StopAdjustmentParams {
  tradeTicket: string | number;
  symbol: string;
  oldSl?: number | null;
  newSl?: number | null;
  oldTp?: number | null;
  newTp?: number | null;
  reason: string;
  directiveScores?: Record<string, any> | null;
}

export interface SimTslEventParams {
  tradeTicket: string | number;
  symbol: string;
  strategyId?: string | null;
  strategyName?: string | null;
  /** 'armed' | 'decision-point' | 'cleared'. Only 'decision-point' is a decision moment. */
  event: 'armed' | 'decision-point' | 'cleared';
  entryPrice?: number | null;
  triggerPrice?: number | null;
  price?: number | null;
  profitPct?: number | null;
  distancePct?: number | null;
  activationPct?: number | null;
  detail?: Record<string, any> | null;
}

/**
 * StopGuardianService — records every SL/TP modification (#476).
 *
 * Called whenever a stop-loss or take-profit is changed — by
 * automation (future Stop Guardian logic) or manual amend via
 * the MT5 bridge or API.
 */
@Injectable()
export class StopGuardianService {
  private readonly logger = new Logger(StopGuardianService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * recordSimTslEvent() — the recorded firing of the per-bot SIMULATED TSL (#936, R20=A 2026-09-24).
   * ==================================================================================================
   * WHY IT LIVES HERE. This service already owns "what the guardian did to a position"; a decision
   * moment is the same kind of fact one step earlier, so it belongs beside `stop_adjustment` rather
   * than in a second recorder that could drift from it.
   *
   * ⚠️ `action` is hardcoded `'recorded'`. Nothing in this path sends an order or moves a stop —
   * the mechanism OBSERVES. Acting on a decision point is a MATHS change and needs a copied
   * configuration and a monitored comparison, which #929 currently blocks.
   *
   * Fire-and-forget, matching `recordAdjustment()` — a logging failure must never block the tick.
   */
  recordSimTslEvent(params: SimTslEventParams): void {
    if (!this.prisma.isAvailable) return;

    this.prisma.simTslEvent.create({
      data: {
        tradeTicket: String(params.tradeTicket),
        symbol: params.symbol,
        strategyId: params.strategyId ?? null,
        strategyName: params.strategyName ?? null,
        event: params.event,
        entryPrice: params.entryPrice ?? null,
        triggerPrice: params.triggerPrice ?? null,
        price: params.price ?? null,
        profitPct: params.profitPct ?? null,
        distancePct: params.distancePct ?? null,
        activationPct: params.activationPct ?? null,
        action: 'recorded',
        detail: params.detail ?? undefined,
      },
    }).then(
      () => this.logger.log(`Sim-TSL ${params.event} recorded for ticket #${params.tradeTicket} (${params.symbol})`),
    ).catch(err => this.logger.warn(`Failed to record sim-TSL event: ${err.message}`));
  }

  /**
   * Record a stop-loss or take-profit adjustment.
   * Fire-and-forget — failures are logged but don't block the trade flow.
   */
  recordAdjustment(params: StopAdjustmentParams): void {
    if (!this.prisma.isAvailable) return;

    this.prisma.stopAdjustment.create({
      data: {
        tradeTicket: String(params.tradeTicket),
        symbol: params.symbol,
        oldSl: params.oldSl ?? null,
        newSl: params.newSl ?? null,
        oldTp: params.oldTp ?? null,
        newTp: params.newTp ?? null,
        reason: params.reason,
        directiveScores: params.directiveScores ?? undefined,
      },
    }).then(
      () => this.logger.debug(`SL/TP adjustment recorded for ticket #${params.tradeTicket}: ${params.reason}`),
    ).catch(err => this.logger.warn(`Failed to record stop adjustment: ${err.message}`));
  }
}
