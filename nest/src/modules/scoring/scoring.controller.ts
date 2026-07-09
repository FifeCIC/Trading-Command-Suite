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
import { SeasonalAffinityService } from './seasonal-affinity.service';
import { StackPerformanceService } from './stack-performance.service';
import { ProviderDegradationService } from '../providers/provider-degradation.service';
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
    private readonly degradationService: ProviderDegradationService,
    private readonly seasonalAffinity: SeasonalAffinityService,
    private readonly stackPerformance: StackPerformanceService,
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

  @Get('degradation')
  @UseInterceptors(new CacheInterceptor(15000))
  @ApiOperation({ summary: 'Get provider degradation status and scoring integrity' })
  @ApiOkResponse({ description: 'Degradation status with provider health and coverage' })
  getDegradation() {
    const allProviders = this.degradationService.getAll();
    const failedProviders = allProviders.filter(p => p.status === 'failed');
    const degradedProviders = allProviders.filter(p => p.status === 'degraded');
    const healthyProviders = allProviders.filter(p => p.status === 'healthy');
    const coverage = allProviders.length > 0
      ? (allProviders.length - failedProviders.length) / allProviders.length
      : 1.0;

    return {
      isDegraded: failedProviders.length > 0 || degradedProviders.length > 0,
      coverage: Number(coverage.toFixed(2)),
      providers: {
        total: allProviders.length,
        healthy: healthyProviders.length,
        degraded: degradedProviders.length,
        failed: failedProviders.length,
      },
      failedProviderIds: failedProviders.map(p => p.providerId),
      degradedProviderIds: degradedProviders.map(p => p.providerId),
      details: allProviders.map(p => ({
        providerId: p.providerId,
        status: p.status,
        reason: p.reason,
      })),
      warning: failedProviders.length > 0
        ? `Scoring degraded — ${failedProviders.length} provider(s) failed: ${failedProviders.map(p => p.providerId).join(', ')}`
        : degradedProviders.length > 0
          ? `Scoring degraded — ${degradedProviders.length} provider(s) experiencing issues`
          : null,
      timestamp: new Date().toISOString(),
    };
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

  @Get('recently-analysed')
  @ApiOperation({ summary: 'Get recently analysed symbols with latest scores' })
  @ApiOkResponse({ description: 'Distinct symbols with latest score, ordered by most recent' })
  getRecentlyAnalysed(@Query('limit') limit?: string) {
    const parsed = Number(limit ?? 30);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 30;
    return this.scoreHistoryService.getRecentlyAnalysed(safe);
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

  /**
   * GET /api/scoring/seasonal/current
   *
   * Returns the current seasonal affinity weight for every protocol.
   * Shows which protocols are seasonally favored/disfavored right now.
   */
  @Get('seasonal/current')
  @UseInterceptors(new CacheInterceptor(300000))
  async getSeasonalWeights() {
    const { PROTOCOL_REGISTRY } = await import('../directives/directive-groups.js');
    const weights: Array<{
      protocolId: string;
      protocolName: string;
      weight: number;
      label: string;
      source: string;
      month: number;
      day: number;
    }> = [];

    for (const [id, proto] of Object.entries(PROTOCOL_REGISTRY) as [string, { name: string }][]) {
      const affinity = this.seasonalAffinity.getAffinity(id);
      weights.push({
        protocolId: id,
        protocolName: proto.name,
        weight: Math.round(affinity.weight * 100) / 100,
        label: affinity.label || '',
        source: affinity.source,
        month: affinity.month + 1,
        day: affinity.day,
      });
    }

    weights.sort((a, b) => b.weight - a.weight);

    const now = new Date();
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    return {
      generatedAt: now.toISOString(),
      currentMonth: monthNames[now.getMonth()],
      currentDay: now.getDate(),
      protocols: weights,
      topPick: weights[0] || null,
      activeCount: weights.filter(w => w.weight !== 0).length,
    };
  }

  /**
   * GET /api/scoring/metastacks/ratings
   * Returns performance ratings for all MetaStacks.
   * A MetaStack = Watchlist + Protocol + Scoring Strategy + Trading Strategy.
   */
  @Get('metastacks/ratings')
  @UseInterceptors(new CacheInterceptor(60000))
  @ApiOperation({ summary: 'Get performance ratings for all MetaStacks' })
  @ApiOkResponse({ description: 'MetaStack ratings with stars, effectiveness rate, and fingerprint' })
  async getMetaStackRatings() {
    return this.stackPerformance.computeAllRatings();
  }

  /**
   * GET /api/scoring/metastacks/:id/rating
   */
  @Get('metastacks/:id/rating')
  @UseInterceptors(new CacheInterceptor(30000))
  @ApiOperation({ summary: 'Get rating for a single MetaStack' })
  @ApiParam({ name: 'id', type: 'string' })
  async getMetaStackRating(@Param('id') id: string) {
    return this.stackPerformance.getMetaStackRating(id);
  }

  /**
   * GET /api/scoring/metastacks/:id/fingerprint
   * Check if a MetaStack's components have changed since its last trade.
   */
  @Get('metastacks/:id/fingerprint')
  @ApiOperation({ summary: 'Check if MetaStack fingerprint has changed' })
  @ApiParam({ name: 'id', type: 'string' })
  async checkFingerprint(@Param('id') id: string) {
    return this.stackPerformance.checkFingerprintChange(id);
  }

  // ── Legacy aliases (backward compat) ──────────────────────

  @Get('stacks/ratings')
  @UseInterceptors(new CacheInterceptor(60000))
  async getStackRatingsLegacy() {
    return this.stackPerformance.computeAllRatings();
  }

  @Get('stacks/:id/rating')
  @UseInterceptors(new CacheInterceptor(30000))
  async getStackRatingLegacy(@Param('id') id: string) {
    return this.stackPerformance.getMetaStackRating(id);
  }
}
