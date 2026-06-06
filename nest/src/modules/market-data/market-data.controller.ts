import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportJobsService } from '../import-jobs/import-jobs.service';
import { CheckFreshnessDto } from './dto/check-freshness.dto';
import { MarketDataService } from './market-data.service';

@ApiTags('market-data')
@Controller('market-data')
export class MarketDataController {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly importJobsService: ImportJobsService,
  ) {}

  @Get('freshness/:symbolId')
  @ApiOperation({ summary: 'Check market data freshness for one symbol and optionally queue import' })
  @ApiOkResponse({ description: 'Freshness result with optional queued run info' })
  async checkFreshness(@Param('symbolId') symbolId: string, @Query() query: CheckFreshnessDto) {
    const freshness = await this.marketDataService.evaluateFreshness(
      symbolId,
      query.timeframe,
      query.maxAgeMinutes,
    );

    if (query.queueIfStale && (freshness.status === 'stale' || freshness.status === 'missing')) {
      const queued = await this.importJobsService.enqueueImport({
        symbolId,
        timeframe: query.timeframe,
        provider: query.provider,
        source: 'freshness-check',
      });

      return {
        ...freshness,
        queuedImport: queued,
      };
    }

    return freshness;
  }

  @Get('latest/:symbolId')
  @ApiOperation({ summary: 'Get latest stored market bar for one symbol and timeframe' })
  @ApiOkResponse({ description: 'Latest market bar record' })
  latest(@Param('symbolId') symbolId: string, @Query('timeframe') timeframe = '1h') {
    return this.marketDataService.getLatestBar(symbolId, timeframe);
  }
}
