import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Trading212Adapter, T212OrderResult } from '../providers/adapters/trading212.adapter';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { SystemLogService } from '../system/log.service';

interface T212Position {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
  fxPpl: number;
  initialFillDate: string;
  frontend: string;
}

export interface T212Account {
  total: number;
  free: number;
  invested: number;
  ppl: number;
  result: number;
  blocked: number;
}

export interface T212Order {
  id: string;
  ticker: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  filledPrice: number;
  limitPrice: number;
  filledValue: number;
  dateCreated: string;
  status: string;
}

export interface TradeHistoryItem {
  date: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  source: 'trading212' | 'mt5' | 'alpaca';
}

export interface TradeHistorySummary {
  totalTrades: number;
  winRate: number;
  totalPnl: number;
  bestTrade: number;
  worstTrade: number;
  winningTrades: number;
  losingTrades: number;
}

@Injectable()
export class Trading212ImportService {
  private readonly logger = new Logger(Trading212ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly t212Adapter: Trading212Adapter,
    private readonly tradeRecorder: TradeRecorderService,
    private readonly syslog: SystemLogService,
  ) {}

  private getAuthHeader(): string {
    const key = process.env.TRADING212_API_KEY || '';
    const secret = process.env.TRADING212_API_SECRET || '';
    if (key && secret) {
      return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
    }
    return key; // Fallback to key-only auth
  }

  async validateConnection(): Promise<{ valid: boolean; account?: T212Account; error?: string }> {
    const apiKey = process.env.TRADING212_API_KEY;
    if (!apiKey) {
      return { valid: false, error: 'TRADING212_API_KEY not set in .env' };
    }

    try {
      const auth = this.getAuthHeader();
      const res = await fetch('https://live.trading212.com/api/v0/equity/account/cash', {
        headers: { Authorization: auth },
      });

      if (!res.ok) {
        const text = await res.text();
        return { valid: false, error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
      }

      const account: T212Account = await res.json();
      return { valid: true, account };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  async importPortfolio(): Promise<{
    success: boolean;
    positionsImported: number;
    symbolsCreated: number;
    account?: T212Account;
    positions?: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number }>;
    error?: string;
  }> {
    const apiKey = process.env.TRADING212_API_KEY;
    if (!apiKey) return { success: false, positionsImported: 0, symbolsCreated: 0, error: 'No API key' };

    try {
      const auth = this.getAuthHeader();
      // Fetch account
      const accountRes = await fetch('https://live.trading212.com/api/v0/equity/account/cash', {
        headers: { Authorization: auth },
      });
      const account: T212Account = accountRes.ok ? await accountRes.json() : null;

      // Fetch positions
      const posRes = await fetch('https://live.trading212.com/api/v0/equity/portfolio', {
        headers: { Authorization: auth },
      });

      if (!posRes.ok) {
        return { success: false, positionsImported: 0, symbolsCreated: 0, account, error: `Positions HTTP ${posRes.status}` };
      }

      const positions: T212Position[] = await posRes.json();
      this.logger.log(`Trading212: fetched ${positions.length} positions, account balance: ${account?.total}`);

      let symbolsCreated = 0;
      const imported: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number }> = [];

      for (const pos of positions) {
        // Clean ticker: strip Trading212 suffixes like _US_EQ, _EQ
        const cleanTicker = pos.ticker.replace(/_US_EQ$/, '').replace(/_EQ$/, '');

        // Ensure symbol exists in our DB
        try {
          const existing = await this.prisma.symbol.findUnique({ where: { ticker: cleanTicker } });
          if (!existing && this.prisma.isAvailable) {
            await this.prisma.symbol.create({
              data: {
                ticker: cleanTicker,
                name: cleanTicker,
                exchange: 'Trading212',
                type: 'stock',
              },
            });
            symbolsCreated++;
          }
        } catch { /* DB may not be available */ }

        imported.push({
          ticker: pos.ticker,
          quantity: pos.quantity,
          ppl: pos.ppl,
          currentPrice: pos.currentPrice,
        });
      }

      // Store account snapshot
      if (account) {
        this.logger.log(`Trading212: imported ${imported.length} positions, account value: $${account.total}`);
      }

      return {
        success: true,
        positionsImported: imported.length,
        symbolsCreated,
        account,
        positions: imported,
      };
    } catch (err) {
      return { success: false, positionsImported: 0, symbolsCreated: 0, error: (err as Error).message };
    }
  }

  async getTradeHistory(days?: number): Promise<{
    success: boolean;
    trades: TradeHistoryItem[];
    summary: TradeHistorySummary;
    error?: string;
    unavailable?: boolean;
  }> {
    const apiKey = process.env.TRADING212_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        trades: [],
        summary: { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0, winningTrades: 0, losingTrades: 0 },
        error: 'TRADING212_API_KEY not configured in .env',
        unavailable: true,
      };
    }

    try {
      const auth = this.getAuthHeader();

      // Trading212 orders endpoint: GET /api/v0/equity/orders
      const res = await fetch('https://live.trading212.com/api/v0/equity/orders', {
        headers: { Authorization: auth },
      });

      if (!res.ok) {
        this.logger.warn(`Trading212 orders fetch failed: HTTP ${res.status}`);
        return {
          success: false,
          trades: [],
          summary: { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0, winningTrades: 0, losingTrades: 0 },
          error: `Trading212 API returned HTTP ${res.status}`,
          unavailable: true,
        };
      }

      const orders: T212Order[] = await res.json();
      this.logger.log(`Trading212: fetched ${orders.length} orders`);

      // Only return filled orders
      const filledOrders = orders.filter((o) => o.status === 'FILLED');

      const trades: TradeHistoryItem[] = filledOrders.map((o) => ({
        date: o.dateCreated,
        symbol: o.ticker.replace(/_US_EQ$/, '').replace(/_EQ$/, ''),
        type: o.type,
        quantity: o.quantity,
        entryPrice: o.type === 'BUY' ? o.filledPrice : 0,
        exitPrice: o.type === 'SELL' ? o.filledPrice : 0,
        pnl: o.type === 'SELL' ? o.filledValue - (o.limitPrice * o.quantity) : 0,
        source: 'trading212' as const,
      }));

      // Filter by days if specified
      const filtered = days ? this.filterByDays(trades, days) : trades;

      return {
        success: true,
        trades: filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        summary: this.buildSummary(filtered),
      };
    } catch (err) {
      this.logger.error(`Trading212 trade history error: ${(err as Error).message}`);
      return {
        success: false,
        trades: [],
        summary: { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0, winningTrades: 0, losingTrades: 0 },
        error: (err as Error).message,
        unavailable: true,
      };
    }
  }

  private filterByDays(trades: TradeHistoryItem[], days: number): TradeHistoryItem[] {
    const cutoff = Date.now() - days * 86400000;
    return trades.filter((t) => new Date(t.date).getTime() >= cutoff);
  }

  private buildSummary(trades: TradeHistoryItem[]): TradeHistorySummary {
    const winning = trades.filter((t) => t.pnl > 0);
    const losing = trades.filter((t) => t.pnl < 0);
    const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
    const bestTrade = trades.length > 0 ? Math.max(...trades.map((t) => t.pnl)) : 0;
    const worstTrade = trades.length > 0 ? Math.min(...trades.map((t) => t.pnl)) : 0;

    return {
      totalTrades: trades.length,
      winRate: trades.length > 0 ? Math.round((winning.length / trades.length) * 100) : 0,
      totalPnl: Math.round(totalPnl * 100) / 100,
      bestTrade: Math.round(bestTrade * 100) / 100,
      worstTrade: Math.round(worstTrade * 100) / 100,
      winningTrades: winning.length,
      losingTrades: losing.length,
    };
  }

  // ── Order Execution ───────────────────────────────────────

  /**
   * Validate pre-trade safety gates before placing an order.
   * Returns null if all gates pass, or an error object if a gate fails.
   */
  async validatePreTrade(params: {
    ticker: string;
    quantity: number;
    side: 'buy' | 'sell';
  }): Promise<{ passed: boolean; gate: string; error?: string }> {
    // Gate 1+2: API Health + Account balance (combined — same endpoint, avoid rate limit double-hit)
    const account = await this.t212Adapter.getAccount();
    if (!account) {
      return { passed: false, gate: 'account', error: `Trading212 API (${this.t212Adapter.mode}) is not reachable or returned no account data. Check credentials and connectivity.` };
    }

    // Gate 3: Position verification (for sells)
    if (params.side === 'sell') {
      const positions = await this.t212Adapter.getPositions();
      const ticker = params.ticker.includes('_') ? params.ticker : `${params.ticker.toUpperCase()}_US_EQ`;
      const pos = positions.find((p) => p.ticker === ticker);
      if (!pos) {
        return { passed: false, gate: 'position', error: `No position found for ${params.ticker} in your ${this.t212Adapter.mode} account.` };
      }
      if (params.quantity > pos.quantity) {
        return { passed: false, gate: 'quantity', error: `You only have ${pos.quantity} shares of ${params.ticker}. Cannot sell ${params.quantity}.` };
      }
    }

    // Gate 4: Sufficient funds (for buys)
    if (params.side === 'buy') {
      // We don't have price here, but gate 1+2 already passed
      if (account.marginFree <= 0) {
        return { passed: false, gate: 'funds', error: 'No free cash available for this purchase.' };
      }
    }

    return { passed: true, gate: 'all' };
  }

  async placeOrder(params: {
    ticker: string;
    quantity: number;
    side: 'buy' | 'sell';
    accountType?: 'investment' | 'isa';
    limitPrice?: number;
  }): Promise<T212OrderResult & { preTrade?: { passed: boolean; gate: string; error?: string } }> {
    // Run pre-trade safety gates
    const preTrade = await this.validatePreTrade({
      ticker: params.ticker,
      quantity: params.quantity,
      side: params.side,
    });

    if (!preTrade.passed) {
      this.logger.warn(`Order blocked by gate "${preTrade.gate}": ${preTrade.error}`);
      return { success: false, error: preTrade.error, preTrade };
    }

    this.logger.log(`Placing ${this.t212Adapter.mode} ${params.side} order: ${params.ticker} ×${params.quantity}${params.limitPrice ? ` @${params.limitPrice}` : ''}`);

    let result: T212OrderResult;
    if (params.limitPrice) {
      result = await this.t212Adapter.placeLimitOrder({
        ticker: params.ticker,
        quantity: params.quantity,
        side: params.side,
        limitPrice: params.limitPrice,
      });
    } else {
      result = await this.t212Adapter.placeMarketOrder({
        ticker: params.ticker,
        quantity: params.quantity,
        side: params.side,
      });
    }

    // Record to DB audit trail
    this.tradeRecorder.record({
      symbol: params.ticker,
      side: params.side,
      quantity: params.quantity,
      exitPrice: result?.filledPrice,
      pnl: undefined, // unknown for buys
      provider: 'trading212',
      status: result?.success ? 'open' : 'rejected',
    });
    this.syslog.order('T212', `${params.side} ${params.quantity}×${params.ticker} → ${result?.success ? 'OK' : 'FAILED: ' + (result?.error || 'unknown')}`);

    return result;
  }

  async getOpenOrders(): Promise<T212OrderResult[]> {
    return this.t212Adapter.getOpenOrders();
  }

  async getOrderStatus(orderId: string): Promise<T212OrderResult> {
    return this.t212Adapter.getOrder(orderId);
  }

  async cancelOrder(orderId: string): Promise<T212OrderResult> {
    return this.t212Adapter.cancelOrder(orderId);
  }

  /** Sell all positions that are currently in profit. */
  async sellAllProfitable(): Promise<{
    sold: number;
    failed: number;
    skipped: number;
    totalPnl: number;
    soldTickers: { ticker: string; quantity: number; ppl: number }[];
  }> {
    const positions = await this.t212Adapter.getPositions();
    const profitable = positions.filter((p) => p.unrealizedPnl > 0);
    const unprofitable = positions.length - profitable.length;

    let sold = 0;
    let failed = 0;
    let totalPnl = 0;
    const soldTickers: { ticker: string; quantity: number; ppl: number }[] = [];

    for (const pos of profitable) {
      const maxSell = pos.quantity;
      if (maxSell <= 0) {
        failed++;
        continue;
      }

      // Trading212 requires quantity precision — exactly 2 decimal places
      const quantity = Math.round(maxSell * 100) / 100;
      if (quantity <= 0) {
        failed++;
        this.logger.warn(`Sell skipped for ${pos.ticker}: quantity ${maxSell} rounds to 0`);
        continue;
      }

      try {
        const result = await this.t212Adapter.placeMarketOrder({
          ticker: pos.ticker,
          quantity,
          side: 'sell',
        });

        if (result?.success) {
          sold++;
          totalPnl += pos.unrealizedPnl;
          soldTickers.push({ ticker: pos.ticker, quantity, ppl: pos.unrealizedPnl });
          this.logger.log(`T212 sold ${quantity}×${pos.ticker} @ ${result?.filledPrice || 'market'}`);
          // Record to DB audit trail
          this.tradeRecorder.record({
            symbol: pos.ticker,
            side: 'sell',
            quantity,
            entryPrice: pos.avgCost,
            exitPrice: result?.filledPrice,
            pnl: pos.unrealizedPnl,
            provider: 'trading212',
            status: 'closed',
          });
        } else {
          failed++;
          this.logger.warn(`Sell rejected for ${pos.ticker}: ${result?.error || 'unknown'}`);
          this.syslog.error('T212', `Sell rejected: ${pos.ticker} ×${quantity} — ${result?.error || 'unknown'}`);
          // Record rejected attempt
          this.tradeRecorder.record({
            symbol: pos.ticker,
            side: 'sell',
            quantity,
            provider: 'trading212',
            status: 'rejected',
          });
        }
      } catch (err) {
        failed++;
        this.logger.error(`Sell failed for ${pos.ticker}: ${(err as Error).message}`);
        this.syslog.error('T212', `Sell exception: ${pos.ticker} — ${(err as Error).message}`);
      }
    }

    this.logger.log(
      `sellAllProfitable: ${sold} sold, ${failed} failed, ${unprofitable} skipped, P&L=${totalPnl.toFixed(2)}`,
    );

    return { sold, failed, skipped: unprofitable, totalPnl, soldTickers };
  }

}

