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
}
