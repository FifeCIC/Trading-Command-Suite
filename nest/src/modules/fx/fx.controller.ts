import { Controller, Get, Param, Query } from '@nestjs/common';
import { FxService } from './fx.service';

@Controller('fx')
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rate/:pair')
  async getRate(@Param('pair') pair: string) {
    return this.fxService.getLatestRate(pair);
  }

  @Get('history/:pair')
  async getHistory(
    @Param('pair') pair: string,
    @Query('days') days?: string,
  ) {
    return this.fxService.getHistory(pair, days ? Number(days) : 30);
  }
}
