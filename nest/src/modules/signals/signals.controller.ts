import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { SignalsService } from './signals.service';

@Controller('api/signals')
export class SignalsController {
  private readonly logger = new Logger(SignalsController.name);

  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  getSignals(
    @Query('symbol') symbol?: string,
    @Query('signal') signal?: string,
    @Query('limit') limit?: string,
  ) {
    return this.signalsService.getSignals({
      symbol,
      signal,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Get('summary')
  getSummary() {
    return this.signalsService.getSummary();
  }

  @Get('latest/:symbol')
  getLatest(@Param('symbol') symbol: string) {
    return this.signalsService.getLatestSignal(symbol);
  }

  @Post()
  addSignal(@Body() body: { symbol: string; strategy: string; score: number; signal: string; confidence: number }) {
    return this.signalsService.addSignal({
      symbol: body.symbol,
      strategy: body.strategy || 'manual',
      score: body.score || 0,
      signal: (body.signal as any) || 'hold',
      confidence: body.confidence || 0,
    });
  }
}
