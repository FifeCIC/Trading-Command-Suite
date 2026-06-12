import { Controller, Post, Get, Param, Body } from '@nestjs/common';
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
  getResult(@Param('runId') runId: string) {
    const result = this.backtestService.getResult(runId);
    if (!result) return { error: 'Run not found' };
    return result;
  }

  @Get('summary/:symbol')
  getSummary(@Param('symbol') symbol: string) {
    return this.backtestService.getSummary(symbol);
  }
}
