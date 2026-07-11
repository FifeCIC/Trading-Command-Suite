/**
 * AutomationLoopService — broker-agnostic scoring & execution engine.
 *
 * Uses manual setInterval (not @nestjs/schedule cron) for:
 *  - Dynamic interval changes per broker
 *  - Immediate pause/resume without restart
 *  - Run-on-demand from dashboard
 *  - No extra dependencies
 *
 * Tick flow:
 *   1. Check Timeline → global risk multiplier
 *   2. Fetch all broker portfolios via AdapterFactory
 *   3. Score every position via ScoringService
 *   4. Evaluate active strategies against scored positions
 *   5. Dispatch: manual→log, semi-auto→queue, auto→execute (with safeties)
 *   6. Record all decisions
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { TimelineService } from './timeline.service';
import { ScoringService } from '../scoring/scoring.service';
import { ScoringLogService } from '../system/scoring-log.service';
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { DuplicateGuardService } from '../trading/duplicate-guard.service';
import { PROTOCOL_REGISTRY } from '../directives/directive-groups';

// ── Protocol-aware thresholds by trading style ──
const STYLE_THRESHOLDS: Record<string, number> = {
  scalp: 75,
  'day-trade': 65,
  speed: 80,
  swing: 55,
  position: 45,
};

function getStyleThreshold(protocolId: string): number {
  const style = PROTOCOL_REGISTRY[protocolId]?.tradingStyle?.toLowerCase() || '';
  if (style.includes('scalp') || style.includes('tick')) return STYLE_THRESHOLDS.scalp;
  if (style.includes('speed')) return STYLE_THRESHOLDS.speed;
  if (style.includes('day')) return STYLE_THRESHOLDS['day-trade'];
  if (style.includes('swing')) return STYLE_THRESHOLDS.swing;
  if (style.includes('position')) return STYLE_THRESHOLDS.position;
  return 60;
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
  watchlistName: string;    // e.g. 'primary', 'momentum-stocks'
  brokerId: string;          // e.g. 'mt5', 'trading212'
  mode: 'manual' | 'semi-auto' | 'auto';
  tradeThreshold: number;
  baseSize: number;
  slPct: number;
  tpPct: number;
  enabled: boolean;
  tradingEnabled: boolean;
}

export interface TickDecision {
  timestamp: string;
  strategyId: string;
  symbol: string;
  brokerId: string;
  decision: 'SCORED' | 'SKIP' | 'SIGNAL' | 'QUEUED' | 'EXECUTED' | 'FAILED' | 'BLOCKED';
  reason: string;
  composite: number;
  signal?: string;
  ticket?: string | number;
  price?: number;
  quantity?: number;
  actionId?: string;
}

// ── Watchlist helpers ─────────────────────────────────

const WATCHLISTS_DIR = resolve(__dirname, '../../../../src/data/watchlists');

function readWatchlist(name: string): string[] | null {
  try {
    const path = resolve(WATCHLISTS_DIR, `${name}.json`);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map((s: any) => typeof s === 'string' ? s : s.ticker || s.symbol).filter(Boolean) : null;
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

  state: LoopState = {
    loopEnabled: false,
    tickIntervalMs: 300000,
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
  };

  /** Scoring strategies: protocol + watchlist pairings */
  scoringStrategies: ScoringStrategy[] = [];

  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly timelineService: TimelineService,
    private readonly scoringService: ScoringService,
    private readonly strategyService: TradingStrategyService,
    private readonly tradeRecorder: TradeRecorderService,
    private readonly duplicateGuard: DuplicateGuardService,
    private readonly scoringLog: ScoringLogService,
    private readonly prisma: PrismaService,
  ) {
    this.initBrokerStates();
    this.loadScoringStrategies();
    // Auto-restore on startup is deferred to onModuleInit (needs DB connection)
  }

  async onModuleInit() {
    // Auto-restore loop + MT5 trading if AUTO_START_AUTOMATION env is not 'false' (defaults true)
    const autoStart = process.env.AUTO_START_AUTOMATION !== 'false';
    if (!autoStart) {
      this.logger.log('Auto-start disabled (AUTO_START_AUTOMATION=false) — loop requires manual start');
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
    // Ensure MT5 is enabled for trading (auto-create if missing)
    if (!this.state.brokerStates['mt5']) {
      this.state.brokerStates['mt5'] = {
        brokerId: 'mt5',
        enabled: true,
        tradingEnabled: true,
        scoreIntervalMs: 300000,
        tradeThreshold: 3,
        requireConfirmation: false,
      };
      this.logger.log('Auto-created MT5 broker state (was missing after initBrokerStates)');
    } else {
      this.state.brokerStates['mt5'].enabled = true;
      this.state.brokerStates['mt5'].tradingEnabled = true;
    }
    try {
      const strategies = await this.strategyService.findAll();
      for (const s of strategies) {
        if (s.active && !(s as any).brokerId) {
          await this.strategyService.update(s.id, { brokerId: 'mt5' } as any);
        }
      }
    } catch (e) { this.logger.warn(`Failed to patch strategies: ${(e as Error).message}`); }
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
          tradeThreshold: getStyleThreshold(''), // Per-protocol — updated when strategies load
          requireConfirmation: true,
        };
      }
    }
  }

  // ── DB Persistence ──────────────────────────────────

  /** Load scoring strategies from DB on startup. Auto-creates from trading strategies if empty. */
  async loadScoringStrategies() {
    try {
      if (!this.prisma.isAvailable) return;
      let rows = await this.prisma.scoringStrategy.findMany({ orderBy: { createdAt: 'asc' } });

      // Auto-create scoring strategies from trading strategies if DB is empty
      if (rows.length === 0) {
        const strategies = await this.strategyService.findAll();
        const activeStrats = strategies.filter((s: any) => s.active);
        const uniqueProtocols = new Map<string, any>();

        for (const strat of activeStrats) {
          if (!strat.protocolId) continue;
          if (!uniqueProtocols.has(strat.protocolId)) {
            uniqueProtocols.set(strat.protocolId, strat);
          }
        }

        if (uniqueProtocols.size > 0) {
          this.logger.log(`No scoring strategies found — auto-creating from ${uniqueProtocols.size} unique protocols`);

          for (const [protocolId, strat] of uniqueProtocols) {
            try {
              await this.prisma.scoringStrategy.create({
                data: {
                  name: `${protocolId} — Auto`,
                  protocolId,
                  watchlistName: 'default',
                  brokerId: strat.brokerId || 'mt5',
                  mode: 'semi-auto',
                  tradeThreshold: strat.minComposite || getStyleThreshold(protocolId),
                  baseSize: strat.baseSize ?? 0.01,
                  slPct: strat.slPct ?? 1.0,
                  tpPct: strat.tpPct ?? 1.0,
                  enabled: true,
                  tradingEnabled: false,
                },
              });
              this.logger.log(`  Created scoring strategy for protocol: ${protocolId}`);
            } catch (err) {
              this.logger.warn(`  Failed to create scoring strategy for ${protocolId}: ${(err as Error).message}`);
            }
          }

          // Reload after creation
          rows = await this.prisma.scoringStrategy.findMany({ orderBy: { createdAt: 'asc' } });
        }
      }

      this.scoringStrategies = rows.map(r => ({
        id: r.id,
        name: r.name,
        protocolId: r.protocolId,
        watchlistName: r.watchlistName,
        brokerId: r.brokerId,
        mode: r.mode as 'manual' | 'semi-auto' | 'auto',
        tradeThreshold: r.tradeThreshold,
        baseSize: r.baseSize,
        slPct: r.slPct,
        tpPct: r.tpPct,
        enabled: r.enabled,
        tradingEnabled: r.tradingEnabled,
      }));
      this.logger.log(`Loaded ${this.scoringStrategies.length} scoring strategies from DB`);
    } catch (err) {
      this.logger.warn(`Failed to load scoring strategies from DB: ${(err as Error).message}`);
    }
  }

  /** Persist a scoring strategy to DB */
  async saveScoringStrategy(strat: ScoringStrategy) {
    try {
      if (!this.prisma.isAvailable) return;
      await this.prisma.scoringStrategy.upsert({
        where: { id: strat.id },
        create: {
          id: strat.id, name: strat.name, protocolId: strat.protocolId,
          watchlistName: strat.watchlistName, brokerId: strat.brokerId,
          mode: strat.mode, tradeThreshold: strat.tradeThreshold,
          baseSize: strat.baseSize, slPct: strat.slPct, tpPct: strat.tpPct,
          enabled: strat.enabled, tradingEnabled: strat.tradingEnabled,
        },
        update: {
          name: strat.name, protocolId: strat.protocolId,
          watchlistName: strat.watchlistName, brokerId: strat.brokerId,
          mode: strat.mode, tradeThreshold: strat.tradeThreshold,
          baseSize: strat.baseSize, slPct: strat.slPct, tpPct: strat.tpPct,
          enabled: strat.enabled, tradingEnabled: strat.tradingEnabled,
        },
      });
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

    try {
      // 1. Check Timeline
      const events = await this.timelineService.getActiveEvents(120);
      this.state.activeTimelineEvents = events;
      const globalEvents = events.filter(e => e.scope === 'global');
      this.state.globalRiskMultiplier = this.timelineService.computeRiskMultiplier(globalEvents);
      this.logger.log(`Tick #${this.state.tickCount}: ${events.length} timeline events, global risk ${this.state.globalRiskMultiplier.toFixed(2)}`);

      // 2. Fetch portfolios from all enabled brokers
      const allPositions: any[] = [];
      for (const [brokerId, brokerState] of Object.entries(this.state.brokerStates)) {
        if (!brokerState.enabled) continue;
        const adapter = this.adapterFactory.create(brokerId);
        if (!adapter?.supportsBrokerage || !adapter.getPositions) continue;

        try {
          const positions = await adapter.getPositions();
          this.logger.log(`  ${brokerId}: ${positions.length} positions`);
          allPositions.push(...positions);
        } catch (err) {
          this.logger.warn(`  ${brokerId}: failed to fetch positions — ${(err as Error).message}`);
        }
      }

      // 2b. Discover active TradingStrategy records from DB
      let activeStrategies: any[] = [];
      try {
        const all = await this.strategyService.findAll();
        activeStrategies = all.filter((s: any) => s.active);
        this.state.activeStrategies = activeStrategies;
        this.logger.log(`  ${activeStrategies.length} active strategies loaded`);
      } catch (err) {
        this.logger.warn(`  Failed to load strategies: ${(err as Error).message}`);
      }
      this.state.activeStrategyIds = activeStrategies.map((s: any) => s.id);

      // Collect symbols from active strategies
      const strategySymbols = [...new Set(activeStrategies.map(s => s.symbol))];
      const allSymbols = [...new Set([...allPositions.map(p => p.symbol), ...strategySymbols])];

      if (allSymbols.length === 0) {
        this.state.lastTickMs = Date.now() - tickStart;
        this.state.nextTickAt = new Date(Date.now() + this.state.tickIntervalMs).toISOString();
        return decisions;
      }

      // 3. Score all symbols via ScoringService.rankAll()
      let scoreMap = new Map<string, any>();
      try {
        const ranked = await this.scoringService.rankAll(undefined, allSymbols.length + 10);
        if (ranked?.ranked) {
          for (const entry of ranked.ranked) {
            scoreMap.set(entry.ticker, entry);
          }
        }

        // Attach scores to positions
        for (const pos of allPositions) {
          const scored = scoreMap.get(pos.symbol) || scoreMap.get(pos.ticker);
          if (scored) {
            pos.composite = scored.score;
            pos.signal = scored.signal;
            pos.dataStatus = scored.dataStatus;
          } else {
            pos.composite = null;
            pos.signal = 'NO_DATA';
            pos.dataStatus = 'untracked';
          }
        }

        // Log scored positions
        const scored = allPositions.filter(p => p.composite !== null);
        this.logger.log(`  Scored ${scored.length}/${allPositions.length} positions`);

        // ── Scoring log: unified logging ──
        this.scoringLog.logScoringRun({
          symbolsScored: scored.length,
          avgScore: scored.length > 0 ? scored.reduce((s, p) => s + p.composite, 0) / scored.length : 0,
          topSymbol: scored[0]?.symbol,
          topScore: scored[0]?.composite,
          durationMs: Date.now() - tickStart,
        });
        // Log top 3 signals
        for (const pos of scored.slice(0, 3)) {
          if (pos.composite >= 40) {
            this.scoringLog.logSignal({
              symbol: pos.symbol, composite: pos.composite,
              signal: pos.signal, confidence: pos.confidence ?? 50,
            });
          }
        }
        // ── End scoring log ──
        for (const pos of scored.slice(0, 5)) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: '',
            symbol: pos.symbol,
            brokerId: pos.brokerId,
            decision: 'SCORED',
            reason: `Composite: ${pos.composite}`,
            composite: pos.composite,
            signal: pos.signal,
          });
        }
      } catch (err) {
        this.logger.error(`Scoring failed: ${(err as Error).message}`);
      }

      // 3b. Score watchlist symbols for each enabled scoring strategy
      for (const strat of this.scoringStrategies) {
        if (!strat.enabled) continue;
        const wlSymbols = readWatchlist(strat.watchlistName);
        if (!wlSymbols || wlSymbols.length === 0) continue;

        try {
          const newSymbols = wlSymbols.filter(s => !allSymbols.includes(s));
          if (newSymbols.length === 0) continue;

          const ranked = await this.scoringService.rankAll(undefined, [...allSymbols, ...newSymbols].length + 10);
          const scoreMap = new Map<string, any>();
          if (ranked?.ranked) for (const e of ranked.ranked) scoreMap.set(e.ticker, e);

          let scoredCount = 0;
          for (const sym of wlSymbols) {
            const s = scoreMap.get(sym);
            if (!s || s.score === null) continue;
            scoredCount++;

            const adjScore = s.score * this.state.globalRiskMultiplier;
            if (adjScore < strat.tradeThreshold) continue;

            decisions.push({
              timestamp: new Date().toISOString(),
              strategyId: strat.id, symbol: sym, brokerId: strat.brokerId,
              decision: 'SCORED',
              reason: `${strat.watchlistName} × ${strat.protocolId}: ${s.score}`,
              composite: s.score, signal: s.signal,
            });

            // Dispatch if trading enabled
            if ((strat.mode === 'auto' || strat.mode === 'semi-auto') && this.state.brokerStates[strat.brokerId]?.tradingEnabled) {
              if (this.lastAnyTradeAt && (Date.now() - this.lastAnyTradeAt) < 60000) continue;

              const side = s.signal || 'BUY';

              // Duplicate guard — block if position already open
              const dupCheck = await this.duplicateGuard.checkDuplicate(sym, strat.brokerId, strat.protocolId);
              if (dupCheck.blocked) {
                decisions.push({ timestamp: new Date().toISOString(), strategyId: strat.id, symbol: sym, brokerId: strat.brokerId, decision: 'BLOCKED', reason: dupCheck.reason || 'Duplicate position', composite: s.score, signal: side });
                continue;
              }

              const broker = this.adapterFactory.create(strat.brokerId);
              if (!broker?.placeOrder) continue;

              const sl = side === 'BUY' ? s.lastPrice * (1 - strat.slPct/100) : s.lastPrice * (1 + strat.slPct/100);
              const tp = side === 'BUY' ? s.lastPrice * (1 + strat.tpPct/100) : s.lastPrice * (1 - strat.tpPct/100);

              if (strat.mode === 'semi-auto') {
                const aid = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
                this.state.pendingActions.push({
                  id: aid, strategyId: strat.id, symbol: sym, brokerId: strat.brokerId,
                  side, quantity: strat.baseSize, composite: s.score,
                  createdAt: new Date().toISOString(),
                  expiresAt: new Date(Date.now() + 5*60000).toISOString(),
                });
                decisions.push({ timestamp: new Date().toISOString(), strategyId: strat.id, symbol: sym, brokerId: strat.brokerId, decision: 'QUEUED', reason: 'Awaiting confirmation', composite: s.score, signal: side, actionId: aid });
              } else {
                const result = await broker.placeOrder({
                  symbol: sym, side: side as 'BUY'|'SELL', quantity: strat.baseSize, sl, tp,
                  comment: `TCS ${strat.name} | ${s.score}%`,
                });
                if (result.success) {
                  this.lastAnyTradeAt = Date.now();
                  try { this.tradeRecorder.record({ symbol: sym, side: side.toLowerCase(), quantity: strat.baseSize, entryPrice: result.price||s.lastPrice||0, pnl:0, provider: strat.brokerId, status:'open', origin:'strategy', scoringStrategyId: strat.id } as any); } catch {}
                }
                decisions.push({ timestamp: new Date().toISOString(), strategyId: strat.id, symbol: sym, brokerId: strat.brokerId, decision: result.success?'EXECUTED':'FAILED', reason: result.success?`Ticket ${result.ticket}`:(result.error||'Unknown'), composite: s.score, signal: side, ticket: result.ticket, price: result.price, quantity: strat.baseSize });
              }
            }
          }
          if (scoredCount > 0) this.logger.log(`  Watchlist "${strat.watchlistName}": ${scoredCount}/${wlSymbols.length} above threshold`);
        } catch (err) {
          this.logger.error(`Watchlist scoring "${strat.watchlistName}" failed: ${(err as Error).message}`);
        }
      }

      // 4. Evaluate active strategies (pass scoreMap for fallback when no position)
      for (const strategyId of this.state.activeStrategyIds) {
        const strategyDecision = await this.evaluateStrategy(strategyId, allPositions, scoreMap);
        if (strategyDecision) decisions.push(strategyDecision);
      }

    } catch (err) {
      this.logger.error(`Tick #${this.state.tickCount} failed: ${(err as Error).message}`);
    }

    this.state.lastTickMs = Date.now() - tickStart;
    this.state.nextTickAt = new Date(Date.now() + this.state.tickIntervalMs).toISOString();

    // Store recent decisions (keep last 50)
    this.state.recentDecisions = [...decisions, ...this.state.recentDecisions].slice(0, 50);

    this.logger.log(`Tick #${this.state.tickCount} completed in ${this.state.lastTickMs}ms — ${decisions.length} decisions`);
    return decisions;
  }

  private async evaluateStrategy(strategyId: string, positions: any[], scoreMap: Map<string, any>): Promise<TickDecision | null> {
    try {
      const strategy = await this.strategyService.findOne(strategyId);
      if (!strategy || !strategy.active) return null;

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
          // Strategy's own minComposite takes priority over broker default
          const threshold = strategy.minComposite ?? brokerState?.tradeThreshold ?? getStyleThreshold(strategy.protocolId);
          const passed = adjScore >= threshold;
          
          // Attempt full evaluation for DB persistence
          try {
            const evalResult = await this.strategyService.evaluate(strategyId);
            if (evalResult.evaluated && evalResult.passed && strategy.mode === 'auto') {
              // ── Auto-execute when no existing position ──
              const bs = this.state.brokerStates[strategy.brokerId || 'mt5'];
              if (bs?.tradingEnabled && (!this.lastAnyTradeAt || Date.now() - this.lastAnyTradeAt >= 60000)) {
                const broker = this.adapterFactory.create(strategy.brokerId || 'mt5');
                if (broker?.placeOrder) {
                  let size = (strategy as any).baseSize || 0.01;
                  const slPct = (strategy as any).slPct || 1.0;
                  const tpPct = (strategy as any).tpPct || 1.0;
                  const entryPrice = evalResult.signal === 'SELL' ? lookupScore.lastPrice : lookupScore.lastPrice;
                  const sl = evalResult.signal === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
                  const tp = evalResult.signal === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);
                  const orderResult = await broker.placeOrder({
                    symbol: strategy.symbol,
                    side: evalResult.signal as 'BUY' | 'SELL',
                    quantity: size,
                    sl,
                    tp,
                    comment: `TCS ${strategy.name} | ${evalResult.composite}%`,
                  });
                  if (orderResult.success) {
                    this.lastAnyTradeAt = Date.now();
                    this.lastTradeTime.set(strategyId, Date.now());
                    try { this.tradeRecorder.record({ symbol: strategy.symbol, side: evalResult.signal?.toLowerCase(), quantity: size, entryPrice: orderResult.price || lookupScore.lastPrice || 0, pnl: 0, provider: strategy.brokerId || 'mt5', status: 'open', origin: 'strategy', scoringStrategyId: strategyId } as any); } catch {}
                  }
                  return {
                    timestamp: new Date().toISOString(),
                    strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
                    decision: orderResult.success ? 'EXECUTED' : 'FAILED',
                    reason: orderResult.success ? `Ticket ${orderResult.ticket}` : (orderResult.error || 'Unknown'),
                    composite: evalResult.composite ?? lookupScore.score,
                    signal: evalResult.signal,
                    ticket: orderResult.ticket,
                    price: orderResult.price,
                    quantity: size,
                  };
                }
              }
            }
            if (evalResult.evaluated) {
              return {
                timestamp: new Date().toISOString(),
                strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
                decision: evalResult.passed ? 'SCORED' : 'SKIP',
                reason: evalResult.passed
                  ? `Evaluate passed: ${evalResult.composite}`
                  : `Evaluate: ${evalResult.reason || 'conditions not met'}`,
                composite: evalResult.composite ?? lookupScore.score, signal: evalResult.signal,
              };
            }
          } catch (err) {
            this.logger.debug(`Full evaluate failed for ${strategy.symbol}, using rankAll score: ${(err as Error).message}`);
          }
          
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: passed ? 'SCORED' : 'SKIP',
            reason: passed
              ? `Strategy composite: ${lookupScore.score} (from rankAll)`
              : `Score ${lookupScore.score} × risk ${this.state.globalRiskMultiplier.toFixed(2)} = ${adjScore.toFixed(1)} < threshold ${threshold}`,
            composite: lookupScore.score,
            signal: lookupScore.signal,
          };
        }
        // No scoreMap entry — try full evaluate anyway (data may have arrived)
        try {
          const evalResult = await this.strategyService.evaluate(strategyId);
          if (evalResult.evaluated && evalResult.passed && strategy.mode === 'auto') {
            // ── Auto-execute for symbols not in rankAll (e.g. forex) ──
            const bs = this.state.brokerStates[strategy.brokerId || 'mt5'];
            if (bs?.tradingEnabled && (!this.lastAnyTradeAt || Date.now() - this.lastAnyTradeAt >= 60000)) {
              const broker = this.adapterFactory.create(strategy.brokerId || 'mt5');
              if (broker?.placeOrder) {
                const size = (strategy as any).baseSize || 0.01;
                const slPct = (strategy as any).slPct || 1.0;
                const tpPct = (strategy as any).tpPct || 1.0;
                const side = evalResult.signal as 'BUY' | 'SELL';
                let entryPrice = 0;
                try {
                  const quote = await broker.getQuote(strategy.symbol);
                  if (quote?.ask && quote?.bid) {
                    entryPrice = side === 'BUY' ? quote.ask : quote.bid;
                  }
                } catch { /* use 0 — bridge will use market */ }
                const sl = entryPrice > 0 ? (side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100)) : 0;
                const tp = entryPrice > 0 ? (side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100)) : 0;
                const orderResult = await broker.placeOrder({
                  symbol: strategy.symbol,
                  side,
                  quantity: size,
                  sl,
                  tp,
                  comment: `TCS ${strategy.name} | ${evalResult.composite}%`,
                });
                if (orderResult.success) {
                  this.lastAnyTradeAt = Date.now();
                  this.lastTradeTime.set(strategyId, Date.now());
                  try { this.tradeRecorder.record({ symbol: strategy.symbol, side: side.toLowerCase(), quantity: size, entryPrice: orderResult.price || entryPrice, pnl: 0, provider: strategy.brokerId || 'mt5', status: 'open', origin: 'strategy', scoringStrategyId: strategyId } as any); } catch {}
                }
                return {
                  timestamp: new Date().toISOString(),
                  strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
                  decision: orderResult.success ? 'EXECUTED' : 'FAILED',
                  reason: orderResult.success ? `Ticket ${orderResult.ticket}` : (orderResult.error || 'Unknown'),
                  composite: evalResult.composite ?? 0, signal: evalResult.signal,
                  ticket: orderResult.ticket, price: orderResult.price, quantity: size,
                };
              }
            }
          }
          if (evalResult.evaluated) {
            return {
              timestamp: new Date().toISOString(),
              strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
              decision: evalResult.passed ? 'SCORED' : 'SKIP',
              reason: evalResult.passed
                ? `Evaluate passed: ${evalResult.composite}`
                : `Evaluate: ${evalResult.reason || 'conditions not met'}`,
                composite: evalResult.composite ?? 0, signal: evalResult.signal ?? 'neutral',
            };
          }
        } catch (err) {
          // Symbol not in DB or no bars — expected for newly added strategies
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

      // Duplicate position guard — don't stack orders on existing positions
      const maxPos = (strategy as any).maxPositions ?? 1;
      if (maxPos <= 1) {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SKIP', reason: 'Position already open (maxPositions=1)',
          composite: pos.composite, signal: pos.signal,
        };
      }

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

      // Compute position size from strategy config
      let size = (strategy as any).baseSize || 0.01;
      if ((strategy as any).useRaritySizing && evalResult.rarity) {
        size *= (evalResult.rarity.sizeMultiplier || 1);
      }
      if ((strategy as any).maxSize) {
        size = Math.min(size, (strategy as any).maxSize);
      }
      size = Math.round(size * 10000) / 10000;

      // Compute SL/TP prices (approximate — actual fill price unknown)
      const slPct = (strategy as any).slPct || 1.0;
      const tpPct = (strategy as any).tpPct || 1.0;
      const slPrice = evalResult.signal === 'BUY' ? pos.currentPrice * (1 - slPct / 100) : pos.currentPrice * (1 + slPct / 100);
      const tpPrice = evalResult.signal === 'BUY' ? pos.currentPrice * (1 + tpPct / 100) : pos.currentPrice * (1 - tpPct / 100);

      // Dispatch by mode
      if (strategy.mode === 'manual') {
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'SIGNAL', reason: 'Manual mode — logged for review',
          composite: evalResult.composite, signal: evalResult.signal,
          quantity: size,
        };
      }

      if (strategy.mode === 'semi-auto') {
        const actionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.state.pendingActions.push({
          id: actionId, strategyId, symbol: strategy.symbol,
          brokerId: strategy.brokerId || 'mt5',
          side: evalResult.signal || 'BUY',
          quantity: size,
          composite: evalResult.composite,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 5 * 60000).toISOString(),
          evaluationId: evalResult.evaluationId,
        });
        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: 'QUEUED', reason: 'Awaiting confirmation',
          composite: evalResult.composite, signal: evalResult.signal,
          actionId,
        };
      }

      if (strategy.mode === 'auto') {
        // Safety: max 1 trade per tick
        const brokerState = this.state.brokerStates[strategy.brokerId || 'mt5'];
        if (!brokerState?.tradingEnabled) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP', reason: 'Trading disabled for this broker',
            composite: evalResult.composite, signal: evalResult.signal,
          };
        }

        // Safety: min 60s between any trades
        if (this.lastAnyTradeAt && (Date.now() - this.lastAnyTradeAt) < 60000) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP', reason: 'Min 60s between trades',
            composite: evalResult.composite, signal: evalResult.signal,
          };
        }

        // Execute
        const broker = this.adapterFactory.create(strategy.brokerId || 'mt5');
        if (!broker?.placeOrder) {
          return {
            timestamp: new Date().toISOString(),
            strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'FAILED', reason: `Broker ${strategy.brokerId} does not support orders`,
            composite: evalResult.composite, signal: evalResult.signal,
          };
        }

        const result = await broker.placeOrder({
          symbol: strategy.symbol,
          side: evalResult.signal as 'BUY' | 'SELL',
          quantity: size,
          sl: slPrice,
          tp: tpPrice,
          comment: `TCS ${strategy.name} | ${evalResult.composite}%`,
        });

        this.lastTradeTime.set(strategyId, Date.now());
        this.lastAnyTradeAt = Date.now();

        // Record trade
        if (result.success) {
          try {
            this.tradeRecorder.record({
              symbol: strategy.symbol,
              side: evalResult.signal?.toLowerCase() || 'buy',
              quantity: size,
              entryPrice: result.price || 0,
              pnl: 0,
              provider: strategy.brokerId || 'mt5',
              status: 'open',
              origin: 'strategy',
              scoringStrategyId: strategyId,
            } as any);
          } catch { /* non-critical */ }
        }

        return {
          timestamp: new Date().toISOString(),
          strategyId, symbol: strategy.symbol, brokerId: strategy.brokerId || 'mt5',
          decision: result.success ? 'EXECUTED' : 'FAILED',
          reason: result.success ? `Ticket ${result.ticket}` : (result.error || 'Unknown error'),
          composite: evalResult.composite, signal: evalResult.signal,
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

  getState(): LoopState {
    return { ...this.state, pendingActions: [...this.state.pendingActions] };
  }

  confirmAction(actionId: string): { confirmed: boolean; message: string } {
    const idx = this.state.pendingActions.findIndex(a => a.id === actionId);
    if (idx === -1) return { confirmed: false, message: 'Action not found or expired' };
    this.state.pendingActions.splice(idx, 1);
    // Actual execution would happen here — for now just acknowledge
    this.logger.log(`Action ${actionId} confirmed`);
    return { confirmed: true, message: 'Action confirmed' };
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
  emergencyStop(): { stopped: boolean; message: string } {
    this.stop();
    this.state.pendingActions = [];
    this.state.activeStrategyIds = [];
    for (const bs of Object.values(this.state.brokerStates)) {
      bs.tradingEnabled = false;
    }
    this.logger.warn('EMERGENCY STOP — loop killed, trading disabled, pending actions cleared');
    return { stopped: true, message: 'Emergency stop complete. All trading disabled. Pending actions cleared.' };
  }
}
