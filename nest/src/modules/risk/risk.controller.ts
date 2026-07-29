/**
 * Risk Controller
 * ================
 * Exposes RiskService + TradingGatesService as a unified risk dashboard.
 */

import { Controller, Get, Post, Body, Query, Logger } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskService, PortfolioRisk, PositionSizeType, StopLossType, TakeProfitType } from './risk.service';
import { TradingGatesService, GateConfig } from '../trading-gates/trading-gates.service';
import { MonteCarloService } from './monte-carlo.service';
import { PrismaService } from '../../database/prisma.service';
import { WeekendGapRiskService } from './weekend-gap-risk.service';

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
  ) {}

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

    // Get risk limits
    const limits = {
      maxPortfolioRisk: 0.15,
      maxPerTradeRisk: 0.02,
      maxPerSymbol: 0.25,
      maxPositions: gateConfig.positions.maxPositions,
      maxDrawdown: 0.25,
      trailingStopAtProfit: 0.03,
    };

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
  calculatePosition(
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
    const riskProfile: PortfolioRisk = {
      maxPortfolioRisk: 0.15,
      maxPerTradeRisk: 0.02,
      maxPerSymbol: 0.25,
      maxPositions: 5,
      maxDrawdown: 0.25,
      trailingStopAtProfit: 0.03,
    };

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
  getLimits() {
    return {
      maxPortfolioRisk: 0.15,
      maxPerTradeRisk: 0.02,
      maxPerSymbol: 0.25,
      maxPositions: 5,
      maxDrawdown: 0.25,
      trailingStopAtProfit: 0.03,
    };
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
