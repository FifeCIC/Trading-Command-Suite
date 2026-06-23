import { Controller, Get, Query, Param, Logger } from '@nestjs/common';
import { FinnhubAdapter } from '../providers/adapters/finnhub.adapter';

@Controller('research')
export class ResearchController {
  private readonly logger = new Logger(ResearchController.name);

  constructor(private readonly finnhub: FinnhubAdapter) {}

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
      return { source: 'finnhub', targets: [], error: 'No symbols provided. Use ?symbols=AAPL,NVDA,MSFT' };
    }

    const results = [];
    for (const symbol of symbolList.slice(0, 10)) {
      const target = await this.finnhub.getPriceTarget(symbol);
      if (target) results.push(target);
    }

    // Sort
    if (sort === 'upside') {
      results.sort((a, b) => (order === 'asc' ? 1 : -1) * ((a.upside ?? 0) - (b.upside ?? 0)));
    }

    return {
      source: 'finnhub',
      count: results.length,
      targets: results,
    };
  }

  @Get('analyst/targets/:symbol')
  async getSymbolTarget(@Param('symbol') symbol: string) {
    const target = await this.finnhub.getPriceTarget(symbol.toUpperCase());
    if (!target) {
      return { source: 'finnhub', target: null, error: `No analyst coverage for ${symbol.toUpperCase()}` };
    }
    return { source: 'finnhub', target };
  }
}
