import { Controller, Get, Post, Put, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdapterFactory } from './adapter-factory';
import { Mt5Adapter } from './adapters/mt5.adapter';
import { Mt5ConnectionManager } from './mt5/mt5-connection-manager.service';
import { Mt5SymbolRouter } from './mt5/mt5-symbol-router.service';
import { resolveMt5BridgeUrl } from './mt5/mt5-bridge.config';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('providers')
@Controller('providers/mt5')
export class Mt5Controller {
  private readonly logger = new Logger(Mt5Controller.name);
  private readonly BRIDGE_URL = resolveMt5BridgeUrl();

  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly prisma: PrismaService,
    private readonly mt5Connection: Mt5ConnectionManager,
    private readonly symbolRouter: Mt5SymbolRouter,
  ) {}

  private getMt5Adapter(): Mt5Adapter | null {
    const adapter = this.adapterFactory.create('mt5');
    if (adapter && adapter instanceof Mt5Adapter) {
      return adapter;
    }
    return null;
  }

  @Get('brokers')
  @ApiOperation({ summary: 'List all active MT5 broker instances with health' })
  @ApiOkResponse({ description: 'Per-broker status, health, and connectivity' })
  async getBrokers() {
    return {
      brokers: await this.mt5Connection.getAllBrokerHealths(),
      timestamp: new Date().toISOString(),
    };
  }

  // ── Symbol → broker routing (symbol_route, GH #747) ──────

  private invalidateRouteCache(symbol?: string): void {
    this.symbolRouter.invalidate(symbol);
    void this.symbolRouter.refresh();
  }

  @Get('routes')
  @ApiOperation({ summary: 'List symbol→broker route assignments' })
  async getRoutes(@Query('brokerId') brokerId?: string, @Query('symbol') symbol?: string) {
    const where: any = {};
    if (brokerId) where.brokerId = parseInt(brokerId, 10);
    if (symbol) where.symbol = symbol.toUpperCase();
    const routes = await this.prisma.symbolRoute.findMany({
      where,
      orderBy: [{ symbol: 'asc' }, { priority: 'asc' }],
    });
    return { routes, cache: this.symbolRouter.snapshot(), timestamp: new Date().toISOString() };
  }

  @Get('routes/:symbol')
  @ApiOperation({ summary: 'Resolve the effective route for a single symbol' })
  async resolveRoute(@Param('symbol') symbol: string) {
    return { symbol: symbol.toUpperCase(), route: this.symbolRouter.resolve(symbol) };
  }

  @Put('routes/:symbol')
  @ApiOperation({ summary: 'Create/update a symbol→broker route' })
  async setRoute(
    @Param('symbol') symbol: string,
    @Body() body: { brokerId: number; brokerSymbol?: string | null; priority?: number; enabled?: boolean; note?: string },
  ) {
    const sym = symbol.toUpperCase();
    if (typeof body?.brokerId !== 'number') {
      return { ok: false, error: 'brokerId (number) is required' };
    }
    const route = await this.prisma.symbolRoute.upsert({
      where: { symbol_brokerId: { symbol: sym, brokerId: body.brokerId } },
      update: {
        brokerSymbol: body.brokerSymbol ?? null,
        priority: body.priority ?? 0,
        enabled: body.enabled ?? true,
        note: body.note ?? null,
      },
      create: {
        symbol: sym,
        brokerId: body.brokerId,
        brokerSymbol: body.brokerSymbol ?? null,
        priority: body.priority ?? 0,
        enabled: body.enabled ?? true,
        note: body.note ?? null,
      },
    });
    this.invalidateRouteCache(sym);
    return { ok: true, route };
  }

  @Post('routes/bulk')
  @ApiOperation({ summary: 'Bulk create/update symbol→broker routes' })
  async bulkSetRoutes(
    @Body() body: { routes: Array<{ symbol: string; brokerId: number; brokerSymbol?: string | null; priority?: number; enabled?: boolean; note?: string }> },
  ) {
    const items = Array.isArray(body?.routes) ? body.routes : [];
    let applied = 0;
    for (const r of items) {
      if (!r?.symbol || typeof r.brokerId !== 'number') continue;
      const sym = r.symbol.toUpperCase();
      await this.prisma.symbolRoute.upsert({
        where: { symbol_brokerId: { symbol: sym, brokerId: r.brokerId } },
        update: { brokerSymbol: r.brokerSymbol ?? null, priority: r.priority ?? 0, enabled: r.enabled ?? true, note: r.note ?? null },
        create: { symbol: sym, brokerId: r.brokerId, brokerSymbol: r.brokerSymbol ?? null, priority: r.priority ?? 0, enabled: r.enabled ?? true, note: r.note ?? null },
      });
      applied++;
    }
    this.invalidateRouteCache();
    return { ok: true, applied, cache: this.symbolRouter.snapshot(), timestamp: new Date().toISOString() };
  }

  @Delete('routes/:symbol')
  @ApiOperation({ summary: 'Delete all routes for a symbol (falls back to asset-type default)' })
  async deleteRoutes(@Param('symbol') symbol: string, @Query('brokerId') brokerId?: string) {
    const sym = symbol.toUpperCase();
    const where: any = { symbol: sym };
    if (brokerId) where.brokerId = parseInt(brokerId, 10);
    const res = await this.prisma.symbolRoute.deleteMany({ where });
    this.invalidateRouteCache(sym);
    return { ok: true, deleted: res.count };
  }

  // ── Bulk market data (broker-grouped — scales to many symbols, #747) ──

  @Post('quotes/bulk')
  @ApiOperation({ summary: 'Bulk quotes for many symbols (grouped per broker)' })
  async bulkQuotes(@Body() body: { symbols: string[] }) {
    const adapter = this.getMt5Adapter();
    if (!adapter) return { ok: false, error: 'MT5 adapter unavailable' };
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const quotes = await adapter.getQuotesBulk(symbols);
    return { ok: true, requested: symbols.length, count: Object.keys(quotes).length, quotes };
  }

  @Post('candles/bulk')
  @ApiOperation({ summary: 'Bulk candles for many symbols (grouped per broker)' })
  async bulkCandles(@Body() body: { symbols: string[]; timeframe?: string; limit?: number }) {
    const adapter = this.getMt5Adapter();
    if (!adapter) return { ok: false, error: 'MT5 adapter unavailable' };
    const symbols = Array.isArray(body?.symbols) ? body.symbols : [];
    const data = await adapter.getCandlesBatch(symbols, body?.timeframe ?? '1h', body?.limit ?? 100);
    return {
      ok: true,
      requested: symbols.length,
      count: Object.keys(data).length,
      barCounts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    };
  }

  @Get('diagnostics')
  @ApiOperation({ summary: 'MT5 bridge diagnostics — aggregate across all active brokers' })
  @ApiOkResponse({ description: 'Aggregated MT5 bridge health across all active broker instances' })
  async getDiagnostics() {
    // Check all active broker accounts, not just the default bridge
    const accounts = await this.mt5Connection.getAllBrokerHealths();
    const connected = accounts.filter((a: any) => a.health?.connected);
    const reachable = accounts.filter((a: any) => a.reachable);

    // #846 — per-broker circuit-breaker state. The breaker is keyed per broker, so this
    // reports each one separately: a single tripped broker no longer implies the others are
    // gated, and the reader can see WHICH is open instead of inferring it from log rows.
    const circuitBreakers = this.getMt5Adapter()?.circuitBreakerSnapshot?.() ?? [];

    if (connected.length > 0) {
      const best = connected[0];
      return {
        connected: true,
        bridgeRunning: true,
        bridgeError: null,
        activeAccounts: connected.length,
        totalAccounts: reachable.length,
        account: best.health?.account ?? null,
        server: best.server,
        balance: best.health?.balance ?? null,
        equity: best.health?.equity ?? null,
        brokerId: best.brokerId,
        circuitBreakers,
        instructions: null,
        timestamp: new Date().toISOString(),
      };
    }

    // No active account connected — try a direct health check on the first bridge
    const adapter = this.getMt5Adapter();
    try {
      const res = await fetch(`${this.BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      const healthData = res.ok ? await res.json() : null;
      return {
        connected: false,
        bridgeRunning: res.ok,
        bridgeError: res.ok ? null : `Bridge HTTP ${res.status}`,
        activeAccounts: 0,
        totalAccounts: reachable.length,
        account: healthData?.account ?? null,
        server: healthData?.server ?? null,
        balance: null,
        equity: null,
        circuitBreakers,
        instructions: res.ok
          ? 'Bridge is running but cannot connect to MT5. Open MetaTrader 5 and log in.'
          : `Bridge not reachable on ${this.BRIDGE_URL}`,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        connected: false,
        bridgeRunning: false,
        bridgeError: err.message || 'Bridge unreachable',
        activeAccounts: 0,
        totalAccounts: reachable.length,
        circuitBreakers,
        instructions: 'No MT5 bridges are running. Start from Intranet controls.',
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Post('restart-bridge')
  @ApiOperation({ summary: 'Signal MT5 bridge to reconnect' })
  @ApiOkResponse({ description: 'Bridge reset signal sent' })
  async restartBridge() {
    const adapter = this.getMt5Adapter();
    if (!adapter) {
      return { success: false, error: 'MT5 adapter not registered' };
    }

    if (typeof (adapter as any).resetCircuitBreaker === 'function') {
      (adapter as any).resetCircuitBreaker();
    }

    return {
      success: true,
      message: 'Circuit breaker reset. Bridge will reconnect on next request.',
      timestamp: new Date().toISOString(),
    };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Force MT5 bridge to refresh data and reconnect to broker' })
  @ApiOkResponse({ description: 'Refresh results with symbol status' })
  async refreshData() {
    try {
      const res = await fetch(`${this.BRIDGE_URL}/refresh`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        return { success: false, error: `Bridge returned HTTP ${res.status}`, timestamp: new Date().toISOString() };
      }
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message || 'Bridge unreachable', instructions: 'Start the bridge: cd scripts/mt5-bridge && python mt5_bridge.py', timestamp: new Date().toISOString() };
    }
  }

  @Post('reconnect')
  @ApiOperation({
    summary: 'Force an MT5 bridge to fully reconnect to terminal',
    description:
      // ⚠️ #992 criterion 4. Before this, the endpoint hardcoded the PRIMARY bridge URL, so with
      // `MT5_ACTIVE_BROKERS=2,3` the only recovery route the app exposed could not be AIMED at the
      // broker that was down — and on 2026-09-25 that is exactly what happened: broker 2 lost its
      // session and the API could only have reached it by luck of being primary.
      'Pass brokerId to target a SPECIFIC bridge. Omitted = the default (primary) bridge, which is ' +
      'what every existing caller gets. An id that is not a registered bridge is REFUSED with the ' +
      'active ids named — never answered by the default (#914).',
  })
  @ApiOkResponse({ description: 'Reconnection result, naming the broker that was reconnected' })
  async reconnect(@Query('brokerId') brokerId?: string) {
    // `undefined`/'' means "the default bridge" and must stay that way for existing callers.
    let resolvedBrokerId: number | null = null;
    let bridgeUrl: string;
    try {
      if (brokerId !== undefined && brokerId !== '') {
        resolvedBrokerId = Number(brokerId);
        if (!Number.isInteger(resolvedBrokerId)) {
          return {
            success: false,
            brokerId: brokerId,
            error: `brokerId must be an integer (got "${brokerId}")`,
            timestamp: new Date().toISOString(),
          };
        }
      }
      // ⚠️ This THROWS for an unregistered id rather than substituting the default (#914), and the
      // throw is REPORTED. Swallowing it into "bridge unreachable" would tell the caller the bridge
      // was down when the real fault was the id they asked for.
      bridgeUrl = this.mt5Connection.getUrl(resolvedBrokerId);
    } catch (err: any) {
      return {
        success: false,
        brokerId: resolvedBrokerId,
        error: err.message || String(err),
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const res = await fetch(`${bridgeUrl}/reconnect`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          brokerId: resolvedBrokerId,
          bridgeUrl,
          error: (body as any).error || `Bridge returned HTTP ${res.status}`,
          timestamp: new Date().toISOString(),
        };
      }
      // ⚠️ NAME WHICH BRIDGE ANSWERED. A reconnect result that does not say which broker was
      // reconnected is the same defect one level up: with two bridges running, "success" is not
      // enough to know whether the RIGHT one recovered.
      const bridgeBody = (body as any) || {};
      return {
        ...bridgeBody,
        brokerId: resolvedBrokerId,
        bridgeUrl,
        // The bridge now classifies its own link (#992): ok | session-lost | terminal-down |
        // account-unavailable, with a remedy. Passing it through keeps that distinction visible to
        // the caller instead of collapsing it back into a boolean.
        connectionState: bridgeBody.connectionState ?? undefined,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        success: false,
        brokerId: resolvedBrokerId,
        bridgeUrl,
        error: err.message || 'Bridge unreachable',
        instructions: 'Start the bridge: cd scripts/mt5-bridge && python mt5_bridge_v2.py',
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get('accounts')
  @ApiOperation({ summary: 'List configured MT5 accounts (aggregated from all brokers)' })
  async getAccounts() {
    try {
      const accounts = await this.mt5Connection.getAccounts();
      return { accounts, timestamp: new Date().toISOString() };
    } catch (err: any) {
      return { accounts: [], error: err.message || 'Failed to fetch accounts' };
    }
  }

  @Post('accounts/remove')
  @ApiOperation({ summary: 'Remove an MT5 account from the bridge config' })
  async removeAccount(@Body() body: { number: number }) {
    try {
      const res = await fetch(`${this.BRIDGE_URL}/accounts/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: body.number }),
        signal: AbortSignal.timeout(5000),
      });
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message || 'Bridge unreachable' };
    }
  }

  @Post('switch/:accountNum')
  @ApiOperation({ summary: 'Switch MT5 to a different account' })
  async switchAccount(@Param('accountNum') accountNum: string) {
    try {
      const res = await fetch(`${this.BRIDGE_URL}/switch/${accountNum}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { success: false, error: (body as any).error || `Bridge returned HTTP ${res.status}` };
      }
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message || 'Bridge unreachable' };
    }
  }

  // ── Trading Endpoints ─────────────────────────────────────

  @Get('positions')
  async getPositions() {
    try {
      const res = await fetch(`${this.BRIDGE_URL}/positions`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { positions: [], error: `Bridge HTTP ${res.status}` };
      return await res.json();
    } catch (err: any) {
      return { positions: [], error: err.message || 'Bridge unreachable' };
    }
  }

  /**
   * Place an MT5 order through the bridge AND record it in the Trade table.
   *
   * This endpoint was historically a DIRECT bridge passthrough — it sent orders
   * to the Python bridge and returned the result with zero traceability.
   * Orders placed here were invisible to portfolio tracking, decision logs,
   * and the audit trail (#446 Phase 1 finding).
   *
   * Now it still calls the bridge (keeping backward compatibility for any
   * callers) but ALSO writes a Trade record with ticket/sl/tp/comment on
   * success. The try/catch around the DB write ensures a recording failure
   * never blocks the actual order.
   *
   * @deprecated Use POST /api/trading/mt5/order instead (Mt5TradingService with full validation + recording).
   * This endpoint is kept for backward compatibility but no active code paths call it.
   * Will be removed in Phase 3 cleanup (Epic #510 DB-Driven Architecture).
   */
  @Post('order')
  async placeOrder(@Body() body: { symbol: string; type: string; volume: number; price?: number; sl?: number; tp?: number; comment?: string }) {
    this.logger.warn(`DEPRECATED — POST /api/providers/mt5/order called for ${body.symbol}. Redirect to POST /api/trading/mt5/order.`);
    // ⚠️ #914 (2026-09-21) — this endpoint used to be a RAW passthrough to the DEFAULT bridge:
    // it resolved no route at all. Measured live during the #914 verification:
    //
    //   POST /api/providers/mt5/order {"symbol":"BTC","type":"BUY","volume":0.1}
    //   → {"success":false,"error":"Volume 0.1 below BTC minimum (1.0)"}
    //
    // The order reached MetaQuotes, MT5 fuzzy-matched the bare ticker `BTC` to `Nasdaq\ETF\BTC`
    // — and the ONLY thing that stopped the fill was that US ETF's own 1-lot floor. It also
    // ignored symbol_route for every other asset, so a symbol routed to Pepperstone was ordered
    // on MetaQuotes. Zero callers exist (frontend uses /api/trading/mt5/order; the architecture
    // reference records the same audit), but a live endpoint that can buy the wrong instrument
    // must not stay unguarded until its scheduled deletion under Epic #510.
    //
    // The order therefore travels the canonical executor — `Mt5Adapter.placeOrder()` — which
    // resolves the route, applies the shared route-integrity guard (one implementation, shared
    // with the feasibility library and Mt5TradingService) and persists the attempt.
    const adapter = this.getMt5Adapter();
    if (!adapter) {
      return { success: false, error: 'MT5 adapter unavailable', _deprecated: true, _migrateTo: 'POST /api/trading/mt5/order' };
    }
    try {
      const result = await adapter.placeOrder({
        symbol: body.symbol,
        side: body.type?.toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
        quantity: body.volume,
        sl: body.sl,
        tp: body.tp,
        comment: body.comment,
      });

      // Record trade for traceability (#446) — unchanged behaviour on a successful fill.
      if (result.success && this.prisma.isAvailable) {
        const side = body.type?.toUpperCase() === 'SELL' ? 'sell' : 'buy';
        try {
          await (this.prisma as any).trade.create({
            data: {
              symbol: body.symbol, side, quantity: body.volume,
              entryPrice: result.price || 0, provider: 'mt5', status: 'open',
              origin: 'user', ticket: result.ticket ?? null,
              sl: body.sl ?? null, tp: body.tp ?? null,
              brokerComment: body.comment ?? null,
            },
          });
        } catch { /* non-critical */ }
      }
      return { ...result, _deprecated: true, _migrateTo: 'POST /api/trading/mt5/order' };
    } catch (err: any) {
      return { success: false, error: err.message || 'Bridge unreachable', _deprecated: true };
    }
  }

  /**
   * @deprecated Use DELETE /api/trading/mt5/close/:ticket instead.
   */
  @Post('close/:ticket')
  async closePosition(@Param('ticket') ticket: string) {
    this.logger.warn(`DEPRECATED — POST /api/providers/mt5/close/${ticket} called. Redirect to DELETE /api/trading/mt5/close/${ticket}.`);
    try {
      const res = await fetch(`${this.BRIDGE_URL}/close/${ticket}`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json() as any;

      // Update trade record with close data (#446)
      if (data.success && this.prisma.isAvailable) {
        try {
          const ticketNum = parseInt(ticket, 10);
          if (!isNaN(ticketNum)) {
            await (this.prisma as any).trade.updateMany({
              where: { ticket: ticketNum, status: 'open' },
              data: { status: 'closed', exitPrice: data.price ?? null, closedAt: new Date() },
            });
          }
        } catch { /* non-critical */ }
      }
      return { ...data, _deprecated: true, _migrateTo: `DELETE /api/trading/mt5/close/${ticket}` };
    } catch (err: any) {
      return { success: false, error: err.message || 'Bridge unreachable', _deprecated: true };
    }
  }

  @Post('close-all')
  async closeAll() {
    try {
      const posRes = await fetch(`${this.BRIDGE_URL}/positions`, { signal: AbortSignal.timeout(10000) });
      if (!posRes.ok) return { closed: 0, failed: 0, error: `Bridge HTTP ${posRes.status}` };
      const positions = await posRes.json();
      const allPositions = Array.isArray(positions) ? positions : (positions.positions || []);

      let closed = 0;
      let failed = 0;
      for (const pos of allPositions) {
        try {
          const closeRes = await fetch(`${this.BRIDGE_URL}/close/${pos.ticket}`, {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
          });
          const data = await closeRes.json() as any;
          if (data.success) {
            closed++;
            // Update trade record (#446)
            if (this.prisma.isAvailable) {
              try {
                await (this.prisma as any).trade.updateMany({
                  where: { ticket: pos.ticket, status: 'open' },
                  data: { status: 'closed', exitPrice: data.price ?? null, closedAt: new Date() },
                });
              } catch { /* non-critical */ }
            }
          } else { failed++; }
        } catch { failed++; }
      }
      return { closed, failed, total: allPositions.length };
    } catch (err: any) {
      return { closed: 0, failed: 0, error: err.message || 'Bridge unreachable' };
    }
  }

  @Post('close-profitable')
  async closeProfitable() {
    try {
      const posRes = await fetch(`${this.BRIDGE_URL}/positions`, { signal: AbortSignal.timeout(10000) });
      if (!posRes.ok) return { closed: 0, failed: 0, skipped: 0, totalPnl: 0, closedTickets: [], error: `Bridge HTTP ${posRes.status}` };
      const positions = await posRes.json();
      const allPositions = Array.isArray(positions) ? positions : (positions.positions || []);
      const profitable = allPositions.filter((p: any) => p.profit > 0);

      let closed = 0;
      let failed = 0;
      let totalPnl = 0;
      const closedTickets: { ticket: number; symbol: string; profit: number }[] = [];

      for (const pos of profitable) {
        try {
          const closeRes = await fetch(`${this.BRIDGE_URL}/close/${pos.ticket}`, {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
          });
          if (closeRes.ok) {
            closed++;
            totalPnl += pos.profit;
            closedTickets.push({ ticket: pos.ticket, symbol: pos.symbol, profit: pos.profit });
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      return {
        closed,
        failed,
        skipped: allPositions.length - profitable.length,
        totalPnl: Math.round(totalPnl * 100) / 100,
        closedTickets,
      };
    } catch (err: any) {
      return { closed: 0, failed: 0, skipped: 0, totalPnl: 0, closedTickets: [], error: err.message || 'Bridge unreachable' };
    }
  }

  @Get('history')
  async getHistory() {
    try {
      const res = await fetch(`${this.BRIDGE_URL}/history`, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return { orders: [], error: `Bridge HTTP ${res.status}` };
      return await res.json();
    } catch (err: any) {
      return { orders: [], error: err.message || 'Bridge unreachable' };
    }
  }

  @Get('quotes')
  @ApiOperation({ summary: 'Bulk quote lookup for one or more symbols' })
  @ApiOkResponse({ description: 'Array of quote objects with bid/ask/spread' })
  async getQuotes(@Query('symbols') symbols?: string) {
    const adapter = this.getMt5Adapter();
    if (!adapter) {
      return { quotes: [], connected: false, error: 'MT5 adapter not registered' };
    }

    // Resolve symbol list from query param
    const symbolList = symbols
      ? symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
      : ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDCAD'];

    // Fetch each quote in parallel, silently dropping failures
    const results = await Promise.allSettled(
      symbolList.map((sym) => adapter.getQuote(sym))
    );

    const quotes: { symbol: string; bid: number | null; ask: number | null; spread: number | null; timestamp: string }[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        const q = r.value;
        quotes.push({
          symbol: q.symbol,
          bid: q.bid,
          ask: q.ask,
          spread: q.ask != null && q.bid != null
            ? Number(((q.ask - q.bid) * 10000).toFixed(1))
            : null,
          timestamp: q.timestamp instanceof Date ? q.timestamp.toISOString() : String(q.timestamp),
        });
      }
    }

    return {
      quotes,
      connected: quotes.length > 0,
      requested: symbolList.length,
      returned: quotes.length,
      timestamp: new Date().toISOString(),
    };
  }
}
