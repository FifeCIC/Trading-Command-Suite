/**
 * Scoring Controller
 * ==================
 * Exposes the ranked symbol endpoint consumed by the SEES UI panel.
 *
 * GET /api/scoring/ranked
 *   Query params: strategy_id (optional), limit (default 20)
 *   Returns: RankedResult with mode+services metadata and ranked symbols.
 */

import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PaginationInterceptor } from '../../common/interceptors/pagination.interceptor';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ScoringService } from './scoring.service';
import { ScoreHistoryService } from './score-history.service';
import { StrategyCompetitionService } from './strategy-competition.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';

@ApiTags('scoring')
@Controller('scoring')
export class ScoringController {
  constructor(
    private readonly scoringService: ScoringService,
    private readonly scoreHistoryService: ScoreHistoryService,
    private readonly competitionService: StrategyCompetitionService,
  ) {}

  @Get('ranked')
  @UseInterceptors(new CacheInterceptor(15000))
  @UseInterceptors(new PaginationInterceptor('ranked'))
  @ApiOperation({ summary: 'Get symbols ranked by aggregate score' })
  @ApiOkResponse({
    description: 'Ranked symbol list with scores and directive breakdown',
  })
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

  @Post('run')
  @ApiOperation({ summary: 'Trigger a full scoring run for active symbols' })
  @ApiOkResponse({ description: 'Ranked results with normalized scores' })
  async runScoring(
    @Body() body?: { symbols?: string[]; timeframe?: string },
  ) {
    return this.scoringService.runScoring(body?.symbols, body?.timeframe);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Quick scoring overview for health checks' })
  @ApiOkResponse({ description: 'Aggregated scoring stats' })
  async getSummary() {
    return this.scoringService.getSummary();
  }

  @Get('test/min-to-min')
  @ApiOperation({ summary: 'QA test: minute-to-minute scoring with modifier' })
  @ApiOkResponse({
    description: 'Ranked symbols with QA modifier applied and debug fields',
  })
  testMinToMin(
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit ?? 20);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    return this.scoringService.qaMinToMin(safeLimit);
  }

  @Get('history/:symbolId')
  @ApiOperation({ summary: 'Get score history for a symbol' })
  @ApiParam({ name: 'symbolId', description: 'Symbol UUID' })
  @ApiOkResponse({ description: 'Array of score snapshots' })
  getHistory(
    @Param('symbolId') symbolId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Number(limit ?? 20);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    return this.scoreHistoryService.getHistory(symbolId, safeLimit);
  }

  @Get('history/:symbolId/latest')
  @ApiOperation({ summary: 'Get latest score snapshot for a symbol' })
  @ApiParam({ name: 'symbolId', description: 'Symbol UUID' })
  @ApiOkResponse({ description: 'Latest score snapshot' })
  getLatest(@Param('symbolId') symbolId: string) {
    return this.scoreHistoryService.getLatest(symbolId);
  }

  // ── Strategy Competition (Q157) ──

  @Post('compete')
  @ApiOperation({ summary: 'Run strategy competition — find best next move across all strategies' })
  async compete(@Body() body: { symbols?: string[]; strategies?: string[]; limit?: number }) {
    return this.competitionService.compete([], body);
  }

  @Get('compete/status')
  @ApiOperation({ summary: 'Get competition status' })
  getCompetitionStatus() {
    return this.competitionService.getStatus();
  }
}
