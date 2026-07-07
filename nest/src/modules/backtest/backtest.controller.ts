import { Controller, Post, Get, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BacktestService } from './backtest.service';
import type { BacktestRunRequest } from './backtest.service';

@ApiTags('backtest')
@Controller('backtest')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Get('datasets')
  @ApiOperation({ summary: 'List available pre-loaded backtest datasets' })
  @ApiOkResponse({ description: 'Array of dataset metadata' })
  async getDatasets() {
    return this.backtestService.getDatasets();
  }

  @Post('run')
  @ApiOperation({ summary: 'Run backtest for a symbol over N days' })
  @ApiOkResponse({ description: 'Backtest result with entry signals and stats' })
  async run(@Body() body: BacktestRunRequest) {
    return this.backtestService.run(body);
  }

  @Get('results/:runId')
  async getResult(@Param('runId') runId: string) {
    const result = await this.backtestService.getResult(runId);
    if (!result) return { error: 'Run not found' };
    return result;
  }

  @Get('summary/:symbol')
  async getSummary(@Param('symbol') symbol: string) {
    return this.backtestService.getSummary(symbol);
  }

  @Get('protocol/:protocolId')
  async listProtocolRuns(@Param('protocolId') protocolId: string, @Query('limit') limit?: string) {
    return this.backtestService.listProtocolRuns(protocolId, limit ? parseInt(limit, 10) : 20);
  }

  @Get('chart-data')
  @ApiOperation({ summary: 'Get chart-ready data with bars, signals, and indicators' })
  async getChartData(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.backtestService.getChartData(symbol, timeframe || '1d', from, to);
  }

  @Post('optimize')
  @ApiOperation({ summary: 'Grid search — optimize SL/TP parameters across a range' })
  async optimize(@Body() body: {
    symbol: string;
    days?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }) {
    return this.backtestService.optimize(body);
  }

  @Post('walk-forward')
  @ApiOperation({ summary: 'Walk-forward — optimize on train period, validate on test period' })
  async walkForward(@Body() body: {
    symbol: string;
    trainDays?: number;
    testDays?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }) {
    return this.backtestService.walkForward(body);
  }

  @Get('data-inventory')
  @ApiOperation({ summary: 'Comprehensive market bar inventory — all symbols with bar counts, date ranges, providers, and backtest run stats' })
  async dataInventory() {
    return this.backtestService.getDataInventory();
  }

  /** List all persisted backtest runs */
  @Get('runs')
  async listRuns(
    @Query('symbol') symbol?: string,
    @Query('protocolId') protocolId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.backtestService.listAllRuns({
      symbol,
      protocolId,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /** Compare multiple runs side-by-side */
  @Post('runs/compare')
  async compareRuns(@Body() body: { runIds: string[] }) {
    if (!body.runIds?.length) return { error: 'runIds array is required' };
    return this.backtestService.compareRuns(body.runIds);
  }

  /** Delete a backtest run */
  @Delete('runs/:runId')
  async deleteRun(@Param('runId') runId: string) {
    return this.backtestService.deleteRun(runId);
  }

  /** Equity curve + drawdown for a run */
  @Get('equity/:runId')
  @ApiOperation({ summary: 'Get equity curve and drawdown data for a backtest run' })
  async getEquityCurve(@Param('runId') runId: string) {
    return this.backtestService.getEquityCurve(runId);
  }
}
