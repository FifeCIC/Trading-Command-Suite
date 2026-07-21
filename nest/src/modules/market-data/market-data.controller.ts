import { Controller, Get, Post, Param, Query, Body, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ModeService } from '../../config/mode.service';
import { ImportJobsService } from '../import-jobs/import-jobs.service';
import { CheckFreshnessDto } from './dto/check-freshness.dto';
import { FreshnessService } from './freshness.service';
import { PriceRefreshService } from './price-refresh.service';
import { MarketDataService } from './market-data.service';
import { BarRefreshService } from './bar-refresh.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';

@ApiTags('market-data')
@Controller('market-data')
export class MarketDataController {
  constructor(
    private readonly marketDataService: MarketDataService,
    private readonly freshnessService: FreshnessService,
    private readonly priceRefresh: PriceRefreshService,
    private readonly importJobsService: ImportJobsService,
    private readonly modeService: ModeService,
    private readonly barRefresh: BarRefreshService,
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

  @Get('freshness/:symbolId/overall')
  @ApiOperation({ summary: 'Get overall freshness across all data types for a symbol' })
  async overallFreshness(@Param('symbolId') symbolId: string) {
    return this.freshnessService.overallFreshness(symbolId);
  }

  @Get('candles')
  @ApiOperation({ summary: 'Proxy MT5 bridge candles for charting' })
  async candles(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe = '5m',
    @Query('limit') limit = '100',
  ) {
    try {
      const res = await fetch(
        `http://localhost:5000/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${Math.min(Number(limit), 1000)}`,
        { signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) {
        return { bars: [], symbol, timeframe, limit: Math.min(Number(limit), 1000), status: 'unavailable', reason: `Bridge HTTP ${res.status}` };
      }
      const data = await res.json();
      const bars = data?.bars || data || [];
      return {
        bars: Array.isArray(bars) ? bars : [],
        symbol,
        timeframe,
        limit: Math.min(Number(limit), 1000),
        status: bars.length > 0 ? 'available' : 'no_data',
        total: Array.isArray(bars) ? bars.length : 0,
      };
    } catch {
      return { bars: [], symbol, timeframe, limit: Math.min(Number(limit), 1000), status: 'unavailable', reason: 'MT5 bridge unreachable' };
    }
  }

  @Post('prices/refresh')
  @ApiOperation({ summary: 'Refresh live prices for portfolio positions via provider chain' })
  async refreshPrices() {
    const result = await this.priceRefresh.refreshAllPositions();
    return { ...result, timestamp: new Date().toISOString() };
  }

  @Post('freshness/batch')
  @ApiOperation({ summary: 'Check freshness for a specific set of symbols' })
  async batchFreshness(@Body() body: { symbols: string[]; timeframe?: string }) {
    const symbols = body.symbols || [];
    const timeframe = body.timeframe || '1m';
    if (symbols.length === 0) return { results: [] };
    const results = await Promise.all(
      symbols.map(async (ticker) => {
        const result = await this.freshnessService.checkOne(
          ticker, timeframe, undefined,
        ).catch(() => ({ symbolId: ticker, ticker, status: 'missing' as const, latestTimestamp: null, ageMinutes: null, timeframe }));
        return { ...result, ticker: result.ticker || ticker };
      }),
    );
    return { results, checkedAt: new Date().toISOString() };
  }

  @Get('top-movers')
  async getTopMovers(@Query('lookback') lookback?: string, @Query('limit') limit?: string) {
    return this.marketDataService.getTopMovers(
      lookback || '15m',
      limit ? parseInt(limit) : 20,
    );
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh prices for specified symbols via provider chain' })
  async refreshSymbols(@Body() body: { symbols: string[] }) {
    const symbols = body.symbols || [];
    if (symbols.length === 0) return { refreshed: [] };
    const result = await this.priceRefresh.refreshPrices(symbols);
    return { ...result, timestamp: new Date().toISOString() };
  }

  // ── Bar Refresh Control ─────────────────────────────────

  @Get('bars/refresh/status')
  @ApiOperation({ summary: 'Get bar refresh service status (running, mode, limits)' })
  async barRefreshStatus() {
    return this.barRefresh.getStatus();
  }

  @Post('bars/refresh/start')
  @ApiOperation({ summary: 'Start periodic live bar refresh' })
  async barRefreshStart(@Body() body?: { intervalMs?: number }) {
    this.barRefresh.start(body?.intervalMs);
    return { ...this.barRefresh.getStatus(), message: 'Bar refresh started' };
  }

  @Post('bars/refresh/stop')
  @ApiOperation({ summary: 'Stop periodic bar refresh' })
  async barRefreshStop() {
    this.barRefresh.stop();
    return { ...this.barRefresh.getStatus(), message: 'Bar refresh stopped' };
  }

  @Post('bars/record')
  @ApiOperation({ summary: 'Record bars for backtesting (on-demand bulk fetch)' })
  async barRecord(@Body() body?: { symbols?: string[] }) {
    const result = await this.barRefresh.recordBars(body?.symbols);
    return { ...result, timestamp: new Date().toISOString() };
  }
}
