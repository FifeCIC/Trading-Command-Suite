import { Controller, Get, Post, Delete, Param, Query, Body } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectivesService } from './directives.service';

@ApiTags('directives')
@Controller('directives')
export class DirectivesController {
  constructor(private readonly directivesService: DirectivesService) {}

  @Get()
  @ApiOperation({ summary: 'List all registered directives with metadata' })
  @ApiOkResponse({ description: 'Array of directive definitions' })
  list() {
    const directives = this.directivesService.list();
    return directives.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      category: (d as any).category ?? 'Uncategorized',
      priority: d.priority ?? 50,
    }));
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━
  //  Fork endpoints (Q301b)
  // ━━━━━━━━━━━━━━━━━━━━━━━━

  @Get('forks')
  @ApiOperation({ summary: 'List all directive forks' })
  async listForks() {
    const forks = await this.directivesService.getForks();
    return { forks };
  }

  @Get('effective')
  @ApiOperation({ summary: 'Get effective directive for a strategy (fork or original)' })
  async getEffective(
    @Query('directiveId') directiveId: string,
    @Query('strategyId') strategyId: string,
  ) {
    const directive = await this.directivesService.getEffectiveDirective(
      directiveId,
      strategyId,
    );
    return { directive };
  }

  @Post(':id/fork')
  @ApiOperation({ summary: 'Create a fork of a directive for a strategy' })
  async fork(
    @Param('id') id: string,
    @Body() body: { strategyId: string; weight?: number; config?: any; reason?: string },
  ) {
    const fork = await this.directivesService.forkDirective(
      id,
      body.strategyId,
      { weight: body.weight, config: body.config, reason: body.reason },
    );
    return { fork };
  }

  @Delete(':id/revert')
  @ApiOperation({ summary: 'Revert a fork — delete it and fall back to parent' })
  async revert(@Param('id') id: string) {
    const result = await this.directivesService.revertFork(id);
    return result;
  }
}
