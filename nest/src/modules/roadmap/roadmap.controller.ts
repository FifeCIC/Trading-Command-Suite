/**
 * RoadmapController — dynamic roadmap board (epic #681, Phase D).
 * =====================================================================
 * GET    /api/roadmap                     — snapshot ∪ interactive state
 * POST   /api/roadmap/cards/:number/move  — { columnId, targetIndex }
 * POST   /api/roadmap/cards/:number/owner — { agent }
 * POST   /api/roadmap/cards/:number/deps  — { blockedBy: number[] }
 * POST   /api/roadmap/columns             — { title, kind? } (sprints)
 * PATCH  /api/roadmap/columns/:id         — { title } (rename)
 * DELETE /api/roadmap/columns/:id         — remove a sprint column (empty only)
 */
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { RoadmapService } from './roadmap.service';

@Controller('roadmap')
export class RoadmapController {
  constructor(private readonly roadmap: RoadmapService) {}

  @Get()
  board() {
    return this.roadmap.getBoard();
  }

  @Post('cards/:number/move')
  move(
    @Param('number', ParseIntPipe) number: number,
    @Body() body: { columnId?: string; targetIndex?: number },
  ) {
    return this.roadmap.moveCard(number, body.columnId || 'triage', body.targetIndex ?? 0);
  }

  @Post('cards/:number/owner')
  owner(
    @Param('number', ParseIntPipe) number: number,
    @Body() body: { agent?: string | null },
  ) {
    return this.roadmap.setOwner(number, body.agent ?? null);
  }

  @Post('cards/:number/deps')
  deps(
    @Param('number', ParseIntPipe) number: number,
    @Body() body: { blockedBy?: number[] },
  ) {
    return this.roadmap.setDependencies(number, Array.isArray(body.blockedBy) ? body.blockedBy : []);
  }

  @Post('columns')
  columns(@Body() body: { title?: string; kind?: string }) {
    return this.roadmap.createColumn(body.title || 'New Sprint', body.kind || 'sprint');
  }

  @Patch('columns/:id')
  rename(@Param('id') id: string, @Body() body: { title?: string }) {
    return this.roadmap.renameColumn(id, body.title || 'Untitled');
  }

  @Delete('columns/:id')
  removeColumn(@Param('id') id: string) {
    return this.roadmap.deleteColumn(id);
  }
}
