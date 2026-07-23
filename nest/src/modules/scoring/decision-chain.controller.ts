import { Controller, Get, Post, Query } from '@nestjs/common';
import { DecisionChainService } from './decision-chain.service';

@Controller('scoring/decision-chain')
export class DecisionChainController {
  constructor(private readonly chainService: DecisionChainService) {}

  /** GET /api/scoring/decision-chain?symbol=EURUSD&actionable=true&limit=20 */
  @Get()
  queryChain(
    @Query('symbol') symbol?: string,
    @Query('strategyId') strategyId?: string,
    @Query('tickNumber') tickNumber?: string,
    @Query('actionable') actionable?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chainService.queryChain({
      symbol,
      strategyId,
      tickNumber: tickNumber ? parseInt(tickNumber, 10) : undefined,
      actionable: actionable === 'true' ? true : actionable === 'false' ? false : undefined,
      fromDate,
      toDate,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /** POST /api/scoring/decision-chain/backfill — populate link fields on existing rows */
  @Post('backfill')
  async backfill() {
    const snapshots = await this.chainService.backfillScoreSnapshots();
    const trades = await this.chainService.backfillTradeLinks();
    return { snapshots, trades };
  }
}
