import { Controller, Get, Post, Put, Delete, Param, Body, Query, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdapterFactory } from './adapter-factory';
import { Mt5Adapter } from './adapters/mt5.adapter';
import { Mt5ConnectionManager } from './mt5/mt5-connection-manager.service';
import { Mt5SymbolRouter } from './mt5/mt5-symbol-router.service';
import { Mt5SessionRecoveryService } from './mt5/mt5-session-recovery.service';
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
    // #992 option B — its state is served beside the manual reconnect, because the two are two
    // halves of one remedy and a reader should not have to hunt for the automatic one.
    private readonly sessionRecovery: Mt5SessionRecoveryService,
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
    if (brokerId !== undefined && brokerId !== '') {
      resolvedBrokerId = Number(brokerId);
      if (!Number.isInteger(resolvedBrokerId)) {
        return {
          success: false,
          brokerId,
          error: `brokerId must be an integer (got "${brokerId}")`,
          timestamp: new Date().toISOString(),
        };
      }
    }

    // ⚠️ ONE IMPLEMENTATION (#992). The body of this endpoint — getUrl, the refusal for an
    // unregistered id, the POST, the state passthrough — moved to
    // `Mt5ConnectionManager.reconnectBroker()` so the AUTOMATIC recovery watchdog and this manual
    // route cannot drift apart. The bridge did the same thing for the same reason when it extracted
    // `reconnect_mt5()`: a second copy drifts and only one of them gets the next fix.
    const result = await this.mt5Connection.reconnectBroker(resolvedBrokerId);
    return { ...result, timestamp: new Date().toISOString() };
  }

  /**
   * GET /api/providers/mt5/session-recovery — the automatic recovery watchdog's state (#992).
   *
   * ⚠️ The surface is part of the fix, not a nicety. The whole defect was that a halted session was
   * invisible: `reachable:false` did not say WHY, and the cause lived in a Python log nobody reads.
   * `unansweringBrokerIds` vs `bridges[].consecutiveDown` is exactly the distinction that was
   * missing — "the bridge is not running" and "the bridge is running and its session is gone".
   */
  @Get('session-recovery')
  @ApiOperation({ summary: 'Automatic MT5 session-recovery watchdog state (#992)' })
  getSessionRecoveryState() {
    return { ...this.sessionRecovery.getState(), timestamp: new Date().toISOString() };
  }

  /** POST /api/providers/mt5/session-recovery — turn the automatic recovery on or off. */
  @Post('session-recovery')
  @ApiOperation({ summary: 'Enable or disable automatic MT5 session recovery (#992)' })
  setSessionRecovery(@Body() body: { enabled: boolean }) {
    return {
      ...this.sessionRecovery.setEnabled(!!body?.enabled),
      timestamp: new Date().toISOString(),
    };
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
    // ⚠️ #1033 — THIS USED TO READ ONE BRIDGE. `this.BRIDGE_URL` is a module-level constant
    // (`resolveMt5BridgeUrl()`), so it never went through the manager at all and with
    // `MT5_ACTIVE_BROKERS=2,3` it answered with broker 2's book only: measured 2026-09-30, **7 of 9**
    // positions. Every consumer rendered 7 as if it were everything.
    //
    // ⚠️ THIS ENDPOINT IS READ-ONLY, and that is why it is safe to widen here. The close endpoints
    // below are NOT: they ACT, so they route per position rather than merely reading more.
    //
    // ⚠️ THE SHAPE IS UNCHANGED (`{ positions: [...] }`) because three dashboard consumers destructure
    // it (`dashboard-widgets.jsx`, `DailyBriefingPage.jsx`, `Mt5TradingPage.jsx`). `brokerId` and
    // `account` are ADDED to each row, which is what makes a row actionable — the same symbol can be
    // open on both accounts and it is not the same money.
    try {
      // Every ACTIVE bridge, whether or not it returned anything. `getAllPositions()` iterates
      // exactly this set, so it is the honest answer to "what was asked?".
      const queried = this.mt5Connection.getBrokerIds().slice().sort((a, b) => a - b);
      const positions = await this.mt5Connection.getAllPositions();

      // ⚠️ THE ACCOUNT IS READ FROM THE BRIDGE THAT HOLDS THE POSITION, NOT FROM `getAccounts()`.
      //
      // The first version of this joined against `getAccounts()`, which lists EVERY configured
      // account including the inactive ones, keyed by brokerId. Measured live 2026-10-01 it put
      // `52918025 @ ICMarketsSC-Demo` on the broker-2 AND broker-3 rows — a login that matches
      // NEITHER bridge (`:5000` is 10011309743 @ MetaQuotes-Demo, `:5001` is 62135531 @
      // PepperstoneUK-Demo). **An attribution field that can be confidently wrong is worse than an
      // absent one**: the whole point of #1033 is that two accounts hold this book and the money is
      // not the same money, so a mislabelled row is the defect restated.
      //
      // `/account` is the bridge's OWN statement of who it is. Read per broker, concurrent.
      const accountByBroker = new Map<number, string>();
      await Promise.all(
        queried.map(async (brokerId) => {
          const info: any = await this.mt5Connection.getAccountInfo(brokerId).catch(() => null);
          if (info && (info.login != null || info.server != null)) {
            accountByBroker.set(brokerId, `${info.login ?? '?'} @ ${info.server ?? '?'}`);
          }
        }),
      );

      return {
        positions: positions.map((p: any) => ({
          ...p,
          // ⚠️ `null` when the bridge could not be asked — NEVER a guess, and never inherited from
          // another broker's row. A row that cannot say which account it is on is not actionable,
          // and saying so is the honest outcome.
          account: accountByBroker.get(Number(p.brokerId)) ?? null,
        })),
        count: positions.length,
        // The bridges that actually RETURNED a position. A broker absent from this list either held
        // nothing or could not be read — see the note on `queried` below, and the gap it states.
        brokers: [...new Set(positions.map((p: any) => Number(p.brokerId)))].sort((a, b) => a - b),
        // ⚠️ THREE FIELDS, BECAUSE "EMPTY" AND "NEVER ASKED" MUST NOT LOOK THE SAME.
        //
        //   `brokers`  — the bridges that RETURNED a position. Empty here is not a fault.
        //   `queried`  — EVERY ACTIVE BRIDGE, asked. This is what proves the fan-out is real: with
        //                `MT5_ACTIVE_BROKERS=2,3` it reads `[2,3]` even when broker 3 holds nothing.
        //   `gaps`     — a bridge that could not be read. ⚠️ Its absence from `positions` is NOT an
        //                empty account, and without this field the two are indistinguishable.
        //
        // ⚠️ `queried` was added while verifying this issue: the endpoint returned `brokers: [2]`
        // and there was no way to tell whether broker 3 was asked and held nothing, or was never
        // asked at all. Measured 2026-10-01, `:5001` answered `{"positions": [], "count": 0}` — so it
        // was the former, and the acceptance criterion ("returns a broker-3 position") is unprovable
        // until broker 3 actually holds one. This field is what makes that distinction visible rather
        // than assumed.
        //
        // ⚠️ NOT reported: WHICH bridge failed, if one did. `getAllPositions()` maps each broker and
        // a failed read yields `[]` — indistinguishable from an empty account, and the manager does
        // not surface it. An empty `gaps: []` here would be a FALSE statement ("nothing failed"), so
        // the field is absent rather than reassuring. Closing that would mean changing the manager,
        // which is out of this issue's scope and is where the remaining blind spot lives.
        queried,
      };
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
    // ⚠️ #1033 — THIS IS A MONEY PATH AND IT READ ONE BRIDGE. "Close all" fetched
    // `${this.BRIDGE_URL}/positions`, so with two accounts it closed broker 2's book and returned a
    // success count. The operator saw "closed 7", the book still held 2, and nothing said so.
    //
    // Each close now goes to the bridge that HOLDS the position, resolved from the ticket. ⚠️ The
    // previous behaviour — post every close to the primary — is not merely incomplete: for a
    // broker-3 ticket it asks an account that has never heard of it.
    try {
      const positions = await this.mt5Connection.getAllPositions();
      let closed = 0;
      let failed = 0;
      for (const pos of positions) {
        try {
          // Throws for an unregistered broker (#914) rather than answering as the default.
          const url = this.mt5Connection.getUrl(Number(pos.brokerId));
          const closeRes = await fetch(`${url}/close/${pos.ticket}`, {
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
      return {
        closed,
        failed,
        total: positions.length,
        // Names what was swept, so a partial sweep cannot look complete.
        brokers: [...new Set(positions.map((p: any) => Number(p.brokerId)))].sort((a, b) => a - b),
      };
    } catch (err: any) {
      return { closed: 0, failed: 0, error: err.message || 'Bridge unreachable' };
    }
  }

  @Post('close-profitable')
  async closeProfitable() {
    // ⚠️ #1033 — every bridge, and each close routed to its own. Same defect and same reasoning as
    // closeAll() above; the profitable-only filter made it worse, because the positions it could not
    // see were the ones it reported as "skipped".
    try {
      const allPositions = await this.mt5Connection.getAllPositions();
      const profitable = allPositions.filter((p: any) => p.profit > 0);

      let closed = 0;
      let failed = 0;
      let totalPnl = 0;
      const closedTickets: { ticket: number; symbol: string; profit: number }[] = [];

      for (const pos of profitable) {
        try {
          const url = this.mt5Connection.getUrl(Number(pos.brokerId));
          const closeRes = await fetch(`${url}/close/${pos.ticket}`, {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
          });
          if (closeRes.ok) {
            closed++;
            totalPnl += Number(pos.profit ?? 0);
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
        // ⚠️ A SUM ACROSS TWO ACCOUNTS AND TWO CURRENCIES (GBP and USD). It was already a
        // cross-symbol sum; it is now cross-account too. Reported because the shape is fixed, but
        // it is NOT a meaningful money total — see the per-ticket rows for the account.
        totalPnl: Math.round(totalPnl * 100) / 100,
        closedTickets,
        brokers: [...new Set(allPositions.map((p: any) => Number(p.brokerId)))].sort((a, b) => a - b),
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
