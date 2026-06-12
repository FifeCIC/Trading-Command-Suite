import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly perf: PerformanceService) {}

  @Post('trade')
  recordTrade(@Body() body: { strategyId: string; strategyName: string; symbol: string; action: 'buy' | 'sell'; quantity: number; entryPrice: number; entryScore?: number }) {
    return this.perf.recordTrade({
      ...body,
      exitPrice: null,
      pnl: null,
      pnlPercent: null,
      exitReason: null,
      entryScore: body.entryScore ?? null,
      openedAt: new Date().toISOString(),
    });
  }

  @Post('trade/:id/close')
  closeTrade(@Param('id') id: string, @Body() body: { exitPrice: number; exitReason: string }) {
    return this.perf.closeTrade(id, body.exitPrice, body.exitReason) ?? { error: 'Trade not found' };
  }

  @Get()
  getAllPerformance() {
    return { strategies: this.perf.getAllPerformance() };
  }

  @Get(':strategyId')
  getPerformance(@Param('strategyId') strategyId: string) {
    return this.perf.getStrategyPerformance(strategyId) ?? { error: 'No trades for this strategy' };
  }

  @Get('trade/all')
  getAllTrades() {
    return { trades: this.perf.getAllTrades() };
  }
}
