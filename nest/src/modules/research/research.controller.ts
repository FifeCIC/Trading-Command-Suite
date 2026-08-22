import { Controller, Get, Query, Param, Logger, Post, Put, Body } from '@nestjs/common';
import { ProvidersService } from '../providers/providers.service';
import { ResearchOverviewService } from './research-overview.service';
import { AnalystTargetsService } from './analyst-targets.service';
import { NasdaqEarningsService } from './nasdaq-earnings.service';
import { ResearchImportService } from './research-import.service';
import { EarningsImportSettingsService } from './earnings-import-settings.service';
import { EarningsImportSettingsDto } from './dto/earnings-import-settings.dto';

@Controller('research')
export class ResearchController {
  private readonly logger = new Logger(ResearchController.name);

  constructor(
    private readonly providers: ProvidersService,
    private readonly overviewService: ResearchOverviewService,
    private readonly analystTargets: AnalystTargetsService,
    private readonly nasdaqEarnings: NasdaqEarningsService,
    private readonly researchImport: ResearchImportService,
    private readonly earningsImportSettings: EarningsImportSettingsService,
  ) {}

  @Get('overview')
  async getOverview() {
    return this.overviewService.getOverview();
  }

  @Get('earnings/calendar')
  async getEarningsCalendar(
    @Query('symbol') symbol?: string,
    @Query('months') months?: string,
  ) {
    const horizonMonths = months ? parseInt(months, 10) : 3;

    // Primary: Finnhub (single call covers the whole horizon).
    const adapter = this.providers.getAdapter('finnhub');
    let events: any[] =
      adapter && typeof (adapter as any).getEarningsCalendar === 'function'
        ? await (adapter as any).getEarningsCalendar(symbol, horizonMonths)
        : [];
    let source = 'finnhub';

    // Fallback: Nasdaq public calendar (no key) — guarantees the page is never empty.
    if (!Array.isArray(events) || events.length === 0) {
      events = await this.nasdaqEarnings.getCalendar(horizonMonths, symbol);
      source = 'nasdaq';
    }

    return {
      source,
      horizonMonths,
      count: events.length,
      events,
    };
  }

  /**
   * POST /api/research/earnings/import
   * Trigger the earnings calendar DB import (Finnhub + Nasdaq cross-check).
   * Runs in the background — returns immediately; watch the backend logs or
   * GET /api/research/earnings/status for progress.
   */
  @Post('earnings/import')
  importEarningsCalendar() {
    const started = this.researchImport.triggerEarningsImport();
    return {
      started,
      message: started
        ? 'Earnings import started — it runs in the background.'
        : 'Earnings import already running.',
    };
  }

  /**
   * GET /api/research/earnings/settings
   * Import filters — scope, min market cap, session, auto-import toggle.
   */
  @Get('earnings/settings')
  async getEarningsSettings() {
    return this.earningsImportSettings.getSettings();
  }

  /**
   * PUT /api/research/earnings/settings
   * Patch one or more import settings.
   */
  @Put('earnings/settings')
  async updateEarningsSettings(@Body() dto: EarningsImportSettingsDto) {
    return this.earningsImportSettings.updateSettings(dto);
  }

  /**
   * GET /api/research/earnings/status
   * Whether an import is currently running + how many events are stored.
   */
  @Get('earnings/status')
  async getEarningsImportStatus() {
    return this.researchImport.getEarningsImportStatus();
  }

  @Get('analyst/targets')
  async getAnalystTargets(
    @Query('symbols') symbols?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    const symbolList = symbols ? symbols.split(',').map((s) => s.trim().toUpperCase()) : [];

    if (symbolList.length === 0) {
      return { source: 'finnhub+fmp', targets: [], error: 'No symbols provided. Use ?symbols=AAPL,NVDA,MSFT' };
    }

    return this.analystTargets.getTargets(symbolList.slice(0, 14), sort, order);
  }

  @Get('analyst/targets/:symbol')
  async getSymbolTarget(@Param('symbol') symbol: string) {
    const target = await this.analystTargets.getTargetForSymbol(symbol.toUpperCase());
    if (!target) {
      return { source: 'finnhub+fmp', target: null, error: `No analyst coverage for ${symbol.toUpperCase()}` };
    }
    return { source: target.source, target };
  }
}
