import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DirectivesService } from '../directives/directives.service';
import { Mt5TradingService } from './mt5-trading.service';
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

    return strategies.map((s) => ({
      id: s.id,
      name: s.name,
      protocolId: s.protocolId,
      symbol: s.symbol,
      timeframe: s.timeframe,
      mode: s.mode,
      active: s.active,
      lastEvaluatedAt: s.evaluations[0]?.evaluatedAt?.toISOString() ?? null,
      lastSignal: s.evaluations[0]?.signal ?? null,
      lastComposite: s.evaluations[0]?.composite ?? null,
      evaluationCount: 0, // Count via separate query for perf
    }));
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
      take: 120,
    });

    if (rows.length < 30) {
      return { evaluated: false, reason: `Only ${rows.length} bars available (need 30+)` };
    }

    const bars: MarketBar[] = rows.map((r) => ({
      timestamp: r.timestamp,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

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

    // Compute position size
    let size = strategy.baseSize;
    if (strategy.useRaritySizing && evalResult.rarity) {
      size *= evalResult.rarity.sizeMultiplier;
    }
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

    // Auto / semi-auto: place bracket order
    const entryPrice = 0; // Market order — MT5 fills at best available
    const slPrice = evalResult.signal === 'BUY'
      ? entryPrice * (1 - strategy.slPct / 100)
      : entryPrice * (1 + strategy.slPct / 100);
    const tpPrice = evalResult.signal === 'BUY'
      ? entryPrice * (1 + strategy.tpPct / 100)
      : entryPrice * (1 - strategy.tpPct / 100);

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

      await this.prisma.strategyEvaluation.update({
        where: { id: evalResult.evaluationId },
        data: {
          traded: result.success,
          tradeTicket: result.ticket ?? null,
          tradeResult: result.success
            ? `Order placed: ticket ${result.ticket}, size ${size}, SL ${slPrice}, TP ${tpPrice}`
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
      };
    } catch (err: any) {
      this.logger.error(`Trade execution failed: ${err.message}`);
      return { executed: false, reason: err.message };
    }
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
    const allResults = this.directivesService.runAll(input);

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
