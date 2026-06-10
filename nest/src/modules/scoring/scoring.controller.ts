/**
 * PLACEHOLDER — implement per SPRINT.md Task 6.
 *
 * Scoring Controller
 * ==================
 * Exposes the ranked symbol endpoint consumed by the SEES UI panel.
 *
 * GET /api/scoring/ranked
 *   Query params: strategy_id (optional), limit (default 20)
 *   Returns: RankedResult with mode+services metadata and ranked symbols.
 */

import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScoringService } from './scoring.service';

@ApiTags('scoring')
@Controller('scoring')
export class ScoringController {
  constructor(private readonly scoringService: ScoringService) {}

  @Get('ranked')
  @ApiOperation({ summary: 'Get symbols ranked by aggregate score' })
  @ApiOkResponse({ description: 'Ranked symbol list with scores' })
  ranked(
    @Query('strategy_id') strategyId?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit ?? 20);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    return this.scoringService.rankAll(strategyId, safeLimit);
  }
}
