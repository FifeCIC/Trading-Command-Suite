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
import { PredictiveScoringService } from './predictive-scoring.service';
import { OutcomeTrackerService } from './outcome-tracker.service';
import { SectorRotationService } from './sector-rotation.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';

@ApiTags('scoring')
@Controller('scoring')
export class ScoringController {
  constructor(
    private readonly scoringService: ScoringService,
    private readonly scoreHistoryService: ScoreHistoryService,
    private readonly competitionService: StrategyCompetitionService,
    private readonly predictiveService: PredictiveScoringService,
    private readonly outcomeTracker: OutcomeTrackerService,
    private readonly sectorRotation: SectorRotationService,
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

  // ── Q304: Self-Improving Scoring — Accuracy ──

  @Get('accuracy')
  @ApiOperation({ summary: 'Get directive prediction accuracy' })
  getAccuracy(
    @Query('directiveId') directiveId?: string,
    @Query('symbol') symbol?: string,
    @Query('timeframe') timeframe?: string,
    @Query('days') days?: string,
  ) {
    return this.outcomeTracker.getAccuracy({
      directiveId,
      symbol,
      timeframe,
      days: days ? Number(days) : 30,
    });
  }

  // ── Strategy Competition (Q157) ──

  @Get('runs')
  @ApiOperation({ summary: 'Get scoring runs grouped by time + strategy with search & pagination' })
  getRuns(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('strategyId') strategyId?: string,
  ) {
    const parsedPage = Number(page ?? 1);
    const parsedLimit = Number(limit ?? 30);
    const safePage = Number.isFinite(parsedPage) ? Math.max(parsedPage, 1) : 1;
    const safeLimit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 30;

    return this.scoreHistoryService.getRuns({
      search: search?.trim() || undefined,
      page: safePage,
      limit: safeLimit,
      strategyId: strategyId?.trim() || undefined,
    });
  }

  @Get('runs/:runId')
  @ApiOperation({ summary: 'Get detailed scores for a specific scoring run' })
  @ApiParam({ name: 'runId', description: 'Run ID (format: run-{epochMs}-{strategyPrefix})' })
  getRunScores(@Param('runId') runId: string) {
    return this.scoreHistoryService.getRunScores(runId);
  }

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

  @Get('predictive')
  getPredictive(
    @Query('symbols') symbols?: string,
    @Query('horizon') horizon?: string,
  ) {
    const symbolList = symbols ? symbols.split(',').map((s) => s.trim().toUpperCase()) : undefined;
    const horizonDays = parseInt(horizon || '7', 10);
    const predictions = this.predictiveService.getPredictions(symbolList, horizonDays);
    return {
      predictions,
      generatedAt: new Date().toISOString(),
      disclaimer: 'PROTOTYPE — Predictive scores are experimental. Based on scheduled events only.',
    };
  }

  // ── Sector Rotation ──

  @Get('sectors/rotation')
  @UseInterceptors(new CacheInterceptor(60000))
  @ApiOperation({ summary: 'Sector ETF rotation with protocol stratification' })
  async getSectorRotation() {
    return this.sectorRotation.getRotation();
  }
}
