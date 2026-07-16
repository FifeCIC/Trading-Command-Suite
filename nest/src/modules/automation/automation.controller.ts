import { Controller, Get, Param, Query, Post, Delete, Body } from '@nestjs/common';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { AutomationLoopService } from './automation-loop.service';
import { PrismaService } from '../../database/prisma.service';
import type { CacheStats, CacheDebugEntry } from './symbol-data-cache.service';
import type { ProtocolRunConfig, RunResult } from './protocol-runner.service';
import type { QueueJob, QueueStats } from './execution-queue.service';
import type { CrossProtocolRanking } from './multi-protocol-ranking.service';

@Controller('automation')
export class AutomationController {
  constructor(
    private readonly cache: SymbolDataCacheService,
    private readonly runner: ProtocolRunnerService,
    private readonly queue: ExecutionQueueService,
    private readonly ranking: MultiProtocolRankingService,
    private readonly loop: AutomationLoopService,
    private readonly prisma: PrismaService,
  ) {}

  // ── Cache endpoints ─────────────────────────────────

  /** GET /api/automation/cache-stats — hit/miss/eviction counts */
  @Get('cache-stats')
  getCacheStats(): CacheStats {
    return this.cache.getStats();
  }

  /** GET /api/automation/cache-entries — full debug dump */
  @Get('cache-entries')
  getCacheEntries(): CacheDebugEntry[] {
    return this.cache.getDebugEntries();
  }

  /** GET /api/automation/cache/flush — clear all entries (for debugging) */
  @Get('cache/flush')
  flushCache(): { flushed: boolean } {
    this.cache.flush();
    return { flushed: true };
  }

  /** GET /api/automation/cache/invalidate/:provider — clear entries for a provider */
  @Get('cache/invalidate/:provider')
  invalidateCache(@Param('provider') provider: string, @Query('symbol') symbol?: string): { invalidated: boolean } {
    this.cache.invalidate(provider, symbol);
    return { invalidated: true };
  }

  // ── Protocol Run endpoints ──────────────────────────

  /** GET /api/automation/runs — list all configured runs */
  @Get('runs')
  async listRuns() {
    if (!this.prisma.isAvailable) return [];
    return this.prisma.protocolRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** POST /api/automation/runs — create a new protocol run */
  @Post('runs')
  async createRun(@Body() config: ProtocolRunConfig) {
    if (!config.name?.trim()) throw new Error('name is required');
    if (!config.protocolId) throw new Error('protocolId is required');
    if (!config.symbols?.length) throw new Error('symbols is required');

    if (this.prisma.isAvailable) {
      const record = await this.prisma.protocolRun.create({
        data: {
          name: config.name.trim(),
          protocolId: config.protocolId,
          symbols: config.symbols.map((s) => s.toUpperCase()),
          status: 'pending',
        },
      });
      return record;
    }

    // Fallback: return in-memory stub
    return {
      id: Date.now(),
      name: config.name.trim(),
      protocolId: config.protocolId,
      symbols: config.symbols.map((s) => s.toUpperCase()),
      status: 'pending',
      createdAt: new Date(),
      runCount: 0,
    };
  }

  /** POST /api/automation/runs/:id/execute — trigger execution */
  @Post('runs/:id/execute')
  async executeRun(@Param('id') id: string): Promise<RunResult> {
    let config: ProtocolRunConfig;

    if (this.prisma.isAvailable) {
      const record = await this.prisma.protocolRun.findUnique({ where: { id: Number(id) } });
      if (!record) throw new Error(`Run ${id} not found`);

      config = {
        name: record.name,
        protocolId: record.protocolId,
        symbols: record.symbols as string[],
      };

      // Mark as running
      await this.prisma.protocolRun.update({
        where: { id: Number(id) },
        data: { status: 'running', lastRunAt: new Date() },
      });
    } else {
      throw new Error('Database not available');
    }

    const result = await this.runner.executeRun(config);

    // Update run with results
    if (this.prisma.isAvailable) {
      await this.prisma.protocolRun.update({
        where: { id: Number(id) },
        data: {
          status: 'complete',
          results: result.results as any,
          runCount: { increment: 1 },
        },
      });
    }

    return result;
  }

  /** GET /api/automation/results/:runId — get latest results */
  @Get('results/:runId')
  async getResults(@Param('runId') runId: string) {
    if (!this.prisma.isAvailable) return null;
    return this.prisma.protocolRun.findUnique({ where: { id: Number(runId) } });
  }

  /** DELETE /api/automation/runs/:id — remove a run */
  @Delete('runs/:id')
  async deleteRun(@Param('id') id: string) {
    if (!this.prisma.isAvailable) return { deleted: false };
    await this.prisma.protocolRun.delete({ where: { id: Number(id) } });
    return { deleted: true };
  }

  // ── Execution Queue endpoints ──────────────────────

  /** GET /api/automation/queue — current queue state */
  @Get('queue')
  getQueue(): QueueJob[] {
    return this.queue.getQueue();
  }

  /** GET /api/automation/queue/stats — aggregate stats */
  @Get('queue/stats')
  getQueueStats(): QueueStats {
    return this.queue.getStats();
  }

  /** GET /api/automation/queue/:jobId — single job status */
  @Get('queue/:jobId')
  getJob(@Param('jobId') jobId: string): QueueJob | null {
    return this.queue.getJob(jobId);
  }

  /** POST /api/automation/queue/:jobId/cancel — cancel a queued job */
  @Post('queue/:jobId/cancel')
  cancelJob(@Param('jobId') jobId: string): { cancelled: boolean } {
    return { cancelled: this.queue.cancel(jobId) };
  }

  /** POST /api/automation/runs/:id/enqueue — enqueue for execution */
  @Post('runs/:id/enqueue')
  async enqueueRun(@Param('id') id: string): Promise<{ jobId: string }> {
    const jobId = await this.queue.enqueue(Number(id));
    return { jobId };
  }

  // ── Cross-Protocol Ranking ──────────────────────────

  /** POST /api/automation/rankings/cross-protocol — rank symbols across all protocols */
  @Post('rankings/cross-protocol')
  async crossProtocolRanking(@Body() body: { symbols: string[] }): Promise<CrossProtocolRanking[]> {
    if (!body.symbols?.length) throw new Error('symbols is required');
    return this.ranking.rankAcrossProtocols(body.symbols);
  }

  /** GET /api/automation/affinities — all symbol-protocol affinities */
  @Get('affinities')
  async getAffinities() {
    return this.ranking.getAllAffinities();
  }

  /** GET /api/automation/affinities/:symbol — single symbol affinity */
  @Get('affinities/:symbol')
  async getSymbolAffinity(@Param('symbol') symbol: string) {
    return this.ranking.getAffinity(symbol);
  }

  // ── Dashboard status endpoint ────────────────────────

  /**
   * GET /api/automation/status
   * Returns full automation dashboard state: brokers, strategies, timeline.
   */
  @Get('status')
  async getStatus() {
    const loopState = this.loop.getState();

    const activeStrategies: any[] = [];
    if (this.prisma.isAvailable) {
      try {
        const strategies = await (this.prisma as any).tradingStrategy.findMany({
          where: { active: true },
          include: { evaluations: { orderBy: { evaluatedAt: 'desc' }, take: 1 } },
        });
        for (const s of strategies) {
          activeStrategies.push({
            id: s.id,
            name: s.name,
            protocolId: s.protocolId,
            symbol: s.symbol,
            brokerId: s.brokerId ?? 'mt5',
            mode: s.mode ?? 'manual',
            active: s.active,
            lastEvaluatedAt: s.evaluations?.[0]?.evaluatedAt ?? null,
            lastSignal: s.evaluations?.[0]?.signal ?? null,
            lastComposite: s.evaluations?.[0]?.composite ?? null,
          });
        }
      } catch { /* strategies table may not have brokerId yet */ }
    }

    return {
      loopEnabled: loopState.loopEnabled,
      tickIntervalMs: loopState.tickIntervalMs,
      tickCount: loopState.tickCount,
      lastTickAt: loopState.lastTickAt,
      nextTickAt: loopState.nextTickAt,
      lastTickMs: loopState.lastTickMs,
      globalRiskMultiplier: loopState.globalRiskMultiplier,
      brokerStates: loopState.brokerStates,
      activeStrategies,
      pendingActions: loopState.pendingActions,
      activeTimelineEvents: loopState.activeTimelineEvents.slice(0, 20),
      recentDecisions: (loopState.recentDecisions || []).slice(0, 20),
    };
  }

  // ── Loop Control ─────────────────────────────────────

  /** POST /api/automation/start — start the automation loop */
  @Post('start')
  startLoop() {
    return this.loop.start();
  }

  /** POST /api/automation/stop — stop the automation loop */
  @Post('stop')
  stopLoop() {
    return this.loop.stop();
  }

  /** POST /api/automation/interval — change tick interval */
  @Post('interval')
  setInterval(@Body() body: { ms: number }) {
    this.loop.setIntervalMs(body.ms);
    return { intervalMs: this.loop.state.tickIntervalMs };
  }

  /** POST /api/automation/run-now — trigger immediate tick */
  @Post('run-now')
  async runNow() {
    const decisions = await this.loop.tick();
    return { run: true, decisions };
  }

  /** POST /api/automation/emergency-stop */
  @Post('emergency-stop')
  emergencyStop() {
    return this.loop.emergencyStop();
  }

  /** POST /api/automation/confirm-action — approve queued trade */
  @Post('confirm-action')
  confirmAction(@Body() body: { actionId: string }) {
    return this.loop.confirmAction(body.actionId);
  }

  /** POST /api/automation/reject-action — reject queued trade */
  @Post('reject-action')
  rejectAction(@Body() body: { actionId: string }) {
    return this.loop.rejectAction(body.actionId);
  }

  /** POST /api/automation/toggle — pause/resume loop or broker */
  @Post('toggle')
  toggle(@Body() body: { target?: string; enabled?: boolean }) {
    const target = body.target || 'loop';
    if (target === 'loop') {
      if (body.enabled ?? !this.loop.state.loopEnabled) {
        return this.loop.start();
      } else {
        return this.loop.stop();
      }
    }
    // Per-broker toggle — create state if missing
    if (!this.loop.state.brokerStates[target]) {
      this.loop.state.brokerStates[target] = {
        brokerId: target,
        enabled: false,
        tradingEnabled: false,
        scoreIntervalMs: 300000,
        tradeThreshold: 60,
        requireConfirmation: true,
      };
    }
    this.loop.state.brokerStates[target].enabled = body.enabled ?? !this.loop.state.brokerStates[target].enabled;
    return { brokerId: target, enabled: this.loop.state.brokerStates[target].enabled };
  }

  /** POST /api/automation/config — update broker config */
  @Post('config')
  updateConfig(@Body() body: { brokerId: string; tradingEnabled?: boolean; tradeThreshold?: number; requireConfirmation?: boolean; scoreIntervalMs?: number }) {
    // Auto-create broker state if missing
    if (!this.loop.state.brokerStates[body.brokerId]) {
      this.loop.state.brokerStates[body.brokerId] = {
        brokerId: body.brokerId,
        enabled: false,
        tradingEnabled: false,
        scoreIntervalMs: 300000,
        tradeThreshold: 60,
        requireConfirmation: true,
      };
    }
    const bs = this.loop.state.brokerStates[body.brokerId];
    if (body.tradingEnabled !== undefined) bs.tradingEnabled = body.tradingEnabled;
    if (body.tradeThreshold !== undefined) bs.tradeThreshold = body.tradeThreshold;
    if (body.requireConfirmation !== undefined) bs.requireConfirmation = body.requireConfirmation;
    if (body.scoreIntervalMs !== undefined) {
      bs.scoreIntervalMs = body.scoreIntervalMs;
    }
    return { brokerId: body.brokerId, config: bs };
  }

  // ── Scoring Strategies ───────────────────────────────

  /** GET /api/automation/scoring-strategies */
  @Get('scoring-strategies')
  getScoringStrategies() {
    return this.loop.scoringStrategies;
  }

  /** POST /api/automation/scoring-strategies */
  @Post('scoring-strategies')
  async addScoringStrategy(@Body() body: {
    name: string; protocolId: string; shortProtocolId?: string;
    watchlistName: string; brokerId: string; mode?: string;
    tradeThreshold?: number; baseSize?: number;
    slPct?: number; tpPct?: number;
    maxPyramidTiers?: number;
    slTpInheritance?: string;
    weightStrategy?: 'group-weighted' | 'maxscore-weighted';
  }) {
    const id = `ss-${Date.now()}`;
    const strat = {
      id,
      name: body.name,
      protocolId: body.protocolId,
      shortProtocolId: body.shortProtocolId ?? undefined,
      watchlistName: body.watchlistName,
      brokerId: body.brokerId || 'mt5',
      mode: (body.mode as any) || 'manual',
      tradeThreshold: body.tradeThreshold ?? 60,
      baseSize: body.baseSize ?? 0.01,
      slPct: body.slPct ?? 1.0,
      tpPct: body.tpPct ?? 1.5,
      maxPyramidTiers: body.maxPyramidTiers ?? 1,
      slTpInheritance: body.slTpInheritance ?? 'inherit',
      weightStrategy: ((body as any).weightStrategy as 'group-weighted' | 'maxscore-weighted') ?? 'group-weighted',
      enabled: true,
      tradingEnabled: false,
    };
    this.loop.scoringStrategies.push(strat);
    await this.loop.saveScoringStrategy(strat);
    return strat;
  }

  /** DELETE /api/automation/scoring-strategies/:id */
  @Delete('scoring-strategies/:id')
  async removeScoringStrategy(@Param('id') id: string) {
    this.loop.scoringStrategies = this.loop.scoringStrategies.filter(s => s.id !== id);
    await this.loop.deleteScoringStrategy(id);
    return { removed: id };
  }

  /** POST /api/automation/scoring-strategies/:id/toggle */
  @Post('scoring-strategies/:id/toggle')
  async toggleScoringStrategy(@Param('id') id: string, @Body() body: { enabled?: boolean; tradingEnabled?: boolean }) {
    const s = this.loop.scoringStrategies.find(s => s.id === id);
    if (!s) return { error: 'Not found' };
    if (body.enabled !== undefined) s.enabled = body.enabled;
    if (body.tradingEnabled !== undefined) s.tradingEnabled = body.tradingEnabled;
    await this.loop.saveScoringStrategy(s);
    return s;
  }
}
