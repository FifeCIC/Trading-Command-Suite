/**
 * Risk Controller
 * ================
 * Exposes RiskService + TradingGatesService as a unified risk dashboard.
 */

import { Controller, Get, Post, Put, Body, Param, Query, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskService, PortfolioRisk, PositionSizeType, StopLossType, TakeProfitType } from './risk.service';
import { buildRiskProfile } from './risk-profile-rules';
import {
  resolveIntent,
  summariseExposure,
  overrideKey,
  parseIntent,
  describeIntent,
  POSITION_INTENTS,
  GAP_EXPOSED_INTENTS,
  PROVIDER_DEFAULT_INTENT,
  type PositionIntent,
} from './position-intent';
import { TradingGatesService, GateConfig } from '../trading-gates/trading-gates.service';
import { MonteCarloService } from './monte-carlo.service';
import { PrismaService } from '../../database/prisma.service';
import { WeekendGapRiskService } from './weekend-gap-risk.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';

@ApiTags('risk')
@Controller('risk')
export class RiskController {
  private readonly logger = new Logger(RiskController.name);

  constructor(
    private readonly riskService: RiskService,
    private readonly tradingGates: TradingGatesService,
    private readonly monteCarlo: MonteCarloService,
    private readonly prisma: PrismaService,
    private readonly weekendGapRisk: WeekendGapRiskService,
    private readonly settings: SettingsResolverService,
  ) {}

  /**
   * readIntentOverrides() — every recorded exception, as the map `position-intent.ts` expects.
   *
   * ⚠️ Returns the rows AND an error, rather than swallowing one into an empty map. An empty map
   * silently means "no exceptions", which for a `trading212` holding resolves to `long-term` — so a
   * failed read would EXEMPT the holdings from risk checks while looking like a healthy answer.
   * Callers must surface `error`; see `getPositionIntents()`.
   */
  private async readIntentOverrides(): Promise<{ map: Map<string, PositionIntent>; error?: string }> {
    try {
      const rows = await this.prisma.positionIntentSetting.findMany();
      const map = new Map<string, PositionIntent>();
      for (const r of rows) {
        const parsed = parseIntent(r.intent);
        if (parsed) map.set(overrideKey(r.provider, r.symbol), parsed);
        else this.logger.warn(`position_intent ${r.provider}/${r.symbol} has unreadable intent "${r.intent}"`);
      }
      return { map };
    } catch (e: any) {
      return { map: new Map(), error: e?.message ?? 'intent override read failed' };
    }
  }

  /**
   * GET /api/risk/position-intents
   *
   * The answer to "what kind of position is this, and does a weekend gap endanger it?" — one row
   * per position, with the intent, WHERE that intent came from, and whether the owner is needed.
   *
   * WHY IT EXISTS: the weekend-gap alert reported 26 positions to "consider flattening" when 21
   * were deliberate long-term holdings. The alert could not tell the difference because nothing
   * recorded it. This endpoint is the surface where the difference is VISIBLE and SETTABLE, so the
   * default is never the only answer.
   *
   * `needsDecision` is the owner's own request: *"if the app itself is missing values it should ask
   * me"*. A row appears there when neither an override nor a provider default can characterise it —
   * the app asks rather than guessing in either direction.
   */
  @Get('position-intents')
  @ApiOperation({ summary: 'Per-position trading intent, its source, and whether a decision is needed' })
  async getPositionIntents(@Query('provider') provider?: string, @Query('symbol') symbol?: string) {
    const { map, error } = await this.readIntentOverrides();
    const where: any = {};
    if (provider) where.provider = provider;
    if (symbol) where.symbol = symbol;

    const positions = await this.prisma.position.findMany({ where });

    const rows = positions.map((p) => {
      const { intent, source } = resolveIntent({ symbol: p.symbol, provider: p.provider }, map);
      return {
        provider: p.provider,
        symbol: p.symbol,
        side: p.side ?? null,
        quantity: p.quantity,
        pnl: p.pnl ?? null,
        intent,
        intentSource: source,
        gapExposed: GAP_EXPOSED_INTENTS.includes(intent),
        needsDecision: intent === 'unclassified',
        label: describeIntent(intent),
      };
    });

    const { exposed, held, needingDecision } = summariseExposure(
      positions.map((p) => ({ symbol: p.symbol, provider: p.provider })), map,
    );

    return {
      positions: rows,
      totals: {
        all: rows.length,
        gapExposed: exposed.length,
        heldLongTerm: held.length,
        needingDecision: needingDecision.length,
      },
      vocabulary: {
        intents: POSITION_INTENTS,
        gapExposedIntents: GAP_EXPOSED_INTENTS,
        providerDefaults: PROVIDER_DEFAULT_INTENT,
      },
      // ⚠️ Present only when the override read FAILED. Forwarded so a stale or empty `totals` is
      // never mistaken for a healthy "nothing to report".
      ...(error ? { error } : {}),
    };
  }

  /**
   * PUT /api/risk/position-intents/:provider/:symbol
   *
   * Records the owner's answer for one position. Body: `{ intent, note? }`.
   *
   * This is the other half of the alert fix — the alert asks, this is where the answer is kept. Once
   * set, the position resolves by OVERRIDE (reported as `intentSource: 'override'`) rather than by
   * provider inference, so the two are always distinguishable afterwards.
   */
  @Put('position-intents/:provider/:symbol')
  @ApiOperation({ summary: 'Set the trading intent for one provider+symbol position' })
  async setPositionIntent(
    @Param('provider') provider: string,
    @Param('symbol') symbol: string,
    @Body() body: { intent?: string; note?: string },
  ) {
    const intent = parseIntent(body?.intent);
    if (!intent) {
      // Refuse rather than coerce. Defaulting an unrecognised intent to `long-term` would silence
      // risk checks on a position the owner was trying to flag — the worst possible direction.
      return {
        ok: false,
        error: `unknown intent "${body?.intent}" — expected one of: ${POSITION_INTENTS.join(', ')}`,
        accepted: POSITION_INTENTS,
      };
    }

    const row = await this.prisma.positionIntentSetting.upsert({
      where: { provider_symbol: { provider, symbol } },
      create: { provider, symbol, intent, note: body?.note ?? null },
      // ⚠️ `intent` is in the update clause, not only the create. An upsert that omits a field
      // cannot REPAIR a wrong value — it would look like a successful change while the old intent
      // stayed in force. (Same defect class as the seeders in database-seed-discipline.)
      update: { intent, note: body?.note ?? null },
    });

    this.logger.log(`position intent set: ${provider}/${symbol} -> ${intent}`);
    return {
      ok: true,
      provider: row.provider,
      symbol: row.symbol,
      intent: row.intent,
      label: describeIntent(intent),
      gapExposed: GAP_EXPOSED_INTENTS.includes(intent),
    };
  }

  /**
   * readRiskCapValues() — the three settings the `PortfolioRisk` caps are built from.
   *
   * One helper for three call sites (GET /overview, GET /limits, POST /calculate-position). Each of
   * those used to hand-write its own six-key literal, which is how `0.25` came to exist in five
   * copies across four files (#865). Now there is one builder and one source per value.
   */
  private async readRiskCapValues() {
    return {
      maxOpenPositions: await this.settings.get<number>('risk.maxOpenPositions'),
      maxPerSymbol: await this.settings.get<number>('risk.maxPerSymbol'),
      maxDrawdown: await this.settings.get<number>('risk.maxDrawdown'),
      // Live since #900 (2026-09-19) — declared since the beginning with no reader anywhere.
      maxPortfolioRisk: await this.settings.get<number>('risk.maxPortfolioRisk'),
    };
  }

  /**
   * GET /api/risk/overview
   *
   * Unified risk dashboard: portfolio health + gate config + recent checks.
   */
  @Get('overview')
  async getOverview() {
    const [health, gateConfig] = await Promise.all([
      this.getPortfolioHealthReal(),
      Promise.resolve(this.tradingGates.getConfig()),
    ]);

    // Build gate status from config
    const gateStatus = {
      enabled: gateConfig.enabled,
      gates: {
        threshold: {
          active: true,
          minScore: gateConfig.thresholds.minScore,
          minConfidence: gateConfig.thresholds.minConfidence,
          longThreshold: gateConfig.thresholds.longThreshold,
          shortThreshold: gateConfig.thresholds.shortThreshold,
        },
        scope: {
          active: true,
          whitelist: gateConfig.scope.symbolWhitelist,
          blacklist: gateConfig.scope.symbolBlacklist,
          marketTypes: gateConfig.scope.marketTypes,
          minPrice: gateConfig.scope.minPrice,
          minAvgVolume: gateConfig.scope.minAvgVolume,
          tradingHours: gateConfig.scope.tradingHours,
        },
        position: {
          active: true,
          maxPositions: gateConfig.positions.maxPositions,
          cooldownHours: gateConfig.positions.cooldownHours,
          allowAveraging: gateConfig.positions.allowAveraging,
          closeOppositeSignal: gateConfig.positions.closeOppositeSignal,
        },
      },
    };

    // Risk limits — built from the SAME settings the live gate reads, so this dashboard cannot
    // disagree with the engine that refuses the order.
    //
    // ⚠️ This block used to spell all six caps by hand AND take `maxPositions` from the
    // TRADING-GATES config, while GET /api/trading/strategies/risk-limits takes it from
    // `risk.maxOpenPositions`. Two endpoints therefore reported a DIFFERENT max-positions cap — and
    // the one reported here came from a config nothing on the live path consults. (#865)
    const limits = await buildRiskProfile(await this.readRiskCapValues());

    // Determine circuit breaker state
    const circuitBreaker = this.evaluateCircuitBreaker(health, gateConfig);

    return {
      generatedAt: new Date().toISOString(),
      portfolioHealth: health,
      riskLimits: limits,
      gateConfig,
      gateStatus,
      circuitBreaker,
    };
  }

  private evaluateCircuitBreaker(
    health: any,
    config: GateConfig,
  ) {
    const triggers: string[] = [];

    if (health.drawdown > 20) triggers.push('Drawdown > 20%');
    if (health.drawdown > (config.thresholds as any)?.maxDrawdown) triggers.push('Exceeded max drawdown');
    if (health.totalExposure > 80) triggers.push('Exposure > 80%');

    const state = triggers.length > 0 ? 'TRIPPED' : 'READY';
    return {
      state,
      triggers,
      autoResetMinutes: state === 'TRIPPED' ? 60 : null,
      lastChecked: new Date().toISOString(),
    };
  }

  private async getPortfolioHealthReal() {
    try {
      // Count positions
      const positionCount = await this.prisma.position.count().catch(() => 0);
      const pnlAgg = await this.prisma.position.aggregate({
        _sum: { pnl: true },
      }).catch(() => ({ _sum: { pnl: 0 } }));
      const totalPnlFromPositions = (pnlAgg as any)?._sum?.pnl ?? 0;

      // Check recent trades for P&L
      const recentTrades: any[] = await this.prisma.trade.findMany({
        orderBy: { closedAt: 'desc' },
        take: 50,
        select: { pnl: true, closedAt: true },
      }).catch(() => [] as any[]);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayTrades = recentTrades.filter((t: any) => t.closedAt && new Date(t.closedAt) >= todayStart);
      const dailyPnl = todayTrades.reduce((s: number, t: any) => s + (t.pnl || 0), 0);
      const tradeTotalPnl = recentTrades.reduce((s: number, t: any) => s + (t.pnl || 0), 0);

      // Estimate drawdown from trade history
      const drawdown = this.computeDrawdown(recentTrades);

      // Risk warnings
      const warnings: string[] = [];
      if (drawdown > 12) warnings.push(`Drawdown at ${drawdown.toFixed(1)}% — near warning threshold`);
      if (drawdown > 20) warnings.push(`Drawdown at ${drawdown.toFixed(1)}% — CRITICAL`);
      if (positionCount === 0) warnings.push('No tracked positions found');
      if (dailyPnl < -500) warnings.push('Daily P&L below -$500');

      return {
        totalExposure: positionCount,
        totalPositionPnl: totalPnlFromPositions,
        tradeTotalPnl,
        drawdown,
        dailyPnl,
        totalPnl: totalPnlFromPositions,
        positionCount,
        riskWarnings: warnings,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(`Portfolio health query failed: ${(err as Error).message}`);
      return {
        totalExposure: 0, totalPositionPnl: 0, tradeTotalPnl: 0, drawdown: 0, dailyPnl: 0,
        totalPnl: 0, positionCount: 0, riskWarnings: ['Unable to query portfolio data'],
        timestamp: new Date().toISOString(),
      };
    }
  }

  private computeDrawdown(trades: Array<{ pnl: number | null; closedAt: Date | null }>): number {
    if (trades.length === 0) return 0;
    let peak = 0;
    let cumPnL = 0;
    let maxDrawdown = 0;
    for (const t of [...trades].reverse()) {
      cumPnL += t.pnl || 0;
      if (cumPnL > peak) peak = cumPnL;
      const dd = peak > 0 ? ((peak - cumPnL) / peak) * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
    return Math.round(maxDrawdown * 10) / 10;
  }

  @Post('calculate-position')
  @ApiOperation({ summary: 'Calculate suggested position size, SL, and TP' })
  async calculatePosition(
    @Body() body: {
      symbol: string;
      score: number;
      confidence: number;
      strategyId?: string;
      entryPrice: number;
      portfolioValue: number;
      positionType?: PositionSizeType;
      stopLossType?: StopLossType;
      takeProfitType?: TakeProfitType;
      atr?: number;
      swingLow?: number;
      winRate?: number;
      avgWinLossRatio?: number;
    },
  ) {
    // Built from settings, not literals: this endpoint is reachable from the UI, so a hardcoded cap
    // here would let a manual sizing request disagree with the automation loop's own limits. (#865)
    const riskProfile: PortfolioRisk = await buildRiskProfile(await this.readRiskCapValues());

    const slPrice = this.riskService.calculateStopLoss(
      body.entryPrice,
      body.stopLossType || 'fixed-pct',
      body.stopLossType === 'atr-multiple' ? 2 : 0.05,
      body.atr,
      body.swingLow,
    );

    const tpResult = this.riskService.calculateTakeProfit(
      body.entryPrice,
      slPrice,
      body.takeProfitType || 'risk-reward',
      2,
    );

    const positionSize = this.riskService.calculatePositionSize(
      body.positionType || 'risk-based',
      1000,
      body.portfolioValue,
      body.entryPrice,
      slPrice,
      riskProfile,
      body.winRate,
      body.avgWinLossRatio,
    );

    return {
      symbol: body.symbol,
      score: body.score,
      confidence: body.confidence,
      suggestedShares: positionSize.shares,
      capitalRequired: positionSize.capitalRequired,
      stopLossPrice: slPrice,
      takeProfitPrice: typeof tpResult === 'number' ? tpResult : tpResult.targets,
      riskAmount: positionSize.maxLoss,
      sizingMethod: positionSize.sizingMethod,
    };
  }

  @Get('portfolio-health')
  @ApiOperation({ summary: 'Get portfolio health overview' })
  async getPortfolioHealth() {
    return this.getPortfolioHealthReal();
  }

  @Get('limits')
  @ApiOperation({ summary: 'Get current risk limits configuration' })
  async getLimits() {
    // ⚠️ `defaultValue` in settings-registry.ts is the DECLARED default; this returns the EFFECTIVE
    // value (a DB override wins). Those two differing is normal and is why the response is now read
    // live rather than echoed from a literal. Provenance per value: GET /api/system/settings/registry
    return buildRiskProfile(await this.readRiskCapValues());
  }

  // ── Weekend Gap Risk ──────────────────────────────────

  @Get('weekend-exposure')
  @ApiOperation({ summary: 'Project weekend gap risk for a position based on historical gaps' })
  async weekendExposure(
    @Query('symbol') symbol: string,
    @Query('direction') direction?: string,
    @Query('value') value?: string,
  ) {
    if (!symbol) return { error: 'symbol query parameter is required' };
    const dir = (direction || 'BUY').toUpperCase() === 'SELL' ? 'SELL' as const : 'BUY' as const;
    const posValue = value ? parseFloat(value) : 1000;

    const exposure = await this.weekendGapRisk.projectExposure(symbol, dir, posValue);
    return exposure;
  }

  @Get('weekend-gap-stats')
  @ApiOperation({ summary: 'Historical weekend gap statistics for a symbol' })
  async weekendGapStats(@Query('symbol') symbol: string) {
    if (!symbol) return { error: 'symbol query parameter is required' };
    const stats = await this.weekendGapRisk.getGapStats(symbol);
    if (!stats) return { error: `Insufficient data for ${symbol} gap analysis` };
    return stats;
  }
}
