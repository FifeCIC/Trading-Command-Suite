import { Controller, Get, Param, Query } from '@nestjs/common';
import { EventRiskService } from './timeline.service';

@Controller('automation/risk-events')
export class EventRiskController {
  constructor(private readonly timeline: EventRiskService) {}

  /**
   * GET /api/automation/risk-events
   * Active events within the lookahead window, each carrying its risk ACTION
   * (`block` | `gate` | `boost` | `reduce`). Renamed from `/api/automation/timeline`
   * (2026-09-30 review): the old path collided with `GET /api/timeline`, which is the
   * UI DISPLAY model and returns a different shape for a different purpose.
   */
  @Get()
  async getTimeline(@Query('lookahead') lookahead?: string) {
    const minutes = parseInt(lookahead || '120', 10);
    const events = await this.timeline.getActiveEvents(Math.min(minutes, 1440));
    return { events, count: events.length, lookaheadMinutes: minutes };
  }

  /**
   * GET /api/automation/risk-events/symbol/:symbol
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
   * GET /api/automation/risk-events/risk
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
