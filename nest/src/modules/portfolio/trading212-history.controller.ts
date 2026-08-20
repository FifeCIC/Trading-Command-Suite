import { Controller, Get, Query, Logger } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { resolveMt5BridgeUrl } from '../providers/mt5/mt5-bridge.config';

@Controller('portfolio/trading212')
export class Trading212HistoryController {
  private readonly logger = new Logger(Trading212HistoryController.name);

  constructor(private readonly portfolio: PortfolioService) {}

  @Get('history')
  async getHistory(@Query('days') days?: string, @Query('source') source?: string) {
    const daysNum = parseInt(days || '30', 10);
    // For now, fetch from MT5 bridge as T212 order history isn't available yet
    // When T212 adapter adds getOrders(), switch to that
    try {
      const bridgeUrl = resolveMt5BridgeUrl();
      const res = await fetch(`${bridgeUrl}/history/deals?days=${daysNum}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();

      // Compute summary
      const deals = data.deals || [];
      const wins = deals.filter((d: any) => (d.profit || 0) > 0);
      const totalPnl = deals.reduce((s: number, d: any) => s + (d.profit || 0), 0);
      const best = deals.reduce((max: any, d: any) => (d.profit || 0) > (max?.profit || -Infinity) ? d : max, null);
      const worst = deals.reduce((min: any, d: any) => (d.profit || 0) < (min?.profit || Infinity) ? d : min, null);

      return {
        trades: deals,
        count: deals.length,
        summary: {
          totalTrades: deals.length,
          winningTrades: wins.length,
          winRate: deals.length ? ((wins.length / deals.length) * 100).toFixed(1) + '%' : '0%',
          totalPnl: +totalPnl.toFixed(2),
          bestTrade: best ? { symbol: best.symbol, profit: best.profit } : null,
          worstTrade: worst ? { symbol: worst.symbol, profit: worst.profit } : null,
        },
        source: 'mt5',
        from: new Date(Date.now() - daysNum * 86400000).toISOString(),
        to: new Date().toISOString(),
      };
    } catch (err) {
      this.logger.warn(`History fetch failed: ${(err as Error).message}`);
      return { trades: [], count: 0, summary: { totalTrades: 0, winningTrades: 0, winRate: '0%', totalPnl: 0, bestTrade: null, worstTrade: null }, source: 'offline' };
    }
  }
}
