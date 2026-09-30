import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { ScenarioService } from './scenario.service';

@Controller('scenarios')
export class ScenarioController {
  constructor(private readonly scenarioService: ScenarioService) {}

  @Post()
  create(@Body() body: any) {
    return this.scenarioService.create(body);
  }

  @Get()
  list() {
    return { scenarios: this.scenarioService.list() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const s = this.scenarioService.get(id);
    if (!s) return { error: 'Scenario not found' };
    return s;
  }

  @Post(':id/assess')
  assess(@Param('id') id: string) {
    const s = this.scenarioService.assess(id);
    if (!s) return { error: 'Scenario not found' };
    return s;
  }

  /**
   * POST /api/scenarios/:id/history — attach what actually happened.
   *
   * ⚠️ Merged 2026-09-30 from the DELETED `scenarios.controller.ts`, which had this endpoint and was
   * never wired. It is the half that makes a scenario useful for training: the setup, and its outcome.
   * `period` is a `{ from, to }` window, not a single date — a scenario is a market PERIOD.
   */
  @Post(':id/history')
  addHistory(
    @Param('id') id: string,
    @Body() body: { period?: { from?: string; to?: string }; outcome?: string },
  ) {
    const from = body?.period?.from;
    const to = body?.period?.to;
    if (!from || !to) {
      return { error: 'period.from and period.to are required — a scenario is a market period, not a date' };
    }
    const s = this.scenarioService.addHistory(id, { from, to }, String(body?.outcome ?? ''));
    if (!s) return { error: 'Scenario not found' };
    return s;
  }
}
