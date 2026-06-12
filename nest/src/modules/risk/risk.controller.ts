/**
 * Risk Controller
 * ================
 * Exposes RiskService as a REST API.
 * Endpoints for position sizing, portfolio health, and risk limits.
 */

import { Controller, Get, Post, Body } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RiskService, PortfolioRisk, PositionSizeType, StopLossType, TakeProfitType } from './risk.service';

@ApiTags('risk')
@Controller('risk')
export class RiskController {
  constructor(private readonly riskService: RiskService) {}

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
  getPortfolioHealth() {
    return {
      totalExposure: 0, // TODO: query from portfolio service
      drawdown: 0,
      dailyPnL: 0,
      riskWarnings: [],
      timestamp: new Date().toISOString(),
    };
  }

  @Get('limits')
  @ApiOperation({ summary: 'Get current risk limits configuration' })
  getLimits() {
    const riskProfile: PortfolioRisk = {
      maxPortfolioRisk: 0.15,
      maxPerTradeRisk: 0.02,
      maxPerSymbol: 0.25,
      maxPositions: 5,
      maxDrawdown: 0.25,
      trailingStopAtProfit: 0.03,
    };
    return riskProfile;
  }
}
