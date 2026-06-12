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

    const healthOk = await adapter.healthCheck();
    const quote = await adapter.getQuote('EURUSD');

    return {
      connected: healthOk,
      adapterName: adapter.name,
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
