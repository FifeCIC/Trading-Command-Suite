import { Controller, Get, Post, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ScenariosService } from './scenarios.service';

@Controller('scenarios')
export class ScenariosController {
  constructor(private readonly scenariosService: ScenariosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: { name: string; description: string; marketCondition: string; symbol: string; factors: { name: string; present: boolean; weight: number }[] }) {
    return this.scenariosService.create(body);
  }

  @Get()
  list() {
    return { scenarios: this.scenariosService.list() };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.scenariosService.get(id) ?? { error: 'Scenario not found' };
  }

  @Post(':id/assess')
  assess(@Param('id') id: string) {
    return this.scenariosService.assess(id) ?? { error: 'Scenario not found' };
  }

  @Post(':id/history')
  addHistory(@Param('id') id: string, @Body() body: { date: string; outcome: string }) {
    return this.scenariosService.addHistory(id, body.date, body.outcome) ?? { error: 'Scenario not found' };
  }
}
