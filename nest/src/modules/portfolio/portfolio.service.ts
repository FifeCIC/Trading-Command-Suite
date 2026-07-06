import { Injectable, Logger } from '@nestjs/common';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { ScoringService } from '../scoring/scoring.service';
import { PrismaService } from '../../database/prisma.service';

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
  account: any;
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly t212: Trading212Adapter,
    private readonly scoringService: ScoringService,
    private readonly prisma: PrismaService,
  ) {}

  async getPortfolio(source = 'trading212', requestedMode?: string): Promise<PortfolioResponse> {
    const isMock = this.t212.mode === 'none';

    // Log mismatch if frontend requested a different mode than adapter is using
    if (requestedMode && requestedMode !== this.t212.mode && this.t212.mode !== 'none') {
      this.logger.warn(`Frontend requested mode=${requestedMode} but adapter is mode=${this.t212.mode} — using adapter mode`);
    }

    // Fetch positions and account in parallel via unified interface
    const [brokerPositions, brokerAccount] = await Promise.all([
      this.t212.getPositions(),
      this.t212.getAccount(),
    ]);

    // Map broker positions, or fall back to Position table if adapter returns empty
    let rawPositions: any[] = brokerPositions;
    if (rawPositions.length === 0 && this.prisma.isAvailable) {
      const dbPositions = await this.prisma.position.findMany({
        where: { provider: 'trading212' },
        orderBy: { symbol: 'asc' },
      });
      if (dbPositions.length > 0) {
        this.logger.log(`Using ${dbPositions.length} cached positions from Position table`);
        rawPositions = dbPositions.map(p => ({
          symbol: p.symbol,
          ticker: p.symbol,
          quantity: p.quantity,
          avgCost: p.avgPrice,
          currentPrice: p.currentPrice ?? 0,
          marketValue: (p.currentPrice ?? 0) * p.quantity,
          unrealizedPnl: p.pnl ?? 0,
          unrealizedPnlPct: p.avgPrice > 0 ? ((p.currentPrice ?? 0) - p.avgPrice) / p.avgPrice * 100 : 0,
          openedAt: p.openedAt?.toISOString() ?? new Date().toISOString(),
        }));
      }
    }

    // BrokerPosition is already normalized — map directly to PortfolioPosition
    const positions: PortfolioPosition[] = rawPositions.map((p: any) => ({
      symbol: p.symbol,
      ticker: p.ticker,
      shares: p.quantity,
      avgCost: p.avgCost,
      currentPrice: p.currentPrice,
      value: p.marketValue,
      pnl: p.unrealizedPnl,
      pnlPct: p.unrealizedPnlPct,
      allocation: 0,
      initialFillDate: p.openedAt,
    }));

    // Auto-register portfolio symbols in the database so they get scored
    if (positions.length > 0) {
      await this.ensureSymbolsExist(positions);
    }

    // Compute allocations
    const totalValue = positions.reduce((s, pos) => s + pos.value, 0);
    for (const pos of positions) {
      pos.allocation = totalValue > 0 ? pos.value / totalValue : 0;
    }

    // Summary
    const totalCost = positions.reduce((s, pos) => s + pos.shares * pos.avgCost, 0);
    const totalPnl = positions.reduce((s, pos) => s + pos.pnl, 0);
    const cash = brokerAccount?.balance ?? 0;
    const pnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

    const summary: PortfolioSummary = {
      totalValue: totalValue + cash,
      cash,
      totalCost,
      totalPnl,
      pnlPct,
      positionCount: positions.length,
      provider: brokerAccount?.brokerName ?? 'Trading212',
      mode: isMock ? 'mock' : this.t212.mode,
    };

    this.logger.log(
      `Portfolio: ${positions.length} positions, totalValue=${summary.totalValue.toFixed(2)}, mode=${summary.mode}`,
    );

    return { summary, positions, account: brokerAccount as any };
  }

  /**
   * Get scoring data for each portfolio holding.
   * Returns last known score and signal strength per symbol.
   * Integrates with ScoringService for real directive-based scores.
   */
  async getPortfolioScores(): Promise<Array<{
    symbol: string; ticker: string; score: number | null; signal: string; strength: string; dataStatus: string;
  }>> {
    const { positions } = await this.getPortfolio();
    if (positions.length === 0) return [];

    // Fetch real scores from scoring service
    let scoreMap = new Map<string, { score: number; dataStatus: string }>();
    try {
      const ranked = await this.scoringService.rankAll(undefined, 200);
      if (ranked?.ranked) {
        for (const entry of ranked.ranked) {
          scoreMap.set(entry.ticker, { score: entry.score, dataStatus: entry.dataStatus });
        }
      }
    } catch (err) {
      this.logger.warn(`Could not fetch portfolio scores: ${(err as Error).message}`);
    }

    return positions.map((p) => {
      const scored = scoreMap.get(p.ticker) ?? scoreMap.get(p.symbol);
      const score = scored?.score ?? null;
      const dataStatus = scored?.dataStatus ?? 'untracked';

      // If dataStatus is 'no_data', don't produce a misleading SELL signal
      const effectiveSignal = dataStatus === 'no_data' || dataStatus === 'untracked'
        ? 'no_data'
        : score !== null
          ? (score >= 65 ? 'buy' : score <= 40 ? 'sell' : 'hold')
          : 'no_data';

      return {
        symbol: p.symbol,
        ticker: p.ticker,
        score,
        signal: effectiveSignal,
        strength: score !== null && dataStatus !== 'no_data' && dataStatus !== 'untracked'
          ? (score >= 80 ? 'strong' : score >= 65 ? 'moderate' : 'weak')
          : 'none',
        dataStatus,
      };
    });
  }

  /**
   * Auto-register portfolio positions as tracked symbols in the database.
   * Uses upsert to avoid duplicates — new symbols get added silently,
   * existing symbols are left untouched.
   */
  private async ensureSymbolsExist(positions: PortfolioPosition[]): Promise<void> {
    if (!this.prisma.isAvailable) return;

    let added = 0;
    for (const pos of positions) {
      try {
        const ticker = pos.symbol.toUpperCase();
        await (this.prisma as any).symbol.upsert({
          where: { ticker },
          update: {}, // no-op — don't overwrite existing
          create: {
            ticker,
            name: ticker,
            exchange: 'Trading212',
            type: 'stock',
            active: true,
          },
        });
        added++;
      } catch (err) {
        this.logger.debug(`Symbol upsert skipped for ${pos.symbol}: ${(err as Error).message}`);
      }
    }
    if (added > 0) {
      this.logger.log(`Auto-registered ${added} portfolio symbols`);
    }
  }
}
