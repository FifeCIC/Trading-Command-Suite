/**
 * AutomationLoopService — STAGE 2+3 of the META.Stack pipeline.
 * ==============================================================
 * ROLE: Orchestrates the full tick: score → gate → evaluate → execute.
 *       Does NOT compute scores itself — delegates to ScoringService and
 *       ProtocolGatingService. Does NOT execute trades directly — delegates
 *       to TradingStrategyService.
 *
 * PIPELINE POSITION:
 *   ScoringService/ProtocolGating (Stage 1) → DB
 *   → AutomationLoop (Stage 2: gate via ScoringStrategies)
 *   → AutomationLoop (Stage 3: evaluate via TradingStrategies)
 *   → TradingStrategyService.execute() (Stage 4)
 *
 * BOUNDARY: This service READS scores and MAKES decisions. It does not
 *           compute directive-level scores or place broker orders.
 *
 * Uses manual setInterval (not @nestjs/schedule cron) for:
 *  - Dynamic interval changes per broker
 *  - Immediate pause/resume without restart
 *  - Run-on-demand from dashboard
 *
 * Tick flow:
 *   1. Check Timeline → global risk multiplier
 *   2. Fetch all broker portfolios via AdapterFactory
 *   3. Score via ScoringService.rankAll() [delegated]
 *   3b. Score watchlist symbols per ScoringStrategy with protocol gating [delegated]
 *   4. Evaluate active TradingStrategies against scored results
 *   5. Dispatch trades via TradingStrategyService [delegated]
 */

import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TimelineService } from './timeline.service';
import { ScoringService } from '../scoring/scoring.service';
import { MetaStackVersioningService } from '../scoring/metastack-versioning.service';
import { ScoringLogService } from '../system/scoring-log.service';
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { DuplicateGuardService } from '../trading/duplicate-guard.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
import { GlobalDiversificationService } from '../diversification/global-diversification.service';
import { DirectivesService } from '../directives/directives.service';
import { MarketDataService } from '../market-data/market-data.service';
import { BarRefreshService } from '../market-data/bar-refresh.service';
import { AuditLogService } from './audit-log.service';
import { JobQueueService } from './job-queue.service';
import { AbTestService } from './ab-test.service';
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { PositionSyncService } from '../providers/position-sync.service';
import { WeekendDefenseService } from '../trading/weekend-defense.service';
import { SymbolResolverService } from '../symbols/symbol-resolver.service';

/**
 * Layer 2 of the 3-layer threshold architecture.
 *
 * Layer 1 (protocol-gating.service.ts): ENTRY_THRESHOLD=40 / HOLD_FLOOR=20
 *   — global signal label classification (BUY/HOLD/SELL).
 *
 * Layer 2 (HERE): per-protocol style defaults.
 *   — selected by protocol.tradingStyle. Used as fallback when a strategy
 *     has no explicit tradeThreshold/minComposite set.
 *   — faster styles (scalp/speed) have higher bars (75-80) to reduce noise.
 *   — slower styles (swing/position) have lower bars (45-55) to capture trends.
 *
 * Layer 3 (scoring_strategy table): per-strategy tradeThreshold / minComposite.
 *   — each strategy's own execution bar. Overrides Layer 2.
 *   — this is what compareProtocolPair() checks before dispatching.
 *
 * ⚠️ SCALE WARNING (2026-08-13) ⚠️
 * These thresholds (and Layer 3's minComposite in the DB) were calibrated for
 * the OLD 0-100 composite scale. The composite is now RAW (values in the
 * hundreds — see protocol-gating.service.ts SCALE WARNING). A minComposite of
 * 55 on the old scale now passes almost any raw composite (55+), which is why
 * the app over-produced BUY signals. Do NOT tune these to new absolute values
 * — the correct fix is percentage-based thresholds (composite / maxScore × 100)
 * so custom protocols of any maxScore share the same semantics.
 */
const STYLE_THRESHOLDS: Record<string, number> = {
  scalp: 75,
  'day-trade': 65,
  speed: 80,
  swing: 55,
  position: 45,
};

function getStyleThreshold(tradingStyle?: string): number {
  const style = (tradingStyle || '').toLowerCase();
  if (style.includes('scalp') || style.includes('tick')) return STYLE_THRESHOLDS.scalp;
  if (style.includes('speed')) return STYLE_THRESHOLDS.speed;
  if (style.includes('day')) return STYLE_THRESHOLDS['day-trade'];
  if (style.includes('swing')) return STYLE_THRESHOLDS.swing;
  if (style.includes('position')) return STYLE_THRESHOLDS.position;
  return 60;
}

interface ProtocolComparison {
  side: 'BUY' | 'SELL' | 'HOLD';
  composite: number;
}

/**
 * Compare LONG vs SHORT protocol scores to determine trade direction.
 * Shared by all call sites that evaluate dual-protocol strategies.
 *
 * @param longGated  - Gated score result from the LONG protocol
 * @param shortGated - Gated score result from the SHORT protocol (null if single-protocol)
 * @param threshold  - Minimum composite score required to trigger a trade
 */
function compareProtocolPair(
  longGated: { composite: number; signal?: string; meta?: { compositePct?: number } } | null | undefined,
  shortGated: { composite: number; meta?: { compositePct?: number } } | null | undefined,
  threshold: number,
): ProtocolComparison {
  // Use the normalized 0-100 percentage when available (protocol-gating returns
  // meta.compositePct). Thresholds were calibrated for a 0-100 scale, but the raw
  // composite is now in the hundreds — comparing raw against a 0-100 threshold
  // makes every threshold trivially pass (see SCALE WARNING above). Falls back to
  // raw composite when meta.compositePct is absent.
  const longComposite = longGated?.meta?.compositePct ?? longGated?.composite ?? 0;
  const shortComposite = shortGated?.meta?.compositePct ?? shortGated?.composite ?? 0;

  if (shortGated != null) {
    // Dual-protocol: LONG vs SHORT comparison
    if (longComposite > shortComposite && longComposite >= threshold) {
      return { side: 'BUY', composite: longComposite };
    }
    if (shortComposite > longComposite && shortComposite >= threshold) {
      return { side: 'SELL', composite: shortComposite };
    }
    // Neither meets threshold — HOLD with highest composite for logging
    return { side: 'HOLD', composite: Math.max(longComposite, shortComposite) };
  }

  // Single-protocol: use the long protocol's signal, but enforce the
  // composite threshold (previously fire-on-signal-alone gap — the dual-
  // protocol branch required composite >= threshold but this branch didn't,
  // allowing below-threshold trades to execute on signal direction alone).
  const signal = (longGated as any)?.signal;
  const belowThreshold = longComposite < threshold;
  if (belowThreshold || (signal !== 'BUY' && signal !== 'SELL')) {
    return { side: 'HOLD', composite: longComposite };
  }
  return { side: signal, composite: longComposite };
}

export interface PriorityQueueEntry {
  scoringStrategyId: string;
  symbol: string;
  strategyName: string;
  composite: number;
  createdAt: string;
  expiresAt: string;
}

export interface LoopState {
  loopEnabled: boolean;
  tickIntervalMs: number;
  lastTickAt: string | null;
  nextTickAt: string | null;
  tickCount: number;
  lastTickMs: number;
  brokerStates: Record<string, BrokerLoopState>;
  activeStrategyIds: string[];
  activeStrategies: any[];
  pendingActions: PendingAction[];
  activeTimelineEvents: any[];
  globalRiskMultiplier: number;
  recentDecisions: TickDecision[];
  priorityQueue: PriorityQueueEntry[];
  /** #615 — META.Stack layer kill switches (mandate hierarchy). */
  protocolsEnabled: boolean;
  tradingEnabled: boolean;
  /** #704 — decision_log write-on-change counters. */
  decisionLogPersisted: number;
  decisionLogSuppressed: number;
}

export interface BrokerLoopState {
  brokerId: string;
  enabled: boolean;
  tradingEnabled: boolean;
  scoreIntervalMs: number;
  tradeThreshold: number;
  requireConfirmation: boolean;
}

export interface PendingAction {
  id: string;
  strategyId: string;
  symbol: string;
  brokerId: string;
  side: string;
  quantity: number;
  composite: number;
  createdAt: string;
  expiresAt: string;
  evaluationId?: string;
}

export interface ScoringStrategy {
  id: string;
  name: string;
  protocolId: string;
  shortProtocolId?: string;
  watchlistName: string;
  brokerId: string;
  mode: 'manual' | 'semi-auto' | 'auto';
  tradeThreshold: number;
  baseSize: number;
  slPct: number;
  tpPct: number;
  maxPyramidTiers: number;
  slTpInheritance: string;
  weightStrategy: 'group-weighted' | 'maxscore-weighted';
  enabled: boolean;
  tradingEnabled: boolean;
}

export interface TickDecision {
  timestamp: string;
  strategyId: string;
  symbol: string;
  brokerId: string;
  decision: 'SCORED' | 'SKIP' | 'SIGNAL' | 'QUEUED' | 'EXECUTED' | 'FAILED' | 'BLOCKED' | 'PYRAMID';
  reason: string;
  composite: number;
  signal?: string;
  ticket?: string | number;
  price?: number;
  quantity?: number;
  actionId?: string;
}

// ── Watchlist helpers ─────────────────────────────────
// Phase A.4: DB-first with JSON file fallback.
// Kept for bootstrap scenarios where the watchlist table hasn't been seeded yet.

const WATCHLISTS_DIR = resolve(__dirname, '../../../../src/data/watchlists');

/** Fallback: read watchlist symbols from a JSON file. Returns null if file not found or unparseable. */
function readWatchlistFromFile(name: string): string[] | null {
  try {
    const path = resolve(WATCHLISTS_DIR, `${name}.json`);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean);
    if (data.symbols && Array.isArray(data.symbols)) return data.symbols.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean);
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class AutomationLoopService implements OnModuleInit {
  private readonly logger = new Logger(AutomationLoopService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastAnyTradeAt: number = 0;
  private lastTradeTime = new Map<string, number>();
  /** Per-symbol trade cooldown — allows multiple symbols to trade per tick. */
  private lastSymbolTrade = new Map<string, number>();
  /** #704 — last-persisted decision signature per strategy|symbol (write-on-change). */
  private lastDecisionWrite = new Map<string, string>();
  /** #695 — last paper-trade signature per strategy|symbol (dry-run dedupe). */
  private lastPaperSig = new Map<string, string>();

  /** Tracks repeated errors across ticks to suppress duplicate logging.
   *  Key = `${strategyId}:${symbol}:${errorMessage}` */
  private suppressedErrors = new Map<string, { lastTick: number; count: number; firstSeenAt: Date }>();

  /** Per-tick cache of protocol-gated scores. Key = `${symbol}|${protocolId}`.
   *  Populated by step 3b, consumed by step 4 to avoid redundant directive execution. */
  private gatedScoreCache = new Map<string, import('../scoring/protocol-gating.service').GatedScore>();

  /** Get watchlist symbols — DB-first with case-insensitive matching + JSON fallback. */
  private async getWatchlistSymbols(name: string): Promise<string[] | null> {
    // Try DB — case-insensitive, normalizes hyphens/underscores to spaces
    try {
      if (this.prisma.isAvailable) {
        // Normalize name for fuzzy matching: replace hyphens/underscores with spaces
        const normalized = name.replace(/[-_]/g, ' ').toLowerCase();
        const wl = await this.prisma.$queryRawUnsafe<Array<{ name: string; symbols: string }>>(
          `SELECT name, symbols FROM watchlist WHERE LOWER(REPLACE(REPLACE(name, '-', ' '), '_', ' ')) = ? LIMIT 1`,
          normalized,
        );
        if (wl.length > 0 && wl[0].symbols) {
          const symbols = typeof wl[0].symbols === 'string' ? JSON.parse(wl[0].symbols) : wl[0].symbols;
          if (Array.isArray(symbols)) {
            const result = symbols.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean);
            if (result.length > 0) return result;
          }
        }
      }
    } catch { /* DB may not be available yet */ }

    // Fall back to JSON file for bootstrap / unseeded watchlists
    const fromFile = readWatchlistFromFile(name);
    if (fromFile && fromFile.length > 0) {
      this.logger.debug(`Watchlist "${name}": loaded from JSON file (DB fallback)`);
    }
    return fromFile;
  }

  /**
   * Shared trade dispatch — STEP 5 of 5 in the tick lifecycle.
   *
   * PIPELINE POSITION:
   *   Step 1: Timeline risk check → global risk multiplier
   *   Step 2: Fetch positions + load active strategies
   *   Step 3: Score symbols via SEES (rankAll / protocol-gating)
   *   Step 4: evaluateStrategy() → compareProtocolPair() → decides BUY/SELL/HOLD
   *   Step 5 (HERE): dispatchTrade() — gates + execution
   *
   * SAFETY GATES (in order — each must pass before the next is checked):
   *   1. Symbol cooldown (60s): prevents re-trading the same symbol too fast
   *   2. Global cooldown (3s): prevents burst trading across all symbols
   *   3. Duplicate guard: blocks if a position already exists for this symbol
   *   4. Diversification check: blocks if portfolio is over-concentrated
   *   5. Mode dispatch: manual=log only, semi-auto=queue, auto=execute
   *
   * Phase B.2: extracted from step 3b so scoring never trades directly.
   * Portfolio snapshot (#477) captured on successful execution.
   */
  private async dispatchTrade(params: {
    strategyId: string;
    strategyName: string;
    symbol: string;
    brokerId: string;
    side: 'BUY' | 'SELL';
    composite: number;
    baseSize: number;
    slPct: number;
    tpPct: number;
    entryPrice: number;
    mode: string;
    protocolId: string | null;
    decisions: TickDecision[];
  }): Promise<void> {
    const { strategyId, strategyName, symbol, brokerId, side, composite, baseSize, slPct, tpPct, entryPrice, mode, protocolId, decisions } = params;

    // #615 mandate: Trading layer OFF → signals still generated, never dispatched.
    if (!this.state.tradingEnabled) {
      this.auditLog.logBlocked(this.state.tickCount, strategyId, symbol, 'Trading layer disabled — dispatch blocked');
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason: 'Trading layer disabled', composite, signal: side });
      return;
    }

    // Cooldown checks
    const lastSymTrade = this.lastSymbolTrade.get(symbol);
    if (lastSymTrade && (Date.now() - lastSymTrade) < 60000) {
      this.auditLog.logSkip(this.state.tickCount, strategyId, symbol, `${symbol} traded ${Math.round((Date.now()-lastSymTrade)/1000)}s ago`);
      return;
    }
    if (this.lastAnyTradeAt && (Date.now() - this.lastAnyTradeAt) < 3000) {
      this.auditLog.logSkip(this.state.tickCount, strategyId, symbol, 'Global safety cooldown (3s)');
      return;
    }

    // Duplicate guard
    const dupCheck = await this.duplicateGuard.checkDuplicate(symbol, brokerId, protocolId ?? undefined);
    if (dupCheck.blocked) {
      this.auditLog.logBlocked(this.state.tickCount, strategyId, symbol, dupCheck.reason || 'Duplicate position');
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason: dupCheck.reason || 'Duplicate position', composite, signal: side });
      return;
    }

    // Global diversification check
    const divCheck = await this.diversification.checkPreTrade(symbol, brokerId);
    if (divCheck.blocked) {
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason: `Diversification: ${divCheck.reason}`, composite, signal: side });
      return;
    }
    if (divCheck.severity === 'warn') {
      this.logger.warn(`Diversification: ${divCheck.reason}`);
    }

    const broker = this.adapterFactory.create(brokerId);
    if (!broker?.placeOrder) return;

    const sl = side === 'BUY' ? entryPrice * (1 - slPct/100) : entryPrice * (1 + slPct/100);
    const tp = side === 'BUY' ? entryPrice * (1 + tpPct/100) : entryPrice * (1 - tpPct/100);

    if (mode === 'semi-auto') {
      const aid = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      this.state.pendingActions.push({
        id: aid, strategyId, symbol, brokerId,
        side, quantity: baseSize, composite,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5*60000).toISOString(),
      });
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'QUEUED', reason: 'Awaiting confirmation', composite, signal: side, actionId: aid });
      return;
    }

    // Auto-execute
    this.auditLog.logDispatch(this.state.tickCount, strategyId, symbol, side, baseSize, sl, tp, entryPrice);
    const result = await broker.placeOrder({
      symbol, side: side as 'BUY'|'SELL', quantity: baseSize, sl, tp,
      // Name only — the sanitizer strips '|'/'%', so "| composite%" polluted
      // the strategy name parsed back on close (see mt5-comment.util.ts).
      comment: `TCS ${strategyName}`,
    });
    this.auditLog.logOrderResult(this.state.tickCount, strategyId, symbol,
      result.success, result.ticket as number|undefined,
      result.error, result.price);
    if (result.success) {
      this.lastAnyTradeAt = Date.now();
      this.lastSymbolTrade.set(symbol, Date.now());
      try {
        await this.tradeRecorder.record({
          symbol, side: side.toLowerCase(), quantity: baseSize,
          entryPrice: result.price || entryPrice || 0, pnl: 0,
          provider: brokerId, status: 'open', origin: 'strategy',
          source: 'meta-stack',
          scoringStrategyId: strategyId,
          ticket: result.ticket as number | undefined,
          sl, tp,
          brokerComment: `TCS ${strategyName}`,
        } as any);
      } catch {}
      // ── Trade-point portfolio snapshot (#477) ──
      // Captures the full portfolio picture at the moment of trade
      // for later "why was this trade placed?" analysis.
      try {
        const allPos = await this.fetchAllPositions();
        this.capturePortfolioSnapshot(allPos, this.state.tickCount, 'trade');
      } catch { /* non-critical */ }
    }
    decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: result.success?'EXECUTED':'FAILED', reason: result.success?`Ticket ${result.ticket}`:(result.error||'Unknown'), composite, signal: side, ticket: result.ticket, price: result.price, quantity: baseSize });
  }

  state: LoopState = {
    loopEnabled: false,
    tickIntervalMs: 120000,  // 2 min — fast enough for intraday, slow enough to avoid rate limits
    lastTickAt: null,
    nextTickAt: null,
    tickCount: 0,
    lastTickMs: 0,
    brokerStates: {},
    activeStrategyIds: [],
    activeStrategies: [],
    pendingActions: [],
    activeTimelineEvents: [],
    globalRiskMultiplier: 1.0,
    recentDecisions: [],
    priorityQueue: [],
    // #615 safe defaults: scoring ON, trading OFF until explicitly enabled.
    protocolsEnabled: true,
    tradingEnabled: false,
    decisionLogPersisted: 0,
    decisionLogSuppressed: 0,
  };

  /**
   * NOTE (2026-08-27, user-approved): the Scoring Strategy middle layer is
   * no longer consumed by the loop. The pipeline is Protocol → Trading
   * Strategy → Execution. The scoring_strategy table remains for MetaStack
   * versioning/performance (#295) but the loop does not read it.
   */

  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly timelineService: TimelineService,
    private readonly scoringService: ScoringService,
    private readonly strategyService: TradingStrategyService,
    private readonly tradeRecorder: TradeRecorderService,
    private readonly duplicateGuard: DuplicateGuardService,
    private readonly scoringLog: ScoringLogService,
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly diversification: GlobalDiversificationService,
    private readonly marketData: MarketDataService,
    private readonly barRefresh: BarRefreshService,
    private readonly auditLog: AuditLogService,
    private readonly directivesService: DirectivesService,
    private readonly protocolDb: ProtocolDbService,
    private readonly versioningService: MetaStackVersioningService,
    private readonly positionSync: PositionSyncService,
    private readonly weekendDefense: WeekendDefenseService,
    private readonly symbolResolver: SymbolResolverService,
    private readonly jobQueue: JobQueueService,
    private readonly abTestService: AbTestService,
  ) {
    this.initBrokerStates();
  }

  async onModuleInit() {
    // #615 — restore layer kill switches (fail-safe defaults: protocols ON, trading OFF).
    await this.restoreLayerFlags();

    // Auto-restore the loop ONLY if AUTO_START_AUTOMATION is explicitly 'true' (fail-closed).
    // Trading is NEVER auto-enabled regardless — it resets to false on every restart.
    const autoStart = process.env.AUTO_START_AUTOMATION === 'true';
    if (!autoStart) {
      this.logger.log('Auto-start disabled (AUTO_START_AUTOMATION !== "true") — loop requires manual start');
      return;
    }
    // Wait for DB
    let attempts = 0;
    while (!this.prisma.isAvailable && attempts < 10) {
      await new Promise(r => setTimeout(r, 2000));
      attempts++;
    }
    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable after 20s — skipping auto-restore');
      return;
    }
    this.logger.log('Auto-start enabled — restoring automation state...');
    // Re-init broker states now that ProvidersModule has registered adapters
    this.initBrokerStates();
    // Ensure MT5 broker state exists (auto-create if missing) — but NEVER
    // auto-enable trading. Trading must be explicitly enabled by the user via
    // POST /api/automation/config { tradingEnabled: true }.
    // ⚠️ Previous code forced tradingEnabled=true here on every restart, which
    // re-enabled auto-trading and caused unexpected MT5 positions (2026-08-12).
    if (!this.state.brokerStates['mt5']) {
      this.state.brokerStates['mt5'] = {
        brokerId: 'mt5',
        enabled: true,
        tradingEnabled: false, // NEVER auto-trade — user must opt in
        scoreIntervalMs: 300000,
        tradeThreshold: 3,
        requireConfirmation: true,
      };
      this.logger.log('Auto-created MT5 broker state (was missing after initBrokerStates)');
    }
    try {
      const strategies = await this.strategyService.findAll();
      for (const s of strategies) {
        if (s.active && !(s as any).brokerId) {
          await this.strategyService.update(s.id, { brokerId: 'mt5' } as any);
        }
      }
    } catch (e) { this.logger.warn(`Failed to patch strategies: ${(e as Error).message}`); }
    await this.restorePendingActions();
    await this.restoreThrottleState();
    this.barRefresh.start(300_000);  // Refresh marketBar data every 5 min

    // Register the first real job-queue handler (#614 Phase 0) — 'fetch-bars'
    // dispatches to BarRefreshService, proving the queue → service path.
    this.jobQueue.registerHandler('fetch-bars', async (job) => {
      const payload = (job.payload ?? {}) as any;
      const result = await this.barRefresh.refresh();
      this.logger.log(
        `JobQueue[fetch-bars] ${payload?.symbol ? `(${payload.symbol}) ` : ''}refreshed ${result.upserted} bars for ${result.symbols.length} symbols`,
      );
    });

    this.start();
  }

  private initBrokerStates() {
    const brokers = this.adapterFactory.getBrokerageAdapters();
    for (const broker of brokers) {
      const id = broker.id || 'unknown';
      if (!this.state.brokerStates[id]) {
        this.state.brokerStates[id] = {
          brokerId: id,
          enabled: id === 'trading212', // Only T212 enabled by default for now
          tradingEnabled: false, // NEVER auto-trade by default
          scoreIntervalMs: 300000,
          tradeThreshold: getStyleThreshold(), // Per-protocol — updated when strategies load
          requireConfirmation: true,
        };
      }
    }
  }

  // ── DB Persistence ──────────────────────────────────

  /**
   * Persist a scoring strategy to DB. Kept for the CRUD endpoints and the
   * MetaStack versioning/performance systems (#295) — the LOOP no longer
   * reads scoring strategies (2026-08-27 decision: pipeline is
   * Protocol → Trading Strategy → Execution).
   */
  async saveScoringStrategy(strat: ScoringStrategy) {
    try {
      if (!this.prisma.isAvailable) return;
      await this.prisma.scoringStrategy.upsert({
        where: { id: strat.id },
        create: {
          id: strat.id, name: strat.name, protocolId: strat.protocolId,
          shortProtocolId: strat.shortProtocolId ?? null,
          watchlistName: strat.watchlistName, brokerId: strat.brokerId,
          mode: strat.mode, tradeThreshold: strat.tradeThreshold,
          baseSize: strat.baseSize, slPct: strat.slPct, tpPct: strat.tpPct,
          maxPyramidTiers: strat.maxPyramidTiers ?? 1,
          slTpInheritance: strat.slTpInheritance ?? 'inherit',
          weightStrategy: strat.weightStrategy ?? 'group-weighted',
          enabled: strat.enabled, tradingEnabled: strat.tradingEnabled,
        },
        update: {
          name: strat.name, protocolId: strat.protocolId,
          shortProtocolId: strat.shortProtocolId ?? null,
          watchlistName: strat.watchlistName, brokerId: strat.brokerId,
          mode: strat.mode, tradeThreshold: strat.tradeThreshold,
          baseSize: strat.baseSize, slPct: strat.slPct, tpPct: strat.tpPct,
          maxPyramidTiers: strat.maxPyramidTiers ?? 1,
          slTpInheritance: strat.slTpInheritance ?? 'inherit',
          weightStrategy: strat.weightStrategy ?? 'group-weighted',
          enabled: strat.enabled, tradingEnabled: strat.tradingEnabled,
        },
      });
      // Auto-create version snapshot on strategy save (#481)
      this.versioningService.createSnapshot(strat.id, 'auto-save').catch(err =>
        this.logger.warn(`Auto-snapshot failed for ${strat.id}: ${(err as Error).message}`),
      );
    } catch (err) {
      this.logger.warn(`Failed to save scoring strategy ${strat.id}: ${(err as Error).message}`);
    }
  }

  /** Delete a scoring strategy from DB */
  async deleteScoringStrategy(id: string) {
    try {
      if (!this.prisma.isAvailable) return;
      await this.prisma.scoringStrategy.delete({ where: { id } });
    } catch (err) {
      this.logger.warn(`Failed to delete scoring strategy ${id}: ${(err as Error).message}`);
    }
  }

  // ── State Persistence (#352) ──────────────────────────

  /** Persist a pending action to DB so it survives restarts. */
  private async persistPendingAction(action: PendingAction): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      await (this.prisma as any).pendingAction.create({
        data: {
          id: action.id, strategyId: action.strategyId, symbol: action.symbol,
          brokerId: action.brokerId, side: action.side, quantity: action.quantity,
          composite: action.composite, createdAt: new Date(action.createdAt),
          expiresAt: new Date(action.expiresAt), status: 'pending',
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to persist pending action: ${(err as Error).message}`);
    }
  }

  /** Remove a pending action from DB (when executed or expired). */
  private async removePendingAction(id: string): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      await (this.prisma as any).pendingAction.update({
        where: { id }, data: { status: 'executed' },
      });
    } catch { /* may not exist */ }
  }

  /** Restore pending actions from DB on startup. */
  private async restorePendingActions(): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      const rows = await (this.prisma as any).pendingAction.findMany({
        where: { status: 'pending', expiresAt: { gt: new Date() } },
      });
      for (const r of rows) {
        this.state.pendingActions.push({
          id: r.id, strategyId: r.strategyId, symbol: r.symbol,
          brokerId: r.brokerId, side: r.side, quantity: r.quantity,
          composite: r.composite, createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
        });
      }
      if (rows.length > 0) {
        this.logger.log(`Restored ${rows.length} pending actions from DB`);
      }
    } catch (err) {
      this.logger.warn(`Failed to restore pending actions: ${(err as Error).message}`);
    }
  }

  /** Restore throttle state from decision_log on startup. */
  private async restoreThrottleState(): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      // Restore lastAnyTradeAt from most recent EXECUTED decision
      const lastExec = await (this.prisma as any).decisionLog.findFirst({
        where: { decision: 'EXECUTED' },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      });
      if (lastExec) {
        this.lastAnyTradeAt = new Date(lastExec.timestamp).getTime();
      }

      // Restore per-symbol last trade times
      const recentTrades = await (this.prisma as any).decisionLog.findMany({
        where: { decision: 'EXECUTED' },
        orderBy: { timestamp: 'desc' },
        select: { symbol: true, timestamp: true },
        take: 100,
      });
      const seen = new Set<string>();
      for (const t of recentTrades) {
        if (!seen.has(t.symbol)) {
          seen.add(t.symbol);
          this.lastSymbolTrade.set(t.symbol, new Date(t.timestamp).getTime());
        }
      }
      if (seen.size > 0) {
        this.logger.log(`Restored throttle state: lastAnyTradeAt=${this.lastAnyTradeAt ? new Date(this.lastAnyTradeAt).toISOString() : 'none'}, ${seen.size} symbols`);
      }
    } catch (err) {
      this.logger.warn(`Failed to restore throttle state: ${(err as Error).message}`);
    }
  }

  // ── Lifecycle ────────────────────────────────────────

  start(): { started: boolean; message: string } {
    if (this.timer) {
      return { started: false, message: 'Loop is already running' };
    }
    this.state.loopEnabled = true;
    this.initBrokerStates();
    this.timer = setInterval(() => this.tick(), this.state.tickIntervalMs);
    this.state.nextTickAt = new Date(Date.now() + this.state.tickIntervalMs).toISOString();
    this.logger.log(`Automation loop started — interval ${this.state.tickIntervalMs}ms`);
    // Fire an immediate tick so we don't wait 5 min after restart
    this.tick().catch(err => this.logger.error(`Initial tick failed: ${(err as Error).message}`));
    return { started: true, message: `Loop started — ${this.state.tickIntervalMs}ms interval` };
  }

  stop(): { stopped: boolean; message: string } {
    if (!this.timer) {
      return { stopped: false, message: 'Loop is not running' };
    }
    clearInterval(this.timer);
    this.timer = null;
    this.state.loopEnabled = false;
    this.state.nextTickAt = null;
    this.logger.log('Automation loop stopped');
    return { stopped: true, message: 'Loop stopped' };
  }

  // ── Hot Stock Priority Queue ─────────────────────────

  /**
   * Add a symbol/scoring-strategy pair to the priority queue.
   * The automation loop will evaluate these strategies FIRST on each tick.
   * Max 3 entries. Expiry: configurable (default 15 minutes).
   */
  addPriority(symbol: string, scoringStrategyId: string, strategyName: string, composite: number): { ok: boolean; reason?: string } {
    // Clean expired entries
    this.cleanPriorityQueue();

    if (this.state.priorityQueue.length >= 3) {
      return { ok: false, reason: 'Priority queue full (max 3). Wait for an entry to expire or be consumed.' };
    }

    const exists = this.state.priorityQueue.find(e => e.scoringStrategyId === scoringStrategyId && e.symbol === symbol);
    if (exists) {
      return { ok: false, reason: `${symbol} is already prioritized for this strategy.` };
    }

    this.state.priorityQueue.push({
      scoringStrategyId,
      symbol,
      strategyName,
      composite,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    });

    this.logger.log(`⚡ Priority boost: ${symbol} via ${strategyName} (composite ${composite})`);
    return { ok: true };
  }

  /** Remove a specific priority entry. */
  removePriority(scoringStrategyId: string, symbol: string): boolean {
    const before = this.state.priorityQueue.length;
    this.state.priorityQueue = this.state.priorityQueue.filter(
      e => !(e.scoringStrategyId === scoringStrategyId && e.symbol === symbol)
    );
    return this.state.priorityQueue.length < before;
  }

  /** Remove all expired priority entries. Returns count of removed entries. */
  cleanPriorityQueue(): number {
    const before = this.state.priorityQueue.length;
    const now = Date.now();
    const removed: PriorityQueueEntry[] = [];
    this.state.priorityQueue = this.state.priorityQueue.filter(e => {
      const expired = new Date(e.expiresAt).getTime() < now;
      if (expired) removed.push(e);
      return !expired;
    });
    if (removed.length > 0) {
      this.logger.log(`Priority queue: ${removed.length} entries expired (${removed.map(e => e.symbol).join(', ')})`);
    }
    return before - this.state.priorityQueue.length;
  }

  /** Get current priority queue entries. */
  getPriorityQueue(): PriorityQueueEntry[] {
    this.cleanPriorityQueue();
    return [...this.state.priorityQueue];
  }

  /** Reorder active strategies so prioritized ones come first. */
  private getPrioritizedStrategies(activeStrategies: any[]): any[] {
    if (this.state.priorityQueue.length === 0) return activeStrategies;

    const prioritized = new Set(
      this.state.priorityQueue.map(e => e.scoringStrategyId)
    );

    const priorityItems = activeStrategies.filter(s => prioritized.has(s.scoringStrategyId || s.id));
    const remaining = activeStrategies.filter(s => !prioritized.has(s.scoringStrategyId || s.id));

    return [...priorityItems, ...remaining];
  }

  setIntervalMs(ms: number): void {
    this.state.tickIntervalMs = Math.max(15000, Math.min(3600000, ms)); // 15s - 60m
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), this.state.tickIntervalMs);
    }
    this.logger.log(`Loop interval changed to ${this.state.tickIntervalMs}ms`);
  }

  // ── Core Tick ────────────────────────────────────────

  async tick(): Promise<TickDecision[]> {
    const tickStart = Date.now();
    this.state.tickCount++;
    this.state.lastTickAt = new Date().toISOString();
    const decisions: TickDecision[] = [];
    const trailRecords: any[] = [];  // DecisionTrail rows (#474)
    this.directivesService.clearTickCache();
    this.gatedScoreCache.clear();
    this.protocolDb.clearCache();
    this.auditLog.logTickStart(this.state.tickCount);

    // #615 mandate: Protocols OFF → no scoring, no trading.
    if (!this.state.protocolsEnabled) {
      this.auditLog.logSkip(this.state.tickCount, 'protocols-layer', '—', 'Protocols layer disabled — scoring skipped');
      this.logger.log(`Tick #${this.state.tickCount} skipped — protocols layer disabled`);
      return decisions;
    }

    // Phase 0 job queue (#614) — poll due jobs once per tick.
    // Non-blocking best-effort: the queue has its own retry/backoff.
    this.jobQueue.pollDueJobs().catch(err =>
      this.logger.warn(`Job queue poll failed: ${(err as Error).message}`));

    // Collect positions across all brokers for scoring + snapshot
    let allPositions: any[] = [];

    try {
      // 1. Check Timeline
      const events = await this.timelineService.getActiveEvents(120);
      this.state.activeTimelineEvents = events;
      const globalEvents = events.filter(e => e.scope === 'global');
      this.state.globalRiskMultiplier = this.timelineService.computeRiskMultiplier(globalEvents);
      this.logger.log(`Tick #${this.state.tickCount}: ${events.length} timeline events, global risk ${this.state.globalRiskMultiplier.toFixed(2)}`);

      // 1b. Weekend defense check — Wed (triple-swap) and Fri (weekend gap)
      const today = new Date().getUTCDay();
      if (today === 3 || today === 5) {
        const mt5Positions = allPositions.filter((p: any) => p.type !== undefined);
        if (mt5Positions.length > 0) {
          try {
            const checklist = await this.weekendDefense.buildChecklist(
              mt5Positions.map((p: any) => ({
                symbol: p.symbol,
                ticket: p.ticket,
                type: p.type,
                volume: p.volume,
                price_open: p.price_open,
                price_current: p.price_current,
                profit: p.profit || 0,
                swap: p.swap || 0,
              }))
            );
            const toClose = checklist.positions.filter(p => p.recommendation === 'CLOSE');
            const toReduce = checklist.positions.filter(p => p.recommendation === 'REDUCE');
            if (toClose.length > 0) {
              this.logger.warn(`⚠️ Weekend Defense: ${toClose.length} position(s) should be CLOSED — ${toClose.map(p => `${p.symbol} (swap drag)`).join(', ')}`);
            }
            if (toReduce.length > 0) {
              this.logger.log(`🟡 Weekend Defense: ${toReduce.length} position(s) should be REDUCED — ${toReduce.map(p => p.symbol).join(', ')}`);
            }
            this.logger.log(`Weekend Defense: ${checklist.summary.totalPositions} positions, $${checklist.totalSwapCostTonight.toFixed(2)} swap tonight, $${checklist.totalGapRisk.toFixed(2)} gap risk`);
          } catch (err) {
            this.logger.warn(`Weekend defense check skipped: ${(err as Error).message}`);
          }
        }
      }

      // 2. Fetch portfolios from all enabled brokers
      allPositions = [];
      for (const [brokerId, brokerState] of Object.entries(this.state.brokerStates)) {
        if (!brokerState.enabled) continue;
        const adapter = this.adapterFactory.create(brokerId);
        if (!adapter?.supportsBrokerage || !adapter.getPositions) continue;

        try {
          const positions = await adapter.getPositions();
          this.logger.log(`  ${brokerId}: ${positions.length} positions`);
          allPositions.push(...positions);

          // Sync positions → DB (two-way data flow #470, broker-agnostic)
          const normalised = positions.map((p: any) => ({
            symbol: p.symbol,
            brokerTicket: String(p.ticket ?? p.id ?? ''),
            quantity: p.quantity,
            avgPrice: p.avgCost ?? p.entryPrice ?? 0,
            currentPrice: p.currentPrice ?? p.avgCost ?? 0,
            pnl: p.unrealizedPnl ?? p.pnl ?? 0,
            sl: p.sl ?? null,
            tp: p.tp ?? null,
            comment: p.comment ?? '',
            openedAt: p.openedAt ? new Date(p.openedAt) : new Date(),
          }));
          this.positionSync.syncPositions(brokerId, normalised).catch(err =>
            this.logger.warn(`Position sync [${brokerId}] failed: ${(err as Error).message}`));
        } catch (err) {
          this.logger.warn(`  ${brokerId}: failed to fetch positions — ${(err as Error).message}`);
        }
      }

      // 2b. Discover active TradingStrategy records from DB
      let activeStrategies: any[] = [];
      try {
        const all = await this.strategyService.findAll();
        activeStrategies = all.filter((s: any) => s.active);

        // ── Data Readiness Check: annotate each strategy with dataStatus ──
        for (const strat of activeStrategies) {
          try {
            // Protocol resolved from the trading strategy itself (2026-08-27)
            const protocolId = strat.protocolId;
            if (!protocolId) {
              strat.dataStatus = 'blocked';
              strat.dataStatusReason = 'No protocol linked';
              continue;
            }
            const requiredBars = this.protocolDb.getRequiredBars(protocolId);
            const timeframe = this.protocolDb.getCached(protocolId)?.recommendedTimeframe || '1d';
            const minBarsNeeded = requiredBars[timeframe] || 100;

            const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: strat.symbol } });
            if (!dbSym) {
              strat.dataStatus = 'pending_bars';
              strat.dataStatusReason = `Symbol ${strat.symbol} not in registry`;
              continue;
            }

            const existingBars = await this.marketData.getBarCount(dbSym.id, timeframe);
            if (existingBars >= minBarsNeeded) {
              strat.dataStatus = 'ready';
              strat.dataStatusReason = `${existingBars}/${minBarsNeeded} bars available`;
            } else if (existingBars > 0) {
              strat.dataStatus = 'pending_bars';
              strat.dataStatusReason = `Accumulating bars: ${existingBars}/${minBarsNeeded} (${timeframe})`;
            } else {
              strat.dataStatus = 'pending_bars';
              strat.dataStatusReason = `Waiting for first bars (${timeframe})`;
            }
          } catch {
            strat.dataStatus = 'pending_bars';
            strat.dataStatusReason = 'Unable to verify data readiness';
          }
        }

        this.state.activeStrategies = activeStrategies;
        this.logger.log(`  ${activeStrategies.length} active strategies loaded`);
      } catch (err) {
        this.logger.warn(`  Failed to load strategies: ${(err as Error).message}`);
      }
      this.state.activeStrategyIds = activeStrategies.map((s: any) => s.id);

      // ── Priority reorder: put prioritized strategies first ──
      this.cleanPriorityQueue();
      activeStrategies = this.getPrioritizedStrategies(activeStrategies);

      // Collect symbols from active strategies via shared resolver
      const strategySymbols = await this.symbolResolver.getSymbolsByTier('active-strategies');
      // Combine with live broker positions for the full working set
      const allSymbols = [...new Set([...allPositions.map(p => p.symbol), ...strategySymbols])];

      // NOTE: no early-return when allSymbols is empty. Protocol-driven
      // scoring (step 3b) must run even with 0 positions/strategies — the
      // protocols are the live scoring path right now, and an early return
      // here made every active protocol silently stop scoring. Step 4 is
      // gated on the working set below instead.

      // 3. REMOVED: rankAll() — ran all 104 directives against every symbol.
      //    This produced thousands of noisy scores (EURUSD=3291, etc.) that had
      //    no protocol scoping and confused the pipeline. Protocol-gating (step 3b)
      //    is the single source of truth for SEES scores now.
      //    See: 2026-08-11 — automation loop protocol-driven refactor.

      // ── Helper: get or compute a gated score for a symbol+protocol pair ──
      const getGatedScore = async (sym: string, protocolId: string, bars: any[], ws: 'group-weighted' | 'maxscore-weighted' = 'group-weighted'): Promise<any> => {
        const cacheKey = `${sym}|${protocolId}|${ws}`;
        const cached = this.gatedScoreCache.get(cacheKey);
        if (cached) return cached;
        const result = await this.protocolGating.scoreWithGating(sym, bars, protocolId, undefined, ws);
        if (result && result.composite !== undefined) {
          this.gatedScoreCache.set(cacheKey, result);
        }
        return result;
      };

      // ═══════════════════════════════════════════════════════════════════════
      // 3b. Protocol-driven scoring — iterate ACTIVE PROTOCOLS directly.
      //
      // DEVELOPMENT PHASE (2026-08-11): We are NOT using Scoring Strategies yet.
      // Scoring Strategies are a future layer that will gate & route protocol
      // scores into trading decisions. For now, protocols are scored independently
      // and results are logged for observability / debugging.
      //
      // Each protocol resolves its symbols via ProtocolDbService.resolveSymbols():
      //   - Single-symbol protocols (xau-speed-v1 → XAUUSD, spy-speed-v1 → SPY)
      //     use the auto-derived symbol from the protocol ID.
      //   - Multi-symbol protocols (forex-session-v1) use a linked watchlist.
      //
      // Results are cached in gatedScoreCache for potential future use by step 4.
      // ═══════════════════════════════════════════════════════════════════════
      const activeProtocols = await this.protocolDb.findAllActive();

      // Readiness gate (#627): a protocol is only eligible to score when every
      // included directive is 'ready'. Beta directives block the protocol.
      //
      // Scoring-status tracking — persisted below so protocol views can
      // explain WHY a protocol isn't scoring. States:
      //   scoring | no-symbols | no-data | paused | error (absent = pending).
      const scoringStatus = new Map<string, {
        state: string;
        reason?: string;
        symbolsResolved?: number;
        symbolsScored?: number;
      }>();
      const readyProtocols: string[] = [];
      for (const slug of activeProtocols) {
        try {
          const readiness = await this.protocolGating.assessReadiness(slug);
          if (readiness.ready) {
            readyProtocols.push(slug);
          } else {
            const blockerText = readiness.blockers
              .map((b) => `${b.directiveId} (${b.readiness})`)
              .join(', ');
            this.logger.warn(`  Protocol "${slug}" PAUSED — non-ready directives: ${blockerText}`);
            scoringStatus.set(slug, { state: 'paused', reason: `Non-ready directives: ${blockerText}` });
          }
        } catch (e) {
          this.logger.warn(`  Protocol "${slug}" readiness check failed: ${(e as Error).message}`);
          scoringStatus.set(slug, { state: 'paused', reason: `Readiness check failed: ${(e as Error).message}` });
        }
      }
      this.logger.log(
        `  ${readyProtocols.length} of ${activeProtocols.length} active protocols ready for scoring`,
      );

      for (const protoSlug of readyProtocols) {
        try {
          // Resolve symbols: single-symbol, watchlist, or auto-derived
          const symbols = await this.protocolDb.resolveSymbols(protoSlug);
          if (!symbols || symbols.length === 0) {
            this.logger.debug(`  Protocol "${protoSlug}": no symbols resolved — skipping`);
            scoringStatus.set(protoSlug, {
              state: 'no-symbols',
              reason: 'No symbols configured — needs a symbol assignment, linked watchlist, or derive rule',
            });
            continue;
          }

          let protoScored = 0;
          for (const sym of symbols) {
            try {
              const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: sym } });
              if (!dbSym) continue;

              // Dynamic bar fetch based on protocol's directive requirements
              const requiredBars = this.protocolDb.getRequiredBars(protoSlug);
              const barCount = requiredBars['5m'] || 100;
              const bars = await this.marketData.getBars(dbSym.id, '5m', barCount);
              if (!bars || bars.length < 20) continue;

              this.auditLog.logBarsFetched(this.state.tickCount, sym, bars.length,
                bars[bars.length - 1]?.timestamp?.toISOString?.() ?? null);

              // Score the symbol against this protocol
              const gated = await getGatedScore(sym, protoSlug, bars);
              if (!gated || gated.composite === undefined) continue;

              protoScored++;

              decisions.push({
                timestamp: new Date().toISOString(),
                strategyId: '', // protocol-driven, not strategy-driven
                symbol: sym,
                brokerId: 'mt5',
                decision: 'SCORED',
                reason: `${protoSlug}: composite=${gated.composite} signal=${gated.signal ?? 'N/A'}`,
                composite: gated.composite,
                signal: gated.signal ?? 'HOLD',
              });

              this.logger.log(
                `  ✓ ${protoSlug} × ${sym}: composite=${gated.composite} signal=${gated.signal ?? 'N/A'}`,
              );
            } catch (symbolErr) {
              const errMsg = (symbolErr as Error).message?.substring(0, 200) || 'Unknown error';
              const errorKey = `${protoSlug}:${sym}:${errMsg}`;
              const prev = this.suppressedErrors.get(errorKey);

              if (prev && prev.lastTick === this.state.tickCount - 1) {
                prev.lastTick = this.state.tickCount;
                prev.count++;
              } else if (prev && prev.lastTick < this.state.tickCount - 1) {
                this.logger.warn(
                  `${protoSlug}:${sym}: ${errMsg} (×${prev.count}, silenced)`,
                );
                prev.lastTick = this.state.tickCount;
                prev.count = 1;
              } else {
                this.logger.warn(`${protoSlug}:${sym}: ${errMsg}`);
                this.suppressedErrors.set(errorKey, { lastTick: this.state.tickCount, count: 1, firstSeenAt: new Date() });
              }
            }
          }
          if (protoScored > 0) {
            this.logger.log(`  Protocol "${protoSlug}": ${protoScored}/${symbols.length} symbols scored`);
            scoringStatus.set(protoSlug, {
              state: 'scoring',
              symbolsResolved: symbols.length,
              symbolsScored: protoScored,
              reason: protoScored < symbols.length
                ? `${protoScored}/${symbols.length} symbols scored (rest lack bars)`
                : undefined,
            });
          } else {
            scoringStatus.set(protoSlug, {
              state: 'no-data',
              symbolsResolved: symbols.length,
              symbolsScored: 0,
              reason: `All ${symbols.length} symbols lack 5m bars — not in bar-refresh set or broker has no data`,
            });
          }
        } catch (protoErr) {
          this.logger.warn(`Protocol "${protoSlug}" scoring failed: ${(protoErr as Error).message}`);
          scoringStatus.set(protoSlug, {
            state: 'error',
            reason: `Scoring failed: ${(protoErr as Error).message?.substring(0, 200)}`,
          });
        }
      }

      // ── Persist protocol scoring status — loop-owned single source of truth
      //    for WHY a protocol is or isn't scoring. Protocol views merge this
      //    with the registry for honest Active/Stalled/Paused/Disabled badges.
      try {
        const statusNow = new Date();
        for (const slug of activeProtocols) {
          const st = scoringStatus.get(slug);
          if (!st) continue;
          await (this.prisma as any).$queryRawUnsafe(
            `INSERT INTO protocol_score_status
               (protocolId, state, reason, symbolsResolved, symbolsScored, lastTickAt, updatedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE state=VALUES(state), reason=VALUES(reason),
               symbolsResolved=VALUES(symbolsResolved), symbolsScored=VALUES(symbolsScored),
               lastTickAt=VALUES(lastTickAt), updatedAt=VALUES(updatedAt)`,
            slug,
            st.state,
            st.reason ?? null,
            st.symbolsResolved ?? 0,
            st.symbolsScored ?? 0,
            statusNow,
            statusNow,
          );
        }
        // Prune rows for protocols that are no longer active.
        if (activeProtocols.length > 0) {
          const placeholders = activeProtocols.map(() => '?').join(',');
          await (this.prisma as any).$queryRawUnsafe(
            `DELETE FROM protocol_score_status WHERE protocolId NOT IN (${placeholders})`,
            ...activeProtocols,
          );
        }
      } catch (statusErr) {
        this.logger.warn(`Protocol scoring-status persistence failed: ${(statusErr as Error).message}`);
      }

      // 3c. A/B test evaluation (#482) — when a test is active, score BOTH
      //     stacks on the test symbols and dispatch side A / side B trades.
      try {
        await this.evaluateAbTest(decisions);
      } catch (err) {
        this.logger.warn(`A/B test evaluation failed: ${(err as Error).message}`);
      }

      // 4. Evaluate active strategies — grouped by symbol to avoid redundant bar fetches & scoring.
      //    Uses gatedScoreCache populated by step 3b for any symbol+protocol already scored.
      //    Only runs when there is a working set (positions/strategies) to evaluate.
      if (allSymbols.length > 0) {
      const strategyIdsBySymbol = new Map<string, string[]>();
      for (const strategyId of this.state.activeStrategyIds) {
        try {
          const s = await this.strategyService.findOne(strategyId);
          if (!s || !s.active) continue;
          const sym = s.symbol;
          if (!strategyIdsBySymbol.has(sym)) strategyIdsBySymbol.set(sym, []);
          strategyIdsBySymbol.get(sym)!.push(strategyId);
        } catch { /* strategy may have been deleted */ }
      }

      for (const [sym, strategyIds] of strategyIdsBySymbol) {
        // Fetch bars once per symbol — compute max required across all strategies for this symbol
        const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: sym } });
        let maxBars = 100; // default
        if (dbSym) {
          for (const sid of strategyIds) {
            const strat = await this.strategyService.findOne(sid).catch(() => null);
            if (strat?.protocolId) {
              const req = this.protocolDb.getRequiredBars(strat.protocolId);
              maxBars = Math.max(maxBars, req['5m'] || 100);
            }
          }
        }
        const bars = dbSym ? await this.marketData.getBars(dbSym.id, '5m', maxBars) : null;
        const hasBars = bars && bars.length >= 20;

        for (const strategyId of strategyIds) {
          const strategyDecision = await this.evaluateStrategy(strategyId, allPositions, new Map(), hasBars ? bars : null);
          if (strategyDecision) decisions.push(strategyDecision);
        }
      }
      } // end working-set guard (step 4)

    } catch (err) {
      this.logger.error(`Tick #${this.state.tickCount} failed: ${(err as Error).message}`);
    }

    this.state.lastTickMs = Date.now() - tickStart;
    this.state.nextTickAt = new Date(Date.now() + this.state.tickIntervalMs).toISOString();

    // Store recent decisions (keep last 50)
    this.state.recentDecisions = [...decisions, ...this.state.recentDecisions].slice(0, 50);

    // Persist decisions to DB so they survive restarts
    this.persistDecisions(decisions, this.state.tickCount);
    this.persistDecisionTrail(trailRecords);

    // ── Portfolio Snapshot (at trade execution) ─────────
    // Captured at the point of trade, not every tick — shows
    // the full portfolio picture at the moment of decision.
    // Enables "why was this trade placed?" analysis: what
    // positions were held, what was the P&L and exposure? (#477)

    // Flush audit event buffer (best-effort, noiseless on failure)
    this.auditLog.flush().catch(() => {});

    this.logger.log(`Tick #${this.state.tickCount} completed in ${this.state.lastTickMs}ms — ${decisions.length} decisions`);
    return decisions;
  }

  /**
   * A/B test runner (#482) — when an active test exists, evaluate BOTH MetaStack
   * snapshots (control vs variant) on the test symbols and dispatch side-tagged
   * trades. Uses the same gated-scoring path as step 3b for fairness.
   */
  private async evaluateAbTest(decisions: TickDecision[]): Promise<void> {
    const test = await this.abTestService.getActiveTest();
    if (!test) return;

    const snapshots = await this.prisma.metaStackSnapshot.findMany({
      where: { id: { in: [test.controlStackId, test.variantStackId] } },
    });
    const control = snapshots.find((s) => s.id === test.controlStackId);
    const variant = snapshots.find((s) => s.id === test.variantStackId);
    if (!control || !variant) {
      this.logger.warn(`A/B test "${test.name}": missing control or variant snapshot — skipping`);
      return;
    }

    const controlCfg = (control.snapshot ?? {}) as any;
    const variantCfg = (variant.snapshot ?? {}) as any;
    const symbols = (Array.isArray(test.symbols) ? test.symbols : []) as string[];

    for (const sym of symbols) {
      const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: sym } });
      if (!dbSym) continue;

      const requiredBars = Math.max(
        this.protocolDb.getRequiredBars(controlCfg.protocolId)?.['5m'] ?? 100,
        this.protocolDb.getRequiredBars(variantCfg.protocolId)?.['5m'] ?? 100,
      );
      const bars = await this.marketData.getBars(dbSym.id, '5m', requiredBars);
      if (!bars || bars.length < 20) continue;

      // Score both stacks against the same symbol + bars.
      const [scoreA, scoreB] = await Promise.all([
        this.protocolGating.scoreWithGating(sym, bars, controlCfg.protocolId, undefined, controlCfg.weightStrategy ?? 'group-weighted'),
        this.protocolGating.scoreWithGating(sym, bars, variantCfg.protocolId, undefined, variantCfg.weightStrategy ?? 'group-weighted'),
      ]);

      const brokerId = (controlCfg.brokerId ?? variantCfg.brokerId ?? 'mt5') as string;
      const mode = (controlCfg.mode ?? variantCfg.mode ?? 'manual') as string;

      const evalSide = async (side: 'A' | 'B', cfg: any, score: any): Promise<void> => {
        if (!score || score.composite === undefined) return;
        const threshold = cfg.tradeThreshold ?? 60;
        const direction = score.signal === 'SELL' ? 'SELL' : 'BUY';
        // A/B trades are BUY-side unless the protocol signals a clear SELL.
        if (score.composite < threshold) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: `ab-test:${side}`,
            symbol: sym,
            brokerId,
            decision: 'SCORED',
            reason: `AB-${side} ${test.name}: composite=${score.composite} < threshold=${threshold}`,
            composite: score.composite,
            signal: score.signal ?? 'HOLD',
          });
          return;
        }

        const sideDir: 'BUY' | 'SELL' = direction === 'SELL' ? 'SELL' : 'BUY';
        const entryPrice = bars[bars.length - 1]?.close ?? 0;
        const result = await this.abTestService.dispatchSideTrade({
          test,
          side,
          symbol: sym,
          brokerId,
          sideDir,
          quantity: cfg.baseSize ?? 0.01,
          slPct: cfg.slPct ?? 1.0,
          tpPct: cfg.tpPct ?? 1.0,
          entryPrice,
          mode,
        });

        decisions.push({
          timestamp: new Date().toISOString(),
          strategyId: `ab-test:${side}`,
          symbol: sym,
          brokerId,
          decision: result.success ? 'EXECUTED' : 'FAILED',
          reason: result.success
            ? `AB-${side} ${test.name}: ${sideDir} @ ${entryPrice} (${result.ticket ?? 'recorded'})`
            : `AB-${side} ${test.name}: ${result.error ?? 'unknown'}`,
          composite: score.composite,
          signal: score.signal ?? 'BUY',
          ticket: result.ticket,
          price: result.price,
        });
      };

      await evalSide('A', controlCfg, scoreA);
      await evalSide('B', variantCfg, scoreB);
    }
  }

  /**
   * #712 — resolve the best actionable signal for a strategy across its
   * protocol subscriptions. Each direction pool (long / short, with 'both'
   * feeding either) is scored and the strongest composite wins, then
   * compareProtocolPair picks the side against the strategy threshold.
   * Falls back to the legacy single protocolId/shortProtocolId fields when
   * no subscriptions exist.
   */
  private async resolveBestSignal(
    strategy: any,
    bars: any[],
    subs: Array<{ protocolId: string; role: string }>,
    getGated: (protocolId: string, bars: any[]) => Promise<any>,
  ): Promise<{
    side: 'BUY' | 'SELL' | 'HOLD';
    composite: number;
    chosenProtocolId: string;
    longProtocolId: string | null;
    shortProtocolId: string | null;
  }> {
    const legacyLong = strategy.protocolId || '';
    const legacyShort = strategy.shortProtocolId || undefined;

    const longPool = subs.length > 0
      ? [...new Set(subs.filter(s => s.role === 'long' || s.role === 'both').map(s => s.protocolId))]
      : (legacyLong ? [legacyLong] : []);
    const shortPool = subs.length > 0
      ? [...new Set(subs.filter(s => s.role === 'short' || s.role === 'both').map(s => s.protocolId))]
      : (legacyShort ? [legacyShort] : []);

    const bestOf = async (pool: string[]) => {
      let best: any = null;
      let bestId: string | null = null;
      for (const pid of pool) {
        try {
          const g = await getGated(pid, bars);
          if (!g) continue;
          const c = g?.meta?.compositePct ?? g?.composite ?? 0;
          const bestC = best ? (best.meta?.compositePct ?? best.composite ?? 0) : -Infinity;
          if (c > bestC) { best = g; bestId = pid; }
        } catch { /* one protocol failing doesn't block the rest */ }
      }
      return { best, bestId };
    };

    const [longRes, shortRes] = [await bestOf(longPool), await bestOf(shortPool)];
    const { side, composite } = compareProtocolPair(longRes.best, shortRes.best, strategy.minComposite ?? 3);
    return {
      side,
      composite,
      longProtocolId: longRes.bestId,
      shortProtocolId: shortRes.bestId,
      chosenProtocolId:
        (side === 'SELL' ? shortRes.bestId : longRes.bestId) ?? longRes.bestId ?? shortRes.bestId ?? legacyLong,
    };
  }

  private async evaluateStrategy(
    strategyId: string,
    positions: any[],
    scoreMap: Map<string, any>,
    preFetchedBars?: any[] | null,
  ): Promise<TickDecision | null> {
    try {
      const strategyCheck = await this.strategyService.findOne(strategyId);
      if (!strategyCheck || !strategyCheck.active) return null;
      const strategy = strategyCheck as NonNullable<typeof strategyCheck>;

      // ── Data Readiness Gate (Layer B Phase 2) ──
      // Skip evaluation if bars haven't accumulated or feeds aren't connected.
      const loopStrat = this.state.activeStrategies?.find((s: any) => s.id === strategyId);
      const dataStatus = (loopStrat as any)?.dataStatus;
      if (dataStatus === 'pending_bars') {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: `⏳ PENDING: ${(loopStrat as any)?.dataStatusReason || 'Waiting for bar data'}`,
          composite: 0,
        };
      }
      if (dataStatus === 'blocked') {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'BLOCKED', reason: `🚫 ${(loopStrat as any)?.dataStatusReason || 'Data requirements not met'}`,
          composite: 0,
        };
      }

      // Cooldown
      const lastTrade = this.lastTradeTime.get(strategyId);
      const cooldownMs = (strategy.cooldownMinutes || 5) * 60000;
      if (lastTrade && (Date.now() - lastTrade) < cooldownMs) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: `Cooldown active`,
          composite: 0,
        };
      }

      // ── Resolve execution params from the TRADING STRATEGY itself (2026-08-27) ──
      // Decision: the loop no longer reads the scoring_strategy table — the
      // pipeline is Protocol → Trading Strategy → Execution. scoring_strategy
      // remains only for MetaStack versioning/performance (#295).
      const effectiveProtocolId = strategy.protocolId || '';
      const effectiveShortProtocolId = strategy.shortProtocolId || undefined;
      const effectiveBaseSize = strategy.baseSize ?? 0.01;
      const effectiveSlPct = strategy.slPct ?? 1.0;
      const effectiveTpPct = strategy.tpPct ?? 1.0;

      // #712 — strategy-owned protocol subscriptions. Falls back to the
      // legacy single protocolId/shortProtocolId fields when none exist.
      let subs: Array<{ protocolId: string; role: string }> = [];
      try {
        const rows: any[] = await (this.prisma as any).strategyProtocol.findMany({
          where: { strategyId },
          orderBy: { sortOrder: 'asc' },
        });
        subs = rows.map((r: any) => ({ protocolId: r.protocolId, role: r.role }));
      } catch { /* table may not exist yet — legacy fields still work */ }

      if (!effectiveProtocolId && subs.length === 0) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: 'No protocol linked — cannot score',
          composite: 0,
        };
      }

      // ── Helper: get bars (pre-fetched or fetch now) ──
      // Timeframe resolved from Protocol.recommendedTimeframe (authority),
      // falling back to the trading strategy's timeframe field.
      const protocolConfig = this.protocolDb.getCached(effectiveProtocolId);
      const effectiveTimeframe = protocolConfig?.recommendedTimeframe || strategy.timeframe || '5m';
      const getBars = async (): Promise<any[] | null> => {
        if (preFetchedBars && preFetchedBars.length >= 20) return preFetchedBars;
        const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: strategy.symbol } });
        if (!dbSym) return null;
        const requiredBars = this.protocolDb.getRequiredBars(effectiveProtocolId);
        const barCount = requiredBars[effectiveTimeframe] || 100;
        const bars = await this.marketData.getBars(dbSym.id, effectiveTimeframe, barCount);
        return bars && bars.length >= 20 ? bars : null;
      };

      // ── Helper: get gated score from cache or compute ──
      // Derive weightStrategy from the trading strategy's protocol (defaults to group-weighted)
      const ws: 'group-weighted' | 'maxscore-weighted' = 'group-weighted';
      const getGated = async (protocolId: string, bars: any[]): Promise<any> => {
        const cacheKey = `${strategy.symbol}|${protocolId}|${ws}`;
        const cached = this.gatedScoreCache.get(cacheKey);
        if (cached) return cached;
        const result = await this.protocolGating.scoreWithGating(strategy.symbol, bars, protocolId, undefined, ws);
        if (result && result.composite !== undefined) {
          this.gatedScoreCache.set(cacheKey, result);
        }
        return result;
      };

      // Find scored position first, fall back to scoreMap
      const pos = positions.find(p =>
        p.symbol === strategy.symbol && p.brokerId === (strategy.brokerId || 'mt5')
      );
      const lookupScore = scoreMap.get(strategy.symbol);
      
      if (!pos || pos.composite === null) {
        // No position — use scoreMap as fallback
        if (lookupScore && lookupScore.score !== null && lookupScore.score !== undefined) {
          const adjScore = lookupScore.score * this.state.globalRiskMultiplier;
          const brokerState = this.state.brokerStates[strategy.brokerId || 'mt5'];
          const threshold = strategy.minComposite ?? brokerState?.tradeThreshold ?? getStyleThreshold(this.protocolDb.getCached(effectiveProtocolId)?.tradingStyle);
          const passed = adjScore >= threshold;
          
          // ── Score with protocol-gating (uses cache) ──
          try {
            const bars = await getBars();
            if (bars) {
              const { side, composite: chosenComposite, chosenProtocolId, longProtocolId, shortProtocolId } =
                await this.resolveBestSignal(strategy, bars, subs, getGated);

              // ── Auto-execute via shared dispatch (Phase B.2) ──
              if (side !== 'HOLD' && strategy.mode === 'auto') {
                const bs = this.state.brokerStates[strategy.brokerId || 'mt5'];
                if (bs?.tradingEnabled) {
                  await this.dispatchTrade({
                    strategyId,
                    strategyName: strategy.name,
                    symbol: strategy.symbol,
                    brokerId: strategy.brokerId || 'mt5',
                    side,
                    composite: chosenComposite,
                    baseSize: effectiveBaseSize,
                    slPct: effectiveSlPct,
                    tpPct: effectiveTpPct,
                    entryPrice: bars[bars.length - 1]?.close || 0,
                    mode: strategy.mode,
                    protocolId: chosenProtocolId,
                    decisions: [],  // result handled via returned decision below
                  });
                } else {
                  // #695 — trading off: capture what WOULD have traded (dry-run).
                  await this.recordPaperTrade({
                    strategyId,
                    symbol: strategy.symbol,
                    side,
                    composite: chosenComposite,
                    baseSize: effectiveBaseSize,
                    slPct: effectiveSlPct,
                    tpPct: effectiveTpPct,
                    entryPrice: bars[bars.length - 1]?.close || 0,
                    protocolId: chosenProtocolId,
                  });
                }
              }

              return {
                timestamp: new Date().toISOString(),
                strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
                decision: side !== 'HOLD' ? 'SCORED' : 'SKIP',
                reason: side !== 'HOLD'
                  ? `Gated: ${chosenProtocolId} → ${side} (${chosenComposite}) [${subs.length || 1} protocol(s)]`
                  : `Gated: ${longProtocolId ?? '—'} vs ${shortProtocolId ?? '—'} low → HOLD`,
                composite: chosenComposite, signal: side,
              };
            }
          } catch (err) {
            this.logger.debug(`Protocol-gating failed for ${strategy.symbol}, using scoreMap fallback: ${(err as Error).message}`);
          }
        }
        // No scoreMap entry — use protocol-gating with cache
        try {
          const bars = await getBars();
          if (!effectiveProtocolId && subs.length === 0) {
            this.logger.debug(`Strategy ${strategyId} has no protocol linked — skipping unscoped scoring`);
          } else if (bars) {
            const { side, composite: chosenComposite, chosenProtocolId, longProtocolId, shortProtocolId } =
              await this.resolveBestSignal(strategy, bars, subs, getGated);

            // Persist evaluation to DB (best-effort)
            try { await this.strategyService.evaluate(strategyId); } catch {}

            // ── Auto-execute via shared dispatch (Phase B.2) ──
            if (side !== 'HOLD' && strategy.mode === 'auto') {
              const bs = this.state.brokerStates[strategy.brokerId || 'mt5'];
              if (bs?.tradingEnabled) {
                await this.dispatchTrade({
                  strategyId,
                  strategyName: strategy.name,
                  symbol: strategy.symbol,
                  brokerId: strategy.brokerId || 'mt5',
                  side,
                  composite: chosenComposite,
                  baseSize: effectiveBaseSize,
                  slPct: effectiveSlPct,
                  tpPct: effectiveTpPct,
                  entryPrice: bars[bars.length - 1]?.close || 0,
                  mode: strategy.mode,
                  protocolId: chosenProtocolId,
                  decisions: [],
                });
              } else {
                // #695 — trading off: capture what WOULD have traded (dry-run).
                await this.recordPaperTrade({
                  strategyId,
                  symbol: strategy.symbol,
                  side,
                  composite: chosenComposite,
                  baseSize: effectiveBaseSize,
                  slPct: effectiveSlPct,
                  tpPct: effectiveTpPct,
                  entryPrice: bars[bars.length - 1]?.close || 0,
                  protocolId: chosenProtocolId,
                });
              }
            }

            return {
              timestamp: new Date().toISOString(),
              strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
              decision: side !== 'HOLD' ? 'SCORED' : 'SKIP',
              reason: side !== 'HOLD'
                ? `Gated: ${chosenProtocolId} → ${side} (${chosenComposite}) [${subs.length || 1} protocol(s)]`
                : `Gated: ${longProtocolId ?? '—'} vs ${shortProtocolId ?? '—'} low → HOLD`,
              composite: chosenComposite, signal: side,
            };
          }
        } catch (err) {
          this.logger.debug(`Protocol-gating failed for ${strategy.symbol} (no scoreMap): ${(err as Error).message}`);
        }
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: 'No score available',
          composite: 0,
        };
      }

      // Timeline block check for this symbol
      const symEvents = this.state.activeTimelineEvents.filter(
        (e: any) => e.scope === 'symbol' && e.symbol === strategy.symbol
      );
      const blockEvent = symEvents.find((e: any) => e.action === 'block');
      if (blockEvent) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'BLOCKED', reason: `Timeline: ${blockEvent.label}`,
          composite: pos.composite, signal: pos.signal,
        };
      }

      // ── Pyramid Averaging (#344) ──
      // When a position already exists, check if we can stack additional entries
      // if the position is in profit, SL is set, and maxPyramidTiers allows it.
      // NOTE: pyramid config moved to the TradingStrategy (2026-08-27) —
      // the loop no longer reads the scoring_strategy table.
      const pyramidTiers = (strategy as any)?.maxPyramidTiers ?? 1;      const isPositionInProfit = (pos as any).profit > 0;
      const hasStopLoss = (pos as any).sl > 0 || (pos as any).stopLoss > 0;

      if (pyramidTiers <= 1) {
        // Pyramid disabled — fall through to standard position evaluation below
      } else if (!isPositionInProfit) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: 'Position not in profit — pyramid requires profit',
          composite: pos.composite, signal: pos.signal,
        };
      }

      if (!hasStopLoss) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: 'No stop-loss set — pyramid requires risk management',
          composite: pos.composite, signal: pos.signal,
        };
      }

      // Count existing entries for this position (volume as proxy for tier count)
      const currentTier = Math.ceil((pos.volume || 1) / ((strategy as any)?.baseSize || 0.01));
      if (currentTier >= pyramidTiers) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: `Pyramid tier limit reached (${currentTier}/${pyramidTiers})`,
          composite: pos.composite, signal: pos.signal,
        };
      }

      // ── Pyramid entry permitted — re-score to confirm signal still valid ──
      const pyramidThreshold = (strategy as any)?.minComposite ?? 60;
      const pyramidComposite = pos.composite * this.state.globalRiskMultiplier;
      if (pyramidComposite < pyramidThreshold) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: `Pyramid re-score ${pyramidComposite.toFixed(1)} < threshold ${pyramidThreshold}`,
          composite: pos.composite, signal: pos.signal,
        };
      }

      // Pyramid entry approved — dispatch with reduced size for safety
      const pyramidSize = ((strategy as any)?.baseSize || 0.01) * 0.5; // Half-size for pyramid entries
      this.logger.log(`🔺 PYRAMID ${strategy.symbol}: tier ${currentTier + 1}/${pyramidTiers} profit=${(pos as any).profit} score=${pyramidComposite.toFixed(1)}`);

      this.dispatchTrade({
        strategyId,
        strategyName: strategy.name || strategyId,
        symbol: strategy.symbol,
        brokerId: strategy.brokerId || 'mt5',
        side: pos.signal as 'BUY' | 'SELL',
        composite: pyramidComposite,
        baseSize: pyramidSize,
        slPct: strategy.slPct ?? 1.0,
        tpPct: strategy.tpPct ?? 1.0,
        entryPrice: (pos as any).currentPrice ?? 0,
        mode: strategy.mode,
        protocolId: effectiveProtocolId,
        decisions: [],
      });

      return {
        timestamp: new Date().toISOString(),
        strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
        decision: 'PYRAMID', reason: `Pyramid entry tier ${currentTier + 1}/${pyramidTiers} — profit confirmed, SL active, score ${pyramidComposite.toFixed(1)}`,
        composite: pyramidComposite, signal: pos.signal,
      };

      // Threshold check
      const brokerState = this.state.brokerStates[strategy.brokerId || 'mt5'];
      const threshold = brokerState?.tradeThreshold ?? 60;
      const adjustedComposite = pos.composite * this.state.globalRiskMultiplier;
      if (adjustedComposite < threshold) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: `Score ${pos.composite} × risk ${this.state.globalRiskMultiplier.toFixed(2)} = ${adjustedComposite.toFixed(1)} < threshold ${threshold}`,
          composite: pos.composite, signal: pos.signal,
        };
      }

      // Full evaluation via strategy service
      const evalResult = await this.strategyService.evaluate(strategyId);
      if (!evalResult.evaluated || !evalResult.passed) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: evalResult.evaluated ? 'Conditions not met' : (evalResult.reason || 'Evaluation failed'),
          composite: evalResult.composite || pos.composite, signal: evalResult.signal || pos.signal,
        };
      }

      // Compute position size from the trading strategy's own config
      let size = effectiveBaseSize;
      if ((strategy as any).useRaritySizing && evalResult.rarity) {
        size *= (evalResult.rarity.sizeMultiplier || 1);
      }
      if ((strategy as any).maxSize) {
        size = Math.min(size, (strategy as any).maxSize);
      }
      size = Math.round(size * 10000) / 10000;

      // Never dispatch a zero/negative volume order (e.g. black-swan rarity sizing)
      if (size <= 0) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: `Position size ${size} — trade skipped (invalid size)`,
          composite: evalResult.composite ?? pos?.composite ?? 0, signal: evalResult.signal || pos?.signal,
          quantity: size,
        };
      }

      // Compute SL/TP prices from the trading strategy's own config
      const slPct = effectiveSlPct;
      const tpPct = effectiveTpPct;
      const slPrice = evalResult.signal === 'BUY' ? pos.currentPrice * (1 - slPct / 100) : pos.currentPrice * (1 + slPct / 100);
      const tpPrice = evalResult.signal === 'BUY' ? pos.currentPrice * (1 + tpPct / 100) : pos.currentPrice * (1 - tpPct / 100);

      // Dispatch by mode
      if (strategy.mode === 'manual') {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SIGNAL', reason: 'Manual mode — logged for review',
          composite: evalResult.composite ?? 0, signal: evalResult.signal,
          quantity: size,
        };
      }

      if (strategy.mode === 'semi-auto') {
        const actionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const action: PendingAction = {
          id: actionId, strategyId, symbol: strategy.symbol,
          brokerId: strategy.brokerId || 'mt5',
          side: evalResult.signal || 'BUY',
          quantity: size,
          composite: evalResult.composite ?? 0,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
        };
        this.state.pendingActions.push(action);
        this.persistPendingAction(action).catch(() => {});
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'QUEUED', reason: 'Awaiting confirmation',
          composite: evalResult.composite ?? 0, signal: evalResult.signal,
          actionId,
        };
      }

      if (strategy.mode === 'auto') {
        const brokerState = this.state.brokerStates[strategy.brokerId || 'mt5'];
        if (!brokerState?.tradingEnabled) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP', reason: 'Trading disabled for this broker',
            composite: evalResult.composite ?? 0, signal: evalResult.signal,
          };
        }

        // Per-symbol cooldown (60s) + short global safety (3s)
        const lastSymTrade = this.lastSymbolTrade.get(strategy.symbol) ?? 0;
        if (lastSymTrade > 0 && (Date.now() - lastSymTrade) < 60000) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP', reason: `${strategy.symbol} traded ${Math.round((Date.now() - (lastSymTrade || 0)) / 1000)}s ago`,
            composite: evalResult.composite ?? 0, signal: evalResult.signal,
          };
        }
        if (this.lastAnyTradeAt && (Date.now() - this.lastAnyTradeAt) < 3000) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP', reason: 'Global safety cooldown (3s)',
            composite: evalResult.composite ?? 0, signal: evalResult.signal,
          };
        }

        // Execute
        const broker = this.adapterFactory.create(strategy.brokerId || 'mt5');
        if (!broker) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'FAILED', reason: `Broker ${strategy.brokerId} does not support orders`,
            composite: evalResult.composite ?? 0, signal: evalResult.signal,
          };
        }
        // TS doesn't narrow after `if (!broker)` due to create() return type
        const b = broker!;
        if (!b.placeOrder) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'FAILED', reason: `Broker ${strategy.brokerId} missing placeOrder`,
            composite: evalResult.composite ?? 0, signal: evalResult.signal,
          };
        }

        const result = await b.placeOrder!({
          symbol: strategy.symbol,
          side: evalResult.signal as 'BUY' | 'SELL',
          quantity: size,
          sl: slPrice,
          tp: tpPrice,
          comment: `TCS ${strategy.name}`,
        });

        this.lastTradeTime.set(strategyId, Date.now());
        this.lastAnyTradeAt = Date.now();
        this.lastSymbolTrade.set(strategy.symbol, Date.now());

        // Record trade
        if (result.success) {
          try {
            await this.tradeRecorder.record({
              symbol: strategy.symbol,
              side: evalResult.signal?.toLowerCase() || 'buy',
              quantity: size,
              entryPrice: result.price || 0,
              pnl: 0,
              provider: strategy.brokerId || 'mt5',
              status: 'open',
              origin: 'strategy',
              source: 'meta-stack',
              scoringStrategyId: strategyId,
            } as any);
          } catch { /* non-critical */ }
        }

        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: result.success ? 'EXECUTED' : 'FAILED',
          reason: result.success ? `Ticket ${result.ticket}` : (result.error || 'Unknown error'),
          composite: evalResult.composite ?? 0, signal: evalResult.signal,
          ticket: result.ticket, price: result.price,
          quantity: size,
        };
      }

      return null;
    } catch (err) {
      this.logger.error(`Strategy ${strategyId} evaluation failed: ${(err as Error).message}`);
      return null;
    }
  }

  // ── Dashboard Helpers ────────────────────────────────

  /**
   * Safety guard for scheduler-style auto-execution (2026-08-27): true only
   * when an active auto-mode TRADING strategy exists AND some broker has
   * trading enabled. Replaces the old scoringStrategies-based check.
   */
  hasAutoTradingEnabled(): boolean {
    const strategies = this.state.activeStrategies || [];
    const hasAuto = strategies.some((s: any) => s.mode === 'auto' && s.active !== false);
    const tradingOn = Object.values(this.state.brokerStates).some((bs: any) => bs?.tradingEnabled);
    return hasAuto && tradingOn;
  }

  getState(): LoopState {
    return { ...this.state, pendingActions: [...this.state.pendingActions] };
  }

  async confirmAction(actionId: string): Promise<{ confirmed: boolean; message: string; ticket?: string | number; price?: number }> {
    const idx = this.state.pendingActions.findIndex(a => a.id === actionId);
    if (idx === -1) return { confirmed: false, message: 'Action not found or expired' };
    const action = this.state.pendingActions[idx];

    // Expired actions are rejected outright
    if (new Date(action.expiresAt).getTime() < Date.now()) {
      this.state.pendingActions.splice(idx, 1);
      this.removePendingAction(actionId).catch(() => {});
      return { confirmed: false, message: 'Action expired — no longer valid' };
    }

    const broker = this.adapterFactory.create(action.brokerId || 'mt5');
    if (!broker || !broker.placeOrder) {
      return { confirmed: false, message: `Broker ${action.brokerId || 'mt5'} does not support orders` };
    }

    // Current price for SL/TP bracket — market order without bracket if unavailable
    let entryPrice = 0;
    try {
      const quote = await broker.getQuote(action.symbol);
      entryPrice = quote?.last ?? quote?.ask ?? quote?.bid ?? 0;
    } catch { /* fall through with entryPrice=0 */ }

    // NOTE (2026-08-27): confirm no longer resolves SL/TP from scoring
    // strategies — safe defaults here, loop dispatch carries exact values.
    const slPct = 1.0;
    const tpPct = 1.0;
    const sl = entryPrice > 0
      ? action.side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100)
      : 0;
    const tp = entryPrice > 0
      ? action.side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100)
      : 0;

    const result = await broker.placeOrder({
      symbol: action.symbol,
      side: action.side as 'BUY' | 'SELL',
      quantity: action.quantity,
      sl,
      tp,
      comment: `TCS ${action.strategyId}`,
    });

    // Action is consumed regardless of outcome (avoids stale confirm buttons)
    this.state.pendingActions.splice(idx, 1);
    this.removePendingAction(actionId).catch(() => {});

    if (!result.success) {
      this.logger.warn(`Action ${actionId} confirm FAILED: ${result.error || 'Unknown error'}`);
      return { confirmed: false, message: `Order failed: ${result.error || 'Unknown error'}` };
    }

    this.lastAnyTradeAt = Date.now();
    this.lastSymbolTrade.set(action.symbol, Date.now());
    this.logger.log(`Action ${actionId} confirmed → ${action.side} ${action.symbol} ticket ${result.ticket}`);

    try {
      await this.tradeRecorder.record({
        symbol: action.symbol,
        side: action.side.toLowerCase(),
        quantity: action.quantity,
        entryPrice: result.price || entryPrice || 0,
        pnl: 0,
        provider: action.brokerId || 'mt5',
        status: 'open',
        origin: 'strategy',
        source: 'meta-stack',
        scoringStrategyId: action.strategyId,
        ticket: result.ticket as number | undefined,
        sl,
        tp,
      } as any);
    } catch { /* non-critical */ }

    return { confirmed: true, message: `Action confirmed — ticket ${result.ticket}`, ticket: result.ticket, price: result.price };
  }

  rejectAction(actionId: string): { rejected: boolean; message: string } {
    const idx = this.state.pendingActions.findIndex(a => a.id === actionId);
    if (idx === -1) return { rejected: false, message: 'Action not found or expired' };
    this.state.pendingActions.splice(idx, 1);
    this.logger.log(`Action ${actionId} rejected`);
    return { rejected: true, message: 'Action rejected' };
  }

  /**
   * Emergency stop — kills loop, flushes pending actions.
   * Does NOT automatically close positions (broker-dependent).
   */
  /**
   * #695 — dry-run capture: when trading is off, record what WOULD have
   * traded into paper_trade (write-on-change, same dedupe idea as #704).
   * Raw SQL — no Prisma model needed (db push is broken).
   */
  private async recordPaperTrade(params: {
    strategyId: string;
    symbol: string;
    side: string;
    composite: number;
    baseSize: number;
    slPct: number;
    tpPct: number;
    entryPrice: number;
    protocolId: string | null;
  }) {
    try {
      const { strategyId, symbol, side, composite, baseSize, slPct, tpPct, entryPrice, protocolId } = params;
      const sig = `${side}|${Math.round(composite)}`;
      if (this.lastPaperSig.get(`${strategyId}|${symbol}`) === sig) return;
      this.lastPaperSig.set(`${strategyId}|${symbol}`, sig);

      const sl = side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
      const tp = side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);
      const id = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO paper_trade (id, strategyId, symbol, side, composite, entryPrice, sl, tp, baseSize, protocolId, tickNumber, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        id, strategyId, symbol, side, Math.round(composite), entryPrice || null, sl, tp, baseSize, protocolId ?? null, this.state.tickCount,
      );
      this.logger.log(`📝 PAPER ${side} ${symbol} composite ${Math.round(composite)} (dry-run, trading off)`);
    } catch (err) {
      this.logger.warn(`Paper trade capture failed: ${(err as Error).message}`);
    }
  }

  /** Persist tick decisions to DB for audit trail survival across restarts.
   *  #704 — HOLD/SCORED rows are write-on-change: identical consecutive ticks
   *  (same decision|signal|rounded composite) are suppressed and counted. */
  private persistDecisions(decisions: TickDecision[], tickNumber: number) {
    if (!this.prisma.isAvailable) return;

    const significant = new Set(['EXECUTED', 'FAILED', 'BLOCKED', 'QUEUED']);
    const keep: TickDecision[] = [];
    for (const d of decisions) {
      const key = `${d.strategyId}|${d.symbol}`;
      const sig = `${d.decision}|${d.signal ?? ''}|${Math.round(d.composite ?? 0)}`;
      if (significant.has(d.decision) || this.lastDecisionWrite.get(key) !== sig) {
        this.lastDecisionWrite.set(key, sig);
        keep.push(d);
      } else {
        this.state.decisionLogSuppressed++;
      }
    }
    this.state.decisionLogPersisted += keep.length;
    if (keep.length === 0) return;

    const records = keep.map(d => ({
      timestamp: d.timestamp ? new Date(d.timestamp) : new Date(),
      tickNumber,
      strategyId: d.strategyId,
      symbol: d.symbol,
      decision: d.decision,
      reason: d.reason?.slice(0, 500) ?? null,
      composite: d.composite ?? 0,
      signal: d.signal ?? null,
      ticket: typeof d.ticket === 'number' ? d.ticket : (d.ticket ? parseInt(String(d.ticket), 10) || null : null),
      price: d.price ?? null,
      quantity: d.quantity ?? null,
    }));

    // Fire-and-forget — don't block the tick on DB writes
    this.prisma.decisionLog.createMany({ data: records }).then(
      () => this.logger.debug(`Persisted ${records.length} decisions to decision_log (${this.state.decisionLogSuppressed} suppressed this session)`),
    ).catch(err => this.logger.warn(`Failed to persist decisions: ${err.message}`));

    // Also log order attempts for EXECUTED/FAILED decisions
    const orderDecisions = keep.filter(d => d.decision === 'EXECUTED' || d.decision === 'FAILED');
    for (const d of orderDecisions) {
      const side = d.signal?.toLowerCase();
      if (!side || (side !== 'buy' && side !== 'sell')) continue;
      this.prisma.order.create({
        data: {
          symbol: d.symbol,
          type: 'market',
          side,
          quantity: d.quantity ?? 0.01,
          price: d.price ?? null,
          status: d.decision === 'EXECUTED' ? 'filled' : 'rejected',
          provider: d.brokerId || 'mt5',
          providerId: d.ticket ? String(d.ticket) : null,
          filledAt: d.decision === 'EXECUTED' ? new Date() : null,
        },
      }).catch(() => {});
    }
  }

  /**
   * Persist decision trail records — captures the LONG vs SHORT protocol
   * comparison that drives each trading decision (#474).
   * Fire-and-forget — don't block the tick on DB writes.
   * Table creation is handled once at startup via PrismaService.bootstrapSchema().
   */
  private persistDecisionTrail(records: any[]) {
    if (!this.prisma.isAvailable || records.length === 0) return;
    this.prisma.decisionTrail.createMany({ data: records }).then(
      () => this.logger.debug(`Persisted ${records.length} trail records`),
    ).catch(err => this.logger.warn(`Trail persist failed: ${err.message}`));
  }

  /**
   * Fetch all positions across all configured brokers.
   * Used for trade-point portfolio snapshots (#477).
   */
  private async fetchAllPositions(): Promise<any[]> {
    const positions: any[] = [];
    for (const bs of Object.values(this.state.brokerStates)) {
      try {
        const adapter = this.adapterFactory.create(bs.brokerId);
        if (adapter?.getPositions) {
          const result = await adapter.getPositions();
          if (Array.isArray(result)) positions.push(...result);
        }
      } catch { /* broker may be offline */ }
    }
    return positions;
  }

  /**
   * Capture a portfolio snapshot at trade execution points.
   * Writes total equity, P&L, and position count to portfolio_snapshot.
   * Fire-and-forget — failures are silent (non-critical).
   */
  private capturePortfolioSnapshot(positions: any[], tickNumber: number, type: string = 'session') {
    if (!this.prisma.isAvailable) return;
    try {
      const totalValue = positions.reduce((s: number, p: any) => s + (p.marketValue || p.value || 0), 0);
      const totalCost = positions.reduce((s: number, p: any) => s + (p.costBasis || (p.avgCost || 0) * (p.quantity || 0)), 0);
      const totalPnl = positions.reduce((s: number, p: any) => s + (p.unrealizedPnl || p.pnl || 0), 0);

      const providerMap = new Map<string, { value: number; count: number }>();
      for (const p of positions) {
        const provider = p.brokerId || p.provider || 'unknown';
        const entry = providerMap.get(provider) || { value: 0, count: 0 };
        entry.value += p.marketValue || p.value || 0;
        entry.count += 1;
        providerMap.set(provider, entry);
      }
      const providerSummary: Record<string, any> = {};
      for (const [k, v] of providerMap) {
        providerSummary[k] = { totalValue: v.value, positionCount: v.count };
      }

      this.prisma.portfolioSnapshot.create({
        data: {
          snapshotType: type,
          totalValue: totalValue || 0,
          totalCost: totalCost || 0,
          totalPnl: totalPnl || 0,
          totalPnlPct: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
          positionCount: positions.length,
          providerSummary: providerSummary as any,
        },
      }).catch(() => {});
    } catch { /* non-critical */ }
  }

  emergencyStop(): { stopped: boolean; message: string } {
    this.stop();
    this.state.pendingActions = [];
    this.state.activeStrategyIds = [];
    for (const bs of Object.values(this.state.brokerStates)) {
      bs.tradingEnabled = false;
    }
    // #615 — the trading layer itself is also switched off and persisted.
    void this.setLayer('trading', false);
    this.logger.warn('EMERGENCY STOP — loop killed, trading disabled, pending actions cleared');
    return { stopped: true, message: 'Emergency stop complete. All trading disabled. Pending actions cleared.' };
  }

  /**
   * #615 — META.Stack layer kill switches.
   *
   * Mandate hierarchy (Protocol → Trading, post-2026-08-27 retirement of the
   * scoring-strategy layer):
   *   - Protocols OFF  → tick skips scoring entirely (no scoring, no trading)
   *   - Trading OFF    → scores/signals still produced, dispatch blocked
   *
   * Flags persist in global_setting; the restart default remains protocols ON,
   * trading OFF unless the stored value says otherwise (explicit user action).
   */
  async setLayer(layer: 'protocols' | 'trading', enabled: boolean): Promise<{ layer: string; enabled: boolean }> {
    if (layer === 'protocols') {
      this.state.protocolsEnabled = enabled;
    } else if (layer === 'trading') {
      this.state.tradingEnabled = enabled;
    } else {
      throw new BadRequestException(`Unknown layer: ${layer} — expected 'protocols' or 'trading'`);
    }
    try {
      await (this.prisma as any).globalSetting.upsert({
        where: { key: `automation.${layer}Enabled` },
        create: { key: `automation.${layer}Enabled`, value: String(enabled) },
        update: { value: String(enabled) },
      });
    } catch (err) {
      this.logger.warn(`Layer flag persist failed: ${(err as Error).message}`);
    }
    this.logger.warn(`META.Stack layer '${layer}' ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return { layer, enabled };
  }

  /** #615 — restore persisted layer flags (safe defaults if missing/unreadable). */
  private async restoreLayerFlags() {
    if (!this.prisma.isAvailable) return;
    try {
      const rows: any[] = await (this.prisma as any).globalSetting.findMany({
        where: { key: { in: ['automation.protocolsEnabled', 'automation.tradingEnabled'] } },
      });
      for (const r of rows) {
        if (r.key === 'automation.protocolsEnabled') this.state.protocolsEnabled = r.value === 'true';
        if (r.key === 'automation.tradingEnabled') this.state.tradingEnabled = r.value === 'true';
      }
      this.logger.log(`Layer flags restored — protocols=${this.state.protocolsEnabled}, trading=${this.state.tradingEnabled}`);
    } catch (err) {
      this.logger.warn(`Layer flag restore failed: ${(err as Error).message}`);
    }
  }
}
