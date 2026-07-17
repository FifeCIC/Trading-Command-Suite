import { Controller, Get, Param, Post, Body, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaginationInterceptor } from '../../common/interceptors/pagination.interceptor';
import { TriggerImportDto } from './dto/trigger-import.dto';
import { ImportJobsService } from './import-jobs.service';
import { DataImportOrchestrator } from './data-import-orchestrator.service';

@ApiTags('imports')
@Controller('imports')
export class ImportJobsController {
  constructor(
    private readonly importJobsService: ImportJobsService,
    private readonly orchestrator: DataImportOrchestrator,
  ) {}

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

  @Post('batch')
  @ApiOperation({ summary: 'Batch import daily bars for multiple tickers' })
  async batchImport(@Body() body: { tickers: string[]; timeframe?: string; limit?: number }) {
    if (!body.tickers?.length) return { error: 'tickers array is required' };
    return this.importJobsService.batchImport(body.tickers, body.timeframe || '1d', body.limit || 365);
  }

  @Get('batch/status')
  @ApiOperation({ summary: 'Check batch import progress' })
  getBatchStatus() {
    return this.importJobsService.getBatchStatus();
  }

  /** Orchestrate freshness + imports for a single symbol */
  @Post('orchestrate/:symbolId')
  @ApiOperation({ summary: 'Orchestrate data freshness across all types for a symbol' })
  async orchestrateSymbol(
    @Param('symbolId') symbolId: string,
    @Query('ticker') ticker?: string,
  ) {
    return this.orchestrator.ensureSymbolFresh(symbolId, ticker);
  }

  /** Orchestrate freshness for all portfolio symbols */
  @Post('orchestrate/portfolio')
  @ApiOperation({ summary: 'Orchestrate data freshness for all active portfolio symbols' })
  async orchestratePortfolio() {
    return this.orchestrator.ensurePortfolioFresh();
  }

  /**
   * POST /api/imports/bars — Flexible bar import with symbol auto-registration.
   * Accepts raw OHLCV bars with symbol, timeframe, and provider metadata.
   * Deduplicates by (symbolId, timeframe, timestamp).
   *
   * @see #272 — Flexible bar import endpoint
   */
  @Post('bars')
  async importBars(@Body() body: {
    symbol: string; timeframe: string; provider?: string;
    bars: Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume?: number }>;
  }) {
    if (!body.symbol || !body.timeframe || !body.bars?.length) {
      return { error: 'symbol, timeframe, and bars[] are required' };
    }
    return this.importJobsService.importBars(
      body.symbol, body.timeframe, body.provider || 'manual', body.bars,
    );
  }
}
