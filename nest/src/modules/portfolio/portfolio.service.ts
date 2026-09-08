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
   * Returns the last PERSISTED protocol-scoped score per holding.
   *
   * ⚠️ DISPLAY-ONLY + PERSISTED-READ (GH #738): this reads the score_snapshot
   * table, which ProtocolGatingService writes ONLY for symbols scored under an
   * ASSIGNED protocol by the automation loop. There is deliberately NO unscoped
   * whole-registry rankAll() here — running the whole directive registry against
   * every symbol is pointless (that practice was retired), and on a display
   * endpoint it also triggered destructive on-demand provider imports + rate-limit
   * exhaustion. A holding with no protocol assignment / no fresh snapshot honestly
   * reports no_data/untracked, signalling it is not yet being scored by a protocol
   * (add a symbol_protocol_assignment row to bring it online — one at a time).
   * These are NOT canonical trade signals on their own — trade decisions use
   * ProtocolGatingService.scoreWithGating() during the loop. Do not persist or feed
   * these numbers to the automation loop.
   */
  async getPortfolioScores(): Promise<Array<{
    symbol: string; ticker: string; score: number | null; signal: string; strength: string; dataStatus: string;
    rawComposite?: number | null; maxPossibleScore?: number | null; protocolId?: string | null;
  }>> {
    const { positions } = await this.getPortfolio();
    if (positions.length === 0) return [];

    const norm = (s: string) => (s || '').toUpperCase();
    const holdingSymbols = positions.map((p) => norm(p.ticker || p.symbol));

    // 1) Resolve each holding's assigned protocol (canonical scoring source).
    const assignments = new Map<string, string>(); // SYM -> protocolId
    if (this.prisma.isAvailable) {
      try {
        const rows = await this.prisma.symbolProtocolAssignment.findMany({
          where: { symbol: { in: holdingSymbols } },
          orderBy: { priority: 'asc' },
        });
        for (const a of rows) {
          const key = norm(a.symbol);
          if (!assignments.has(key)) assignments.set(key, a.protocolId);
        }
      } catch (err) {
        this.logger.warn(`Could not resolve protocol assignments for portfolio scores: ${(err as Error).message}`);
      }
    }

    // 2) Latest persisted protocol-scoped snapshot per holding (fast, no live screening).
    const snapshots = new Map<string, {
      protocolId: string; signalPct: number | null; composite: number | null;
      tradingSignal: string | null; snappedAt: Date;
    }>();
    if (this.prisma.isAvailable) {
      try {
        const snaps = await this.prisma.scoreSnapshot.findMany({
          where: { symbol: { in: holdingSymbols } },
          orderBy: { snappedAt: 'desc' },
        });
        for (const s of snaps) {
          const key = norm(s.symbol);
          if (!snapshots.has(key)) {
            snapshots.set(key, {
              protocolId: s.protocolId,
              signalPct: s.signalPct ?? null,
              composite: s.composite ?? null,
              tradingSignal: s.tradingSignal ?? null,
              snappedAt: s.snappedAt,
            });
          }
        }
      } catch (err) {
        this.logger.warn(`Could not read persisted scores for portfolio: ${(err as Error).message}`);
      }
    }

    // Freshness horizon for a persisted snapshot to count as "live" data.
    const FRESH_MS = 30 * 24 * 60 * 60 * 1000; // 30 days = the loop's persistence horizon
    const now = Date.now();

    return positions.map((p) => {
      const key = norm(p.ticker || p.symbol);
      const snap = snapshots.get(key);
      const assignedProtocolId = assignments.get(key) ?? null;

      // Honest: no persisted protocol score => this holding is not being scored by a
      // protocol right now. Report no_data/untracked rather than a fabricated number.
      if (!snap) {
        return {
          symbol: p.symbol, ticker: p.ticker,
          score: null, signal: 'no_data', strength: 'none', dataStatus: 'untracked',
          rawComposite: null, maxPossibleScore: null, protocolId: assignedProtocolId,
        };
      }

      // normalized 0-100 signal % is the ONLY comparable score field (never the
      // raw unbounded composite). This is what the protocol actually classified on.
      const pct = snap.signalPct;
      const score = pct === null || pct === undefined ? null : Math.round(pct);
      const fresh = now - snap.snappedAt.getTime() <= FRESH_MS;
      const dataStatus = fresh ? 'live' : 'stale';

      // Prefer the server-owned trading signal (persisted by the loop); fall back to
      // thresholding the % only if the signal string is absent.
      const signal = snap.tradingSignal
        ? this.mapPersistedSignal(snap.tradingSignal)
        : score !== null
          ? (score >= 65 ? 'buy' : score <= 40 ? 'sell' : 'hold')
          : 'no_data';

      const strength = score !== null
        ? (score >= 80 ? 'strong' : score >= 65 ? 'moderate' : 'weak')
        : 'none';

      return {
        symbol: p.symbol, ticker: p.ticker, score, signal, strength, dataStatus,
        rawComposite: snap.composite, maxPossibleScore: null, protocolId: snap.protocolId || assignedProtocolId,
      };
    });
  }

  /** Map a persisted protocol-gating signal (uppercase vocabulary) to the compact
   *  lowercase vocabulary this endpoint has always returned. */
  private mapPersistedSignal(sig: string): string {
    switch ((sig || '').toUpperCase()) {
      case 'STRONG_BUY':
      case 'BUY': return 'buy';
      case 'STRONG_SELL':
      case 'SELL': return 'sell';
      case 'HOLD': return 'hold';
      default: return 'no_data';
    }
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
