import { Controller, Get, Post, Delete, Param, Query, Body } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DirectivesService } from './directives.service';
import { PROTOCOL_REGISTRY } from './directive-groups';

@ApiTags('directives')
@Controller('directives')
export class DirectivesController {
  constructor(private readonly directivesService: DirectivesService) {}

  @Get()
  @ApiOperation({ summary: 'List all registered directives with metadata' })
  @ApiOkResponse({ description: 'Array of directive definitions' })
  list() {
    const directives = this.directivesService.list();

    // Build a category map from all protocol groups
    const directiveCategory = new Map<string, string>();
    for (const proto of Object.values(PROTOCOL_REGISTRY)) {
      for (const group of proto.groups) {
        for (const did of group.directiveIds) {
          if (!directiveCategory.has(did)) {
            directiveCategory.set(did, group.name);
          }
        }
      }
    }

    // Compute protocolCount: how many protocols include each directive
    const protocolCounts = new Map<string, number>();
    for (const proto of Object.values(PROTOCOL_REGISTRY)) {
      const seen = new Set<string>();
      for (const group of proto.groups) {
        for (const did of group.directiveIds) {
          if (!seen.has(did)) { seen.add(did); }
        }
      }
      for (const did of seen) {
        protocolCounts.set(did, (protocolCounts.get(did) ?? 0) + 1);
      }
    }

    return directives.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      category: directiveCategory.get(d.id) ?? 'Other',
      priority: d.priority ?? 50,
      protocolCount: protocolCounts.get(d.id) ?? 0,
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
