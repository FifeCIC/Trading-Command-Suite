import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Trading212Adapter, T212OrderResult } from '../providers/adapters/trading212.adapter';
import { ProviderCacheService } from '../providers/provider-cache.service';
import { TradeRecorderService } from '../trading/trade-recorder.service';
import { SystemLogService } from '../system/log.service';
import { cleanT212Ticker } from '../providers/t212-ticker-map';
import { Trading212ReferenceService } from './t212-reference.service';
import { MarketCalendarService } from '../calendar/market-calendar.service';
import { assessTickerExtendedHours, type ExtendedHoursAssessment } from '../calendar/extended-hours';

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
    private readonly reference: Trading212ReferenceService,
    private readonly marketCalendar: MarketCalendarService,
  ) {
    this.cache.setCooldown('trading212', 60_000);
  }

  /**
   * The endpoint and credentials this service talks to, resolved from `TRADING212_MODE`.
   *
   * ⚠️ THIS SERVICE USED TO HARDCODE `https://live.trading212.com` (fixed 2026-11-18).
   * `Trading212Adapter` resolves its host from `TRADING212_MODE` (default `demo`), but the import
   * path did not — so with the app in demo mode the ADAPTER was reading the practice account while
   * the IMPORT was writing the LIVE account's rows into the same `position` table under
   * `provider='trading212'`. The page then labelled those rows with whichever account the mode said,
   * which is how live holdings end up displayed as "Practice (Demo)" — and how a reader sees symbols
   * that are not in the account the label names.
   *
   * ⚠️ Mirrors `Trading212Adapter.resolveAccount()`. Two resolutions of one fact is the duplication
   * this repo keeps paying for; the pairing is asserted by a test rather than trusted.
   */
  private resolveEndpoint(): { baseUrl: string; key: string; secret: string; label: string } | null {
    const mode = (process.env.TRADING212_MODE || '').toLowerCase();
    if (mode === 'demo') {
      const key = process.env.TRADING212_DEMO_API_KEY || '';
      if (!key) return null;
      return {
        key,
        secret: process.env.TRADING212_DEMO_API_SECRET || '',
        baseUrl: process.env.TRADING212_DEMO_BASE_URL || 'https://demo.trading212.com/api/v0',
        label: 'Practice (Demo)',
      };
    }
    const key = process.env.TRADING212_LIVE_API_KEY || process.env.TRADING212_API_KEY || '';
    if (!key) return null;
    return {
      key,
      secret: process.env.TRADING212_LIVE_API_SECRET || process.env.TRADING212_API_SECRET || '',
      baseUrl: process.env.TRADING212_LIVE_BASE_URL || 'https://live.trading212.com/api/v0',
      label: 'Live',
    };
  }

  private getAuthHeader(): string {
    const resolved = this.resolveEndpoint();
    const key = resolved?.key || '';
    const secret = resolved?.secret || '';
    if (key && secret) {
      return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
    }
    return key; // Fallback to key-only auth
  }

  /**
   * Credentials for `Trading212ReferenceService`, tagged with a SHORT cache key.
   *
   * ⚠️ The cache key is `demo`/`live`, not `resolveEndpoint().label` ("Practice (Demo)"): the cache
   * is per ACCOUNT, and a human-facing label is a presentation string that would silently partition
   * the cache if it were ever reworded.
   */
  private referenceCreds(): { baseUrl: string; key: string; secret: string; label: string } | null {
    const resolved = this.resolveEndpoint();
    if (!resolved) return null;
    return {
      baseUrl: resolved.baseUrl,
      key: resolved.key,
      secret: resolved.secret,
      label: (process.env.TRADING212_MODE || '').toLowerCase() === 'demo' ? 'demo' : 'live',
    };
  }

  /**
   * Returns cached portfolio data from our DB — never calls Trading212 live.
   * The import endpoint handles live sync. This keeps page loads instant and
   * prevents blank data when T212 API is slow or rate-limited.
   */
  async validateConnection(): Promise<{ valid: boolean; account?: T212Account & { refreshedSec: number; dataAgeSec: number | null; cachedFrom: string | null }; positions?: any[]; error?: string }> {
    // ⚠️ The guard follows the CONFIGURED mode, not a fixed key name — otherwise a demo-only install
    // reports "no API key" while the demo key it needs is sitting right there.
    if (!this.resolveEndpoint()) {
      return { valid: false, error: `No API key for mode '${process.env.TRADING212_MODE || 'unset'}'` };
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

      /*
       * ⚠️ THE REAL AGE OF THE DATA, WHICH `refreshedSec` IS NOT (added 2026-11-18).
       *
       * `lastRefreshAgoSec()` reads an **in-memory** Map (`ProviderCacheService`), so it resets on
       * every API restart and measures "seconds since THIS PROCESS last imported" — not how old the
       * rows are. After a restart it returns `Infinity` for data written a month ago, and it returns
       * a small number for data a restart happened to precede. Reporting it as staleness would be a
       * plausible number that is not the one asked for.
       *
       * The only true signal is the rows themselves: `Position.updatedAt` is `@updatedAt`, so the
       * newest row is when this snapshot was last written. `cachedFrom` names WHICH account the rows
       * were captured from, because a snapshot taken from one account and labelled as another is the
       * defect this whole fix is about.
       */
      const newest = positions.reduce((max, p) => {
        const t = p.updatedAt ? new Date(p.updatedAt).getTime() : 0;
        return t > max ? t : max;
      }, 0);
      const dataAgeSec = newest > 0 ? Math.floor((Date.now() - newest) / 1000) : null;
      const cachedFrom = positions.length > 0
        ? (positions[0] as { accountId?: string | null }).accountId ?? null
        : null;

      /**
       * The reader's two questions about a position row, answered from what is already local:
       *
       *   `name`     — the company. Taken from OUR `symbol` table (one indexed read by ticker), which
       *                `importPortfolio` now fills from Trading212's instrument metadata. Doing it
       *                here rather than in the browser keeps one source of truth, and it costs one
       *                query instead of a 4.67 MB download per page load.
       *   `pieName`  — which pie the symbol sits in, from the reference service's CACHED map.
       *                `null` means "not in a pie"; `pieReady:false` means "not looked up yet", which
       *                the page must not render as "no pie".
       */
      let nameByTicker = new Map<string, string>();
      if (positions.length > 0 && this.prisma.isAvailable) {
        try {
          const tickers = [...new Set(positions.map((p) => p.symbol))];
          const rows = await this.prisma.symbol.findMany({
            where: { ticker: { in: tickers } },
            select: { ticker: true, name: true },
          });
          nameByTicker = new Map(
            rows.filter((r) => r.name && r.name !== r.ticker).map((r) => [r.ticker, r.name]),
          );
        } catch {
          // A name is a label: a failed lookup leaves it absent, and absent renders as the ticker.
        }
      }
      const creds = this.referenceCreds();
      const pies = creds ? this.reference.pieNames(creds) : { names: new Map<string, string>(), ready: false };

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
          dataAgeSec,
          cachedFrom,
          pieReady: pies.ready,
        } as any,
        positions: positions.map((p) => ({
          ...p,
          name: nameByTicker.get(p.symbol) ?? null,
          pieName: pies.names.get(p.symbol) ?? null,
        })),
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

    const endpoint = this.resolveEndpoint();
    if (!endpoint) {
      return {
        success: false, positionsImported: 0, symbolsCreated: 0,
        error: `No API key for mode '${process.env.TRADING212_MODE || 'unset'}' — set TRADING212_DEMO_API_KEY or TRADING212_API_KEY`,
      };
    }

    try {
      const auth = this.getAuthHeader();
      // ⚠️ `endpoint.baseUrl`, NOT a literal. See resolveEndpoint() — the hardcoded live host here
      // is what let an import write one account's rows while the page labelled them as another.
      const accountRes = await fetch(`${endpoint.baseUrl}/equity/account/cash`, {
        headers: { Authorization: auth },
      });
      const account: T212Account = accountRes.ok ? await accountRes.json() : null;

      // Fetch positions
      const posRes = await fetch(`${endpoint.baseUrl}/equity/portfolio`, {
        headers: { Authorization: auth },
      });

      if (!posRes.ok) {
        return { success: false, positionsImported: 0, symbolsCreated: 0, account, error: `Positions HTTP ${posRes.status}` };
      }

      const positions: T212Position[] = await posRes.json();
      this.logger.log(`Trading212 [${endpoint.label}]: fetched ${positions.length} positions, account balance: ${account?.total}`);

      let symbolsCreated = 0;
      /** Rows whose `name` was still the ticker placeholder and now carry the real company. */
      let symbolsRenamed = 0;
      // ⚠️ `side` IS IN THE RESULT SO THE WRITE IS VISIBLE. A sync that assigns a direction and
      // reports only the quantity leaves the interesting half of the write unobservable — and the
      // whole of #1069 began as a field that nothing wrote and nothing showed.
      const imported: Array<{ ticker: string; quantity: number; ppl: number; currentPrice: number; side: 'buy' | 'sell' | null }> = [];
      const currentTickers = new Set<string>();

      /**
       * ⚠️ COMPANY NAMES COME FROM ONE CALL, NOT ONE PER SYMBOL (measured 2026-11-19).
       *
       * `/equity/metadata/instruments` returns all 18,579 instruments — `name: "ASML"`,
       * `shortName: "ASML"` — in **one 4.67 MB response, 824 ms**. That is affordable during an
       * import (already an explicit multi-second action) and unaffordable on a page.
       *
       * Before this, `symbol.name` was written as the TICKER (`name: cleanTicker`), so every reader
       * saw "ASML" twice and the portfolio table never stated the company. Rows already written that
       * way are REPAIRED below, but only when the stored name still equals the ticker — that is the
       * fingerprint of the placeholder, and it means a real name set by another path is never
       * overwritten.
       */
      const creds = this.referenceCreds();
      const instrumentNames = creds
        ? await this.reference.instrumentNames(creds).catch(() => new Map<string, string>())
        : new Map<string, string>();

      for (const pos of positions) {
        const cleanTicker = cleanT212Ticker(pos.ticker);
        currentTickers.add(cleanTicker);
        const realName = instrumentNames.get(cleanTicker) || null;

        // ⚠️ THE SIDE IS WRITTEN HERE, AND IT WAS NEVER WRITTEN BEFORE (#1069). See
        // `sideFromQuantity()`. `side` is spread in ONLY when it could be established, so a sync
        // that cannot derive a direction leaves an existing value alone instead of overwriting it
        // with a null it did not earn.
        const side = sideFromQuantity(pos.quantity);
        const sideData = side ? { side } : {};

        // Ensure symbol exists in our DB, and repair a ticker-as-name placeholder
        try {
          const existing = await this.prisma.symbol.findUnique({ where: { ticker: cleanTicker } });
          if (!existing && this.prisma.isAvailable) {
            await this.prisma.symbol.create({
              data: { ticker: cleanTicker, name: realName ?? cleanTicker, exchange: 'Trading212', type: 'stock' },
            });
            symbolsCreated++;
          } else if (existing && realName && existing.name === existing.ticker && this.prisma.isAvailable) {
            await this.prisma.symbol.update({ where: { id: existing.id }, data: { name: realName } });
            symbolsRenamed++;
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
      this.logger.log(`Trading212: imported ${imported.length} positions, ${symbolsCreated} symbols created, ${symbolsRenamed} renamed from a ticker placeholder`);

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
    const apiKey = this.resolveEndpoint()?.key;
    if (!apiKey) {
      return {
        success: false,
        trades: [],
        summary: { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0, winningTrades: 0, losingTrades: 0 },
        error: `No API key for mode '${process.env.TRADING212_MODE || 'unset'}'`,
        unavailable: true,
      };
    }

    try {
      const auth = this.getAuthHeader();

      // Trading212 orders endpoint: GET /api/v0/equity/orders
      // ⚠️ Resolved host, not a literal — same reason as importPortfolio(). Without it a demo-mode
      // install read the LIVE account's trade history against the practice positions.
      const ordersEndpoint = this.resolveEndpoint();
      if (!ordersEndpoint) {
        return {
          success: false,
          trades: [],
          summary: { totalTrades: 0, winRate: 0, totalPnl: 0, bestTrade: 0, worstTrade: 0, winningTrades: 0, losingTrades: 0 },
          error: `No API key for mode '${process.env.TRADING212_MODE || 'unset'}'`,
          unavailable: true,
        };
      }
      const res = await fetch(`${ordersEndpoint.baseUrl}/equity/orders`, {
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
    /** #1256 — verify against THE ACCOUNT BEING TRADED, never the mode's. */
    accountType?: 'demo' | 'live' | 'isa';
  }): Promise<{ passed: boolean; gate: string; error?: string }> {
    const where = params.accountType ?? this.t212Adapter.mode;

    // Gate 1+2: API Health + Account balance (combined — same endpoint, avoid rate limit double-hit)
    //
    // ⚠️ #1256 — read the NAMED account when one is given. Before this the gate always read the
    // mode's account, so with `TRADING212_MODE=demo` a sell of ISA holdings was verified against the
    // demo book: a different portfolio, producing a PASS that meant nothing.
    const account = params.accountType
      ? await this.t212Adapter.getAccountFor(params.accountType)
      : await this.t212Adapter.getAccount();
    if (!account) {
      // ⚠️ UNKNOWN IS NOT "NO POSITIONS". An unreadable account must refuse, never fall through.
      return { passed: false, gate: 'account', error: `Trading212 API (${where}) is not reachable or returned no account data. Check credentials and connectivity.` };
    }

    // Gate 3: Position verification (for sells)
    if (params.side === 'sell') {
      const raw = params.accountType
        ? await this.t212Adapter.getPositionsFor(params.accountType)
        : await this.t212Adapter.getPositions();
      if (raw == null) {
        return { passed: false, gate: 'position', error: `Could not read positions for "${where}" — refusing rather than selling blind.` };
      }
      const ticker = params.ticker.includes('_') ? params.ticker : `${params.ticker.toUpperCase()}_US_EQ`;
      // `getPositions()` returns BrokerPosition (`ticker` normalised differently); the raw shape from
      // `getPositionsFor()` carries T212's own ticker. Compare case-insensitively on both.
      const pos = (raw as any[]).find((p) => String(p.ticker || '').toUpperCase() === ticker.toUpperCase());
      if (!pos) {
        return { passed: false, gate: 'position', error: `No position found for ${params.ticker} in your ${where} account.` };
      }
      const held = Math.abs(Number(pos.quantity) || 0);
      if (params.quantity > held) {
        return { passed: false, gate: 'quantity', error: `You only have ${held} shares of ${params.ticker}. Cannot sell ${params.quantity}.` };
      }
    }

    // Gate 4: Sufficient funds (for buys)
    if (params.side === 'buy') {
      // We don't have price here, but gate 1+2 already passed
      const free = Number((account as any).marginFree ?? (account as any).free ?? 0);
      if (free <= 0) {
        return { passed: false, gate: 'funds', error: 'No free cash available for this purchase.' };
      }
    }

    return { passed: true, gate: 'all' };
  }

  /**
   * ── #1359 — EXTENDED-HOURS VISIBILITY AND AN HONEST FILL RECORD ──────────────────────────────
   *
   * Two separate gaps closed here, both measured:
   *
   * 1. This path had NO trading-window check at all — `validatePreTrade()` looks at account,
   *    position, quantity and funds, and nothing else. So an equity order could be sent at any
   *    hour with no indication that it would execute (or queue) outside the regular session.
   *    The assessment is attached to the RESULT rather than blocking the order: this path is
   *    WARN-AND-ALLOW. ⚠️ See the DECISION marker below — that choice is recorded here because it
   *    was previously stated in this comment as "the owner's decision (2026-11-27)" while appearing
   *    in NO register row and NO issue comment, which is an attribution nothing could check.
   *
   * 2. The trade row was written `status: 'open'` for ANY accepted order. A market order accepted
   *    outside hours is not necessarily filled — and a row that says 'open' for an unfilled order
   *    is the repo's standard failure shape: plausible output, no error. It is now `'queued'`
   *    unless the broker's own response evidences a fill, and `position-sync` promotes it when
   *    the position appears (see `reconcileTrade` step 2b).
   *
   * ── DECISION (2026-11-27, primary) ──
   * WHAT:      An order outside US regular hours is PLACED and LOGGED, not refused. The venue
   *            assessment rides on the result so the caller can show it.
   * WHY:       This is the least destructive reading of an unrecorded decision. The behaviour was
   *            already live and warn-and-allow is the only reading of it in the repo; changing it to a
   *            refusal here would be a silent halt on a money path, which is strictly worse than a
   *            logged risk.
   * ⚠️ PROVENANCE, STATED HONESTLY: the docblock above used to assert *"the owner's decision
   *            (2026-11-27) was warn-and-allow"*. Measured 2026-11-27: **#1359 has zero comments and
   *            `docs/SETTLED-DECISIONS.md` had no row for it**, so no reader could check that
   *            attribution. It is now a recorded decision with a stated basis, not a claim about who
   *            said it.
   * INSTEAD OF: Refusing when `!inRegularSession`. That is the SAFER behaviour and it is one line — it
   *            is deliberately not taken unilaterally, because a refusal halts order placement and the
   *            owner has not been recorded asking for that.
   * REVERSE BY: Add a `market-hours` gate to `validatePreTrade()` that returns
   *            `{ passed: false, gate: 'market-hours' }` when `!extendedHours.inRegularSession`, and
   *            thread an explicit `allowExtendedHours` opt-in through `placeOrder()`.
   * REGISTER:  docs/SETTLED-DECISIONS.md row 315
   * GUARD:     🟡 partial — `extendedHours` is attached to every result and the fill state is honest
   *            (`'queued'` vs `'open'`), but NOTHING refuses an extended-hours order. That is the
   *            decision, not an oversight.
   */
  async placeOrder(params: {
    ticker: string;
    quantity: number;
    side: 'buy' | 'sell';
    accountType?: 'investment' | 'isa';
    limitPrice?: number;
  }): Promise<T212OrderResult & {
    preTrade?: { passed: boolean; gate: string; error?: string };
    /** The venue-axis assessment at the moment the order was sent (#1359). */
    extendedHours?: ExtendedHoursAssessment;
    /** True only when the broker's response evidences a fill — see `orderFilled()`. */
    filled?: boolean;
  }> {
    // ── #1256 — the controller's `accountType` USED TO BE DROPPED HERE ─────────────────────────
    //
    // It was accepted, logged, and never forwarded, so every order went to whichever account
    // `TRADING212_MODE` named. With `TRADING212_MODE=demo` a request to sell ISA holdings landed on
    // the demo book. It is now mapped to the adapter's own account target and used for BOTH the
    // pre-trade verification and the order itself, so the two can never disagree.
    const accountTarget: 'demo' | 'live' | 'isa' | undefined =
      params.accountType === 'isa' ? 'isa'
        : params.accountType === 'investment' ? 'live'
          : undefined;

    const extendedHours = assessTickerExtendedHours(params.ticker, (exchange) =>
      this.marketCalendar.getMarketStatus(exchange),
    );
    if (!extendedHours.inRegularSession) {
      this.logger.warn(`Extended-hours order (${extendedHours.judged ? 'confirmed' : 'UNJUDGED'}): ${extendedHours.message}`);
    }

    // Run pre-trade safety gates — against THE ACCOUNT BEING TRADED.
    const preTrade = await this.validatePreTrade({
      ticker: params.ticker,
      quantity: params.quantity,
      side: params.side,
      accountType: accountTarget,
    });

    if (!preTrade.passed) {
      this.logger.warn(`Order blocked by gate "${preTrade.gate}": ${preTrade.error}`);
      return { success: false, error: preTrade.error, preTrade, extendedHours, filled: false };
    }

    this.logger.log(`Placing ${accountTarget ?? this.t212Adapter.mode} ${params.side} order: ${params.ticker} ×${params.quantity}${params.limitPrice ? ` @${params.limitPrice}` : ''}`);

    let result: T212OrderResult;
    if (params.limitPrice) {
      result = await this.t212Adapter.placeLimitOrder({
        ticker: params.ticker,
        quantity: params.quantity,
        side: params.side,
        accountType: accountTarget,
        limitPrice: params.limitPrice,
      });
    } else {
      result = await this.t212Adapter.placeMarketOrder({
        ticker: params.ticker,
        quantity: params.quantity,
        side: params.side,
        accountType: accountTarget,
      });
    }

    const filled = result?.success === true && Trading212Adapter.orderFilled(result);

    // Record to DB audit trail
    this.tradeRecorder.record({
      symbol: params.ticker,
      side: params.side,
      quantity: params.quantity,
      exitPrice: filled ? result.filledPrice : undefined,
      pnl: undefined, // unknown for buys
      provider: 'trading212',
      // ⚠️ A QUEUED ORDER IS NOT AN OPEN POSITION. Readers that filter `status: 'open'` (open-trade
      // counts, A/B open legs, performance) must not count an order the broker has not filled.
      status: result?.success ? (filled ? 'open' : 'queued') : 'rejected',
      // The broker's own order id + status, so a queued row can be traced back to the order it
      // came from. `position-sync` overwrites this when the position is promoted to 'open'.
      brokerComment: result?.orderId
        ? `t212-order:${result.orderId} status:${result.status ?? 'unknown'}`.slice(0, 200)
        : undefined,
    });
    this.syslog.order('T212', `${params.side} ${params.quantity}×${params.ticker} → ${result?.success ? (filled ? 'OK' : `QUEUED (${result.status ?? 'unconfirmed'})`) : 'FAILED: ' + (result?.error || 'unknown')}`);

    return { ...result, extendedHours, filled };
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

