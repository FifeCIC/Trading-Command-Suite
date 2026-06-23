/**
 * TradeHistoryController — unified trade audit trail
 * ====================================================
 * Reads from the Prisma Trade model for all providers.
 */

import { Controller, Get, Query } from '@nestjs/common';
import { TradeRecorderService } from '../trading/trade-recorder.service';

@Controller('trading')
export class TradeHistoryController {
  constructor(private readonly tradeRecorder: TradeRecorderService) {}

  /** Get trade history from the audit trail (all providers) */
  @Get('trade-history')
  async getHistory(
    @Query('provider') provider?: string,
    @Query('symbol') symbol?: string,
    @Query('days') days?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
  ) {
    return this.tradeRecorder.getHistory({
      provider,
      symbol,
      days: days ? Number(days) : 30,
      limit: limit ? Number(limit) : 200,
      status,
    });
  }
}
