import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { EarningsService } from './earnings.service';

@Controller('earnings')
export class EarningsController {
  constructor(private readonly earningsService: EarningsService) {}

  /**
   * POST /api/earnings/import?horizon=3
   * Trigger an import from Alpha Vantage EARNINGS_CALENDAR.
   */
  @Post('import')
  async import(@Query('horizon') horizon?: string) {
    const months = parseInt(horizon || '3', 10);
    return this.earningsService.importCalendar(months);
  }

  /**
   * GET /api/earnings/calendar?days=90
   * Read upcoming earnings from DB — zero API calls.
   */
  @Get('calendar')
  async getCalendar(@Query('days') days?: string) {
    return this.earningsService.getCalendar(days ? parseInt(days, 10) : 90);
  }

  /**
   * GET /api/earnings/symbol/:symbol
   * Get next earnings for a specific symbol.
   */
  @Get('symbol/:symbol')
  async getForSymbol(@Param('symbol') symbol: string) {
    return this.earningsService.getForSymbol(symbol);
  }

  /**
   * GET /api/earnings/status
   * Check if earnings data is fresh or stale.
   */
  @Get('status')
  async getStatus() {
    const stale = await this.earningsService.isStale();
    return { stale, message: stale ? 'Earnings data is stale — run POST /api/earnings/import' : 'Earnings data is fresh' };
  }
}
