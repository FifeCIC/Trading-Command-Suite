/**
 * SeasonalityController — hour×day win rate heatmap endpoint.
 *
 * GET /api/speed/seasonality/:symbol
 */
import { Controller, Get, Param } from '@nestjs/common';
import { SeasonalityService } from './seasonality.service';

@Controller('speed')
export class SeasonalityController {
  constructor(private readonly seasonality: SeasonalityService) {}

  @Get('seasonality/:symbol')
  async getSeasonality(@Param('symbol') symbol: string) {
    return this.seasonality.compute(symbol.toUpperCase());
  }
}
