import { Controller, Post, Get, Delete, Param, Body, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BacktestService } from './backtest.service';
import { PrismaService } from '../../database/prisma.service';
import type { BacktestRunRequest } from './backtest.service';

/**
 * Backtest Controller — Historical Strategy Validation
 * ======================================================
 * CANONICAL ROLE (2026-07-29): Analytics, not scoring. Compares
 * strategy performance against benchmarks using historical data.
 *
 * NOT a scoring pipeline — does not evaluate directives or produce
 * trade signals. Reads from MarketBar 1d data and TradeRecord tables.
 *
 * Endpoints:
 *   GET  /api/backtest/datasets    — available pre-loaded datasets
 *   POST /api/backtest/run         — run a backtest
 *   GET  /api/backtest/runs        — list past runs
 *   GET  /api/backtest/benchmark   — compare strategy vs buy-and-hold
 *
 * @see docs/handoff/2026-07-29-scoring-paths-audit-497.md
 */

@ApiTags('backtest')
@Controller('backtest')
export class BacktestController {
  constructor(
    private readonly backtestService: BacktestService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('datasets')
  @ApiOperation({ summary: 'List available pre-loaded backtest datasets' })
  @ApiOkResponse({ description: 'Array of dataset metadata' })
  async getDatasets() {
    return this.backtestService.getDatasets();
  }

  @Post('run')
  @ApiOperation({ summary: 'Run backtest for a symbol over N days' })
  @ApiOkResponse({ description: 'Backtest result with entry signals and stats' })
  async run(@Body() body: BacktestRunRequest) {
    try {
      return await this.backtestService.run(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { error: true, message: message || 'Backtest failed — check symbol, days range, or data availability' };
    }
  }

  @Get('results/:runId')
  async getResult(@Param('runId') runId: string) {
    const result = await this.backtestService.getResult(runId);
    if (!result) return { error: 'Run not found' };
    return result;
  }

  @Get('summary/:symbol')
  async getSummary(@Param('symbol') symbol: string) {
    return this.backtestService.getSummary(symbol);
  }

  @Get('protocol/:protocolId')
  async listProtocolRuns(@Param('protocolId') protocolId: string, @Query('limit') limit?: string) {
    return this.backtestService.listProtocolRuns(protocolId, limit ? parseInt(limit, 10) : 20);
  }

  @Get('chart-data')
  @ApiOperation({ summary: 'Get chart-ready data with bars, signals, and indicators' })
  async getChartData(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.backtestService.getChartData(symbol, timeframe || '1d', from, to);
  }

  @Post('optimize')
  @ApiOperation({ summary: 'Grid search — optimize SL/TP parameters across a range' })
  async optimize(@Body() body: {
    symbol: string;
    days?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }) {
    return this.backtestService.optimize(body);
  }

  @Post('walk-forward')
  @ApiOperation({ summary: 'Walk-forward — optimize on train period, validate on test period' })
  async walkForward(@Body() body: {
    symbol: string;
    trainDays?: number;
    testDays?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }) {
    return this.backtestService.walkForward(body);
  }

  @Get('data-inventory')
  @ApiOperation({ summary: 'Comprehensive market bar inventory — all symbols with bar counts, date ranges, providers, and backtest run stats' })
  async dataInventory() {
    return this.backtestService.getDataInventory();
  }

  /** List all persisted backtest runs */
  @Get('runs')
  async listRuns(
    @Query('symbol') symbol?: string,
    @Query('protocolId') protocolId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.backtestService.listAllRuns({
      symbol,
      protocolId,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /** Compare multiple runs side-by-side */
  @Post('runs/compare')
  async compareRuns(@Body() body: { runIds: string[] }) {
    if (!body.runIds?.length) return { error: 'runIds array is required' };
    return this.backtestService.compareRuns(body.runIds);
  }

  /** Delete a backtest run */
  @Delete('runs/:runId')
  async deleteRun(@Param('runId') runId: string) {
    return this.backtestService.deleteRun(runId);
  }

  /** Equity curve + drawdown for a run */
  @Get('equity/:runId')
  @ApiOperation({ summary: 'Get equity curve and drawdown data for a backtest run' })
  async getEquityCurve(@Param('runId') runId: string) {
    return this.backtestService.getEquityCurve(runId);
  }

  /** Per-directive coverage: backtest every directive individually */
  @Post('coverage')
  @ApiOperation({ summary: 'Run every directive individually against historical data and report per-directive performance' })
  async directiveCoverage(@Body() body: { symbol: string; days?: number; timeframe?: string }) {
    return this.backtestService.runDirectiveCoverage(body);
  }

  // ── Benchmark Comparison ──────────────────────────────

  @Get('benchmark')
  @ApiOperation({ summary: 'Compare strategy returns against buy-and-hold benchmark' })
  async benchmark(
    @Query('symbol') symbol: string,
    @Query('days') days?: string,
  ) {
    const lookbackDays = days ? parseInt(days, 10) : 90;
    if (!symbol) return { error: 'symbol query parameter is required' };

    if (!this.prisma.isAvailable) {
      return { error: 'Database unavailable for benchmark comparison' };
    }

    try {
      // Fetch 1d bars for the lookback period
      const bars = await (this.prisma as any).marketBar.findMany({
        where: {
          symbol: { ticker: symbol.toUpperCase() },
          timeframe: '1d',
        },
        orderBy: { timestamp: 'desc' },
        take: lookbackDays + 5,
      });

      if (!bars || bars.length < 5) {
        return { error: `Insufficient daily bar data for ${symbol} (need 5+, have ${bars?.length || 0})` };
      }

      bars.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const firstBar = bars[0];
      const lastBar = bars[bars.length - 1];
      const firstPrice = firstBar.close;
      const lastPrice = lastBar.close;

      // Buy-and-hold return
      const bhReturnPct = ((lastPrice - firstPrice) / firstPrice) * 100;
      const bhReturn = bhReturnPct;

      // Max drawdown for buy-and-hold
      let peak = firstPrice;
      let maxDrawdownPct = 0;
      for (const bar of bars) {
        if (bar.close > peak) peak = bar.close;
        const dd = ((bar.close - peak) / peak) * 100;
        if (dd < maxDrawdownPct) maxDrawdownPct = dd;
      }

      // Get strategy trades for this symbol
      let strategyReturn = 0;
      let strategyWinRate = 0;
      let strategyTrades = 0;
      try {
        const trades = await (this.prisma as any).trade.findMany({
          where: { symbol: symbol.toUpperCase(), status: 'closed' },
          orderBy: { openedAt: 'asc' },
          take: 200,
        });
        if (trades && trades.length > 0) {
          strategyTrades = trades.length;
          const wins = trades.filter((t: any) => (t.pnl || 0) > 0).length;
          strategyWinRate = Math.round((wins / trades.length) * 10000) / 100;
          strategyReturn = trades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
        }
      } catch { /* no trades yet */ }

      const alpha = strategyReturn - bhReturnPct;
      const outperformed = strategyReturn > bhReturnPct;

      return {
        symbol: symbol.toUpperCase(),
        period: `${bars.length} trading days (${firstBar.timestamp} → ${lastBar.timestamp})`,
        benchmark: {
          name: 'Buy & Hold',
          startPrice: Math.round(firstPrice * 100) / 100,
          endPrice: Math.round(lastPrice * 100) / 100,
          returnPct: Math.round(bhReturn * 100) / 100,
          maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
        },
        strategy: {
          trades: strategyTrades,
          winRate: strategyWinRate,
          totalPnl: Math.round(strategyReturn * 100) / 100,
        },
        comparison: {
          alpha: Math.round(alpha * 100) / 100,
          outperformed,
          verdict: outperformed
            ? `Strategy beat buy-and-hold by ${Math.abs(alpha).toFixed(2)}%`
            : `Buy-and-hold beat strategy by ${Math.abs(alpha).toFixed(2)}%`,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { error: `Benchmark comparison failed: ${(err as Error).message}` };
    }
  }
}
