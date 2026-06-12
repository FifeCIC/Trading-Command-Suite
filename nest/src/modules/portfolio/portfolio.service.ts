import { Injectable, Logger } from '@nestjs/common';
import { Trading212Adapter, Trading212Position, Trading212AccountCash } from '../providers/adapters/trading212.adapter';

export interface PortfolioSummary {
  totalValue: number;
  cash: number;
  totalCost: number;
  totalPnl: number;
  pnlPct: number;
  positionCount: number;
  provider: string;
  mode: 'live' | 'demo' | 'mock';
}

export interface PortfolioPosition {
  symbol: string;
  ticker: string;
  shares: number;
  avgCost: number;
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPct: number;
  allocation: number;
  initialFillDate: string;
}

export interface PortfolioResponse {
  summary: PortfolioSummary;
  positions: PortfolioPosition[];
  account: Trading212AccountCash | null;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(private readonly t212: Trading212Adapter) {}

  async getPortfolio(): Promise<PortfolioResponse> {
    const isMock = this.t212.mode === 'none';

    // Fetch positions and account in parallel
    const [rawPositions, account] = await Promise.all([
      this.t212.getPositions(),
      this.t212.getAccountCash(),
    ]);

    // Normalize positions
    const positions: PortfolioPosition[] = rawPositions.map((p: Trading212Position) => {
      const value = p.currentPrice * p.quantity;
      const cost = p.averagePrice * p.quantity;
      const pnl = p.ppl ?? (value - cost);
      const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
      return {
        symbol: this.stripTicker(p.ticker),
        ticker: p.ticker,
        shares: p.quantity,
        avgCost: p.averagePrice,
        currentPrice: p.currentPrice,
        value,
        pnl,
        pnlPct,
        allocation: 0, // computed below
        initialFillDate: p.initialFillDate,
      };
    });

    // Compute allocations
    const totalValue = positions.reduce((s, pos) => s + pos.value, 0);
    for (const pos of positions) {
      pos.allocation = totalValue > 0 ? pos.value / totalValue : 0;
    }

    // Summary
    const totalCost = positions.reduce((s, pos) => s + pos.shares * pos.avgCost, 0);
    const totalPnl = positions.reduce((s, pos) => s + pos.pnl, 0);
    const cash = account?.free ?? 0;
    const pnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    const summary: PortfolioSummary = {
      totalValue: totalValue + cash,
      cash,
      totalCost,
      totalPnl,
      pnlPct,
      positionCount: positions.length,
      provider: 'Trading212',
      mode: isMock ? 'mock' : this.t212.mode,
    };

    this.logger.log(
      `Portfolio: ${positions.length} positions, totalValue=${summary.totalValue.toFixed(2)}, mode=${summary.mode}`,
    );

    return { summary, positions, account };
  }

  /** Strip Trading212 ticker suffix: AAPL_US_EQ → AAPL */
  private stripTicker(ticker: string): string {
    return ticker.split('_')[0] || ticker;
  }
}
