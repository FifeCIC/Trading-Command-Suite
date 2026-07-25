import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface StopAdjustmentParams {
  tradeTicket: number;
  symbol: string;
  oldSl?: number | null;
  newSl?: number | null;
  oldTp?: number | null;
  newTp?: number | null;
  reason: string;
  directiveScores?: Record<string, any> | null;
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
   * Record a stop-loss or take-profit adjustment.
   * Fire-and-forget — failures are logged but don't block the trade flow.
   */
  recordAdjustment(params: StopAdjustmentParams): void {
    if (!this.prisma.isAvailable) return;

    this.prisma.stopAdjustment.create({
      data: {
        tradeTicket: params.tradeTicket,
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
