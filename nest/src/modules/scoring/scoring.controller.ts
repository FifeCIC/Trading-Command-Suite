/**
 * Scoring Controller — Flat/Ranked Pipeline
 * ==========================================
 * CANONICAL ROLE (2026-07-29): Quick overview & dashboard scoring.
 *
 * This is the ORIGINAL scoring path. It runs ALL 104 directives against
 * every symbol (unfiltered) when ?fresh=true, or reads pre-computed
 * results from the DB when cached. Use for:
 *   - Dashboards (DashboardPage, DailyBriefing, HotStockPicks)
 *   - Quick symbol lookups (AnalyseSymbol, GapScanner)
 *   - Status pages (MetaStackStatus, ScoringOverview)
 *
 * NOT for trading decisions — use /api/scoring/gated/batch for
 * protocol-scoped, risk-gated scoring with directive breakouts.
 *
 * ── Scoring Surface Map ──────────────────────────────────────
 *   /api/scoring/ranked          ← THIS FILE — flat, all-directive
 *   /api/scoring/gated/batch     ← Protocol-gated, risk chains
 *   /api/signals/ladder          ← Enriched envelopes, conflict detection
 *   /api/speed/scan              ← Micro-trend scalping scanner
 *   /api/backtest/benchmark      ← Buy-and-hold comparison (analytics)
 *
 * @see docs/handoff/2026-07-29-scoring-paths-audit-497.md
 */

import { Body, Controller, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common';
import { PaginationInterceptor } from '../../common/interceptors/pagination.interceptor';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ScoringService } from './scoring.service';
import { ScoreHistoryService } from './score-history.service';
import { ScoreVelocityService } from './score-velocity.service';
import { DirectiveImpactService } from './directive-impact.service';
import { StrategyCompetitionService } from './strategy-competition.service';
import { PredictiveScoringService } from './predictive-scoring.service';
import { OutcomeTrackerService } from './outcome-tracker.service';
import { SectorRotationService } from './sector-rotation.service';
import { SeasonalAffinityService } from './seasonal-affinity.service';
import { StackPerformanceService } from './stack-performance.service';
import { ProtocolDbService } from './protocol-db.service';
import { ProviderDegradationService } from '../providers/provider-degradation.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';

@ApiTags('scoring')
@Controller('scoring')
export class ScoringController {
  constructor(
    private readonly scoringService: ScoringService,
    private readonly scoreHistoryService: ScoreHistoryService,
    private readonly scoreVelocityService: ScoreVelocityService,
    private readonly directiveImpactService: DirectiveImpactService,
    private readonly competitionService: StrategyCompetitionService,
    private readonly predictiveService: PredictiveScoringService,
    private readonly outcomeTracker: OutcomeTrackerService,
    private readonly sectorRotation: SectorRotationService,
    private readonly degradationService: ProviderDegradationService,
    private readonly seasonalAffinity: SeasonalAffinityService,
    private readonly stackPerformance: StackPerformanceService,
    private readonly protocolDb: ProtocolDbService,
  ) {}

  @Get('ranked')
  @UseInterceptors(new CacheInterceptor(15000))
  @UseInterceptors(new PaginationInterceptor('ranked'))
  @ApiOperation({ summary: 'Get symbols ranked by score (DB-read by default, fresh on demand)' })
  @ApiOkResponse({
    description: 'Ranked symbol list. Uses pre-computed DB scores by default. Pass ?fresh=true to run the full pipeline.',
  })
  ranked(
    @Query('strategy_id') strategyId?: string,
    @Query('limit') limit?: string,
    @Query('fresh') fresh?: string,
    @Query('protocol') protocol?: string,
  ) {
    const parsedLimit = Number(limit ?? 20);
    const safeLimit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 100)
      : 20;

    // ?fresh=true → run the full pipeline (speed trading, testing, on-demand)
    if (fresh === 'true') {
      return this.scoringService.rankAll(strategyId, safeLimit, undefined, protocol);
    }

    // Default: read pre-computed scores from DB
    return this.scoringService.rankFromDb(safeLimit);
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

  /**
   * GET /api/scoring/velocity/:symbol?window=5
   * Score Momentum Indicator (#519) — velocity, acceleration, volatility, directive drift.
   */
  @Get('velocity/:symbol')
  @ApiOperation({ summary: 'Get score momentum metrics for a symbol' })
  @ApiParam({ name: 'symbol', description: 'Symbol ticker (e.g. XAUUSD)' })
  @ApiQuery({ name: 'window', description: 'Number of snapshots (default 5)', required: false })
  async getVelocity(@Param('symbol') symbol: string, @Query('window') window?: string) {
    const w = Math.min(20, Math.max(2, Number(window) || 5));
    return this.scoreVelocityService.getVelocity(symbol.toUpperCase(), w);
  }

  /**
   * GET /api/scoring/directive-impact/:symbol?window=10
   * Directive Performance Audit (#283) — ranks directives by real-world impact.
   */
  @Get('directive-impact/:symbol')
  @ApiOperation({ summary: 'Get directive impact ranking for a symbol' })
  @ApiParam({ name: 'symbol', description: 'Symbol ticker (e.g. XAUUSD)' })
  @ApiQuery({ name: 'window', description: 'Number of snapshots (default 10)', required: false })
  async getDirectiveImpact(@Param('symbol') symbol: string, @Query('window') window?: string) {
    const w = Math.min(50, Math.max(3, Number(window) || 10));
    return this.directiveImpactService.getImpactReport(symbol.toUpperCase(), w);
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
  @UseInterceptors(new CacheInterceptor(15000))
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
    const allProtocols = this.protocolDb.getAllCached();
    const weights: Array<{
      protocolId: string;
      protocolName: string;
      weight: number;
      label: string;
      source: string;
      month: number;
      day: number;
    }> = [];

    for (const [id, proto] of Object.entries(allProtocols) as [string, { name: string }][]) {
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
  @ApiOkResponse({ description: 'MetaStack ratings with stars, effectiveness rate, and configuration signature' })
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
   * Check if a MetaStack's configuration signature has changed since its last trade.
   */
  @Get('metastacks/:id/fingerprint')
  @ApiOperation({ summary: 'Check if MetaStack configuration signature has changed' })
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
