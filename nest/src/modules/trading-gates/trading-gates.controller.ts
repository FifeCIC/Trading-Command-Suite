/**
 * Trading Gates Controller
 * =========================
 * Exposes TradingGatesService as a REST API.
 * Endpoints for gate checks, status, and audit history.
 */

import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TradingGatesService, Position } from './trading-gates.service';

@ApiTags('trading-gates')
@Controller('trading-gates')
export class TradingGatesController {
  constructor(private readonly tradingGatesService: TradingGatesService) {}

  @Post('check')
  @ApiOperation({ summary: 'Check if a trade passes all execution gates' })
  checkGate(
    @Body() body: {
      symbol: string;
      signal: 'long' | 'short';
      score: number;
      confidence: number;
      price: number;
      avgVolume?: number;
      marketType?: string;
      strategyId?: string;
      openPositions?: Position[];
    },
  ) {
    return this.tradingGatesService.evaluate(
      body.symbol,
      body.score,
      body.confidence,
      body.price,
      body.avgVolume || 1_000_000,
      body.marketType || 'stocks',
      body.signal,
      body.openPositions || [],
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current gate status summary' })
  getStatus() {
    return {
      tradingPaused: false,
      dailyLossLimit: 0.05,
      drawdown: 0,
      marketOpen: true,
      gatesEnabled: true,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('audit')
  @ApiOperation({ summary: 'Get gate check audit log for a symbol' })
  getAudit(@Query('symbol') symbol?: string) {
    return {
      symbol: symbol || 'all',
      checks: [],
      message: 'Audit history tracked in production database',
    };
  }
}
