import { Controller, Get, Post } from '@nestjs/common';
import { SessionTrackerService } from './session-tracker.service';
import { MarketContextService } from './market-context.service';

@Controller('trading/sessions')
export class SessionTrackerController {
  constructor(
    private readonly sessionTracker: SessionTrackerService,
    private readonly marketContext: MarketContextService,
  ) {}

  @Get('current')
  getCurrent() { return this.sessionTracker.getStats(); }

  @Post('start')
  start() { return this.sessionTracker.start(); }

  @Post('end')
  end() { return this.sessionTracker.end(); }

  @Get('history')
  getHistory() { return this.sessionTracker.getHistory(); }

  @Get('market-context')
  getMarketContext() { return this.marketContext.getContext(); }
}
