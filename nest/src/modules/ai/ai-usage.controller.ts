import { Controller, Get, Query } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';

@Controller('ai')
export class AiUsageController {
  constructor(private readonly aiUsage: AiUsageService) {}

  /**
   * GET /api/ai/usage?period=today|week|month
   *
   * Returns aggregate AI cost/usage stats for the given period.
   * Used by AICostsPage to display cost dashboards.
   */
  @Get('usage')
  async getUsage(@Query('period') period: string = 'today') {
    const valid = ['today', 'week', 'month'].includes(period) ? period as 'today' | 'week' | 'month' : 'today';
    return this.aiUsage.getUsage(valid);
  }

  /**
   * GET /api/ai/usage/breakdown
   *
   * Returns per-feature cost breakdown (briefing, analysis, explain, sentiment).
   * Used by AICostsPage "Cost by Feature" section.
   */
  @Get('usage/breakdown')
  async getBreakdown(@Query('period') period: string = 'today') {
    const valid = ['today', 'week', 'month'].includes(period) ? period as 'today' | 'week' | 'month' : 'today';
    return this.aiUsage.getBreakdown(valid);
  }
}
