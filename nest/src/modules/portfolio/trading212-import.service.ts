import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Trading212Adapter, T212OrderResult } from '../providers/adapters/trading212.adapter';
import { ProviderCacheService } from '../providers/provider-cache.service';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { SystemLogService } from '../system/log.service';
import { cleanT212Ticker } from '../providers/t212-ticker-map';

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

/**
 * sideFromQuantity() — the position's direction, ESTABLISHED from the holding rather than assumed.
 *
 * ⚠️ WHY THIS FUNCTION EXISTS (#1069 option C, 2026-10-05). This import path created **18**
 * `position` rows with `side = NULL`, and the signed profit percentage is written **four times**
 * with divergent edges: `profitPctFor()` (`peak.ts`, the canonical) treats an unrecognised side as
 * LONG, while `exit-consensus.service.ts:373` and both `stop-guardian.service.ts` sites treat it as
 * SHORT. So for those 18 rows the displayed direction was a **default, not a fact**, and nothing
 * recorded which of the two defaults had been applied.
 *
 * Registering the side at the SOURCE is the one option of the three that changes no maths. The
 * alternatives edited a money path to agree about a case it could not reach anyway.
 *
 * ⚠️ DERIVED FROM THE SIGN OF `quantity`, NOT HARDCODED TO `'buy'`. Measured 2026-10-05: all 18 rows
 * held a positive quantity (min 0.61, max 66.05, **zero negatives**). That is an observation about
 * today, and hardcoding it would be an assumption that has to survive the day the API reports
 * something else. A negative quantity establishes `sell`.
 *
 * ⚠️ AND ZERO ESTABLISHES NOTHING. A holding with no size has no direction, so this returns `null`
 * rather than picking one — the same rule as register row 60: *"NULL ≠ 0 — 'no peak observed' and
 * 'the peak was break-even' are different facts."* A caller that cannot derive a side must leave the
 * column alone rather than write a guess into it.
 */
export function sideFromQuantity(quantity: unknown): 'buy' | 'sell' | null {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty === 0) return null;
  return qty < 0 ? 'sell' : 'buy';
}

@Injectable()
export class Trading212ImportService {
  private readonly logger = new Logger(Trading212ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly t212Adapter: Trading212Adapter,
    private readonly cache: ProviderCacheService,
    private readonly tradeRecorder: TradeRecorderService,
    private readonly syslog: SystemLogService,
  ) {
    this.cache.setCooldown('trading212', 60_000);
  }

  private getAuthHeader(): string {
    const key = process.env.TRADING212_API_KEY || '';
    const secret = process.env.TRADING212_API_SECRET || '';
    if (key && secret) {
      return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
    }
    return key; // Fallback to key-only auth
  }

  /**
   * Returns cached portfolio data from our DB — never calls Trading212 live.
   * The import endpoint handles live sync. This keeps page loads instant and
   * prevents blank data when T212 API is slow or rate-limited.
   */
  async validateConnection(): Promise<{ valid: boolean; account?: T212Account & { refreshedSec: number }; positions?: any[]; error?: string }> {
    const apiKey = process.env.TRADING212_API_KEY;
    if (!apiKey) {
      return { valid: false, error: 'TRADING212_API_KEY not set in .env' };
    }

    if (!this.prisma.isAvailable) {
      return { valid: false, error: 'Database not available' };
    }

    try {
      // Read cached positions from our DB
      const positions = await this.prisma.position.findMany({
        where: { provider: 'trading212' },
        orderBy: { symbol: 'asc' },
      });

      // Build account summary from cached positions
      const totalInvested = positions.reduce((s, p) => s + (p.avgPrice * p.quantity || 0), 0);
      const totalValue = positions.reduce((s, p) => s + (p.currentPrice * p.quantity || 0), 0);
      const totalPpl = positions.reduce((s, p) => s + (p.pnl || 0), 0);

      const refreshedSec = this.cache.lastRefreshAgoSec('trading212');

      return {
        valid: true,
        account: {
          total: totalValue,
          free: 0, // not tracked from positions alone
          invested: totalInvested,
          ppl: totalPpl,
          result: totalPpl,
          blocked: 0,
          refreshedSec,
        } as any,
        positions,
      };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  }

  async importPortfolio(): Promise<{
    success: boolean;
    positionsImported: number;
    symbolsCreated: number;
    account?: T212Account;
    positions?: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number; side: 'buy' | 'sell' | null }>;
    error?: string;
    cooldown?: boolean;
  }> {
    if (!this.cache.canRefresh('trading212')) {
      const remaining = this.cache.remainingSec('trading212');
      return { success: false, positionsImported: 0, symbolsCreated: 0, error: `Cooldown: ${remaining}s remaining`, cooldown: true };
    }

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
      // ⚠️ `side` IS IN THE RESULT SO THE WRITE IS VISIBLE. A sync that assigns a direction and
      // reports only the quantity leaves the interesting half of the write unobservable — and the
      // whole of #1069 began as a field that nothing wrote and nothing showed.
      const imported: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number; side: 'buy' | 'sell' | null }> = [];
      const currentTickers = new Set<string>();

      for (const pos of positions) {
        const cleanTicker = cleanT212Ticker(pos.ticker);
        currentTickers.add(cleanTicker);

        // ⚠️ THE SIDE IS WRITTEN HERE, AND IT WAS NEVER WRITTEN BEFORE (#1069). See
        // `sideFromQuantity()`. `side` is spread in ONLY when it could be established, so a sync
        // that cannot derive a direction leaves an existing value alone instead of overwriting it
        // with a null it did not earn.
        const side = sideFromQuantity(pos.quantity);
        const sideData = side ? { side } : {};

        // Ensure symbol exists in our DB
        try {
          const existing = await this.prisma.symbol.findUnique({ where: { ticker: cleanTicker } });
          if (!existing && this.prisma.isAvailable) {
            await this.prisma.symbol.create({
              data: { ticker: cleanTicker, name: cleanTicker, exchange: 'Trading212', type: 'stock' },
            });
            symbolsCreated++;
          }
        } catch { /* DB may not be available */ }

        imported.push({
          ticker: pos.ticker,
          quantity: pos.quantity,
          ppl: pos.ppl,
          currentPrice: pos.currentPrice,
          side,
        });

        // Update existing or create — no gap window (no delete-all-first)
        if (this.prisma.isAvailable) {
          try {
            const existing = await this.prisma.position.findFirst({
              where: { symbol: cleanTicker, provider: 'trading212' },
            });
            if (existing) {
              await this.prisma.position.update({
                where: { id: existing.id },
                data: {
                  quantity: pos.quantity,
                  avgPrice: pos.averagePrice,
                  currentPrice: pos.currentPrice,
                  pnl: pos.ppl ?? null,
                  accountId: `trading212-${this.t212Adapter.mode || 'demo'}`,
                  ...sideData,
                },
              });
            } else {
              await this.prisma.position.create({
                data: {
                  symbol: cleanTicker,
                  quantity: pos.quantity,
                  avgPrice: pos.averagePrice,
                  currentPrice: pos.currentPrice,
                  pnl: pos.ppl ?? null,
                  provider: 'trading212',
                  accountId: `trading212-${this.t212Adapter.mode || 'demo'}`, // live vs demo separation (#TBD)
                  ...sideData,
                },
              });
            }
          } catch { /* position may not exist yet */ }
        }
      }

      // AFTER all upserts, remove positions no longer in the portfolio (single gap-free pass)
      if (this.prisma.isAvailable && currentTickers.size > 0) {
        try {
          await this.prisma.position.deleteMany({
            where: {
              provider: 'trading212',
              symbol: { notIn: Array.from(currentTickers) },
            },
          });
        } catch { /* cleanup is best-effort */ }
      }

      this.cache.touch('trading212');
      this.logger.log(`Trading212: imported ${imported.length} positions, ${symbolsCreated} symbols created`);

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
        symbol: cleanT212Ticker(o.ticker),
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

