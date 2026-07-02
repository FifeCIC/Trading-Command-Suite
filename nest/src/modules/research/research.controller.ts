import { Controller, Get, Query, Param, Logger } from '@nestjs/common';
import { FinnhubAdapter } from '../providers/adapters/finnhub.adapter';
import { ResearchOverviewService } from './research-overview.service';
import { AnalystTargetsService } from './analyst-targets.service';

@Controller('research')
export class ResearchController {
  private readonly logger = new Logger(ResearchController.name);

  constructor(
    private readonly finnhub: FinnhubAdapter,
    private readonly overviewService: ResearchOverviewService,
    private readonly analystTargets: AnalystTargetsService,
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
    const data = await this.finnhub.getEarningsCalendar(symbol, horizonMonths);
    return {
      source: 'finnhub',
      horizonMonths,
      count: data.length,
      events: data,
    };
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
