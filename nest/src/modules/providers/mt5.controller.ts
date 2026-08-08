import { Controller, Get, Post, Param, Body, Query, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdapterFactory } from './adapter-factory';
import { Mt5Adapter } from './adapters/mt5.adapter';
import { Mt5ConnectionManager } from './mt5/mt5-connection-manager.service';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('providers')
@Controller('providers/mt5')
export class Mt5Controller {
  private readonly logger = new Logger(Mt5Controller.name);
  private readonly BRIDGE_URL = process.env.MT5_BRIDGE_URL || 'http://localhost:5000';

  constructor(
    private readonly adapterFactory: AdapterFactory,
    private readonly prisma: PrismaService,
    private readonly mt5Connection: Mt5ConnectionManager,
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

  @Get('diagnostics')
  @ApiOperation({ summary: 'MT5 bridge diagnostics — aggregate across all active brokers' })
  @ApiOkResponse({ description: 'Aggregated MT5 bridge health across all active broker instances' })
  async getDiagnostics() {
    // Check all active broker accounts, not just the default bridge
    const accounts = await this.mt5Connection.getAllBrokerHealths();
    const connected = accounts.filter((a: any) => a.health?.connected);
    const reachable = accounts.filter((a: any) => a.reachable);

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
  @ApiOperation({ summary: 'Force MT5 bridge to fully reconnect to terminal' })
  @ApiOkResponse({ description: 'Reconnection result' })
  async reconnect() {
    try {
      const res = await fetch(`${this.BRIDGE_URL}/reconnect`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return { success: false, error: (body as any).error || `Bridge returned HTTP ${res.status}`, timestamp: new Date().toISOString() };
      }
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message || 'Bridge unreachable', instructions: 'Start the bridge: cd scripts/mt5-bridge && python mt5_bridge.py', timestamp: new Date().toISOString() };
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
    try {
      const res = await fetch(`${this.BRIDGE_URL}/order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json() as any;

      // Record trade for traceability (#446)
      if (data.success && this.prisma.isAvailable) {
        const side = (body.type?.toUpperCase() === 'SELL') ? 'sell' : 'buy';
        try {
          await (this.prisma as any).trade.create({
            data: {
              symbol: body.symbol, side, quantity: body.volume,
              entryPrice: data.price || 0, provider: 'mt5', status: 'open',
              origin: 'user', ticket: data.ticket ?? null,
              sl: body.sl ?? null, tp: body.tp ?? null,
              brokerComment: body.comment ?? null,
            },
          });
        } catch { /* non-critical */ }
      }
      return { ...data, _deprecated: true, _migrateTo: 'POST /api/trading/mt5/order' };
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
