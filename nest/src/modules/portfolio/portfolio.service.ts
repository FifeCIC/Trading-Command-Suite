import { Injectable, Logger } from '@nestjs/common';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';
import { AdapterFactory } from '../providers/adapter-factory';
import { IProviderAdapter, BrokerPosition, BrokerAccount } from '../providers/interfaces/provider-adapter.interface';
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
  /** Total notional exposure across all positions (CFD margin exposure ≠ equity). */
  exposure?: number;
  /** Distinct currencies present across positions + accounts (mixed-currency warning). */
  currencies?: string[];
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
  broker?: string;
  currency?: string;
}

export interface PortfolioResponse {
  summary: PortfolioSummary;
  positions: PortfolioPosition[];
  account: any;
  accounts?: BrokerAccount[];
}

@Injectable()
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly t212: Trading212Adapter,
    private readonly scoringService: ScoringService,
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  async getPortfolio(source = 'trading212', requestedMode?: string): Promise<PortfolioResponse> {
    const isMock = this.t212.mode === 'none';

    // Log mismatch if frontend requested a different mode than adapter is using
    if (requestedMode && requestedMode !== this.t212.mode && this.t212.mode !== 'none') {
      this.logger.warn(`Frontend requested mode=${requestedMode} but adapter is mode=${this.t212.mode} — using adapter mode`);
    }

    // Resolve which broker adapters to query. source=all → every connected broker.
    const brokerIds = source === 'all' ? ['trading212', 'mt5'] : [source];
    const adapters: Array<{ id: string; adapter: IProviderAdapter }> = [];
    for (const id of brokerIds) {
      const adapter = this.adapterFactory.create(id);
      if (adapter?.getPositions) adapters.push({ id, adapter });
    }
    if (adapters.length === 0) {
      this.logger.warn(`Portfolio: no adapter for source=${source} — falling back to trading212`);
      adapters.push({ id: 'trading212', adapter: this.t212 });
    }

    // Fetch positions + accounts for every selected broker in parallel.
    const fetched = await Promise.all(
      adapters.map(async ({ id, adapter }) => {
        let positions: BrokerPosition[] = await adapter.getPositions!();
        // Legacy DB fallback for Trading212 when its live adapter returns empty.
        if ((!positions || positions.length === 0) && id === 'trading212' && this.prisma.isAvailable) {
          const dbPositions = await this.prisma.position.findMany({
            where: { provider: 'trading212' },
            orderBy: { symbol: 'asc' },
          });
          if (dbPositions.length > 0) {
            this.logger.log(`Using ${dbPositions.length} cached positions from Position table`);
            positions = dbPositions.map((p) => ({
              brokerId: 'trading212',
              brokerName: 'Trading212',
              symbol: p.symbol,
              ticker: p.symbol,
              quantity: p.quantity,
              avgCost: p.avgPrice,
              currentPrice: p.currentPrice ?? 0,
              marketValue: (p.currentPrice ?? 0) * p.quantity,
              unrealizedPnl: p.pnl ?? 0,
              unrealizedPnlPct: p.avgPrice > 0 ? ((p.currentPrice ?? 0) - p.avgPrice) / p.avgPrice * 100 : 0,
              currency: 'GBP',
              openedAt: p.openedAt?.toISOString() ?? new Date().toISOString(),
            }));
          }
        }
        const account = adapter.getAccount ? await adapter.getAccount() : null;
        return { id, positions: positions ?? [], account };
      }),
    );

    // Merge, tagging each position with its broker for the UI.
    const rawPositions: Array<BrokerPosition & { broker: string }> = [];
    for (const f of fetched) {
      for (const p of f.positions) {
        rawPositions.push({ ...p, broker: p.brokerName ?? f.id });
      }
    }
    const accounts = fetched.filter((f) => f.account).map((f) => f.account) as BrokerAccount[];
    const brokerAccount = accounts[0] ?? null;

    // BrokerPosition is already normalized — map directly to PortfolioPosition
    const positions: PortfolioPosition[] = rawPositions.map((p) => ({
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
      broker: p.broker,
      currency: p.currency,
    }));

    // Auto-register portfolio symbols in the database so they get scored
    if (positions.length > 0) {
      await this.ensureSymbolsExist(positions);
    }

    // Compute allocations against total position value (position weight).
    const notionalExposure = positions.reduce((s, pos) => s + pos.value, 0);
    for (const pos of positions) {
      pos.allocation = notionalExposure > 0 ? pos.value / notionalExposure : 0;
    }

    // Summary — per-broker portfolio value.
    // T212: fully-funded stock holdings → positions market value + free cash.
    // MT5/CFD: margin account → equity already = balance + floating P&L;
    //   its positions are NOTIONAL exposure (leveraged), so they are NOT added
    //   to portfolio value — adding notional + balance would double-count.
    let totalValue = 0;
    for (const f of fetched) {
      const positionsValue = f.positions.reduce((s, p) => s + p.marketValue, 0);
      const acct = f.account;
      if (!acct) {
        totalValue += positionsValue;
      } else if (f.id === 'trading212') {
        totalValue += positionsValue + (acct.balance ?? 0);
      } else {
        totalValue += (acct.equity ?? acct.balance ?? 0);
      }
    }

    const totalCost = positions.reduce((s, pos) => s + pos.shares * pos.avgCost, 0);
    const totalPnl = positions.reduce((s, pos) => s + pos.pnl, 0);
    const cash = accounts.reduce((s, a) => s + (a.balance ?? 0), 0);
    const pnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    const currencies = [...new Set([
      ...positions.map((p) => p.currency).filter(Boolean),
      ...accounts.map((a) => a.currency).filter(Boolean),
    ])] as string[];

    const summary: PortfolioSummary = {
      totalValue,
      cash,
      totalCost,
      totalPnl,
      pnlPct,
      positionCount: positions.length,
      provider: source === 'all'
        ? (accounts.map((a) => a.brokerName).filter(Boolean).join(' + ') || 'all')
        : (brokerAccount?.brokerName ?? source),
      mode: isMock ? 'mock' : ((brokerAccount?.mode ?? this.t212.mode) as PortfolioSummary['mode']),
      exposure: +notionalExposure.toFixed(2),
      currencies,
    };

    this.logger.log(
      `Portfolio: ${positions.length} positions, totalValue=${summary.totalValue.toFixed(2)}, mode=${summary.mode}`,
    );

    return { summary, positions, account: brokerAccount as any, accounts };
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
