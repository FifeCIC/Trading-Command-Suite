/**
 * movers-treatment.controller.ts — `GET /api/scoring/movers-treatment` (#1281).
 *
 * Read-only. Answers: *"today's biggest winners and losers — what is TCS actually doing about
 * each one?"* The heavy lifting (and the reasoning) is in `movers-treatment.service.ts`.
 *
 * ⚠️ NO STRATEGY GATE ON THIS ROUTE, DELIBERATELY. The strategy that motivated the page does not
 * exist yet, so gating the DATA on it would return nothing at all and the page could not show the
 * "inactive, and here is the reason" state the requirement is for. What is gated is the strategy's own
 * tab, not the observation — an operator can always ask what the app is doing with a mover.
 */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MoversTreatmentService } from './movers-treatment.service';

@ApiTags('scoring')
@Controller('scoring')
export class MoversTreatmentController {
  constructor(private readonly moversTreatment: MoversTreatmentService) {}

  @Get('movers-treatment')
  @ApiOperation({
    summary: "Today's biggest winners and losers, and how TCS treated each one",
    description:
      'Four states, never collapsed: traded · queued · refused · scored · unscored · no-data. ' +
      'A symbol with no bars reports no-data — that is an absence, not a 0% move.',
  })
  @ApiQuery({ name: 'timeframe', required: false, example: '5m' })
  @ApiQuery({ name: 'bars', required: false, description: 'Bars back to compare against (1-60)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Winners and losers per side (1-50)' })
  async get(
    @Query('timeframe') timeframe?: string,
    @Query('bars') bars?: string,
    @Query('limit') limit?: string,
  ) {
    return this.moversTreatment.getTreatment({
      timeframe,
      bars: bars ? Number(bars) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
