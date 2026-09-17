import { Controller, Get, Param, Query, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { SymbolDataCacheService } from './symbol-data-cache.service';
import { ProtocolRunnerService } from './protocol-runner.service';
import { ExecutionQueueService } from './execution-queue.service';
import { MultiProtocolRankingService } from './multi-protocol-ranking.service';
import { AutomationLoopService } from './automation-loop.service';
import { PositionTimeStopService } from './position-time-stop.service';
import { AuditLogService } from './audit-log.service';
import { PrismaService } from '../../database/prisma.service';
import { RequireAuthGuard } from '../auth/guards/require-auth.guard';
import { PositionSyncService } from '../providers/position-sync.service';
// ⚠️ SINGLE SOURCE for the bot strength bar — see validate-threshold-sources.cjs (#839).
// The literals here were `60`, a pre-rescale value the new scale can never clear.
import { BOT_BAR_DEFAULT } from '../../common/utils/style-thresholds';
import type { CacheStats, CacheDebugEntry } from './symbol-data-cache.service';
import type { ProtocolRunConfig, RunResult } from './protocol-runner.service';
import type { QueueJob, QueueStats } from './execution-queue.service';
import type { CrossProtocolRanking } from './multi-protocol-ranking.service';

@Controller('automation')
@UseGuards(RequireAuthGuard)
export class AutomationController {
  constructor(
    private readonly cache: SymbolDataCacheService,
    private readonly runner: ProtocolRunnerService,
    private readonly queue: ExecutionQueueService,
    private readonly ranking: MultiProtocolRankingService,
    private readonly loop: AutomationLoopService,
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly positionSync: PositionSyncService,
    private readonly positionTimeStop: PositionTimeStopService,
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

  /**
   * GET /api/automation/activity — lightweight current-tick progress feed.
   * Reads the most recent automation_event rows and derives current tick/phase.
   * Designed for 3s polling from the Automation Dashboard activity widget.
   */
  @Get('activity')
  async getActivity(@Query('limit') limit?: string) {
    const take = Math.min(parseInt(limit || '30', 10) || 30, 100);
    return this.auditLog.getRecentActivity(take);
  }

  /** GET /api/automation/events — unified log of ALL automated activity */
  @Get('events')
  async getEvents(@Query('limit') limit?: string, @Query('type') type?: string) {
    const take = Math.min(parseInt(limit || '50', 10) || 50, 200);

    // Automation loop ticks
    const events: any[] = [];
    try {
      const ticks = await (this.prisma as any).automationEvent.findMany({
        orderBy: { timestamp: 'desc' },
        take: type === 'automation' ? take : Math.ceil(take / 2),
      });
      for (const t of ticks) {
        events.push({
          id: t.id, type: 'automation', taskName: t.step, status: t.decision || 'info',
          detail: t.detail?.substring?.(0, 200) || '', symbol: t.symbol, tickNumber: t.tickNumber,
          timestamp: t.timestamp, durationMs: t.durationMs,
        });
      }
    } catch { /* table may not exist yet */ }

    // Trade decisions
    try {
      const decisions = await (this.prisma as any).decisionLog.findMany({
        orderBy: { timestamp: 'desc' },
        take: type === 'decision' ? take : Math.ceil(take / 2),
      });
      for (const d of decisions) {
        events.push({
          id: d.id, type: 'decision', taskName: d.decision, status: d.decision === 'EXECUTED' ? 'success' : d.decision === 'FAILED' ? 'error' : 'info',
          detail: d.reason?.substring?.(0, 200) || '', symbol: d.symbol, tickNumber: d.tickNumber,
          timestamp: d.timestamp, composite: d.composite, price: d.price,
        });
      }
    } catch { /* table may not exist yet */ }

    // Sort by timestamp descending
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return { events: events.slice(0, take), total: events.length };
  }

  /**
   * GET /api/automation/decision-trail — walk the full audit chain.
   *
   * ?tradeTicket=123     — trace from a specific trade back through the pipeline
   * ?symbol=XAUUSD       — all trail records for a symbol
   * ?tickNumber=5        — all trail records for a tick
   * ?limit=20            — max records (default 20)
   *
   * Returns the LONG vs SHORT comparison, winner, and linked trade/scoring IDs.
   */
  @Get('decision-trail')
  async getDecisionTrail(
    @Query('tradeTicket') tradeTicket?: string,
    @Query('symbol') symbol?: string,
    @Query('tickNumber') tickNumber?: string,
    @Query('limit') limit?: string,
  ) {
    if (!this.prisma.isAvailable) {
      return { trails: [], message: 'Database unavailable' };
    }

    const take = Math.min(parseInt(limit || '20', 10) || 20, 100);

    try {
      const where: any = {};
      if (tradeTicket) where.tradeTicket = parseInt(tradeTicket, 10);
      if (symbol) where.symbol = symbol.toUpperCase();
      if (tickNumber) where.tickNumber = parseInt(tickNumber, 10);

      const trails = await (this.prisma as any).decisionTrail.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take,
      });

      return {
        trails: trails.map((t: any) => ({
          id: t.id,
          tickNumber: t.tickNumber,
          timestamp: t.timestamp,
          strategyId: t.strategyId,
          symbol: t.symbol,
          long: {
            protocolId: t.longProtocolId,
            composite: t.longComposite,
            signal: t.longSignal,
          },
          short: {
            protocolId: t.shortProtocolId,
            composite: t.shortComposite,
            signal: t.shortSignal,
          },
          winner: t.winner,
          chosenComposite: t.chosenComposite,
          finalSignal: t.finalSignal,
          reason: t.reason?.substring?.(0, 500) ?? t.reason,
          actionable: t.actionable,
          tradeTicket: t.tradeTicket,
          tradeVolume: t.tradeVolume,
          tradePrice: t.tradePrice,
          chainLinks: {
            scoreSnapshotId: t.scoreSnapshotId,
            strategyEvalId: t.strategyEvalId,
            tradeId: t.tradeId,
          },
        })),
        total: trails.length,
        filters: { tradeTicket: tradeTicket || null, symbol: symbol || null, tickNumber: tickNumber ? parseInt(tickNumber, 10) : null },
      };
    } catch (err) {
      return { trails: [], error: (err as Error).message };
    }
  }

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

    // Build lookup of dataStatus from the in-memory loop state (set during tick)
    const dataStatusMap = new Map<string, { dataStatus: string; dataStatusReason: string }>();
    for (const s of (loopState.activeStrategies || [])) {
      if (s.dataStatus) dataStatusMap.set(s.id, { dataStatus: s.dataStatus, dataStatusReason: s.dataStatusReason });
    }

    const activeStrategies: any[] = [];
    if (this.prisma.isAvailable) {
      try {
        const strategies = await (this.prisma as any).tradingStrategy.findMany({
          where: { active: true },
          include: { evaluations: { orderBy: { evaluatedAt: 'desc' }, take: 1 } },
        });
        for (const s of strategies) {
          const ds = dataStatusMap.get(s.id);
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
            dataStatus: ds?.dataStatus || 'unknown',
            dataStatusReason: ds?.dataStatusReason || 'Not yet checked',
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
      layers: {
        protocolsEnabled: loopState.protocolsEnabled ?? true,
        tradingEnabled: loopState.tradingEnabled ?? false,
      },
      // EFFECTIVE EXECUTION STATE (2026-09-10).
      //
      // `layers.tradingEnabled` alone is NOT what decides whether an order is
      // placed — Gate 7 requires the layer flag AND the per-broker flag. The UI
      // read only the layer flag, so the app could show "trading enabled" while
      // dispatching nothing but paper rows. This block states the RESULT so the
      // two can never disagree silently again.
      execution: {
        /** True only when the layer AND at least one broker allow real orders. */
        willPlaceRealOrders: Boolean(
          (loopState.tradingEnabled ?? false) &&
          Object.values(loopState.brokerStates || {}).some((bs: any) => bs?.tradingEnabled),
        ),
        mode: ((loopState.tradingEnabled ?? false) &&
          Object.values(loopState.brokerStates || {}).some((bs: any) => bs?.tradingEnabled))
          ? 'live'
          : (loopState.tradingEnabled ?? false)
            ? 'paper (no broker enabled)'
            : 'paper (trading layer off)',
        layerTradingEnabled: loopState.tradingEnabled ?? false,
       brokerTradingEnabled: Object.fromEntries(
          Object.entries(loopState.brokerStates || {}).map(([id, bs]: [string, any]) => [id, Boolean(bs?.tradingEnabled)]),
        ),
      },
      decisionLogStats: {
        persisted: loopState.decisionLogPersisted ?? 0,
        suppressed: loopState.decisionLogSuppressed ?? 0,
      },
      brokerStates: loopState.brokerStates,
      activeStrategies,
      pendingActions: loopState.pendingActions,
      activeTimelineEvents: loopState.activeTimelineEvents.slice(0, 20),
      recentDecisions: (loopState.recentDecisions || []).slice(0, 20),
      priorityQueue: loopState.priorityQueue || [],
      // ── Session-gated bots (#759) ──
      // Bots the session gate is holding shut right now. Present so a gated bot
      // is never mistaken for an idle one: before this, three of six forex bots
      // could be shut through London and the US session and every surface
      // reported nothing at all. `ambigutyHint: 'news-flow?'` means the window
      // resolved through a CITY alias, so the gate may be reading a news-flow
      // name as a trading clock — a question for the operator, not a decision
      // this endpoint makes.
      sessionGatedBots: this.loop.getSessionGated(),
      positionSync: {
        lastSyncedAt: this.positionSync.getLastSyncTime(),
        lastResult: this.positionSync.getLastSyncResult(),
      },
    };
  }

  // ── Hot Stock Priority Queue ──────────────────────────

  /** GET /api/automation/priority — list current priority queue */
  @Get('priority')
  getPriorityQueue() {
    return this.loop.getPriorityQueue();
  }

  /** POST /api/automation/priority — add a symbol to the priority queue */
  @Post('priority')
  addPriority(@Body() body: { symbol: string; scoringStrategyId: string; strategyName: string; composite: number }) {
    return this.loop.addPriority(body.symbol, body.scoringStrategyId, body.strategyName, body.composite);
  }

  /** DELETE /api/automation/priority — remove a symbol from the priority queue */
  @Delete('priority')
  removePriority(@Query('scoringStrategyId') scoringStrategyId: string, @Query('symbol') symbol: string) {
    const removed = this.loop.removePriority(scoringStrategyId, symbol);
    return { removed };
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

  /**
   * GET /api/automation/time-stop — the #773 position time-stop's state.
   *
   * ⚠️ `skipped` is the important half of this payload. Before it existed, this service's
   * state could only say "no position is past its limit", which is ALSO what it said when it
   * could not attribute a single position — so a completely dead attribution path (the order
   * comment was parsed with a format the writer has never emitted) was indistinguishable from
   * a healthy, idle service for as long as the regex stayed wrong. A skip now names its reason.
   */
  @Get('time-stop')
  timeStopStatus() {
    const s = this.positionTimeStop.state;
    return {
      enabled: s.enabled,
      dryRun: s.dryRun,
      armed: !s.dryRun,
      tickIntervalMs: s.tickIntervalMs,
      tickCount: s.tickCount,
      lastTickAt: s.lastTickAt,
      lastError: s.lastError,
      wouldClose: s.candidates.length,
      candidates: s.candidates,
      // Cannot-evaluate, with reasons. An empty array here means every position was readable.
      skippedCount: s.skipped.length,
      skipped: s.skipped,
      skippedByReason: s.skipped.reduce<Record<string, number>>((acc, k) => {
        acc[k.reason] = (acc[k.reason] ?? 0) + 1;
        return acc;
      }, {}),
      /** ⚠️ The denominator. `wouldClose: 0` with `lastSummary.positionsSeen: 0` means the READ
       *  is broken, not the limits — without this the two are the same payload. */
      lastSummary: s.lastSummary,
      closedCount: s.closedCount,
      recentCloses: s.recentCloses,
      /**
       * `POSITION_TIMESTOP_DRY_RUN !== '0'` makes dry-run the DEFAULT, and `nest/.env` sets
       * nothing — so unless the operator opts in, this reports and never closes. Stated in the
       * payload because "the control ran" and "the control did something" are not the same thing.
       */
      armHint: s.dryRun
        ? 'DRY RUN — set POSITION_TIMESTOP_DRY_RUN=0 in nest/.env and restart to arm it.'
        : null,
    };
  }

  /**
   * POST /api/automation/time-stop/run-now — evaluate once, on demand.
   *
   * The service's own comment has referenced "the manual trigger endpoint" since it was
   * written; it did not exist, so the only way to observe the time-stop was to query state and
   * wait up to 5 minutes, or read the log. This makes the dry run directly observable — which is
   * the whole point of having a dry run.
   *
   * ⚠️ If the service is ARMED this can close positions. It is a deliberate operator action.
   */
  @Post('time-stop/run-now')
  async timeStopRunNow() {
    const s = await this.positionTimeStop.tick();
    return {
      ran: true,
      dryRun: s.dryRun,
      wouldClose: s.candidates.length,
      candidates: s.candidates,
      skippedCount: s.skipped.length,
      skippedByReason: s.skipped.reduce<Record<string, number>>((acc, k) => {
        acc[k.reason] = (acc[k.reason] ?? 0) + 1;
        return acc;
      }, {}),
      lastSummary: s.lastSummary,
      closedCount: s.closedCount,
      lastError: s.lastError,
    };
  }

  /** POST /api/automation/layer — META.Stack layer kill switch (#615) */
  @Post('layer')
  async setLayer(@Body() body: { layer: string; enabled: boolean }) {
    return this.loop.setLayer(body.layer as 'protocols' | 'trading', Boolean(body.enabled));
  }

  /** GET /api/automation/paper — dry-run candidates while trading is off (#695). */
  @Get('paper')
  async getPaperTrades() {
    try {
      const recent: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, strategyId, symbol, side,
                CAST(composite AS SIGNED) AS composite,
                entryPrice, sl, tp, baseSize, protocolId,
                CAST(tickNumber AS SIGNED) AS tickNumber, createdAt
         FROM paper_trade ORDER BY createdAt DESC LIMIT 100`,
      );
      const summary: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT strategyId, symbol, side, CAST(COUNT(*) AS SIGNED) AS n,
                CAST(MAX(composite) AS SIGNED) AS maxComposite, MAX(createdAt) AS lastAt
         FROM paper_trade GROUP BY strategyId, symbol, side ORDER BY lastAt DESC LIMIT 20`,
      );
      // MySQL aggregates can surface as BigInt via raw queries — sanitize.
      const safe = (v: any): any => (typeof v === 'bigint' ? Number(v) : v);
      return {
        recent: recent.map((r: any) => ({
          id: safe(r.id),
          strategyId: safe(r.strategyId),
          symbol: safe(r.symbol),
          side: safe(r.side),
          composite: safe(r.composite),
          entryPrice: safe(r.entryPrice),
          sl: safe(r.sl),
          tp: safe(r.tp),
          baseSize: safe(r.baseSize),
          protocolId: safe(r.protocolId),
          tickNumber: safe(r.tickNumber),
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        })),
        summary: summary.map((s: any) => ({
          strategyId: safe(s.strategyId),
          symbol: safe(s.symbol),
          side: safe(s.side),
          n: safe(s.n),
          maxComposite: safe(s.maxComposite),
          lastAt: s.lastAt instanceof Date ? s.lastAt.toISOString() : String(s.lastAt ?? ''),
        })),
      };
    } catch {
      return { recent: [], summary: [] };
    }
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
        tradeThreshold: BOT_BAR_DEFAULT,
        requireConfirmation: true,
      };
    }
    this.loop.state.brokerStates[target].enabled = body.enabled ?? !this.loop.state.brokerStates[target].enabled;
    return { brokerId: target, enabled: this.loop.state.brokerStates[target].enabled };
  }

  /** POST /api/automation/config — update broker config */
  @Post('config')
  async updateConfig(@Body() body: { brokerId: string; tradingEnabled?: boolean; tradeThreshold?: number; requireConfirmation?: boolean; scoreIntervalMs?: number }) {
    // Auto-create broker state if missing
    if (!this.loop.state.brokerStates[body.brokerId]) {
      this.loop.state.brokerStates[body.brokerId] = {
        brokerId: body.brokerId,
        enabled: false,
        tradingEnabled: false,
        scoreIntervalMs: 300000,
        tradeThreshold: BOT_BAR_DEFAULT,
        requireConfirmation: true,
      };
    }
    const bs = this.loop.state.brokerStates[body.brokerId];
    if (body.tradingEnabled !== undefined) {
      bs.tradingEnabled = body.tradingEnabled;
      // PER-BROKER PERSISTENCE (2026-09-10): without this the flag lived only in
      // memory and reset to false on every restart, so automated trading shut
      // itself off silently (94 -> 9 -> 1 trades/month). Persist the explicit
      // choice so a restart restates it rather than overruling it.
      await this.loop.persistBrokerTradingFlag(body.brokerId, body.tradingEnabled);
    }
    if (body.tradeThreshold !== undefined) bs.tradeThreshold = body.tradeThreshold;
    if (body.requireConfirmation !== undefined) bs.requireConfirmation = body.requireConfirmation;
    if (body.scoreIntervalMs !== undefined) {
      bs.scoreIntervalMs = body.scoreIntervalMs;
    }
    return { brokerId: body.brokerId, config: bs };
  }

  /**
   * #714 Stage 3 — Expert Trading Bot queue configuration.
   * GET  /api/automation/bot-queue  — current settings
   * POST /api/automation/bot-queue  — { enabled?, interTradeDelayMinutes? }
   */
  @Get('bot-queue')
  getBotQueue() {
    return this.loop.getBotQueueConfig();
  }

  @Post('bot-queue')
  setBotQueue(@Body() body: { enabled?: boolean; interTradeDelayMinutes?: number }) {
    return this.loop.setBotQueueConfig(body);
  }

  // ── Scoring Strategies (CRUD kept for MetaStack versioning/UI — #295) ──
  // NOTE (2026-08-27): the LOOP no longer reads scoring strategies; these
  // endpoints manage the table only, DB-first.

  /** GET /api/automation/scoring-strategies */
  @Get('scoring-strategies')
  async getScoringStrategies() {
    try {
      return await (this.prisma as any).scoringStrategy.findMany({ orderBy: { createdAt: 'asc' } });
    } catch {
      return [];
    }
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
      tradeThreshold: body.tradeThreshold ?? BOT_BAR_DEFAULT,
      baseSize: body.baseSize ?? 0.01,
      slPct: body.slPct ?? 1.0,
      tpPct: body.tpPct ?? 1.5,
      maxPyramidTiers: body.maxPyramidTiers ?? 1,
      slTpInheritance: body.slTpInheritance ?? 'inherit',
      weightStrategy: ((body as any).weightStrategy as 'group-weighted' | 'maxscore-weighted') ?? 'group-weighted',
      enabled: true,
      tradingEnabled: false,
    };
    await this.loop.saveScoringStrategy(strat);
    return strat;
  }

  /** DELETE /api/automation/scoring-strategies/:id */
  @Delete('scoring-strategies/:id')
  async removeScoringStrategy(@Param('id') id: string) {
    await this.loop.deleteScoringStrategy(id);
    return { removed: id };
  }

  /** POST /api/automation/scoring-strategies/:id/toggle */
  @Post('scoring-strategies/:id/toggle')
  async toggleScoringStrategy(@Param('id') id: string, @Body() body: { enabled?: boolean; tradingEnabled?: boolean }) {
    const rows: any[] = await (this.prisma as any).scoringStrategy.findMany({ where: { id } });
    const s = rows[0];
    if (!s) return { error: 'Not found' };
    if (body.enabled !== undefined) s.enabled = body.enabled;
    if (body.tradingEnabled !== undefined) s.tradingEnabled = body.tradingEnabled;
    await this.loop.saveScoringStrategy(s);
    return s;
  }
}
