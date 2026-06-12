import { Controller, Get, Post, Logger } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdapterFactory } from './adapter-factory';
import { Mt5Adapter } from './adapters/mt5.adapter';

@ApiTags('providers')
@Controller('providers/mt5')
export class Mt5Controller {
  private readonly logger = new Logger(Mt5Controller.name);

  constructor(private readonly adapterFactory: AdapterFactory) {}

  private getMt5Adapter(): Mt5Adapter | null {
    const adapter = this.adapterFactory.create('mt5');
    if (adapter && adapter instanceof Mt5Adapter) {
      return adapter;
    }
    return null;
  }

  @Get('diagnostics')
  @ApiOperation({ summary: 'MT5 bridge diagnostics and connection status' })
  @ApiOkResponse({ description: 'MT5 bridge health, latency, account info' })
  async getDiagnostics() {
    const adapter = this.getMt5Adapter();
    if (!adapter) {
      return { connected: false, error: 'MT5 adapter not registered' };
    }

    // Check if Python bridge is even reachable
    let bridgeReachable = false;
    let bridgeError = '';
    let healthData: any = null;
    try {
      const res = await fetch('http://localhost:5000/health', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        bridgeReachable = true;
        healthData = await res.json();
      } else {
        bridgeError = `Bridge returned HTTP ${res.status}`;
      }
    } catch (err: any) {
      bridgeError = err.message || 'Bridge unreachable';
    }

    const healthOk = bridgeReachable && healthData?.connected === true;

    // Try to get a quote if connected
    let quote = null;
    if (healthOk) {
      quote = await adapter.getQuote('EURUSD');
    }

    return {
      connected: healthOk,
      bridgeRunning: bridgeReachable,
      bridgeError: bridgeReachable ? null : (bridgeError || 'Bridge not reachable on localhost:5000'),
      bridgeHealth: healthData,
      adapterName: adapter.name,
      circuitBreakerTripped: (adapter as any).tripped === true,
      consecutiveErrors: (adapter as any).consecutiveErrors ?? 0,
      mt5PackageAvailable: healthData?.mt5Package ?? null,
      mt5LoggedIn: healthData?.connected ?? false,
      account: healthData?.account ?? null,
      server: healthData?.server ?? null,
      balance: healthData?.balance ?? null,
      equity: healthData?.equity ?? null,
      lastQuote: quote
        ? {
            symbol: quote.symbol,
            bid: quote.bid,
            ask: quote.ask,
            spread: quote.ask != null && quote.bid != null
              ? Number(((quote.ask - quote.bid) * 10000).toFixed(1))
              : null,
            timestamp: quote.timestamp,
          }
        : null,
      instructions: !bridgeReachable
        ? 'The MT5 Python bridge is not running. Start it: cd scripts/mt5-bridge && python mt5_bridge.py'
        : !healthOk
          ? 'Bridge is running but cannot connect to MT5. Open MetaTrader 5 and log in to your account.'
          : null,
      timestamp: new Date().toISOString(),
    };
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
}
