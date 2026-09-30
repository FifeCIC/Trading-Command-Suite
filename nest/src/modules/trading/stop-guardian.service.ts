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
 * ExhaustionEventParams — the recorded firing of the UP-move exhaustion observer (#995).
 *
 * ⚠️ Every number here is stored RAW, deliberately. `recentProgressPct` / `priorProgressPct` are
 * the two halves of the comparison, and `decelPct` is that comparison at the threshold in force
 * when the row was written. Storing the inputs rather than only the verdict means the threshold
 * can be RE-EVALUATED against the same recorded firings later, without re-observing anything —
 * which matters because the theory is `testing` and the right threshold is exactly what is
 * unknown.
 */
export interface ExhaustionEventParams {
  tradeTicket: string | number;
  symbol: string;
  strategyId?: string | null;
  strategyName?: string | null;
  /** 'buy' | 'sell' — the direction of the OPEN POSITION being watched. */
  side: 'buy' | 'sell';
  entryPrice?: number | null;
  price?: number | null;
  peakPrice?: number | null;
  profitPct?: number | null;
  recentProgressPct?: number | null;
  priorProgressPct?: number | null;
  decelPct?: number | null;
  thresholdPct?: number | null;
  barsUsed?: number | null;
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
export class StopAdjustmentRecorder {
  private readonly logger = new Logger(StopAdjustmentRecorder.name);

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
   * recordExhaustionEvent() — the recorded firing of the UP-move exhaustion observer (#995).
   * ========================================================================================
   * ⚠️ WHAT IS DELIBERATELY MISSING: there is no ninth argument, no branch on the result, and no
   * consumer. `action` is hardcoded `'recorded'` for the same reason `recordSimTslEvent`'s is —
   * the mechanism OBSERVES. Escalating this into an exit means adding an id to
   * `STOP_GUARDIAN_DIRECTIVES`, and that changes how much a tradeable position moves its stop:
   * that is MATHS (`maths-change-requires-ab`) and needs a COPIED configuration, which #929's
   * precondition still blocks from reporting.
   *
   * WHY IT SITS BESIDE `recordSimTslEvent` RATHER THAN IN ITS OWN RECORDER. Both answer "what was
   * true about this position at a moment we did not act on", which is one kind of fact. A second
   * recorder would drift from this one, and only one of them would receive the next fix.
   *
   * Fire-and-forget, matching the siblings — a logging failure must never block the tick.
   */
  recordExhaustionEvent(params: ExhaustionEventParams): void {
    if (!this.prisma.isAvailable) return;

    this.prisma.exhaustionEvent.create({
      data: {
        tradeTicket: String(params.tradeTicket),
        symbol: params.symbol,
        strategyId: params.strategyId ?? null,
        strategyName: params.strategyName ?? null,
        side: params.side,
        event: 'observed',
        entryPrice: params.entryPrice ?? null,
        price: params.price ?? null,
        peakPrice: params.peakPrice ?? null,
        profitPct: params.profitPct ?? null,
        recentProgressPct: params.recentProgressPct ?? null,
        priorProgressPct: params.priorProgressPct ?? null,
        decelPct: params.decelPct ?? null,
        thresholdPct: params.thresholdPct ?? null,
        barsUsed: params.barsUsed ?? null,
        action: 'recorded',
        detail: params.detail ?? undefined,
      },
    }).then(
      () => this.logger.log(`Exhaustion observed for ticket #${params.tradeTicket} (${params.symbol}, decel ${params.decelPct}%)`),
    ).catch(err => this.logger.warn(`Failed to record exhaustion event: ${err.message}`));
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
