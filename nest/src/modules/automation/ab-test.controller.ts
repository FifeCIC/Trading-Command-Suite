import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AbTestService } from './ab-test.service';

/**
 * A/B Test Runner API (#482).
 * POST /api/automation/ab-tests            — create
 * POST /api/automation/ab-tests/:id/start  — begin
 * POST /api/automation/ab-tests/:id/stop   — stop + compute results
 * POST /api/automation/ab-tests/:id/cancel — stop with NO verdict
 * GET  /api/automation/ab-tests/:id/results — PnL, win rate, drawdown
 *
 * ── WHY `cancel` EXISTS ALONGSIDE `stop` (2026-09-30) ──
 *
 * `cancel()` has existed in the service since #482 and had NO ROUTE, so the only way to halt a
 * running test through the API was `/stop` — which marks it `complete` and computes a verdict.
 * Those are two DIFFERENT claims and they were fused into one verb:
 *
 *   - `stop`   = "it ran its course, here is what it found"     → status `complete`
 *   - `cancel` = "it is being abandoned; there is no finding"    → status `cancelled`
 *
 * Measured 2026-09-30, test `b50727ee` (#929 measurable run): **104** trade rows carried its id and
 * **103** of them had no exit price and no P&L. Calling `/stop` would have manufactured a verdict
 * from a single usable row — the precise defect the change guide exists to prevent, and the reason
 * this test could not report the −322.67 loss it caused.
 *
 * ⚠️ ONLY `status = 'running'` DISPATCHES ORDERS. `automation-loop.service.ts` `evaluateAbTest()`
 * reads `getActiveTests()`, which filters on that one value — so cancelling stops the orders. Any
 * other status is inert, which is what makes this a kill switch rather than a label.
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

  /** Halt a running test WITHOUT computing a verdict. See the header. */
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.abTestService.cancel(id);
  }

  @Get(':id/results')
  getResults(@Param('id') id: string) {
    return this.abTestService.getResults(id);
  }
}
