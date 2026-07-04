import { Controller, Get, Param, Query } from '@nestjs/common';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly perf: PerformanceService) {}

  /** GET /api/performance — all strategies with performance stats */
  @Get()
  async getAllPerformance() {
    const strategies = await this.perf.getAllPerformance();
    return { strategies, count: strategies.length };
  }

  /** GET /api/performance/:strategyId — single strategy detail */
  @Get(':strategyId')
  async getPerformance(@Param('strategyId') strategyId: string) {
    const perf = await this.perf.getStrategyPerformance(strategyId);
    return perf ?? { error: 'No trades for this strategy', strategyId };
  }

  /** GET /api/performance/summary/full?days=90 — equity curve + monthly breakdown + overall */
  @Get('summary/full')
  async getSummary(@Query('days') days?: string) {
    const d = parseInt(days || '90', 10);
    return this.perf.getSummary(Math.min(d, 365));
  }
}
