import { Controller, Get, Param, Query } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Controller('automation/timeline')
export class TimelineController {
  constructor(private readonly timeline: TimelineService) {}

  /**
   * GET /api/automation/timeline
   * Full timeline: active events within the lookahead window.
   */
  @Get()
  async getTimeline(@Query('lookahead') lookahead?: string) {
    const minutes = parseInt(lookahead || '120', 10);
    const events = await this.timeline.getActiveEvents(Math.min(minutes, 1440));
    return { events, count: events.length, lookaheadMinutes: minutes };
  }

  /**
   * GET /api/automation/timeline/symbol/:symbol
   * Events relevant to a specific symbol.
   */
  @Get('symbol/:symbol')
  async getSymbolTimeline(
    @Param('symbol') symbol: string,
    @Query('hours') hours?: string,
  ) {
    const h = parseInt(hours || '48', 10);
    const events = await this.timeline.getSymbolEvents(symbol.toUpperCase(), Math.min(h, 168));
    const riskMultiplier = this.timeline.computeRiskMultiplier(events);
    return {
      symbol: symbol.toUpperCase(),
      events,
      count: events.length,
      riskMultiplier,
      lookaheadHours: h,
    };
  }

  /**
   * GET /api/automation/timeline/risk
   * Quick risk check — returns current global risk multiplier.
   */
  @Get('risk')
  async getRisk() {
    const events = await this.timeline.getActiveEvents(120);
    const global = events.filter(e => e.scope === 'global');
    const risk = this.timeline.computeRiskMultiplier(global);
    return { riskMultiplier: risk, globalEvents: global.length, totalEvents: events.length };
  }
}
