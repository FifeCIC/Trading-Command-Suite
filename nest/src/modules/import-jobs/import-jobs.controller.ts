import { Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationInterceptor } from '../../common/interceptors/pagination.interceptor';
import { TriggerImportDto } from './dto/trigger-import.dto';
import { ImportJobsService } from './import-jobs.service';

@ApiTags('imports')
@Controller('imports')
export class ImportJobsController {
  constructor(private readonly importJobsService: ImportJobsService) {}

  @Post('refresh/:symbolId')
  @ApiOperation({ summary: 'Direct real-data import for one symbol (bypasses queue, calls adapters)' })
  @ApiOkResponse({ description: 'Real bars imported from best available provider' })
  async refresh(
    @Param('symbolId') symbolId: string,
    @Query('timeframe') timeframe = '1d',
    @Query('limit') limit = '100',
  ) {
    return this.importJobsService.importRealBars(
      symbolId,
      timeframe,
      parseInt(limit, 10),
    );
  }

  @Post('trigger/:symbolId')
  @ApiOperation({ summary: 'Queue market data import for one symbol' })
  @ApiOkResponse({ description: 'Import queued successfully' })
  trigger(
    @Param('symbolId') symbolId: string,
    @Query() query: TriggerImportDto,
  ) {
    return this.importJobsService.enqueueImport({
      symbolId,
      timeframe: query.timeframe,
      provider: query.provider,
      source: query.source,
    });
  }

  @Get('runs')
  @UseInterceptors(new PaginationInterceptor('runs'))
  @ApiOperation({ summary: 'List recent import runs' })
  @ApiOkResponse({ description: 'Recent import runs' })
  listRuns(@Query('limit') limit?: string) {
    const parsedLimit = Number(limit ?? 20);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    return this.importJobsService.listRecent(safeLimit);
  }
}
