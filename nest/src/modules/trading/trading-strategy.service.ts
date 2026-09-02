/**
 * TradingStrategyService — STAGE 4 of the META.Stack pipeline.
 * ============================================================
 * ROLE: Receive evaluated decisions and dispatch trades to brokers.
 *       Does NOT compute scores, apply gates, or make decisions —
 *       those all happen upstream in Scoring → AutomationLoop.
 *
 * PIPELINE POSITION:
 *   ScoringService (Stage 1) → AutomationLoop gates+evaluates (Stage 2+3)
 *   → TradingStrategyService.execute() (Stage 4) → Broker (MT5/T212/etc.)
 *
 * CONTRACT:
 *   INPUT:  strategyId + evaluated signal (BUY/SELL/HOLD from AutomationLoop)
 *   OUTPUT: trade placed via broker adapter, recorded to Trade table
 *   NEVER:  computes directive scores, applies risk gates, or decides direction
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Mt5TradingService } from './mt5-trading.service';
import { ConditionDetectorService } from '../directives/condition-detector.service';
import { RiskService } from '../risk/risk.service';
import { NotificationService } from '../notifications/notifications.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
import { MarketBar } from '../directives/interfaces/directive.interface';

export interface StrategySummary {
  id: string;
  name: string;
  version?: string | null;
  protocolId: string | null;
  shortProtocolId?: string | null;
  /** #703-era protocol subscriptions (2026-08-31) — the multi-protocol signal sources. */
  protocols?: Array<{ id: string; protocolId: string; role: string }>;
  symbol: string;
  timeframe: string;
  mode: string;
  active: boolean;
  brokerId?: string;
  minComposite?: number;
  baseSize?: number | null;
  slPct?: number | null;
  tpPct?: number | null;
  cooldownMinutes?: number;
  maxPositions?: number;
  /** #344 pyramid averaging — moved here from ScoringStrategy (2026-08-27). */
  maxPyramidTiers?: number;
  lastEvaluatedAt: string | null;
  lastSignal: string | null;
  lastComposite: number | null;
  evaluationCount: number;
  /** Profit/runtime ratio: total P&L / days active. null if no trades. */
  profitRatio: number | null;
  /** Total realized P&L across all trades for this strategy. */
  totalPnl: number | null;
  /** Days since first trade (or 1 if only one day of trades). */
  daysActive: number | null;
}

@Injectable()
export class TradingStrategyService {
  private readonly logger = new Logger(TradingStrategyService.name);
  private lastTradeTime = new Map<string, Date>(); // strategyId → last trade time
  /** Monotonic peak equity — only increases, so drawdown is measured against a real peak. */
  private peakEquity: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mt5: Mt5TradingService,
    private readonly conditionDetector: ConditionDetectorService,
    private readonly riskService: RiskService,
    private readonly notificationService: NotificationService,
    private readonly protocolGating: ProtocolGatingService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────

  // #712 — strategy-owned protocol subscriptions.
  async getProtocolSubscriptions(strategyId: string) {
    return (this.prisma as any).strategyProtocol
      .findMany({ where: { strategyId }, orderBy: { sortOrder: 'asc' } })
      .catch(() => []);
  }

  /** #714 — pending signal queue for one trading bot (strongest first). */
  async getSignalQueue(strategyId: string) {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT id, strategyId, symbol, protocolId, direction, \`signal\`,
                CAST(compositePct AS SIGNED) AS compositePct,
                CAST(signalPct AS SIGNED) AS signalPct,
                CAST(opportunityPct AS SIGNED) AS opportunityPct,
                CAST(combinedStrength AS SIGNED) AS combinedStrength,
                scoreId, status, createdAt, updatedAt
         FROM strategy_signal_queue
         WHERE strategyId = ? AND status = 'pending'
         ORDER BY COALESCE(combinedStrength, 0) DESC, createdAt ASC`,
        strategyId,
      );
      return rows.map((r: any) => ({
        ...r,
        compositePct: r.compositePct == null ? null : Number(r.compositePct),
        signalPct: r.signalPct == null ? null : Number(r.signalPct),
        opportunityPct: r.opportunityPct == null ? null : Number(r.opportunityPct),
        combinedStrength: r.combinedStrength == null ? null : Number(r.combinedStrength),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt ?? ''),
      }));
    } catch {
      return [];
    }
  }

  /**
   * #714 Stage 2 — all pending queue entries across every trading bot,
   * joined with strategy info for the Strategy Monitor queue view.
   */
  async getAllQueues() {
    try {
      const rows: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT q.id, q.strategyId, ts.name AS strategyName, ts.symbol AS strategySymbol,
                ts.active AS strategyActive, ts.mode AS strategyMode, ts.brokerId,
                q.symbol, q.protocolId, q.direction, q.\`signal\`,
                CAST(q.compositePct AS SIGNED) AS compositePct,
                CAST(q.signalPct AS SIGNED) AS signalPct,
                CAST(q.opportunityPct AS SIGNED) AS opportunityPct,
                CAST(q.combinedStrength AS SIGNED) AS combinedStrength,
                q.scoreId, q.status, q.createdAt, q.updatedAt
         FROM strategy_signal_queue q
         JOIN trading_strategy ts ON ts.id = q.strategyId
         WHERE q.status = 'pending'
         ORDER BY q.createdAt DESC`,
      );
      const num = (v: unknown) => (v == null ? null : Number(v));
      return rows.map((r: any) => ({
        ...r,
        compositePct: num(r.compositePct),
        signalPct: num(r.signalPct),
        opportunityPct: num(r.opportunityPct),
        combinedStrength: num(r.combinedStrength),
        strategyActive: Boolean(r.strategyActive),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt ?? ''),
      }));
    } catch {
      return [];
    }
  }

  async addProtocolSubscription(strategyId: string, protocolId: string, role = 'long') {
    const existing: any = await (this.prisma as any).strategyProtocol
      .findFirst({ where: { strategyId, protocolId, role } })
      .catch(() => null);
    if (existing) return existing;
    return (this.prisma as any).strategyProtocol.create({ data: { strategyId, protocolId, role } });
  }

  async removeProtocolSubscription(strategyId: string, subId: string) {
    return (this.prisma as any).strategyProtocol.deleteMany({ where: { id: subId, strategyId } });
  }

  /**
   * #714 (2026-09-02) — record a queue-driven evaluation WITHOUT re-scoring.
   * Powers the Strategy Monitor's Last Score / Last Signal from the signal
   * queue snapshot (the same values processSignalQueues gates on).
   */
  async recordEvaluation(strategyId: string, data: {
    symbol: string;
    composite: number;
    signal: string;
    direction?: string | null;
    traded?: boolean;
    tradeTicket?: number | null;
    tradeResult?: string | null;
  }) {
    return this.prisma.strategyEvaluation.create({
      data: {
        strategyId,
        symbol: data.symbol,
        composite: data.composite,
        signal: data.signal,
        direction: data.direction ?? null,
        traded: data.traded ?? false,
        tradeTicket: data.tradeTicket ?? null,
        tradeResult: data.tradeResult ?? null,
      },
    });
  }

  async findAll(): Promise<StrategySummary[]> {
    const strategies = await this.prisma.tradingStrategy.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        evaluations: {
          orderBy: { evaluatedAt: 'desc' },
          take: 1,
        },
        protocols: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return strategies.map((s) => {
      const lastEval = s.evaluations?.[0];
      return {
        id: s.id,
        name: s.name,
        version: (s as any).version ?? null,
        protocolId: s.protocolId,
        shortProtocolId: (s as any).shortProtocolId ?? null,
        protocols: ((s as any).protocols || []).map((p: any) => ({
          id: p.id,
          protocolId: p.protocolId,
          role: p.role,
        })),
        symbol: s.symbol,
        timeframe: s.timeframe,
        mode: s.mode,
        active: s.active,
        brokerId: s.brokerId,
        minComposite: s.minComposite,
        baseSize: s.baseSize,
        slPct: s.slPct,
        tpPct: s.tpPct,
        cooldownMinutes: s.cooldownMinutes,
        maxPositions: s.maxPositions,
        maxPyramidTiers: (s as any).maxPyramidTiers ?? 1,
        lastEvaluatedAt: lastEval?.evaluatedAt ? new Date(lastEval.evaluatedAt).toISOString() : null,
        lastSignal: lastEval?.signal ?? null,
        lastComposite: lastEval?.composite ?? null,
        evaluationCount: s.evaluations?.length ?? 0,
        profitRatio: null, totalPnl: null, daysActive: null, // filled below
      };
    });
  }

  /**
   * findAll with profit/runtime ratio (#343).
   * Computes SUM(trade.pnl) / days_active per strategy.
   */
  async findAllWithRatios(): Promise<StrategySummary[]> {
    const strategies = await this.findAll();

    if (!this.prisma.isAvailable || strategies.length === 0) return strategies;

    try {
      // Batch query: P&L per strategy from the trade table
      const trades = await this.prisma.trade.findMany({
        where: {
          scoringStrategyId: { in: strategies.map(s => s.id) },
          pnl: { not: null },
          status: 'closed',
        },
        select: { scoringStrategyId: true, pnl: true, openedAt: true },
      });

      // Aggregate per strategy
      const agg = new Map<string, { totalPnl: number; firstTrade: Date; lastTrade: Date }>();
      for (const t of trades) {
        if (!t.scoringStrategyId) continue;
        const entry = agg.get(t.scoringStrategyId) || { totalPnl: 0, firstTrade: t.openedAt, lastTrade: t.openedAt };
        entry.totalPnl += t.pnl || 0;
        if (t.openedAt < entry.firstTrade) entry.firstTrade = t.openedAt;
        if (t.openedAt > entry.lastTrade) entry.lastTrade = t.openedAt;
        agg.set(t.scoringStrategyId, entry);
      }

      // Apply ratios
      for (const s of strategies) {
        const a = agg.get(s.id);
        if (!a) continue;
        const daysActive = Math.max(1, Math.ceil((Date.now() - a.firstTrade.getTime()) / 86400000));
        s.totalPnl = Math.round(a.totalPnl * 100) / 100;
        s.daysActive = daysActive;
        s.profitRatio = Math.round((a.totalPnl / daysActive) * 100) / 100;
      }
    } catch (err) {
      this.logger.warn(`Could not compute profit ratios: ${(err as Error).message}`);
    }

    return strategies;
  }

  async findOne(id: string) {
    return this.prisma.tradingStrategy.findUnique({
      where: { id },
      include: {
        evaluations: {
          orderBy: { evaluatedAt: 'desc' },
          take: 20,
        },
      },
    });
  }

  async create(data: {
    name: string;
    protocolId: string;
    symbol: string;
    description?: string;
    brokerId?: string;
    shortProtocolId?: string;
    scoringStrategyId?: string;
    watchlistId?: string;
    watchlistName?: string;
    timeframe?: string;
    minComposite?: number;
    minRarityBand?: string;
    requireDirection?: string;
    slPct?: number;
    tpPct?: number;
    baseSize?: number;
    useRaritySizing?: boolean;
    maxSize?: number;
    maxPositions?: number;
    maxDailyLoss?: number;
    cooldownMinutes?: number;
    mode?: string;
    active?: boolean;
    hotStockEnabled?: boolean;
    hotStockAllocation?: number;
    hotStockDetectionMode?: string;
    hotStockMaxHoldHours?: number;
  }) {
    // Auto-create ScoringStrategy when watchlist is provided without a scoringStrategyId
    let scoringStrategyId = data.scoringStrategyId ?? null;
    if (!scoringStrategyId && (data.watchlistId || data.watchlistName)) {
      try {
        const watchlistName = data.watchlistName || data.watchlistId || 'default';
        const existingScoring = await (this.prisma as any).scoringStrategy.findFirst({
          where: { protocolId: data.protocolId, watchlistName },
        });
        if (existingScoring) {
          scoringStrategyId = existingScoring.id;
        } else {
          const created = await (this.prisma as any).scoringStrategy.create({
            data: {
              name: `${data.name} Scoring`,
              protocolId: data.protocolId,
              watchlistName,
              watchlistId: data.watchlistId ?? null,
              brokerId: data.brokerId ?? 'mt5',
              mode: data.mode ?? 'score',
              tradeThreshold: data.minComposite ?? 60,
              baseSize: data.baseSize ?? 0.01,
              slPct: data.slPct ?? 1.0,
              tpPct: data.tpPct ?? 1.0,
              enabled: true,
            },
          });
          scoringStrategyId = created.id;
        }
      } catch (err) {
        this.logger.warn(`Auto-create ScoringStrategy failed for ${data.name}: ${(err as Error).message}`);
      }
    }

    return this.prisma.tradingStrategy.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        protocolId: data.protocolId,
        shortProtocolId: data.shortProtocolId ?? null,
        scoringStrategyId,
        symbol: data.symbol.toUpperCase(),
        brokerId: data.brokerId ?? 'mt5',
        timeframe: data.timeframe ?? '5m',
        minComposite: data.minComposite ?? 65,
        minRarityBand: data.minRarityBand ?? null,
        requireDirection: data.requireDirection ?? null,
        slPct: data.slPct ?? 1.0,
        tpPct: data.tpPct ?? 1.0,
        baseSize: data.baseSize ?? 0.01,
        useRaritySizing: data.useRaritySizing ?? true,
        maxSize: data.maxSize ?? null,
        maxPositions: data.maxPositions ?? 1,
        maxDailyLoss: data.maxDailyLoss ?? null,
        cooldownMinutes: data.cooldownMinutes ?? 5,
        mode: data.mode ?? 'manual',
        active: data.active ?? false,
        hotStockEnabled: data.hotStockEnabled ?? false,
        hotStockAllocation: data.hotStockAllocation ?? null,
        hotStockDetectionMode: data.hotStockDetectionMode ?? null,
        hotStockMaxHoldHours: data.hotStockMaxHoldHours ?? null,
      },
    });
  }

  async update(id: string, data: Record<string, any>) {
    return this.prisma.tradingStrategy.update({ where: { id }, data });
  }

  async remove(id: string) {
    return this.prisma.tradingStrategy.delete({ where: { id } });
  }

  async toggle(id: string) {
    const strategy = await this.prisma.tradingStrategy.findUnique({ where: { id } });
    if (!strategy) throw new Error('Strategy not found');
    return this.prisma.tradingStrategy.update({
      where: { id },
      data: { active: !strategy.active },
    });
  }

  // ── Core: Evaluate ────────────────────────────────────

  /**
   * Evaluate a strategy against current market data.
   * Returns the scoring result WITHOUT placing any trade.
   */
  async evaluate(strategyId: string) {
    const strategy = await this.prisma.tradingStrategy.findUnique({ where: { id: strategyId } });
    if (!strategy) throw new Error('Strategy not found');

    const { symbol, protocolId, timeframe, minComposite, minRarityBand, requireDirection } = strategy;

    // Fetch bars from market data
    const sym = await this.prisma.symbol.findFirst({ where: { ticker: symbol } });
    if (!sym) {
      this.logger.warn(`Symbol ${symbol} not found in DB for strategy ${strategy.name}`);
      return { evaluated: false, reason: `Symbol ${symbol} not in database` };
    }

    const rows = await this.prisma.marketBar.findMany({
      where: { symbolId: sym.id, timeframe },
      orderBy: { timestamp: 'asc' },
      take: 200,
    });

    let bars: MarketBar[];

    if (rows.length < 30) {
      // ── MT5 Fallback (Sprint 2026-07-04) ──
      this.logger.warn(`Only ${rows.length} DB bars for ${symbol} — trying MT5 bridge`);
      const mt5Bars = await this.mt5.getCandles(symbol, timeframe, 200);
      if (mt5Bars.length >= 30) {
        // Store in DB for future use
        try {
          await this.prisma.marketBar.createMany({
            data: mt5Bars.map((b) => ({
              symbolId: sym.id, provider: 'mt5', timeframe,
              timestamp: b.timestamp, open: b.open, high: b.high,
              low: b.low, close: b.close, volume: b.volume,
            })),
            skipDuplicates: true,
          });
        } catch { /* ignore dupes */ }
        this.logger.log(`MT5 fallback: imported ${mt5Bars.length} bars for ${symbol}`);
        bars = mt5Bars;
      } else {
        return { evaluated: false, reason: `Only ${rows.length} DB bars + ${mt5Bars.length} MT5 bars (need 30+)` };
      }
    } else {
      bars = rows.map((r) => ({
        timestamp: r.timestamp, open: Number(r.open), high: Number(r.high),
        low: Number(r.low), close: Number(r.close), volume: Number(r.volume),
      }));
    }

    // Gated scoring — PROTOCOL-SCOPED (#531). The unscoped kitchen-sink
    // DIRECTIVE_GROUPS fallback was removed with the default protocol
    // (user policy: scoring without a protocol generates risky data).
    if (!protocolId) {
      this.logger.warn(`Strategy ${strategy.name} has no protocol linked — evaluation skipped`);
      return { evaluated: false, reason: 'No protocol linked' };
    }

    let gated: any;
    try {
      gated = await this.protocolGating.scoreWithGating(symbol, bars, protocolId);
    } catch (err) {
      this.logger.warn(`Protocol scoring failed for ${symbol}/${protocolId}: ${(err as Error).message}`);
      return { evaluated: false, reason: `Protocol scoring failed: ${(err as Error).message}` };
    }

    // Store the pre-gate percentage so the Strategy Monitor and the loop
    // speak the same scale (0-100, classification basis).
    const composite = Math.round(gated?.meta?.compositePct ?? gated?.composite ?? 0);
    const signal = gated?.signal ?? 'HOLD';
    const rarity = gated?.rarity ?? null;

    // Direction check
    let directionPassed = true;
    if (requireDirection && requireDirection !== 'BOTH') {
      const dirResult = this.getDirection(bars);
      directionPassed = dirResult === requireDirection;
    }

    // Threshold check
    const scoreOk = composite >= minComposite;
    const rarityOk = !minRarityBand || !rarity || rarityBandRank(rarity.band) >= rarityBandRank(minRarityBand);
    const passed = scoreOk && rarityOk && directionPassed;

    // Store evaluation
    const evaluation = await this.prisma.strategyEvaluation.create({
      data: {
        strategyId,
        symbol,
        composite,
        signal,
        rarityBand: rarity?.band ?? null,
        rarityPct: rarity?.percentile ?? null,
        direction: requireDirection ?? null,
        traded: false,
      },
    });

    return {
      evaluated: true,
      passed,
      evaluationId: evaluation.id,
      symbol,
      composite,
      signal,
      rarity: rarity ?? null,
      checks: {
        scoreOk: { passed: scoreOk, required: minComposite, actual: composite },
        rarityOk: { passed: rarityOk, required: minRarityBand ?? 'none', actual: rarity?.band ?? 'unknown' },
        directionOk: { passed: directionPassed },
      },
    };
  }

  // ── Core: Execute ─────────────────────────────────────

  /**
   * Evaluate AND execute a trade if conditions are met.
   * Respects mode: manual=log only, semi-auto=needs approval, auto=execute.
   */
  async execute(strategyId: string) {
    const strategy = await this.prisma.tradingStrategy.findUnique({ where: { id: strategyId } });
    if (!strategy) throw new Error('Strategy not found');

    if (!strategy.active) {
      return { executed: false, reason: 'Strategy is not active' };
    }

    // Cooldown check
    const lastTrade = this.lastTradeTime.get(strategyId);
    if (lastTrade) {
      const elapsed = (Date.now() - lastTrade.getTime()) / 60000;
      if (elapsed < strategy.cooldownMinutes) {
        return { executed: false, reason: `Cooldown active — ${Math.ceil(strategy.cooldownMinutes - elapsed)}m remaining` };
      }
    }

    // Position limit check
    if (strategy.mode === 'auto') {
      const positions = await this.mt5.getPositions();
      if (positions.length >= strategy.maxPositions) {
        return { executed: false, reason: `Max positions (${strategy.maxPositions}) reached` };
      }
    }

    // Evaluate
    const evalResult = await this.evaluate(strategyId);
    if (!evalResult.evaluated || !evalResult.passed) {
      return {
        executed: false,
        reason: evalResult.evaluated ? 'Conditions not met' : evalResult.reason,
        evaluation: evalResult,
      };
    }

    // Compute position size with regime adaptation
    let size = strategy.baseSize ?? 0.01;
    if (strategy.useRaritySizing && evalResult.rarity) {
      size *= evalResult.rarity.sizeMultiplier;
    }

    // ── Regime-Adaptive Sizing (Sprint 2026-07-04) ──
    let regimeMultiplier = 1.0;
    let regimeLabel = 'normal';
    try {
      const condition = this.conditionDetector.detect({
        symbol: strategy.symbol,
        bars: [], // ConditionDetector falls back to defaults if no bars
      });
      if (condition.volatility === 'high') {
        regimeMultiplier = 0.5;  // Half-size in high vol
        regimeLabel = 'high vol — half size';
      } else if (condition.regime === 'chaotic') {
        regimeMultiplier = 0.25; // Quarter-size in chaos
        regimeLabel = 'chaotic — quarter size';
      } else if (condition.regime === 'trending' && condition.regimeStrength > 0.7) {
        regimeMultiplier = 1.25; // 25% boost in strong trends
        regimeLabel = 'strong trend — 1.25× size';
      }
    } catch { /* keep default 1.0 */ }
    size *= regimeMultiplier;
    // ── End regime-adaptive sizing ──

    if (strategy.maxSize) {
      size = Math.min(size, strategy.maxSize);
    }
    size = Math.round(size * 10000) / 10000; // Round to 4 decimals

    // Never dispatch a zero/negative volume order. Rarity sizing (black-swan
    // band) intentionally multiplies size by 0 — skip the trade instead of
    // sending an invalid 0-lot order to the broker.
    if (size <= 0) {
      this.logger.warn(`Trade skipped for ${strategy.symbol}: position size ${size} (invalid after sizing)`);
      return {
        executed: false,
        reason: 'Position size is 0 after sizing (e.g. black-swan rarity) — trade skipped',
        signal: evalResult.signal,
        composite: evalResult.composite,
        suggestedSize: 0,
        evaluationId: evalResult.evaluationId,
      };
    }

    // Mode dispatch
    if (strategy.mode === 'manual') {
      // Log only — human must execute
      await this.prisma.strategyEvaluation.update({
        where: { id: evalResult.evaluationId },
        data: { tradeResult: 'Manual mode — awaiting human execution' },
      });
      return {
        executed: false,
        reason: 'Manual mode — signal logged. Execute manually.',
        signal: evalResult.signal,
        composite: evalResult.composite,
        suggestedSize: size,
        evaluationId: evalResult.evaluationId,
      };
    }

    // Auto / semi-auto: place bracket order with trailing stop
    const entryPrice = 0; // Market order — MT5 fills at best available
    const slPct = (strategy.slPct ?? 1.0) / 100;
    const tpPct = (strategy.tpPct ?? 1.0) / 100;

    // ── Pre-Flight Safety Gates (Issue #28) ──────────────
    const safetyCheck = await this.runSafetyGates(strategy, size);
    if (!safetyCheck.allowed) {
      return { executed: false, reason: safetyCheck.reason };
    }
    // ── End safety gates ──

    // ── Auto Trailing Stop (Sprint 2026-07-04) ──
    // Use ATR-based trail: 2× ATR for trail distance, activate at +1.5× SL distance
    const useTrailingStop = strategy.mode === 'auto'; // Auto-trail for all auto strategies
    const trailDistancePct = slPct * 0.75;            // Trail at 75% of SL distance
    const trailActivationPct = slPct * 1.5;            // Activate trailing once in 1.5× SL profit

    const slPrice = evalResult.signal === 'BUY'
      ? entryPrice > 0
        ? entryPrice * (1 - slPct)
        : 0 // Will be set by MT5 based on current market
      : entryPrice > 0
        ? entryPrice * (1 + slPct)
        : 0;

    const tpPrice = evalResult.signal === 'BUY'
      ? entryPrice > 0
        ? entryPrice * (1 + tpPct)
        : 0
      : entryPrice > 0
        ? entryPrice * (1 - tpPct)
        : 0;

    const orderType = evalResult.signal === 'BUY' ? 'BUY' : 'SELL';

    try {
      const result = await this.mt5.placeOrder({
        symbol: strategy.symbol,
        type: orderType as 'BUY' | 'SELL',
        volume: size,
        sl: slPrice,
        tp: tpPrice,
        // Name only — the shared sanitizer strips '|' and '%', so embedding
        // "| composite%" pollutes the strategy name parsed back on close.
        comment: `TCS ${strategy.name}`,
      });

      this.lastTradeTime.set(strategyId, new Date());

      // ── Signal Alert (Sprint 2026-07-04) ──
      if (result.success) {
        this.notificationService.send({
          event: 'entry-signal',
          title: `${orderType} ${strategy.symbol}`,
          body: [
            `Signal: ${evalResult.signal} @ ${evalResult.composite}%`,
            `Size: ${size} (${regimeLabel})`,
            useTrailingStop
              ? `Trailing SL: ${(trailDistancePct * 100).toFixed(1)}% trail`
              : `SL/TP: ${slPct * 100}% / ${tpPct * 100}%`,
            `Rarity: ${evalResult.rarity?.band ?? 'standard'}`,
            `Strategy: ${strategy.name}`,
          ].join(' | '),
        }).catch(() => {}); // Fire-and-forget
      }
      // ── End signal alert ──

      await this.prisma.strategyEvaluation.update({
        where: { id: evalResult.evaluationId },
        data: {
          traded: result.success,
          tradeTicket: result.ticket ?? null,
          tradeResult: result.success
            ? [
                `Order: ticket ${result.ticket}, size ${size} (${regimeLabel})`,
                useTrailingStop
                  ? `Trailing: ${(trailDistancePct * 100).toFixed(1)}% trail, activate at +${(trailActivationPct * 100).toFixed(1)}% profit`
                  : `Fixed SL/TP: ${slPct * 100}% / ${tpPct * 100}%`,
              ].join(' | ')
            : `Order failed: ${result.error}`,
        },
      });

      return {
        executed: result.success,
        ticket: result.ticket ?? null,
        symbol: strategy.symbol,
        type: orderType,
        size,
        slPrice,
        tpPrice,
        composite: evalResult.composite,
        signal: evalResult.signal,
        rarity: evalResult.rarity?.band ?? null,
        trailingStop: useTrailingStop ? {
          enabled: true,
          trailDistancePct,
          activationPct: trailActivationPct,
        } : undefined,
        regimeSizing: { multiplier: regimeMultiplier, label: regimeLabel },
      };
    } catch (err: any) {
      this.logger.error(`Trade execution failed: ${err.message}`);
      return { executed: false, reason: err.message };
    }
  }

  /**
   * Pre-flight safety gates before any MT5 order.
   * Checks env-driven risk limits + RiskService portfolio gates.
   */
  private async runSafetyGates(
    strategy: any,
    size: number,
  ): Promise<{ allowed: boolean; reason: string }> {
    // ── 1. MT5_MAX_POSITION_SIZE ──
    const maxPosSize = parseFloat(process.env.MT5_MAX_POSITION_SIZE || '1.0');
    if (size > maxPosSize) {
      return { allowed: false, reason: `Position size ${size} exceeds MT5_MAX_POSITION_SIZE (${maxPosSize})` };
    }

    // ── 2. MT5_MAX_OPEN_POSITIONS ──
    const maxOpenPositions = parseInt(process.env.MT5_MAX_OPEN_POSITIONS || '5', 10);
    try {
      const positions = await this.mt5.getPositions();
      if (positions.length >= maxOpenPositions) {
        return { allowed: false, reason: `Max open positions (${maxOpenPositions}) reached — ${positions.length} currently open` };
      }
    } catch { /* MT5 may be unreachable — proceed with caution */ }

    // ── 3. MT5_MAX_DAILY_LOSS ──
    const maxDailyLoss = parseFloat(process.env.MT5_MAX_DAILY_LOSS || '100');
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const trades = await this.prisma.trade.findMany({
        where: {
          provider: 'mt5',
          closedAt: { gte: today },
          pnl: { not: null },
        },
        select: { pnl: true },
      });
      const dailyPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      if (dailyPnl < -maxDailyLoss) {
        return { allowed: false, reason: `Daily loss $${Math.abs(dailyPnl).toFixed(2)} exceeds MT5_MAX_DAILY_LOSS ($${maxDailyLoss})` };
      }
    } catch { /* DB may be unavailable */ }

    // ── 4. RiskService portfolio gates ──
    try {
      const positions = await this.mt5.getPositions().catch(() => []);
      const account = await this.mt5.getAccount().catch(() => null);
      const portfolioValue = account?.equity ?? account?.balance ?? 10_000;
      // Use actual margin impact instead of notional (0.01 lot at 1:30 = ~$33, not $1,000)
      const leverage = account?.margin && account?.balance
        ? account.balance / account.margin
        : 30;
      const estimatedCapital = (size * 100_000) / Math.max(leverage, 1); // Margin used, not notional

      const riskProfile = {
        maxPortfolioRisk: 0.15,
        maxPerTradeRisk: 0.02,
        maxPerSymbol: 0.25,
        maxPositions: maxOpenPositions,
        maxDrawdown: 0.25,
        trailingStopAtProfit: 0.03,
      };

      const posCheck = this.riskService.canOpenPosition(
        positions.length,
        portfolioValue,
        estimatedCapital,
        riskProfile,
      );
      if (!posCheck.allowed) {
        return { allowed: false, reason: posCheck.reason };
      }

      // Drawdown check — track peak equity (only increases) so drawdown is real.
      // Previously peak was hardcoded to current equity, making drawdown always 0%
      // and permanently disabling the maxDrawdown: 0.25 risk limit.
      if (this.peakEquity === null || portfolioValue > this.peakEquity) {
        this.peakEquity = portfolioValue;
      }
      const drawdownCheck = this.riskService.checkDrawdown(
        this.peakEquity,
        portfolioValue,
        riskProfile,
      );
      if (drawdownCheck.inDrawdown) {
        return { allowed: false, reason: `Drawdown ${(drawdownCheck.drawdownPercent * 100).toFixed(1)}% exceeds limit` };
      }
    } catch (err: any) {
      this.logger.warn(`Risk gate check failed: ${err.message} — proceeding with caution`);
    }

    return { allowed: true, reason: 'All safety gates passed' };
  }

  // ── Helpers ───────────────────────────────────────────

  /**
   * Evaluate all active strategies. Intended to be called by
   * TradingSchedulerService or triggered manually via API.
   */
  async evaluateAllActive() {
    const strategies = await this.prisma.tradingStrategy.findMany({
      where: { active: true },
    });
    if (strategies.length === 0) return { evaluated: 0 };

    this.logger.log(`Evaluating ${strategies.length} active strategy(s)...`);
    let count = 0;
    for (const strategy of strategies) {
      try {
        if (strategy.mode === 'auto') {
          await this.execute(strategy.id);
        } else {
          await this.evaluate(strategy.id);
        }
        count++;
      } catch (err: any) {
        this.logger.error(`Strategy ${strategy.name}: ${err.message}`);
      }
    }
    return { evaluated: count };
  }

  private getDirection(bars: MarketBar[]): string {
    if (bars.length < 5) return 'HOLD';
    const recent = bars.slice(-5);
    const first = recent[0].close;
    const last = recent[recent.length - 1].close;
    if (last > first * 1.002) return 'BUY';
    if (last < first * 0.998) return 'SELL';
    return 'HOLD';
  }

  /**
   * Seed default trading strategies from seed data.
   * Idempotent — skips strategies that already exist by name+symbol.
   * Creates scoring strategies automatically if they don't exist.
   */
  async seedDefaults(strategies: Array<{
    name: string; symbol: string; protocolId: string;
    brokerId: string; mode: string; timeframe: string;
    baseSize: number; slPct: number; tpPct: number; minComposite: number;
  }>): Promise<{ created: number; skipped: number; scoringCreated: number }> {
    if (!this.prisma.isAvailable) {
      return { created: 0, skipped: strategies.length, scoringCreated: 0 };
    }

    let created = 0, skipped = 0, scoringCreated = 0;

    for (const s of strategies) {
      // Check if already exists
      const existing = await (this.prisma as any).tradingStrategy.findFirst({
        where: { name: s.name, symbol: s.symbol },
      });
      if (existing) { skipped++; continue; }

      // Create or find scoring strategy
      let scoringId: string | null = null;
      try {
        const existingScoring = await (this.prisma as any).scoringStrategy.findFirst({
          where: { protocolId: s.protocolId, watchlistName: 'default' },
        });
        if (existingScoring) {
          scoringId = existingScoring.id;
        } else {
          const createdScoring = await (this.prisma as any).scoringStrategy.create({
            data: {
              name: `${s.name} Scoring`,
              protocolId: s.protocolId,
              watchlistName: 'default',
              enabled: true,
              tradeThreshold: s.minComposite,
              mode: 'score',
            },
          });
          scoringId = createdScoring.id;
          scoringCreated++;
        }
      } catch (err) {
        this.logger.warn(`Could not create scoring strategy for ${s.name}: ${(err as Error).message}`);
      }

      // Create trading strategy
      try {
        await (this.prisma as any).tradingStrategy.create({
          data: {
            name: s.name,
            symbol: s.symbol,
            protocolId: s.protocolId,
            brokerId: s.brokerId,
            mode: s.mode,
            timeframe: s.timeframe,
            baseSize: s.baseSize,
            slPct: s.slPct,
            tpPct: s.tpPct,
            minComposite: s.minComposite,
            scoringStrategyId: scoringId,
            active: true,
          },
        });
        created++;
      } catch (err) {
        this.logger.warn(`Could not create trading strategy ${s.name}: ${(err as Error).message}`);
        skipped++;
      }
    }

    this.logger.log(`Seed complete: ${created} created, ${skipped} skipped, ${scoringCreated} scoring auto-created`);
    return { created, skipped, scoringCreated };
  }
}

function rarityBandRank(band: string): number {
  const order = ['standard', 'strong', 'exceptional', 'cyclical', 'black-swan'];
  return order.indexOf(band);
}
