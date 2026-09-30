/**
 * AutomationLoopService — ORCHESTRATOR of the META.Stack pipeline tick.
 * ==============================================================
 * ROLE: one scoring line + one trade path per tick.
 *   - Does NOT compute directive scores (delegates to SignalEnvelope/
 *     ProtocolGating). Does NOT place broker orders (delegates to the shared
 *     dispatchTrade safety chain).
 *
 * ⚠️ CONCEPT (2026-09-02, #714) — read before changing this file:
 *   "Strategy" = the WHOLE pipeline: Protocol (signal thesis) + Trading Bot
 *   (execution policy). A `TradingStrategy` DB row is really a BOT — an
 *   execution/money-management policy named by BEHAVIOUR, not by symbol
 *   (e.g. "Quick Win CFD", not "Sydney AUDUSD"). Bots subscribe to protocols
 *   (strategy_protocol) as signal sources; their queues (strategy_signal_queue)
 *   fill from the ONE scoring line; each bot processes its OWN queue.
 *   The loop NEVER re-scores a strategy — evaluateStrategy / resolveBestSignal /
 *   compareProtocolPair were RETIRED. Dual LONG-vs-SHORT winner-pick is gone by
 *   design (direction is declared by the protocol). Do NOT reintroduce
 *   strategy-side scoring or a second scoring line.
 *
 * PIPELINE POSITION:
 *   SignalEnvelope/ProtocolGating (score) → DB signal records
 *   → AutomationLoop tick:
 *       3b. buildBestLadder()   = ONE scoring line (score, persist, sync queues)
 *       4.  processSignalQueues() = queue heads → gates → dispatchTrade
 *   → dispatchTrade safety chain → broker adapters
 *
 * BOUNDARY: READS scores/signals and MAKES dispatch decisions; does NOT
 *           compute directive-level scores or place broker orders itself.
 *
 * Uses manual setInterval (not @nestjs/schedule cron) for:
 *  - Dynamic interval changes per broker
 *  - Immediate pause/resume without restart
 *  - Run-on-demand from dashboard
 */

import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../../database/prisma.service';
// #929 — the runner consumes EVERY active test now (capacity >1); the type names the param.
import type { AbTest } from '@prisma/client';
// ⚠️ #908 — required by the data-readiness gate: `recommendedTimeframe` is FREE TEXT and
// must reach bar queries through selectBaseTimeframe() (INV-SINGLE-CADENCE).
import { selectBaseTimeframe } from '../../common/utils/timeframe';
import { AdapterFactory } from '../providers/adapter-factory';
import { TimelineService } from './timeline.service';
import { ScoringService } from '../scoring/scoring.service';
import { MetaStackVersioningService } from '../scoring/metastack-versioning.service';
import { StrategyRegistryService } from '../scoring/strategy-registry.service';
import { ScoringLogService } from '../system/scoring-log.service';
import { TradingStrategyService } from '../trading/trading-strategy.service';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { PyramidPolicyService } from '../trading/pyramid-policy.service';
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
import { SignalEnvelopeService } from '../signals/signal-envelope.service';
import { StopGuardianService } from './stop-guardian.service';
import { PositionTimeStopService } from './position-time-stop.service';
import { ExecutionFeasibilityService } from '../trading/execution-feasibility.service';
import { checkSessionWindow, auditNameVsWindow, SessionGateResult } from '../trading/session-window';
import { resolveStyleThreshold, BOT_BAR_DEFAULT } from '../../common/utils/style-thresholds';
// ⚠️ SINGLE AUTHORITY for signal-class → direction/side. Replacing local predicates here because
// `score.signal === 'SELL'` misses `STRONG_SELL`, which dispatched a BUY on the strongest bearish
// signal. See `signal-direction.ts`.
import { signalToSide, directionToSide } from '../../common/utils/signal-direction';
// ⚠️ #882 — the ONE freshness bound, shared with the queue sweep (signal-queue.service.ts).
// The consumer gate must refuse what the sweep expires; a second literal here would drift.
import { getMaxSignalAgeMinutes, signalAgeMinutes } from '../../common/utils/signal-freshness';
import { computeMarketStatus } from '../directives/market-status';
// #849 (2026-09-17) — the layer kill switches and bot-queue settings are declared settings now.
// ⚠️ The DEFAULTS in settings-registry.ts are load-bearing: `automation.tradingEnabled` is false, and it
// must stay false. See the warning comment there before changing any of them.
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';

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
 *   — #714 (2026-09-02): the bar is now checked by processSignalQueues against
 *     the signal record's compositePct — no strategy-side scoring exists.
 *
 * ⚠️ SCALE WARNING (2026-08-13) ⚠️
 * These thresholds (and Layer 3's minComposite in the DB) were calibrated for
 * the OLD 0-100 composite scale. The composite is now RAW (values in the
 * hundreds — see protocol-gating.service.ts SCALE WARNING). A minComposite of
 * 55 on the old scale now passes almost any raw composite (55+), which is why
 * the app over-produced BUY signals. Do NOT tune these to new absolute values
 * — the correct fix is percentage-based thresholds (composite / maxScore × 100)
 * so custom protocols of any maxScore share the same semantics.
 *
 * The style→bar table and matcher live in common/utils/style-thresholds.ts.
 * This file used to carry its own copy with a DIFFERENT fallback (60) from the
 * signals gate's (65); two copies of one table always drift.
 */
function getStyleThreshold(tradingStyle?: string): number {
  // BOT_BAR_DEFAULT (60) preserves this path's historic fallback exactly.
  return resolveStyleThreshold(tradingStyle, BOT_BAR_DEFAULT).threshold;
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
  /** #714 Stage 3 — Expert Trading Bot queue processing + pacing. */
  botQueueEnabled: boolean;
  botInterTradeDelayMinutes: number;
  lastBotTradeAt: string | null;
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
  /**
   * Open positions held at this broker, as MEASURED on the last tick.
   *
   * ⚠️ THREE STATES — do not collapse them:
   *   number → measured this tick
   *   0      → measured, and the broker genuinely holds none
   *   null   → NOT MEASURED (no adapter yet, the fetch threw, or no tick has run)
   *
   * WHY THIS FIELD IS SPELLED OUT AT ALL: `MarketTape` and the Automation Pulse widget both
   * READ `brokerStates[*].positionCount`, but nothing ever WROTE it. `(b.positionCount || 0)`
   * turned "not reported" into a confident `0`, so the header tape displayed "0 positions"
   * permanently — while MT5 actually held five. A field that is read but never written looks
   * exactly like a field that is always zero, and no error is raised either way.
   *
   * Every reader MUST render `null` as unknown (`?`), never as `0`.
   * `MetaStackCockpitPage` already does this correctly — follow that.
   */
  positionCount?: number | null;
}

export interface PendingAction {
  id: string;
  strategyId: string;
  symbol: string;
  brokerId: string;
  side: string;
  quantity: number;
  composite: number;
  slPct?: number;
  tpPct?: number;
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

/**
 * #909 / #937 — the score slots, as a DISCRIMINATED CHOICE rather than two loose optionals.
 *
 *   compositeRaw — the additive protocol score (envelope ladder + A/B writers). Compared
 *                  against protocol capacity, NOT against a percentage bar.
 *   compositePct — percentage of the protocol's CONFIGURED capacity, 0-100 (queue path).
 *                  This is the number `minComposite` was calibrated for.
 *
 * ⚠️ They are different quantities. Do not compare, average or chart them as one series.
 * Exactly one is set; a BOTH-NULL pair means "no score" — never 0, because a 0 reads as a real
 * measurement in either unit (the defect #909 removed: the old `composite` column held both
 * units under one name).
 *
 * ⚠️ #937 — THE TYPE ENFORCES THIS; IT IS NOT A COMMENT. Both slots used to be independent
 * optionals, so a writer could omit BOTH and persist an untyped row with nothing failing —
 * the verifier's finding on #909 ("the build fails if a writer omits it") was not true. The
 * union below makes the choice mandatory: `?: never` on the opposite arm means a literal that
 * sets NEITHER slot, or BOTH, is a compile error at every push site — and because jest runs
 * ts-jest with diagnostics, removing the unit from a scored write path fails a TEST, not just
 * the build. To write "no score", say so: `compositePct: null`.
 * The enforcement is itself guarded (automation-loop-decision-units.spec.ts), so reverting this
 * union to two loose optionals also fails the suite.
 */
type TickDecisionScore =
  | { compositeRaw: number | null; compositePct?: never }
  | { compositePct: number | null; compositeRaw?: never };

export type TickDecision = {
  timestamp: string;
  strategyId: string;
  symbol: string;
  brokerId: string;
  // ⚠️ #971 — 'OBSERVED' means NOTHING CONSUMES THIS ROW. A ladder envelope has no bot attached,
  // so it is an observation, not a signal. It used to be written as 'SCORED' (the same value a
  // bot's dispatched signal carries) with `strategyId: ''`, which made "nothing reads this" an
  // inference from an empty column instead of a stated fact.
  decision: 'OBSERVED' | 'SCORED' | 'SKIP' | 'SIGNAL' | 'QUEUED' | 'EXECUTED' | 'FAILED' | 'BLOCKED' | 'PYRAMID';
  reason: string;
  signal?: string;
  ticket?: string | number;
  price?: number;
  quantity?: number;
  actionId?: string;
} & TickDecisionScore;

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
  /** #714 Stage 3 — bot pacing: last queue-driven trade per strategy + globally. */
  private lastBotTradeAt = new Map<string, number>();
  private lastBotTradeAnyAt = 0;
  /** Prevent overlapping interval/manual ticks from racing through pre-trade gates. */
  private tickInProgress = false;

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
   * Shared trade dispatch — the ONLY trade path in the tick lifecycle.
   *
   * PIPELINE POSITION:
   *   Step 1: Timeline risk check → global risk multiplier
   *   Step 2: Fetch positions + load active strategies
   *   Step 3: ONE scoring line (buildBestLadder) → signal records → queues
   *   Step 4: processSignalQueues → queue heads → gates (no re-scoring)
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
    /** #909 — percentage of configured capacity (0-100). Its ONLY caller is the queue path,
     *  where the value is `strategy_signal_queue.compositePct`. Named for its unit. */
    compositePct: number;
    baseSize: number;
    slPct: number;
    tpPct: number;
    entryPrice: number;
    mode: string;
    protocolId: string | null;
    executionId?: string;
    /** #1018 — the bot's MT5 magic. OMITTED when unknown. */
    magic?: number;
    decisions: TickDecision[];
  }): Promise<void> {
    const { strategyId, strategyName, symbol, brokerId, side, compositePct, baseSize, slPct, tpPct, entryPrice, mode, protocolId, executionId, decisions } = params;

    // #615 mandate: Trading layer OFF → signals still generated, never dispatched.
    if (!this.state.tradingEnabled) {
      this.auditLog.logBlocked(this.state.tickCount, strategyId, symbol, 'Trading layer disabled — dispatch blocked');
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason: 'Trading layer disabled', compositePct: compositePct, signal: side });
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

    // Duplicate / scale-in policy (#721 — shared library, bot path)
    const broker = this.adapterFactory.create(brokerId);
    let openPositions: any[] = [];
    try {
      openPositions = (await broker?.getPositions?.()) ?? [];
    } catch { /* unknown — policy will treat as no open position */ }
    const pyramid = await this.pyramidPolicy.evaluate({
      symbol, side, brokerId, positions: openPositions,
    });
    if (!pyramid.allowed) {
      const first = pyramid.blockers[0];
      const reason = first?.message || 'Duplicate/scale-in policy block';
      this.auditLog.logBlocked(this.state.tickCount, strategyId, symbol, reason);
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason, compositePct, signal: side });
      return;
    }

    // Portfolio-wide risk authority (merged from CodeRabbit 416f794 / MST-006).
    // Kept alongside the per-symbol duplicate/scale-in policy above: one guards
    // Position building, the other guards aggregate account risk.
    // ⚠️ `symbol` is passed because the per-symbol cap needs the instrument's contract size and
    // price — without them gold and a yen cross are priced identically (#865).
    const accountRisk = await this.strategyService.assessGlobalRiskLimits(baseSize, symbol);
    if (!accountRisk.allowed) {
      this.auditLog.logBlocked(this.state.tickCount, strategyId, symbol, accountRisk.reason);
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason: accountRisk.reason, compositePct, signal: side });
      return;
    }

    // Authoritative feasibility re-check immediately before broker dispatch.
    // Generation annotations are advisory because positions/market state may
    // change while a queue entry waits (2026-09-08).
    const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    const freshBars = dbSymbol ? await this.marketData.getBars(dbSymbol.id, '5m', 20) : [];
    const feasibility = await this.feasibility.assess({
      symbol,
      side,
      brokerId,
      protocolId,
      marketStatus: computeMarketStatus(freshBars),
    });
    if (!feasibility.feasible) {
      const reason = feasibility.blockers.map(blocker => blocker.message).join('; ');
      this.auditLog.logBlocked(this.state.tickCount, strategyId, symbol, reason);
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'BLOCKED', reason, compositePct, signal: side });
      return;
    }

    if (!broker?.placeOrder) return;

    const sl = side === 'BUY' ? entryPrice * (1 - slPct/100) : entryPrice * (1 + slPct/100);
    const tp = side === 'BUY' ? entryPrice * (1 + tpPct/100) : entryPrice * (1 - tpPct/100);

    if (mode === 'semi-auto') {
      const aid = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const action: PendingAction = {
        id: aid, strategyId, symbol, brokerId,
        // `PendingAction.composite` is the pending_action table's own column (#909 is about
        // decision_log only) — it receives the same queue-path percentage.
        side, quantity: baseSize, composite: compositePct, slPct, tpPct,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5*60000).toISOString(),
      };
      this.state.pendingActions.push(action);
      await this.persistPendingAction(action);
      decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: 'QUEUED', reason: 'Awaiting confirmation', compositePct, signal: side, actionId: aid });
      return;
    }

    // Auto-execute
    this.auditLog.logDispatch(this.state.tickCount, strategyId, symbol, side, baseSize, sl, tp, entryPrice);
    const result = await broker.placeOrder({
      symbol, side: side as 'BUY'|'SELL', quantity: baseSize, sl, tp,
      // Name only — the sanitizer strips '|'/'%', so "| composite%" polluted
      // the strategy name parsed back on close (see mt5-comment.util.ts).
      comment: `TCS ${strategyName}`,
      // #1018 — the position's identity for life (see the adapter note).
      magic: params.magic,
      clientOrderId: executionId,
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
          // #1018 — RECORD THE OWNER ON THE ROW, not only on the position. This was omitted, so
          // `trade.magic` was NULL on every open row and the ONLY remaining owner key was a
          // `scoringStrategyId` that holds slugs as well as UUIDs. Measured 2026-09-29: 150 of 318
          // closed trades could not be attributed to ANY bot.
          magic: params.magic,
          // ⚠️ #1014 — DELIBERATELY STILL THE ORDER TICKET. This looks like the bug the issue
          // describes (the reconciler matches `deal.positionId`), and I changed it to prefer
          // `result.positionId` — then reverted, because that alone is UNSAFE:
          //
          // `position-sync.service.ts` computes `realizedPnl` as the WHOLE net of the position's
          // closing deals, with NO split by the row's volume. On a NETTING account every order on a
          // symbol shares one positionId, so N rows carrying it would EACH claim the full P&L —
          // a 4x overstatement on a scale-in, and a plausible-looking one.
          //
          // Measured 2026-09-28: no two `trade` rows share a brokerTicket yet, so nothing is
          // overstated today. The correct fix needs the reconciler to SPLIT by volume ("many rows
          // sharing a positionId") — and that split cannot be verified while no multi-row position
          // exists. Shipping an unverifiable money path is worse than shipping this comment.
          // The plumbing is in place: `result.positionId` is populated by the adapter.
          brokerTicket: result.ticket != null ? String(result.ticket) : undefined,
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
    decisions.push({ timestamp: new Date().toISOString(), strategyId, symbol, brokerId, decision: result.success?'EXECUTED':'FAILED', reason: result.success?`Ticket ${result.ticket}`:(result.error||'Unknown'), compositePct, signal: side, ticket: result.ticket, price: result.price, quantity: baseSize });
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
    // #714 Stage 3 — bot queue ON (paper-only while trading layer is OFF).
    botQueueEnabled: true,
    botInterTradeDelayMinutes: 10,
    lastBotTradeAt: null,
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
    private readonly pyramidPolicy: PyramidPolicyService,
    private readonly scoringLog: ScoringLogService,
    private readonly prisma: PrismaService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly diversification: GlobalDiversificationService,
    private readonly marketData: MarketDataService,
    private readonly barRefresh: BarRefreshService,
    private readonly auditLog: AuditLogService,
    private readonly settings: SettingsResolverService,
    private readonly directivesService: DirectivesService,
    private readonly protocolDb: ProtocolDbService,
    private readonly versioningService: MetaStackVersioningService,
    private readonly positionSync: PositionSyncService,
    private readonly weekendDefense: WeekendDefenseService,
    private readonly symbolResolver: SymbolResolverService,
    private readonly jobQueue: JobQueueService,
    private readonly abTestService: AbTestService,
    private readonly signalEnvelope: SignalEnvelopeService,
    private readonly stopGuardian: StopGuardianService,
    private readonly positionTimeStop: PositionTimeStopService,
    private readonly feasibility: ExecutionFeasibilityService,
    // #875 — the materialisation watcher: syncAuto() mints a registry row (stable id, name null)
    // for a NEWLY materialised combination, so every live strategy has an identity before naming.
    private readonly strategyRegistry: StrategyRegistryService,
  ) {
    this.initBrokerStates();
  }

  async onModuleInit() {
    // #615 — restore layer kill switches (fail-safe defaults: protocols ON, trading OFF).
    await this.restoreLayerFlags();

    // Auto-restore the loop ONLY if AUTO_START_AUTOMATION is explicitly 'true' (fail-closed).
    // The per-broker trading flag is restored later, after the LAST
    // initBrokerStates() — see the comment there for why ordering matters.
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
    // Re-init broker states now that ProvidersModule has registered adapters.
    //
    // ⚠️ ORDERING IS LOAD-BEARING (2026-09-10). The broker-trading restore MUST
    // come after BOTH this initBrokerStates() AND the mt5 auto-create block
    // below. Two earlier placements each failed silently:
    //   1. next to restoreLayerFlags() → the later initBrokerStates() clobbered it;
    //   2. immediately after initBrokerStates() → at that point
    //      getBrokerageAdapters() is still empty, so the loop iterated an empty
    //      map and restored nothing, and the mt5 auto-create then set it false.
    // Both looked correct in the database while the running value stayed off.
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
        positionCount: null, // not measured until the first successful tick fetch
      };
      this.logger.log('Auto-created MT5 broker state (was missing after initBrokerStates)');
    }

    // THE per-broker trading restore — deliberately the LAST word on the flag.
    // Everything that can create or reset a broker entry has now run.
    await this.restoreBrokerTradingFlags();
    this.logEffectiveTradingState();
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
          // null = not measured yet. NOT 0 — no tick has run, so the count is unknown,
          // not zero. See BrokerLoopState.positionCount for why this distinction is load-bearing.
          positionCount: null,
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
          composite: action.composite, slPct: action.slPct, tpPct: action.tpPct,
          createdAt: new Date(action.createdAt),
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
          composite: r.composite, slPct: r.slPct ?? undefined, tpPct: r.tpPct ?? undefined,
          createdAt: r.createdAt.toISOString(),
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

  /**
   * Run the first tick once the broker adapters are registered.
   *
   * WHY (#877): `start()` deliberately ticks immediately so a restart does not cost a full
   * interval. But the adapters are registered by `ProvidersModule`'s OWN `onModuleInit`, and Nest
   * does not guarantee that hook runs before this one. Measured 2026-09-18 on 0.35.0:
   *
   *     Tick #1: 1 timeline events, global risk 1.00
   *     WARN  [AdapterFactory] No adapter registered for id: mt5          ← the tick's own fetch
   *     DEBUG [AdapterFactory] Registered adapter: mt5 (MetaTrader 5)     ← registration, after
   *
   * `create('mt5')` returned null, the broker loop skipped that broker, and
   * `positionSync.syncPositions()` was never called — so the pass reconciled nothing and closed
   * nothing, with **no line saying it had been skipped**. The next tick 2 minutes later worked.
   *
   * ⚠️ `listAdapters()` is read-only — it reads the registry and does NOT instantiate. That
   * matters: `create()` would, on a registered-but-DI-not-ready adapter, fall through to
   * `new ctor()` in `instantiate()` and then CACHE a dependency-less instance. Polling the
   * registry avoids creating an adapter in order to ask whether adapters can be created.
   *
   * ⚠️ The wait is BOUNDED and proceeds either way. A genuinely unregistered adapter is a
   * different problem and must not stop the loop; it is reported per tick by the warn in the
   * broker loop instead.
   */
  private async tickWhenAdaptersReady(timeoutMs = 5000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.adapterFactory.listAdapters().length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.tick();
  }

  start(): { started: boolean; message: string } {
    if (this.timer) {
      return { started: false, message: 'Loop is already running' };
    }
    this.state.loopEnabled = true;
    this.initBrokerStates();
    this.timer = setInterval(() => this.tick(), this.state.tickIntervalMs);
    this.state.nextTickAt = new Date(Date.now() + this.state.tickIntervalMs).toISOString();
    this.logger.log(`Automation loop started — interval ${this.state.tickIntervalMs}ms`);
    // Start the trailing-stop guardian alongside the loop (#721). It no-ops
    // unless there are active auto-mode strategies with open positions.
    this.stopGuardian.start();
    // Start the position time-stop alongside the loop (#773). This is the fix for the
    // slot bottleneck: 11 auto bots shared 5 broker-wide slots and NOTHING freed them,
    // because no time-based exit existed — `maxHoldDuration` was declared but never read.
    // It no-ops unless a strategy opts in, and is DRY RUN unless POSITION_TIMESTOP_DRY_RUN=0.
    this.positionTimeStop.start();
    // Fire an immediate tick so we don't wait 2 min after restart — but only once the adapters
    // exist. Firing it unconditionally raced the adapter registration and silently skipped
    // position sync; see tickWhenAdaptersReady().
    this.tickWhenAdaptersReady().catch(err => this.logger.error(`Initial tick failed: ${(err as Error).message}`));
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
    this.stopGuardian.stop();
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

  /**
   * runWeekendDefenseCheck() — the Wed (triple-swap) / Fri (weekend-gap) check, extracted so a test
   * can FORCE the day. (#869 Finding A)
   *
   * ⚠️ WHY THIS IS A METHOD AND NOT AN INLINE `if`. The original block read `allPositions` ~25 lines
   * BEFORE the portfolio fetch filled it, so `mt5Positions.length` was always 0 and the block — with
   * its own log line — never executed. A check that cannot log its own absence is indistinguishable
   * from one that is working, so the guard is a test that forces day 5 and asserts the log line, and
   * one that forces day 2 and asserts silence.
   *
   * `day` is a parameter rather than a `new Date()` read inside, for exactly that reason.
   */
  private async runWeekendDefenseCheck(day: number, allPositions: any[]): Promise<void> {
    if (day !== 3 && day !== 5) return;
    const mt5Positions = allPositions.filter((p: any) => p.symbol);
    if (mt5Positions.length === 0) return;
    try {
      const checklist = await this.weekendDefense.buildChecklist(
        mt5Positions.map((p: any) => ({
          symbol: p.symbol,
          ticket: p.brokerTicket ?? p.ticket ?? '',
          side: p.side,
          volume: p.quantity ?? p.volume ?? 0,
          openPrice: p.avgCost ?? p.avgPrice ?? 0,
          currentPrice: p.currentPrice ?? 0,
          profit: p.unrealizedPnl ?? p.pnl ?? 0,
          marketValue: p.marketValue ?? null,
        }))
      );
      const toClose = checklist.positions.filter(p => p.recommendation === 'CLOSE');
      const toReduce = checklist.positions.filter(p => p.recommendation === 'REDUCE');
      if (toClose.length > 0) {
        this.logger.warn(`⚠️ Weekend Defense: ${toClose.length} position(s) should be CLOSED — ${toClose.map(p => p.symbol).join(', ')}`);
      }
      if (toReduce.length > 0) {
        this.logger.log(`🟡 Weekend Defense: ${toReduce.length} position(s) should be REDUCED — ${toReduce.map(p => p.symbol).join(', ')}`);
      }
      // The basis is logged, not assumed. "$X" on a total that is not money is the defect
      // this line exists to make visible (#869 Finding C).
      this.logger.log(
        `Weekend Defense: ${checklist.summary.totalPositions} positions, ` +
        `$${checklist.totalSwapCostTonight.toFixed(2)} swap tonight, ` +
        `$${checklist.totalGapRisk.toFixed(2)} gap risk, exposure ${checklist.totalExposure.toFixed(2)} ` +
        `(${checklist.totalExposureBasis})` +
        (checklist.unknownSideCount > 0 ? `, ⚠️ ${checklist.unknownSideCount} position(s) with UNSTATED direction` : '')
      );
    } catch (err) {
      this.logger.warn(`Weekend defense check skipped: ${(err as Error).message}`);
    }
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
    if (this.tickInProgress) {
      this.logger.warn('Automation tick skipped — previous tick is still running');
      return [];
    }
    this.tickInProgress = true;
    const tickStart = Date.now();
    this.state.tickCount++;
    this.state.lastTickAt = new Date().toISOString();
    const decisions: TickDecision[] = [];
    const trailRecords: any[] = [];  // DecisionTrail rows (#474)
    this.directivesService.clearTickCache();
    this.protocolDb.clearCache();
    this.auditLog.logTickStart(this.state.tickCount);

    // #615 mandate: Protocols OFF → no scoring, no trading.
    if (!this.state.protocolsEnabled) {
      this.auditLog.logSkip(this.state.tickCount, 'protocols-layer', '—', 'Protocols layer disabled — scoring skipped');
      this.logger.log(`Tick #${this.state.tickCount} skipped — protocols layer disabled`);
      this.tickInProgress = false;
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

      // 1b. Weekend defense check — MOVED. See the block after the portfolio fetch below.
      //
      // ⚠️ This block used to sit HERE and read `allPositions` ~25 lines before it was populated
      // (`allPositions = []` then filled in the broker loop at step 2). It was therefore empty on
      // every tick, `mt5Positions.length > 0` was always false, and the whole block — including its
      // own logger line — never executed. It also mapped from the `Mt5Position` shape (`type`,
      // `price_open`, `profit`) while `allPositions` holds `BrokerPosition` (`side`, `avgCost`,
      // `unrealizedPnl`, `marketValue`), so moving it alone would not have fixed it.
      //
      // The lesson is recorded because it is not "a bug": a check that cannot log its own absence
      // is indistinguishable from one that is working. Measured 2026-09-18 — a Friday, with the loop
      // ticking — the string "Weekend Defense" appeared nowhere in logs/api-out.log. (#869 Finding A)

      // 2. Fetch portfolios from all enabled brokers
      allPositions = [];
      for (const [brokerId, brokerState] of Object.entries(this.state.brokerStates)) {
        if (!brokerState.enabled) continue;
        const adapter = this.adapterFactory.create(brokerId);
        if (!adapter) {
          // ⚠️ Distinct from "registered but not a brokerage adapter" below, and it must be LOUD.
          // `create()` returns null when the factory holds no REGISTRATION for the id — which on
          // the first tick after boot is a startup-ordering artifact, not a config error.
          // Silently `continue`-ing here is what made #877 invisible: the tick looked like it had
          // run, while no positions were fetched and no reconciliation happened.
          this.logger.warn(
            `  ${brokerId}: NO ADAPTER INSTANCE — its positions were NOT fetched this tick ` +
            '(adapter not registered yet?)',
          );
          // UNKNOWN, not zero — this broker's positions were never fetched. Setting 0 here
          // is what made the tape claim "0 positions" with confidence it had not earned.
          brokerState.positionCount = null;
          continue;
        }
        if (!adapter.supportsBrokerage || !adapter.getPositions) continue;

        try {
          const snapshot = adapter.getPositionSnapshot
            ? await adapter.getPositionSnapshot()
            : { positions: await adapter.getPositions(), authoritative: false };
          const positions = snapshot.positions;
          this.logger.log(`  ${brokerId}: ${positions.length} positions`);
          // MEASURED this tick. A literal 0 here is a real "holds none" and is distinct
          // from the null above and below. This is the only place the count becomes known.
          brokerState.positionCount = positions.length;
          allPositions.push(...positions);

          // Sync positions → DB (two-way data flow #470, broker-agnostic)
          //
          // ⚠️ A snapshot spanning SEVERAL accounts must not be scoped to one of them (#883).
          // `position-sync` scopes its `position` scan by this accountId, so passing broker 2's
          // id while the payload also holds broker 3's positions would leave broker 3's rows
          // unreconciled. `null` means "all accounts for this provider", which is what a merged
          // multi-broker snapshot actually is.
          const distinctAccounts = new Set(
            positions.map((p: any) => p.accountId).filter((a: any) => !!a),
          );
          let accountId = distinctAccounts.size === 1
            ? ([...distinctAccounts][0] as string)
            : undefined;
          if (adapter.getAccount && distinctAccounts.size <= 1) {
            const account = await adapter.getAccount().catch(() => null);
            accountId = accountId ?? account?.accountId;
          }
          const authoritative = snapshot.authoritative || positions.length > 0;
          const normalised = positions.map((p: any) => ({
            symbol: p.symbol,
            brokerTicket: String(p.brokerTicket ?? p.ticket ?? p.id ?? ''),
            side: p.side ?? null,
            quantity: p.quantity,
            avgPrice: p.avgCost ?? p.entryPrice ?? 0,
            currentPrice: p.currentPrice ?? p.avgCost ?? 0,
            pnl: p.unrealizedPnl ?? p.pnl ?? 0,
            sl: p.sl ?? null,
            tp: p.tp ?? null,
            comment: p.comment ?? '',
            openedAt: p.openedAt ? new Date(p.openedAt) : new Date(),
            accountId: p.accountId ?? accountId ?? null,
          }));
          await this.positionSync.syncPositions(brokerId, normalised, { authoritative, accountId });
        } catch (err) {
          // Measurement FAILED. Reset to unknown rather than leaving the previous tick's number —
          // a stale count presented as current is worse than an admitted gap, because nothing
          // downstream can tell it is out of date.
          brokerState.positionCount = null;
          this.logger.warn(`  ${brokerId}: failed to fetch positions — ${(err as Error).message}`);
        }
      }

      // 1b. Weekend defense check — Wed (triple-swap) and Fri (weekend gap).
      //
      // ⚠️ Runs AFTER the portfolio fetch, because it consumes what that loop produced. Mapping is
      // from `BrokerPosition` (`side`, `quantity`, `avgCost`, `currentPrice`, `unrealizedPnl`,
      // `marketValue`), NOT the `Mt5Position` shape the old copy assumed.
      //
      // `marketValue` is passed because it is ALREADY money — preferred over volume × contract size,
      // which `BrokerPosition` does not carry. When neither is available the service reports the
      // basis as `not-money` instead of returning a ratio that reads like a currency amount.
      await this.runWeekendDefenseCheck(new Date().getUTCDay(), allPositions);

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
            // ⚠️ #908 — the cadence MUST go through selectBaseTimeframe(). `recommendedTimeframe`
            // is FREE TEXT in the protocol seed ('5s–30s', '5m–1h', '1d (signal), 1h/15m' are real
            // values). Used raw as a bar key, getBarCount() returned 0 FOREVER: GER40/UK100/DAX
            // bots sat in "pending_bars — Waiting for first bars (5s–30s)" for 44h+ while their
            // symbols held thousands of real 1m/5m bars — no marketbar row will ever carry
            // timeframe='5s–30s', so the gate could not clear and the message read as a 30-second
            // wait. Measured: 55 identical decision_log reasons in 24h. Resolution lives in the
            // shared util (INV-SINGLE-CADENCE); guarded at build time by scanRawCadenceFallback().
            const timeframe = selectBaseTimeframe(this.protocolDb.getCached(protocolId)?.recommendedTimeframe);
// ⚠️ #1013 — was `requiredBars[timeframe] || 100`, the same fall-through: this gate
              // cleared at 20 bars while scoring needed 72, so the bot was declared "ready" and
              // then every long-window directive returned 0.
              const minBarsNeeded = this.protocolDb.getBaseBarCount(protocolId, timeframe);

            const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: strat.symbol } });
            if (!dbSym) {
              // #908 — a symbol absent from the registry is a CONFIG state, not a warm-up.
              // "pending_bars" promised an imminent start that can never come; "blocked" says
              // permanent. The decision-log skip text carries this reason verbatim.
              strat.dataStatus = 'blocked';
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

      // NOTE: no early-return when allSymbols is empty. The one scoring line
      // (buildBestLadder, step 3b) must run even with 0 positions/strategies —
      // protocols are the live scoring path and an early return here made every
      // active protocol silently stop scoring.

      // 3. REMOVED: rankAll() — ran all 104 directives against every symbol.
      //    That produced thousands of noisy scores (EURUSD=3291, etc.) with no
      //    protocol scoping. buildBestLadder() (step 3b) is the single source
      //    of truth for SEES scores now.
      //    See: 2026-08-11 — automation loop protocol-driven refactor.
      //    2026-09-02 (#714) — strategy-side scoring retired; the queue path
      //    is the only trade path.

      // ═══════════════════════════════════════════════════════════════════════
      // 3b. ONE scoring line — SignalEnvelopeService.buildBestLadder().
      //
      // Scores each ready protocol × symbol, persists signal score records,
      // refreshes the trading-bot queues (routing + void rule), and returns
      // per-protocol scoring status. Readiness-gated protocols are excluded
      // so beta/non-ready directives never produce signals (#627).
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

      let bestLadder: { envelopes: any[]; protocolStatus: Record<string, { state: string; reason?: string; symbolsResolved?: number; symbolsScored?: number }> } | null = null;
      try {
        bestLadder = await this.signalEnvelope.buildBestLadder({ allowedProtocols: new Set(readyProtocols) });
        for (const [slug, st] of Object.entries(bestLadder?.protocolStatus || {})) {
          if (!scoringStatus.has(slug)) scoringStatus.set(slug, st);
        }
        // Decision-log observability — one OBSERVED row per visible signal.
        //
        // ⚠️ #971 — these are OBSERVATIONS, not signals. A ladder envelope is protocol-driven:
        // no bot is subscribed to it, so nobody will ever act on the row. Writing them as 'SCORED'
        // (which is what a bot's signal carries) made 539 of 577 scored rows indistinguishable
        // from tradeable ones — the sprint's "why isn't this symbol trading?" question had no
        // data answer. The VALUE is the claim now:
        //   OBSERVED            nothing consumes it (this block)
        //   SCORED              a bot scored a signal it may act on
        //   BLOCKED / SKIP      a consumer refused it
        //   QUEUED / EXECUTED   it reached the order path
        // A reader wanting only tradeable rows must exclude OBSERVED. Rows written before this
        // change still hold 'SCORED' with `strategyId = ''` — see src/core/decision-display.js,
        // which reads the empty strategyId as the historical marker.
        for (const env of bestLadder?.envelopes ?? []) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: '', // protocol-driven, not strategy-driven
            symbol: env.symbol,
            brokerId: 'mt5',
            decision: 'OBSERVED',
            reason: `${env.protocolId ?? 'any'}: composite=${env.composite} signal=${env.signal}`,
            // #909 — `env.composite` is the RAW additive score (GatedScore.composite), NOT a
            // percentage. `env.signalPct` is the percentage; this slot is the raw one.
            compositeRaw: env.composite ?? null,
            signal: env.signal ?? 'HOLD',
          });
        }
        this.logger.log(`  One scoring line: ${bestLadder?.envelopes?.length ?? 0} actionable signals, queues synced`);
      } catch (err) {
        this.logger.warn(`One scoring line (buildBestLadder) failed: ${(err as Error).message}`);
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

      // 4. REMOVED (2026-09-02, #714) — strategy-side scoring (evaluateStrategy /
      //    compareProtocolPair) is retired. The Expert Trading Bot below is the
      //    ONLY trading path: queue heads, gates, dispatch. No re-scoring.

      // ── #714: Expert Trading Bot — consume signal queues. ──
      await this.processSignalQueues(decisions);

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

    // #875 — materialisation watcher. A derived combination that has a LIVE bot and no registered
    // row yet gets one (stable id, name null, source 'auto'). Successors of already-registered
    // bots are skipped — those are the owner's drift/re-accept decisions, not new identities.
    // Failures never block the tick: registration is an identity ledger, not a trading gate.
    try {
      const sync = await this.strategyRegistry.syncAuto();
      if (sync.created > 0) {
        this.logger.log(`Strategy registry: ${sync.created} new materialised combination(s) auto-registered (#875).`);
      }
    } catch (err) {
      this.logger.warn(`Strategy registry sync failed: ${(err as Error).message}`);
    }

    // ── Portfolio Snapshot (at trade execution) ─────────────────────────────
    // Captured at the point of trade, not every tick — shows
    // the full portfolio picture at the moment of decision.
    // Enables "why was this trade placed?" analysis: what
    // positions were held, what was the P&L and exposure? (#477)

    // Flush audit event buffer (best-effort, noiseless on failure)
    this.auditLog.flush().catch(() => {});

    this.logger.log(`Tick #${this.state.tickCount} completed in ${this.state.lastTickMs}ms — ${decisions.length} decisions`);
    this.tickInProgress = false;
    return decisions;
  }

  /**
   * A/B test runner (#482) — evaluate EVERY active test each tick.
   *
   * ⚠️ #929 — this used to fetch a single active test (`getActiveTest()`). The capacity decision
   * (recorded on #929, 2026-09-22) allows AB_MAX_ACTIVE concurrent tests, because one test ×
   * 4 symbols accrued evidence too slowly to settle anything. The runner iterates; `runAbTest`
   * is the unchanged single-test body. Uses the same gated-scoring path as step 3b for fairness.
   */
  private async evaluateAbTest(decisions: TickDecision[]): Promise<void> {
    const tests = await this.abTestService.getActiveTests();
    for (const test of tests) {
      await this.runAbTest(test, decisions);
    }
  }

  /** One test — both snapshots scored on the test's symbols, side-tagged trades. */
  private async runAbTest(test: AbTest, decisions: TickDecision[]): Promise<void> {
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

    // ⚠️ #929 — the TRADING authority is resolved from the BOT, once per test, and NEVER from
    // `controlCfg.mode`. That field holds the SCORING style (`'score'`), which the runner used to
    // compare against `'auto'` — a comparison that is false for every snapshot in existence, so
    // no A/B order was ever placed. `null` means cannot-judge and is refused, not defaulted.
    const authority = await this.abTestService.resolveTradeAuthority(control.id);
    if (authority.mode !== 'auto') {
      this.logger.warn(
        `A/B test "${test.name}": no live orders will be placed — ` +
          (authority.reason ?? `owning bot "${authority.botName}" is '${authority.mode}'`),
      );
    }

    for (const sym of symbols) {
      const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: sym } });
      if (!dbSym) continue;

      // ⚠️ #929 — the CADENCE comes from the protocol, via the canonical `selectBaseTimeframe()`.
      //
      // These two lines read `'5m'` as a LITERAL. Every other scoring path in the system resolves
      // the cadence through `selectBaseTimeframe(protocol.recommendedTimeframe)` — the envelope
      // (#908, `signal-envelope.service.ts`), the protocol runner, consensus, and the main loop
      // above. The A/B runner was the ONLY exception, and because an M15 protocol scored on
      // 5-minute bars reads completely differently, it was measuring a configuration that does
      // not exist. Measured 2026-09-23, XAUUSD, same protocol (`xau-speed-m15`), same second:
      //
      //     real pipeline (15m bars) : composite 94, signal BUY  -> bot EXECUTED (ticket ...5422)
      //     A/B runner   ( 5m bars) : composite 15, signal HOLD -> SKIP — no order, ever
      //
      // A `'5m'` literal does not type-error and does not log. It just silently compares the
      // wrong two things, which is why the first 'runnable' A/B placed no orders at all.
      const controlTf = selectBaseTimeframe(this.protocolDb.getCached(controlCfg.protocolId)?.recommendedTimeframe);
      const variantTf = selectBaseTimeframe(this.protocolDb.getCached(variantCfg.protocolId)?.recommendedTimeframe);
      if (controlTf !== variantTf) {
        // Named, not silently resolved: a test whose two sides are scored on different cadences
        // is comparing two things at once, which is the one thing this path must not do.
        this.logger.warn(
          `A/B test "${test.name}": control cadence ${controlTf} != variant cadence ${variantTf} — ` +
            `scoring on the control's (${controlTf})`,
        );
      }
      // ⚠️ #1013 — both sides via the ONE rule; this open-coded the fall-through twice.
      const requiredBars = Math.max(
        this.protocolDb.getBaseBarCount(controlCfg.protocolId, controlTf),
        this.protocolDb.getBaseBarCount(variantCfg.protocolId, variantTf),
      );
      const bars = await this.marketData.getBars(dbSym.id, controlTf, requiredBars);
      if (!bars || bars.length < 20) continue;

      // Score both stacks against the same symbol + bars.
      //
      // ⚠️ Each side gets ITS OWN protocol's bundle. Loading one bundle from
      // `controlCfg.protocolId` and handing it to both sides made the variant's MTF
      // directives read the control's timeframe sizes — the A/B comparison then
      // measured a difference that partly did not exist, which is the one thing this
      // path must not do (#735, #751).
      const [controlBundle, variantBundle] = await Promise.all([
        this.protocolGating.loadHigherTfBundle(dbSym.id, controlCfg.protocolId),
        controlCfg.protocolId === variantCfg.protocolId
          ? Promise.resolve(null)
          : this.protocolGating.loadHigherTfBundle(dbSym.id, variantCfg.protocolId),
      ]);
      const [scoreA, scoreB] = await Promise.all([
        this.protocolGating.scoreWithGating(sym, bars, controlCfg.protocolId, controlBundle, controlCfg.weightStrategy ?? 'group-weighted'),
        this.protocolGating.scoreWithGating(sym, bars, variantCfg.protocolId, variantBundle ?? controlBundle, variantCfg.weightStrategy ?? 'group-weighted'),
      ]);

      const brokerId = (controlCfg.brokerId ?? variantCfg.brokerId ?? 'mt5') as string;

      const evalSide = async (side: 'A' | 'B', cfg: any, score: any): Promise<void> => {
        if (!score || score.composite === undefined) return;
        // ⚠️ `BOT_BAR_DEFAULT`, not a literal.
        //
        // This line read `?? 60` while `BOT_BAR_DEFAULT` was ALREADY IMPORTED at the top of this
        // very file (L66) — the canonical constant was in scope and a stale literal was written
        // anyway. That is the whole lesson of #839: making the right value *available* does not
        // make it *used*. The 60 was a pre-rescale bar the new scale (~10-33) can never clear,
        // so A/B variants were gated by an unclearable threshold and silently never traded.
        //
        // Enforced now by nest/scripts/validate-threshold-sources.cjs — a literal here fails the build.
        const threshold = cfg.tradeThreshold ?? BOT_BAR_DEFAULT;
        if (score.composite < threshold) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: `ab-test:${side}`,
            symbol: sym,
            brokerId,
            decision: 'SCORED',
            reason: `AB-${side} ${test.name}: composite=${score.composite} < threshold=${threshold}`,
            // `score` is a GatedScore — `composite` is the RAW additive score (#909).
            compositeRaw: score.composite,
            signal: score.signal ?? 'HOLD',
          });
          return;
        }

        // ⚠️ Single authority. This read `score.signal === 'SELL' ? 'SELL' : 'BUY'`, which turned a
        // STRONG_SELL into a BUY — the same inversion the router had — followed by a pointless
        // round-trip (`direction === 'SELL' ? 'SELL' : 'BUY'`).
        const sideDir = signalToSide(score.signal);
        if (!sideDir) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: `ab-test:${side}`,
            symbol: sym,
            brokerId,
            decision: 'SKIP',
            reason: `AB-${side} ${test.name}: signal class "${score.signal}" has no derivable side`,
            compositeRaw: score.composite,
            signal: score.signal ?? 'HOLD',
          });
          return;
        }
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
          tradeMode: authority.mode,
          tradeModeSource: authority.botName ? `bot "${authority.botName}"` : undefined,
          tradeModeReason: authority.reason,
        });

        decisions.push({
          timestamp: new Date().toISOString(),
          strategyId: `ab-test:${side}`,
          symbol: sym,
          brokerId,
          // ⚠️ #929 — THREE outcomes, deliberately kept distinct:
          //   EXECUTED  an order reached the broker and a ticket came back;
          //   SKIP      a REFUSAL — the owning bot is not 'auto', so nothing was attempted.
          //             Nothing went wrong, which is why it must not read as an error;
          //   FAILED    the attempt was made and the adapter returned an error.
          // This line previously read `result.success ? 'EXECUTED' : 'FAILED'` while a "success"
          // could mean only that an intent was recorded — ten rows with no broker ticket were
          // therefore logged as EXECUTED on 2026-09-22. Collapsing refusal into either of the
          // other two is the defect class this repo keeps finding: plausible output, no error.
          decision: result.refused ? 'SKIP' : result.success ? 'EXECUTED' : 'FAILED',
          reason: result.refused
            ? `AB-${side} ${test.name}: refused — ${result.error ?? 'trade authority is not auto'}`
            : result.success
              ? `AB-${side} ${test.name}: ${sideDir} @ ${entryPrice} (${result.ticket ?? 'recorded'})`
              : `AB-${side} ${test.name}: ${result.error ?? 'unknown'}`,
          compositeRaw: score.composite,
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
   * #714 (2026-09-02): resolveBestSignal + evaluateStrategy are RETIRED.
   * The one scoring line (buildBestLadder) routes signals into queues and
   * processSignalQueues dispatches them — strategies are gates, not scorers.
   */
  /**
   * #714 Stage 3 — Expert Trading Bot queue processor.
   *
   * ONE scoring line: this method NEVER re-scores. It reads the strongest
   * pending entry from each active auto-mode bot's strategy_signal_queue and
   * dispatches it through the shared safety chain (dispatchTrade) using the
   * queue's SEES snapshot (direction + combinedStrength + protocolId).
   *
   * Gates, in order (all read-only checks before any mutation):
   *   1. botQueueEnabled setting (#714 kill switch for this path only)
   *   2. strategy mode must be auto (manual/semi-auto = user UI buttons)
   *   3. data readiness (same dataStatus annotation as the legacy path)
   *   4. minComposite — snapshot strength vs the strategy's own bar
   *   5. strategy cooldown (shared lastTradeTime map)
   *   6. bot pacing — inter-trade delay (default 10m, persisted setting)
   *   7. trading layer / broker trading off → paper capture (#695), no trade
   *   8. dispatchTrade safety chain (layer, 60s symbol + 3s global cooldown,
   *      duplicate guard, diversification, mode dispatch)
   *
   * Consumed only on EXECUTED/QUEUED (status → 'executing'). BLOCKED and
   * FAILED entries stay pending for the next tick. Every failure is non-fatal.
   */
  /** Session-gate log dedupe: strategyId → last skip reason (report once, not per tick). */
  private readonly sessionSkipLog = new Map<string, string>();

  /**
   * Bots currently held shut by the session gate (#759). Keyed by strategyId.
   *
   * This is the observable counterpart to `sessionSkipLog`'s dedupe: the log
   * reports the TRANSITION, this reports the STATE. Without it a gated bot looks
   * identical to an idle one from every surface, which is how three of six forex
   * bots stayed shut through London and the US session without anyone noticing.
   */
  private readonly sessionGated = new Map<string, {
    strategyId: string;
    name: string;
    symbol: string;
    reason: string;
    allowed: string[];
    active: string[];
    /** 'ambiguous' means the NAME could mean a clock or a news flow — see auditNameVsWindow. */
    nameWindowAgreement: string;
    nameWindowNote: string;
    at: string;
  }>();

  /** Bots the session gate is currently holding shut — for the status payload. */
  getSessionGated(): Array<ReturnType<typeof Object> & Record<string, unknown>> {
    return [...this.sessionGated.values()];
  }

  /**
   * Silent-gate notes — the observable counterpart to the gates that `continue` with no record.
   *
   * THREE gates in this loop skip a queued entry without emitting a decision row: `mode !== 'auto'`
   * (Gate 2), data readiness (Gate 3), and the strategy cooldown (Gate 5). Their effect is
   * indistinguishable from the loop not running at all — an entry that already PASSES minComposite
   * simply sits `pending` with no reason on any surface.
   *
   * This is the same defect shape as the session gate's (#759): correct behaviour, invisible. It was
   * found on 2026-09-18 by measuring GER40 and UK100, which had held `pending` queue entries for
   * ~24h while their composite (10) already met their minComposite (10) — and nothing in
   * decision_log said why. The one QueueBot line either symbol had ever produced was a PACING skip
   * from the previous day, which pointed at the wrong gate entirely.
   *
   * Reported once per bot per gate per interval, because a standing condition would otherwise write
   * a row per bot per tick and flood decision_log — the same reason `logSessionSkip` dedupes.
   */
  private static readonly GATE_NOTE_INTERVAL_MS = 30 * 60 * 1000;
  private readonly gateNoteAt = new Map<string, number>();

  /**
   * Returns a SKIP decision row naming the gate that held an already-qualified entry, or null when
   * one was reported recently. Returned rather than pushed because `decisions` is local to the
   * caller.
   */
  private gateSkipNote(
    strategy: any, symbol: string, gate: string, reason: string, compositePct: number | null = null,
  ): Record<string, unknown> | null {
    const key = `${strategy?.id ?? ''}:${gate}`;
    const now = Date.now();
    if (now - (this.gateNoteAt.get(key) ?? 0) < AutomationLoopService.GATE_NOTE_INTERVAL_MS) {
      return null;
    }
    this.gateNoteAt.set(key, now);
    return {
      timestamp: new Date().toISOString(),
      strategyId: strategy.id,
      symbol,
      brokerId: strategy.brokerId || 'mt5',
      decision: 'SKIP',
      reason: `[QueueBot] held by ${gate} — ${reason}`,
      compositePct,
      signal: 'HOLD',
    };
  }

  private logSessionSkip(strategy: any, symbol: string, sess: SessionGateResult): void {
    const key = String(strategy?.id ?? '');
    const reason = sess.reason ?? 'session closed';
    if (this.sessionSkipLog.get(key) === reason) return;
    this.sessionSkipLog.set(key, reason);

    // ── Audit whether the NAME and the WINDOW mean the same thing (#759) ──
    //
    // The window VALUE is always a canonical tag ('asian'), so it can never look
    // wrong on its own — the ambiguity lives in the bot NAME. "Sydney AUDUSD
    // Session" naming a city whose news drives the pair, while the window
    // declares the `asian` CLOCK, is consistent with two readings and the gate
    // cannot tell them apart. Report the question; do not answer it by editing
    // the bot's trading hours.
    const audit = auditNameVsWindow(strategy?.name, strategy?.sessionWindow);

    // Record the block so it is VISIBLE, not just logged once. The dedupe above is
    // deliberate (a standing condition should not write a row per bot per tick),
    // but on its own it made a gated bot indistinguishable from an idle one: the
    // single log line scrolled away and no surface reported that three of six
    // forex bots were shut. AUDUSD scored 100% STRONG_BUY with zero pre-trade
    // blockers while this line was the ONLY evidence, and it was not being read.
    this.sessionGated.set(key, {
      strategyId: key,
      name: strategy?.name ?? key,
      symbol,
      reason,
      allowed: sess.allowed,
      active: sess.active,
      nameWindowAgreement: audit.agreement,
      nameWindowNote: audit.note,
      at: new Date().toISOString(),
    });
    this.logger.log(
      `  [SessionGate] ${strategy?.name ?? key} (${symbol}) skipped — ${reason}`
      + (audit.agreement === 'ambiguous' ? ` ⚠ ${audit.note}` : ''),
    );
  }

  private async processSignalQueues(decisions: TickDecision[]): Promise<void> {
    try {
      if (!this.state.botQueueEnabled) return;
      const strategies = (this.state.activeStrategies || []).filter((s: any) => s.active !== false);
      if (strategies.length === 0) return;

      // ── Recover rows stranded in 'executing' (#759) ──
      //
      // The pre-#759 code wrote 'executing' for QUEUED as well as EXECUTED, and
      // nothing read that state back, so a row whose confirmation was never
      // answered stranded permanently and removed the bot from trading that
      // symbol. The write is fixed above; this pass drains the rows already
      // stuck in the field so the fix takes effect without hand-editing the DB.
      //
      // 'executing' is not a legitimate resting state for this pipeline: a
      // genuine execution reaches 'executed' in the same tick. Anything still
      // 'executing' after a grace period was abandoned, so it is returned to
      // 'pending' and re-offered. Bounded and non-fatal — a queue that cannot be
      // drained must not take the tick down with it.
      try {
        await (this.prisma as any).$executeRawUnsafe(
          `UPDATE strategy_signal_queue
              SET status = 'pending', updatedAt = UTC_TIMESTAMP()
            WHERE status = 'executing'
              AND updatedAt < UTC_TIMESTAMP() - INTERVAL 15 MINUTE`,
        );
      } catch { /* recovery is best-effort */ }

      const pendingRows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT q.id, q.strategyId, q.symbol, q.protocolId, q.direction, q.\`signal\`,
                CAST(q.compositePct AS DECIMAL(10,4)) AS compositePct,
                CAST(q.combinedStrength AS DECIMAL(10,4)) AS combinedStrength,
                q.scoreId, q.createdAt, q.updatedAt
         FROM strategy_signal_queue q
         JOIN trading_strategy ts ON ts.id = q.strategyId
         WHERE q.status = 'pending' AND ts.active = 1
         ORDER BY COALESCE(q.combinedStrength, 0) DESC, q.createdAt ASC`,
      ).catch(() => []);
      // ⚠️ `createdAt ASC` as the strength tiebreak was reviewed under #882 and KEPT: the
      // freshness gate below guarantees every candidate is actively re-confirmed, so
      // "longest-waiting live signal first" is FIFO among equals — fair, and no longer
      // capable of preferring a dead entry. Before that gate it preferred the STALEST entry
      // on every strength tie; if the freshness gate is ever removed, THIS ORDERING MUST GO.
      if (!Array.isArray(pendingRows) || pendingRows.length === 0) return;

      const stratById = new Map(strategies.map((s: any) => [s.id, s]));
      const heads = new Map<string, any>();
      for (const r of pendingRows) {
        if (heads.has(r.strategyId) || !stratById.has(r.strategyId)) continue;
        heads.set(r.strategyId, { ...r, strategy: stratById.get(r.strategyId) });
      }

      const delayMs = (this.state.botInterTradeDelayMinutes || 10) * 60000;

      // Recent 5m close for SL/TP computation (same feed as the legacy path).
      const getClose = async (symbol: string, protocolId: string): Promise<number> => {
        try {
          const dbSym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
          if (!dbSym) return 0;
          const requiredBars = this.protocolDb.getRequiredBars(protocolId);
          const bars = await this.marketData.getBars(dbSym.id, '5m', requiredBars['5m'] || 100);
          return bars?.length ? Number(bars[bars.length - 1].close) || 0 : 0;
        } catch {
          return 0;
        }
      };

      for (const head of heads.values()) {
        const strategy = head.strategy;
        const symbol = head.symbol;
        const strength = Number(head.combinedStrength ?? 0);
        // Legacy scale: minComposite is calibrated for the protocol composite
        // percentage (meta.compositePct), so the gate uses compositePct — the
        // same number the retired scoring path compared. combinedStrength stays
        // for logs/display only.
        const gatePct = Number(head.compositePct ?? 0);

        // ── FRESHNESS GATE (#882) — checked FIRST, before any other evaluation ──
        //
        // A pending entry whose last confirmation (`updatedAt`) is older than the shared bound
        // is no longer being observed: the void pass cannot see it (its pair is not scored),
        // and on 2026-09-21 one such entry executed 120 hours after insertion and an order was
        // placed on a 20.6-hour-old score. Refused for the right reason, offered exactly once,
        // then archived — the row survives, it just never gets another chance to be executed.
        //
        // `updatedAt`, NOT `createdAt`: a live session bot's entry is re-confirmed every
        // scoring run and keeps a fresh `updatedAt` — that waiting is intended and must never
        // expire (an earlier pass ordered by `createdAt` and overstated staleness 5 of 7 times).
        const maxAgeMin = getMaxSignalAgeMinutes();
        const ageMin = signalAgeMinutes(head.updatedAt);
        if (ageMin > maxAgeMin) {
          await (this.prisma as any).$executeRawUnsafe(
            `UPDATE strategy_signal_queue SET status = 'expired', updatedAt = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'`,
            head.id,
          ).catch(() => {});
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: strategy.id, symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP',
            reason: `[QueueBot] expired — last confirmed ${ageMin}m ago (> ${maxAgeMin}m max): no longer observed, not executed`,
            compositePct: gatePct, signal: 'HOLD',
          });
          continue;
        }

        // ⚠️ Single authority for direction → side. This read
        // `head.direction === 'SHORT' ? 'SELL' : 'BUY'`, so ANY unrecognised direction silently
        // became a BUY. Combined with the router's `startsWith('SELL')` bug, a STRONG_SELL reached
        // here as direction=LONG and became a BUY. An underivable direction is now BLOCKED and
        // named rather than defaulted into the wrong side of the market.
        const side = directionToSide(head.direction);
        if (!side) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: strategy.id, symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'BLOCKED',
            reason: `[QueueBot] queue direction "${head.direction}" has no derivable side`,
            // #909 — no trustworthy score for this row; null, never 0 (0 would read as a
            // real measurement in either unit).
            compositePct: null, signal: 'HOLD',
          });
          continue;
        }

        if (!head.scoreId || !Number.isFinite(gatePct) || gatePct < 0 || gatePct > 100) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: strategy.id, symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'BLOCKED',
            reason: '[QueueBot] invalid score lineage or percentage unit',
            compositePct: null, signal: side,
          });
          continue;
        }

        // Gate 2 — auto bots only; manual/semi-auto stay for the UI buttons.
        if (strategy.mode !== 'auto') {
          const note = this.gateSkipNote(
            strategy, symbol, 'gate2:mode', `mode is "${strategy.mode}", only auto bots consume the queue`, gatePct,
          );
          if (note) decisions.push(note as any);
          continue;
        }

        // Gate 3 — data readiness (same annotation as the strategy loader).
        if (strategy.dataStatus === 'pending_bars' || strategy.dataStatus === 'blocked') {
          const note = this.gateSkipNote(
            strategy, symbol, 'gate3:data',
            `${strategy.dataStatus} — ${strategy.dataStatusReason ?? 'no reason recorded'}`, gatePct,
          );
          if (note) decisions.push(note as any);
          continue;
        }

        // Gate 4 — minComposite bar on the SNAPSHOT (no re-scoring).
        const minC = Number(strategy.minComposite ?? 0);
        if (minC > 0 && gatePct < minC) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: strategy.id, symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP',
            reason: `[QueueBot] ${symbol} composite ${gatePct} < minComposite ${minC} — stays queued`,
            compositePct: gatePct, signal: side,
          });
          continue;
        }

        // Gate 4.5 — SESSION GATE (2026-09-10).
        // A bot only acts during the market session(s) it declares. This is a
        // WHEN check, not a WHAT check: it never touches the score or the
        // thresholds — it decides whether an already-qualified signal is
        // allowed to become an order right now. Bots named "London … Session"
        // were previously only *labelled* London; this makes it a rule.
        // Ungated bots (null/empty window) pass — the gate is opt-in, so no
        // existing strategy's behaviour changes until it declares a window.
        // Silent skip: "session closed" is a standing condition, and a row per
        // bot per tick would flood decision_log. Transitions log once instead.
        const sess = checkSessionWindow(strategy.sessionWindow, new Date());
        if (!sess.ok) {
          this.logSessionSkip(strategy, symbol, sess);
          continue;
        }
        this.sessionSkipLog.delete(String(strategy.id));
        this.sessionGated.delete(String(strategy.id));

        // Gate 5 — strategy cooldown (shared with the legacy path).
        const lastTrade = this.lastTradeTime.get(strategy.id);
        const cooldownMs = (strategy.cooldownMinutes || 5) * 60000;
        if (lastTrade && (Date.now() - lastTrade) < cooldownMs) {
          const note = this.gateSkipNote(
            strategy, symbol, 'gate5:cooldown',
            `cooldown ${strategy.cooldownMinutes || 5}m — ${Math.ceil((cooldownMs - (Date.now() - lastTrade)) / 60000)}m left`,
            gatePct,
          );
          if (note) decisions.push(note as any);
          continue;
        }

        // Gate 6 — bot pacing (persisted inter-trade delay).
        const lastBot = Math.max(this.lastBotTradeAt.get(strategy.id) || 0, this.lastBotTradeAnyAt || 0);
        if (lastBot && (Date.now() - lastBot) < delayMs) {
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: strategy.id, symbol, brokerId: strategy.brokerId || 'mt5',
            decision: 'SKIP',
            reason: `[QueueBot] pacing — next trade in ${Math.ceil((delayMs - (Date.now() - lastBot)) / 60000)}m`,
            compositePct: gatePct, signal: side,
          });
          continue;
        }

        const entryPrice = await getClose(symbol, head.protocolId);
        const baseSize = strategy.baseSize ?? 0.01;
        const slPct = strategy.slPct ?? 1.0;
        const tpPct = strategy.tpPct ?? 1.0;

        // Gate 7 — trading OFF → paper capture, entry stays pending.
        //
        // ⚠️ TWO DIFFERENT FLAGS gate this, and they used to be reported as one
        // ("trading layer OFF") even when the LAYER was on and only the BROKER
        // flag was off. That wording sent two investigations after the wrong
        // component and hid a months-long throughput collapse. Name the flag that
        // actually blocked, so the reason is never ambiguous again.
        const brokerId = strategy.brokerId || 'mt5';
        const layerOn = this.state.tradingEnabled;
        const brokerOn = this.state.brokerStates[brokerId]?.tradingEnabled === true;
        if (!layerOn || !brokerOn) {
          const why = !layerOn && !brokerOn
            ? `trading layer OFF and broker ${brokerId} OFF`
            : !layerOn
              ? 'trading layer OFF'
              : `broker ${brokerId} tradingEnabled=false (layer ON)`;
          await this.recordPaperTrade({
            strategyId: strategy.id,
            symbol,
            side,
            composite: gatePct,
            baseSize,
            slPct,
            tpPct,
            entryPrice,
            protocolId: head.protocolId,
          });
          // Monitor continuity — latest evaluation reflects the queue snapshot.
          this.strategyService.recordEvaluation(strategy.id, {
            symbol, composite: gatePct, signal: side, direction: head.direction,
          }).catch(() => {});
          decisions.push({
            timestamp: new Date().toISOString(),
            strategyId: strategy.id, symbol, brokerId,
            decision: 'SKIP',
            reason: `[QueueBot] ${side} ${symbol} captured as paper — ${why} — stays queued`,
            compositePct: gatePct, signal: side,
          });
          continue;
        }

        // Gate 8 — shared dispatch chain (layer, cooldowns, duplicate, diversification).
        const before = decisions.length;
        await this.dispatchTrade({
          strategyId: strategy.id,
          strategyName: strategy.name || strategy.id,
          symbol,
          brokerId: strategy.brokerId || 'mt5',
          side,
          compositePct: gatePct,
          baseSize,
          slPct,
          tpPct,
          entryPrice,
          mode: strategy.mode,
          protocolId: head.protocolId,
          executionId: `queue-${head.id}`,
        magic: strategy.magic ?? undefined,
          decisions,
        });
        const last = decisions.length > before ? decisions[decisions.length - 1] : null;
        if (last && last.strategyId === strategy.id && (last.decision === 'EXECUTED' || last.decision === 'QUEUED')) {
          // ── Terminal status is DERIVED from the actual outcome (#759) ──
          //
          // This used to write `status = 'executing'` for BOTH EXECUTED and QUEUED,
          // and 'executing' is not a state this method ever reads back — the head
          // query only takes `status = 'pending'`. A QUEUED (awaiting confirmation)
          // row therefore left the queue permanently: if the confirmation was never
          // clicked, or the process restarted before it was, the row sat in
          // 'executing' forever and the bot silently stopped trading that symbol.
          // Observed: GBPUSD Session stuck at 'executing' from 13:07 with no ticket.
          //
          // QUEUED stays PENDING so it is re-offered next tick — that is the honest
          // state for "waiting on a human", and it is what the docblock above always
          // claimed ("BLOCKED and FAILED entries stay pending"). Only a real
          // EXECUTED consumes the entry.
          if (last.decision === 'EXECUTED') {
            await (this.prisma as any).$executeRawUnsafe(
              `UPDATE strategy_signal_queue SET status = 'executed', updatedAt = UTC_TIMESTAMP() WHERE id = ? AND status = 'pending'`,
              head.id,
            ).catch(() => {});
            // ── #882 — record HOW OLD the signal was when it became an order ──
            //
            // The number is freshness, not waiting time: minutes between the queue entry's
            // LAST CONFIRMATION (its `updatedAt` before this write) and execution. A 120h-old
            // entry and a 20.6h-old score were both discovered only by a bespoke query after
            // the fact; this field makes staleness-at-execution answerable directly. NULL on
            // every non-queue path — absence, not a zero. Best-effort: never blocks dispatch.
            const executedTicket = typeof last.ticket === 'number' ? last.ticket : null;
            if (executedTicket != null) {
              await (this.prisma as any).$executeRawUnsafe(
                `UPDATE trade SET signalAgeAtExecutionMinutes = ? WHERE provider = ? AND brokerTicket = ?`,
                ageMin, strategy.brokerId || 'mt5', String(executedTicket),
              ).catch(() => {});
            }
          }
          this.lastBotTradeAt.set(strategy.id, Date.now());
          this.lastBotTradeAnyAt = Date.now();
          this.state.lastBotTradeAt = new Date().toISOString();
          this.strategyService.recordEvaluation(strategy.id, {
            symbol, composite: gatePct, signal: side, direction: head.direction,
            traded: last.decision === 'EXECUTED',
            tradeTicket: typeof last.ticket === 'number' ? last.ticket : null,
            tradeResult: last.reason ?? null,
          }).catch(() => {});
          this.logger.warn(
            `🤖 QueueBot ${strategy.name} ${last.decision} ${side} ${symbol} strength=${strength} protocol=${head.protocolId} — queue entry consumed`,
          );
        } else if (last && last.decision === 'BLOCKED') {
          this.logger.log(`[QueueBot] ${strategy.name} ${symbol} blocked: ${last.reason} — entry stays pending`);
        }
      }
    } catch (err) {
      this.logger.warn(`Signal queue processing failed: ${(err as Error).message}`);
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

    const accountRisk = await this.strategyService.assessGlobalRiskLimits(action.quantity, action.symbol);
    if (!accountRisk.allowed) {
      return { confirmed: false, message: `Action blocked: ${accountRisk.reason}` };
    }

    const dbSymbol = await this.prisma.symbol.findFirst({ where: { ticker: action.symbol } });
    const freshBars = dbSymbol ? await this.marketData.getBars(dbSymbol.id, '5m', 20) : [];
    const feasibility = await this.feasibility.assess({
      symbol: action.symbol,
      side: action.side as 'BUY' | 'SELL',
      brokerId: action.brokerId || 'mt5',
      marketStatus: computeMarketStatus(freshBars),
    });
    if (!feasibility.feasible) {
      return {
        confirmed: false,
        message: `Action blocked: ${feasibility.blockers.map(blocker => blocker.message).join('; ')}`,
      };
    }

    // Current price for SL/TP bracket — market order without bracket if unavailable
    let entryPrice = 0;
    try {
      const quote = await broker.getQuote(action.symbol);
      entryPrice = quote?.last ?? quote?.ask ?? quote?.bid ?? 0;
    } catch { /* fall through with entryPrice=0 */ }

    // NOTE (2026-08-27): confirm no longer resolves SL/TP from scoring
    // strategies — safe defaults here, loop dispatch carries exact values.
    const slPct = action.slPct ?? 1.0;
    const tpPct = action.tpPct ?? 1.0;
    const sl = entryPrice > 0
      ? action.side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100)
      : 0;
    const tp = entryPrice > 0
      ? action.side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100)
      : 0;

    // ⚠️ THE COMMENT MUST CARRY THE BOT **NAME**, NOT ITS ID — and this path wrote the ID.
    //
    // `resolvePositionOwner()` matches a position to a bot by NAME (the auto path writes
    // `TCS ${strategyName}`). This path wrote `TCS ${action.strategyId}` — a UUID — so a
    // semi-auto-confirmed position could NEVER be attributed: the comment named no bot, and until
    // 2026-09-29 the order sent no magic either, so it landed on the bridge's DEFAULT_MAGIC too.
    // TWO KEYS, BOTH EMPTY. Measured the same day: `XAUUSD #152698800224` was left unmanaged for
    // 341 consecutive ticks for the analogous reason (a parenthesised bot name the comment mangled
    // to `TCS Gold Swing 1H copy`).
    //
    // Resolved HERE rather than stored on the pending action, so a bot renamed between queueing and
    // confirming still yields the CURRENT name. Best-effort: an unresolvable id falls back to the id
    // (still wrong, but visibly so in the comment rather than silently blank).
    const owner = await this.prisma.tradingStrategy
      .findUnique({ where: { id: action.strategyId }, select: { name: true, magic: true } })
      .catch(() => null);
    const ownerName = owner?.name || action.strategyId;

    const result = await broker.placeOrder({
      symbol: action.symbol,
      side: action.side as 'BUY' | 'SELL',
      quantity: action.quantity,
      sl,
      tp,
      comment: `TCS ${ownerName}`,
      // #1018 — without this the position carries DEFAULT_MAGIC and no bot owns it.
      magic: owner?.magic ?? undefined,
      clientOrderId: `confirm-${action.id}`,
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
        // #1018 — the row records its owner, read from the same lookup that named the comment.
        magic: owner?.magic ?? null,
        // ⚠️ #1014 — see the note at the other write site: still the ORDER ticket on purpose.
        // Preferring `result.positionId` here without a reconciler volume-split would make several
        // rows claim the same position's whole P&L.
        brokerTicket: result.ticket != null ? String(result.ticket) : undefined,
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

      const sl = side === 'BUY' ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
      const tp = side === 'BUY' ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100);
      const id = `pt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await (this.prisma as any).$executeRawUnsafe(
        `INSERT INTO paper_trade (id, strategyId, symbol, side, composite, entryPrice, sl, tp, baseSize, protocolId, tickNumber, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        id, strategyId, symbol, side, Math.round(composite), entryPrice || null, sl, tp, baseSize, protocolId ?? null, this.state.tickCount,
      );
      // Mark only AFTER a successful insert — a failed attempt must not
      // poison the dedupe map (e.g. table missing on first deployment).
      this.lastPaperSig.set(`${strategyId}|${symbol}`, sig);
      this.logger.log(`📝 PAPER ${side} ${symbol} composite ${Math.round(composite)} (dry-run, trading off)`);
    } catch (err) {
      this.logger.warn(`Paper trade capture failed: ${(err as Error).message}`);
    }
  }

  /** Persist tick decisions to DB for audit trail survival across restarts.
   *  #704 — HOLD/SCORED rows are write-on-change: identical consecutive ticks
   *  (same decision|signal|rounded score) are suppressed and counted.
   *
   *  ⚠️ #909 — the score is written to `compositeRaw` or `compositePct` depending on which one
   *  the producing site set (see TickDecision). The old `composite` column is left NULL for
   *  every new row: it is HISTORICAL ONLY, because its 141k pre-split rows cannot be classified
   *  with certainty. A reader that shows a NULL-typed row must say "unit not recorded". */
  private persistDecisions(decisions: TickDecision[], tickNumber: number) {
    if (!this.prisma.isAvailable) return;

    const significant = new Set(['EXECUTED', 'FAILED', 'BLOCKED', 'QUEUED']);
    const keep: TickDecision[] = [];
    for (const d of decisions) {
      const key = `${d.strategyId}|${d.symbol}`;
      // Both typed slots in the signature: a unit that changes between ticks is a real change
      // and must not be suppressed as a repeat.
      const sig = `${d.decision}|${d.signal ?? ''}|${d.compositeRaw ?? ''}|${d.compositePct ?? ''}`;
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
      // ⚠️ #909 — the unit lives in the COLUMN, exactly one of the two is set, and the legacy
      // `composite` column stays NULL for new rows (it is historical-only).
      compositeRaw: d.compositeRaw ?? null,
      compositePct: d.compositePct ?? null,
      signal: d.signal ?? null,
      ticket: typeof d.ticket === 'number' ? d.ticket : (d.ticket ? parseInt(String(d.ticket), 10) || null : null),
      price: d.price ?? null,
      quantity: d.quantity ?? null,
    }));

    // Fire-and-forget — don't block the tick on DB writes
    this.prisma.decisionLog.createMany({ data: records }).then(
      () => this.logger.debug(`Persisted ${records.length} decisions to decision_log (${this.state.decisionLogSuppressed} suppressed this session)`),
    ).catch(err => this.logger.warn(`Failed to persist decisions: ${err.message}`));

    // Also log order attempts — for decisions that BECAME an order (#885).
    //
    // ⚠️ #885 — this used to include FAILED decisions and write them as `rejected`. FAILED covers
    // everything that stopped a trade before an order existed (signal below threshold, market
    // closed, position cap reached, bridge unreachable) — so 79 "rejections" appeared in the
    // `order` table against ZERO broker-side failures, and `WHERE status='rejected'` could not
    // answer "is the broker refusing our orders?". A decision that never became an order is NOT
    // an order-audit row; it already lives in decision_log (the `significant` set above keeps
    // every FAILED row there). This table audits ORDER ATTEMPTS.
    const orderDecisions = keep.filter(d => d.decision === 'EXECUTED');
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
          status: 'filled',
          provider: d.brokerId || 'mt5',
          providerId: d.ticket ? String(d.ticket) : null,
          filledAt: new Date(),
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
      // Persist the shutdown too — an emergency stop must survive a restart,
      // otherwise a reboot would silently undo the operator's stop.
      void this.persistBrokerTradingFlag(bs.brokerId, false);
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
      // #849 — through the resolver, so the default lives in ONE place (settings-registry.ts) rather than
      // being implicit in the state initialiser. `layer` is a two-value union, so the key stays static
      // and declarable: the previous dynamic `automation.${layer}Enabled` template was doing by string
      // interpolation what the type system already knows.
      await this.settings.set(
        layer === 'protocols' ? 'automation.protocolsEnabled' : 'automation.tradingEnabled',
        enabled,
      );
    } catch (err) {
      this.logger.warn(`Layer flag persist failed: ${(err as Error).message}`);
    }
    this.logger.warn(`META.Stack layer '${layer}' ${enabled ? 'ENABLED' : 'DISABLED'}`);
    return { layer, enabled };
  }

  /** #615 — restore persisted layer flags. */
  private async restoreLayerFlags() {
    if (!this.prisma.isAvailable) return;
    try {
      // #849 — resolved rather than read raw. Each default reproduces the state initialiser exactly, so
      // this is behaviour-neutral; the gain is that "what is the default" is now answerable in one file,
      // and an unparseable row is REPORTED by the resolver instead of being silently coerced.
      this.state.protocolsEnabled = await this.settings.get<boolean>('automation.protocolsEnabled');
      this.state.tradingEnabled = await this.settings.get<boolean>('automation.tradingEnabled');
      // #714 Stage 3 — bot queue + pacing settings (defaults: ON, 10m).
      this.state.botQueueEnabled = await this.settings.get<boolean>('automation.botQueueEnabled');
      this.state.botInterTradeDelayMinutes = await this.settings.get<number>(
        'automation.botInterTradeDelayMinutes',
      );
      // NOTE: the per-broker trading flag is NOT restored here — it is restored
      // separately, after the LAST initBrokerStates() call. See onModuleInit().
      this.logger.log(
        `Layer flags restored — protocols=${this.state.protocolsEnabled}, trading=${this.state.tradingEnabled}` +
        `, botQueue=${this.state.botQueueEnabled}, botDelay=${this.state.botInterTradeDelayMinutes}m`,
      );
    } catch (err) {
      this.logger.warn(`Layer flag restore failed: ${(err as Error).message}`);
    }
  }

  /**
   * Restore per-broker trading flags from global_setting; default OFF when absent.
   *
   * WHY THIS EXISTS (2026-09-10): this flag used to be memory-only and
   * `initBrokerStates()` hard-set it to false on every boot with no restore.
   * Gate 7 requires BOTH the layer flag AND the broker flag, so the layer flag
   * reading `true` was meaningless — the broker flag silently vetoed every
   * dispatch. Measured impact: automated trades went 94/month (Jul) → 9 (Aug) →
   * 1 (Sep) purely from restarts, with no UI signal that trading had been
   * switched off. 104 historical `origin='strategy'` trades exist only from
   * windows where the process stayed up and someone re-enabled it.
   *
   * Default remains OFF for any broker with no stored value, so a fresh install
   * still cannot trade without an explicit opt-in. Restoring only restates the
   * user's own last explicit choice.
   */
  private async restoreBrokerTradingFlags(): Promise<void> {
    if (!this.prisma.isAvailable) return;
    try {
      const rows: any[] = await (this.prisma as any).globalSetting.findMany({
        where: { key: { startsWith: 'automation.brokerTrading.' } },
      });
      const stored = new Map<string, boolean>();
      for (const r of rows) {
        const id = String(r.key).slice('automation.brokerTrading.'.length);
        if (id) stored.set(id, r.value === 'true');
      }
      for (const bs of Object.values(this.state.brokerStates)) {
        const persisted = stored.get(bs.brokerId);
        if (persisted !== undefined) {
          const changed = bs.tradingEnabled !== persisted;
          bs.tradingEnabled = persisted;
          if (changed) {
            this.logger.warn(
              `[TradingState] broker=${bs.brokerId} tradingEnabled restored to ${persisted} from stored setting`,
            );
          }
        }
        // No stored value → leave the safe default (false).
      }
    } catch (err) {
      this.logger.warn(`Broker trading-flag restore failed: ${(err as Error).message}`);
    }
  }

  /**
   * Make the effective execution state unmissable at boot.
   *
   * The layer flag and the per-broker flag are DIFFERENT things and used to
   * disagree silently (layer=true, broker=false), which is how a months-long
   * throughput collapse stayed invisible: the UI read only the layer flag.
   */
  private logEffectiveTradingState(): void {
    const states = Object.values(this.state.brokerStates);
    const anyBroker = states.some((bs: any) => bs?.tradingEnabled);
    const live = this.state.tradingEnabled && anyBroker;
    for (const bs of states) {
      this.logger.warn(
        `[TradingState] broker=${bs.brokerId} tradingEnabled=${bs.tradingEnabled}` +
        ` (layer tradingEnabled=${this.state.tradingEnabled})` +
        (bs.tradingEnabled ? '' : ' — dispatches for this broker are PAPER ONLY'),
      );
    }
    this.logger.warn(
      `[TradingState] EFFECTIVE MODE = ${live ? 'LIVE (real orders will be placed)' : 'PAPER ONLY'}`,
    );
  }

  /** Persist one broker's trading flag. Called from every setter that mutates it. */
  async persistBrokerTradingFlag(brokerId: string, enabled: boolean): Promise<void> {
    if (!this.prisma.isAvailable) return;
    const key = `automation.brokerTrading.${brokerId}`;
    try {
      await (this.prisma as any).globalSetting.upsert({
        where: { key },
        create: { key, value: String(enabled) },
        update: { value: String(enabled) },
      });
    } catch (err) {
      this.logger.warn(`Broker trading-flag persist failed (${key}): ${(err as Error).message}`);
    }
  }

  /**
   * #714 Stage 3 — bot queue configuration (kill switch + pacing).
   * Persisted in global_setting so restarts keep the choice.
   */
  async setBotQueueConfig(body: { enabled?: boolean; interTradeDelayMinutes?: number }) {
    if (body.enabled !== undefined) {
      this.state.botQueueEnabled = body.enabled;
      await this.settings.set('automation.botQueueEnabled', body.enabled)
        .catch((err: any) => this.logger.warn(`botQueueEnabled persist failed: ${err.message}`));
    }
    if (body.interTradeDelayMinutes !== undefined) {
      const mins = Math.max(0, Math.floor(body.interTradeDelayMinutes));
      this.state.botInterTradeDelayMinutes = mins;
      await this.settings.set('automation.botInterTradeDelayMinutes', mins)
        .catch((err: any) => this.logger.warn(`botInterTradeDelayMinutes persist failed: ${err.message}`));
    }
    this.logger.warn(`QueueBot config — enabled=${this.state.botQueueEnabled}, interTradeDelay=${this.state.botInterTradeDelayMinutes}m`);
    return {
      enabled: this.state.botQueueEnabled,
      interTradeDelayMinutes: this.state.botInterTradeDelayMinutes,
      lastBotTradeAt: this.state.lastBotTradeAt,
    };
  }

  getBotQueueConfig() {
    return {
      enabled: this.state.botQueueEnabled,
      interTradeDelayMinutes: this.state.botInterTradeDelayMinutes,
      lastBotTradeAt: this.state.lastBotTradeAt,
    };
  }
}
