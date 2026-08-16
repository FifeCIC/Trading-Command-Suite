import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AbTestService } from './ab-test.service';

/**
 * A/B Test Runner API (#482).
 * POST /api/automation/ab-tests            — create
 * POST /api/automation/ab-tests/:id/start  — begin
 * POST /api/automation/ab-tests/:id/stop   — stop + compute results
 * GET  /api/automation/ab-tests/:id/results — PnL, win rate, drawdown
 */
@Controller('automation/ab-tests')
export class AbTestController {
  constructor(private readonly abTestService: AbTestService) {}

  @Post()
  create(
    @Body() body: { name: string; controlStackId: string; variantStackId: string; symbols: string[] },
  ) {
    return this.abTestService.create(body);
  }

  @Get()
  list() {
    return this.abTestService.list();
  }

  @Get('snapshots')
  listSnapshots() {
    return this.abTestService.listSnapshots();
  }

  @Post(':id/start')
  start(@Param('id') id: string) {
    return this.abTestService.start(id);
  }

  @Post(':id/stop')
  stop(@Param('id') id: string) {
    return this.abTestService.stop(id);
  }

  @Get(':id/results')
  getResults(@Param('id') id: string) {
    return this.abTestService.getResults(id);
  }
}
