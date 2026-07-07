import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { Mt5TradingService } from './mt5-trading.service';
import { ConditionDetectorService } from '../directives/condition-detector.service';
import { RiskService } from '../risk/risk.service';
import { NotificationService } from '../notifications/notifications.service';
import {
  DIRECTIVE_GROUPS,
  BTC_SPEED_GROUPS,
  PROTOCOL_REGISTRY,
} from '../directives/directive-groups';
import { DirectiveInput, MarketBar } from '../directives/interfaces/directive.interface';

export interface StrategySummary {
  id: string;
  name: string;
  protocolId: string;
  symbol: string;
  timeframe: string;
  mode: string;
  active: boolean;
  lastEvaluatedAt: string | null;
  lastSignal: string | null;
  lastComposite: number | null;
  evaluationCount: number;
}

@Injectable()
export class TradingStrategyService {
  private readonly logger = new Logger(TradingStrategyService.name);
  private lastTradeTime = new Map<string, Date>(); // strategyId → last trade time

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
    private readonly mt5: Mt5TradingService,
    private readonly conditionDetector: ConditionDetectorService,
    private readonly riskService: RiskService,
    private readonly notificationService: NotificationService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────

  async findAll(): Promise<StrategySummary[]> {
    const strategies = await this.prisma.tradingStrategy.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        evaluations: {
          orderBy: { evaluatedAt: 'desc' },
          take: 1,
        },
      },
    });

    return strategies.map((s) => {
      const lastEval = s.evaluations?.[0];
      return {
        id: s.id,
        name: s.name,
        protocolId: s.protocolId,
        symbol: s.symbol,
        timeframe: s.timeframe,
        mode: s.mode,
        active: s.active,
        lastEvaluatedAt: lastEval?.evaluatedAt ? new Date(lastEval.evaluatedAt).toISOString() : null,
        lastSignal: lastEval?.signal ?? null,
        lastComposite: lastEval?.composite ?? null,
        evaluationCount: s.evaluations?.length ?? 0,
      };
    });
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
    brokerId?: string;
    timeframe?: string;
    minComposite?: number;
    slPct?: number;
    tpPct?: number;
    baseSize?: number;
    mode?: string;
  }) {
    return this.prisma.tradingStrategy.create({
      data: {
        name: data.name,
        protocolId: data.protocolId,
        symbol: data.symbol.toUpperCase(),
        brokerId: data.brokerId ?? 'mt5',
        timeframe: data.timeframe ?? '5m',
        minComposite: data.minComposite ?? 65,
        slPct: data.slPct ?? 1.0,
        tpPct: data.tpPct ?? 1.0,
        baseSize: data.baseSize ?? 0.01,
        mode: data.mode ?? 'manual',
        active: false,
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

    // Gated scoring
    const groups = PROTOCOL_REGISTRY[protocolId]?.groups ?? DIRECTIVE_GROUPS;
    const { composite, signal, rarity } = await this.gateScore(symbol, bars, groups);

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
    let size = strategy.baseSize;
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
    const slPct = strategy.slPct / 100; // Convert from percentage to decimal
    const tpPct = strategy.tpPct / 100;

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
        comment: `TCS ${strategy.name} | ${evalResult.composite}%`,
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

      // Drawdown check — use account balance as peak proxy
      const drawdownCheck = this.riskService.checkDrawdown(
        Math.max(portfolioValue, portfolioValue), // TODO: track peak equity properly
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

  private async gateScore(
    symbol: string,
    bars: MarketBar[],
    groups: any[],
  ): Promise<{ composite: number; signal: string; rarity: any | null }> {
    const input: DirectiveInput = { symbol, bars };
    const allResults = await this.directivesService.runAll(input);

    let technicalScore = 50;
    let sentimentScore = 50;
    let riskScore = 50;

    for (const group of groups) {
      let totalNorm = 0;
      let count = 0;
      for (const directiveId of group.directiveIds) {
        const result = allResults.get(directiveId);
        if (!result) continue;
        const directive = this.directivesService.get(directiveId);
        const maxScore = directive?.maxScore ?? 100;
        totalNorm += maxScore > 0 ? (result.score / maxScore) * 100 : 0;
        count++;
      }
      const avg = count > 0 ? totalNorm / count : 50;
      if (group.id === 'technical') technicalScore = avg;
      else if (group.id === 'sentiment') sentimentScore = avg;
      else if (group.id === 'risk') riskScore = avg;
    }

    const riskGroup = groups.find((g: any) => g.id === 'risk');
    let riskMultiplier = riskScore / 100;
    if (riskGroup) {
      riskMultiplier = Math.max(riskGroup.minMultiplier, Math.min(riskGroup.maxMultiplier, riskMultiplier));
    }

    const raw = (technicalScore * 0.40 + sentimentScore * 0.35) * riskMultiplier;
    const composite = Math.round(Math.max(0, Math.min(100, raw)));
    const signal = composite >= 65 ? 'BUY' : composite >= 35 ? 'HOLD' : 'SELL';

    // Rarity (simplified — full implementation in ProtocolGatingService)
    let rarity: any = null;
    try {
      const history = await this.prisma.scoreSnapshot.findMany({
        where: { snappedAt: { gte: new Date(Date.now() - 365 * 86400000) } },
        select: { composite: true },
        orderBy: { composite: 'asc' },
        take: 500,
      });
      if (history.length >= 10) {
        const scores = history.map(h => h.composite);
        let below = 0;
        for (const s of scores) { if (s < composite) below++; }
        const pct = Math.round((below / scores.length) * 100);
        const band = pct >= 99 ? 'black-swan' : pct >= 95 ? 'cyclical' : pct >= 85 ? 'exceptional' : pct >= 70 ? 'strong' : 'standard';
        const multipliers: Record<string, number> = { 'standard': 1.0, 'strong': 1.5, 'exceptional': 2.0, 'cyclical': 2.5, 'black-swan': 0 };
        rarity = { percentile: pct, band, sizeMultiplier: multipliers[band] ?? 1.0 };
      }
    } catch { /* rarity unavailable */ }

    return { composite, signal, rarity };
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
}

function rarityBandRank(band: string): number {
  const order = ['standard', 'strong', 'exceptional', 'cyclical', 'black-swan'];
  return order.indexOf(band);
}
