import { Controller, Get, Post, Query } from '@nestjs/common';
import { Trading212ImportService } from './trading212-import.service';

@Controller('portfolio/trading212')
export class Trading212PortfolioController {
  constructor(private readonly importService: Trading212ImportService) {}

  @Get('validate')
  validate() {
    return this.importService.validateConnection();
  }

  @Post('import')
  importPortfolio() {
    return this.importService.importPortfolio();
  }

  @Get('history')
  async getHistory(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : undefined;
    const result = await this.importService.getTradeHistory(daysNum);
    return result;
  }
}
