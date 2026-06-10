import { Controller, Get, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModeService } from '../../config/mode.service';
import { ImportJobsService } from '../import-jobs/import-jobs.service';
import { CheckFreshnessDto } from './dto/check-freshness.dto';
import { FreshnessService } from './freshness.service';
import { MarketDataService } from './market-data.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';

@ApiTags('market-data')
@Controller('market-data')
export class MarketDataController {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly freshnessService: FreshnessService,
    private readonly importJobsService: ImportJobsService,
    private readonly modeService: ModeService,
  ) {}

  private modeMeta() {
    const info = this.modeService.getModeInfo();
    return {
      mode: info.mode,
      services: {
        database: info.database,
        queue: info.queue,
        redis: info.redis,
      },
    };
  }

  @Get('freshness')
  @UseInterceptors(new CacheInterceptor(30000))
  @ApiOperation({ summary: 'Check freshness for all active symbols' })
  @ApiOkResponse({ description: 'Batch freshness results' })
  async checkAll(
    @Query('timeframe') timeframe = '1h',
    @Query('maxAgeMinutes') maxAgeMinutes?: string,
  ) {
    const maxAge = maxAgeMinutes ? Number(maxAgeMinutes) : undefined;
    return this.freshnessService.checkAllActive(
      timeframe,
      Number.isFinite(maxAge) ? maxAge : undefined,
    );
  }

  @Get('freshness/:symbolId')
  @ApiOperation({
    summary:
      'Check market data freshness for one symbol and optionally queue import',
  })
  @ApiOkResponse({
    description: 'Freshness result with optional queued run info',
  })
  async checkFreshness(
    @Param('symbolId') symbolId: string,
    @Query() query: CheckFreshnessDto,
  ) {
    const freshness = await this.freshnessService.checkOne(
      symbolId,
      query.timeframe,
      query.maxAgeMinutes,
    );

    if (
      query.queueIfStale &&
      (freshness.status === 'stale' || freshness.status === 'missing')
    ) {
      const queued = await this.importJobsService.enqueueImport({
        symbolId,
        timeframe: query.timeframe,
        provider: query.provider,
        source: 'freshness-check',
      });

      return {
        ...this.modeMeta(),
        ...freshness,
        queuedImport: queued,
      };
    }

    return {
      ...this.modeMeta(),
      ...freshness,
    };
  }

  @Get('latest/:symbolId')
  @ApiOperation({
    summary: 'Get latest stored market bar for one symbol and timeframe',
  })
  @ApiOkResponse({ description: 'Latest market bar record' })
  latest(
    @Param('symbolId') symbolId: string,
    @Query('timeframe') timeframe = '1h',
  ) {
    return this.marketDataService.getLatestBar(symbolId, timeframe);
  }
}
