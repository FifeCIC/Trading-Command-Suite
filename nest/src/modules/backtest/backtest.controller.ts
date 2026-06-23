import { Controller, Post, Get, Param, Body, Query } from '@nestjs/common';
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
}
