import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProvidersService } from './providers.service';
import { AdapterFactory } from './adapter-factory';
import { RateLimitGovernor } from './rate-limit-governor.service';
import { ProviderDegradationService } from './provider-degradation.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';
import { Trading212Adapter } from './adapters/trading212.adapter';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly adapterFactory: AdapterFactory,
    private readonly t212Adapter: Trading212Adapter,
    private readonly rateLimitGovernor: RateLimitGovernor,
    private readonly degradation: ProviderDegradationService,
  ) {}

  @Get('degradation')
  getDegradation() {
    return {
      providers: this.degradation.getAll(),
      degradedCount: this.degradation.getAll().filter(p => p.status !== 'healthy' && p.status !== 'unknown').length,
    };
  }

  @Get('governor')
  getGovernorStatus() {
    return this.rateLimitGovernor.getStatus();
  }

  @Get('rate-limits')
  @ApiOperation({ summary: 'Get rate limit state for all provider adapters' })
  @ApiOkResponse({ description: 'Rate limit states with tripped/warning flags' })
  getRateLimits() {
    const states = this.adapterFactory.getAllRateLimits();
    const active = this.adapterFactory.getActive();
    const activeId = active ? this.findInstanceId(active) : null;
    return {
      adapters: states,
      activeAdapter: activeId,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('rate-limits/detail')
  getRateLimitDetail() {
    const t212State = this.t212Adapter.getRateLimitState();
    const lastCalls = Object.entries(t212State.lastCalls).map(([endpoint, state]) => ({
      endpoint,
      elapsedMs: state.elapsedMs,
      intervalMs: state.intervalMs,
      ready: state.elapsedMs >= state.intervalMs,
      readyInMs: Math.max(0, state.intervalMs - state.elapsedMs),
    }));
    return {
      provider: 'trading212',
      mode: this.t212Adapter.mode,
      circuitBreaker: {
        tripped: t212State.tracker.tripped,
        consecutive429s: t212State.tracker.consecutive429s,
        remaining: t212State.tracker.remaining,
        warning: t212State.tracker.warning,
      },
      endpoints: lastCalls,
      refreshPolicy: 'manual-only',
      timestamp: new Date().toISOString(),
    };
  }

  /** Find the instance ID for an adapter. */
  private findInstanceId(adapter: any): string | null {
    for (const [id, instance] of (this.adapterFactory as any).instances) {
      if (instance === adapter) return id;
    }
    return null;
  }

  @Get('health')
  @UseInterceptors(new CacheInterceptor(60000))
  @ApiOperation({ summary: 'Get provider connectivity and credential health' })
  @ApiOkResponse({ description: 'Provider health state list' })
  health() {
    return this.providersService.getHealth();
  }

  @Post('health/:provider')
  @ApiOperation({
    summary: 'Update provider health state manually or via adapter hooks',
  })
  @ApiOkResponse({ description: 'Updated provider health record' })
  updateHealth(
    @Param('provider') provider: string,
    @Query('status') status = 'healthy',
    @Query('message') message?: string,
    @Query('latencyMs', new ParseIntPipe({ optional: true }))
    latencyMs?: number,
  ) {
    return this.providersService.updateHealth(
      provider,
      status,
      message,
      latencyMs ?? null,
    );
  }

  @Get('test/:provider/:symbol')
  @ApiOperation({ summary: 'Test adapter getQuote method with a symbol' })
  @ApiOkResponse({
    description: 'Quote data from the specified provider adapter',
  })
  async testAdapter(
    @Param('provider') providerId: string,
    @Param('symbol') symbol: string,
  ) {
    const adapter = this.providersService.getAdapter(providerId);

    if (!adapter) {
      return {
        error: 'Provider adapter not found',
        providerId,
        availableProviders: ['alpaca', 'alphavantage', 'trading212'],
      };
    }

    const quote = await adapter.getQuote(symbol);
    const healthOk = await adapter.healthCheck();

    return {
      provider: providerId,
      adapterName: adapter.name,
      symbol,
      quote,
      healthOk,
      timestamp: new Date().toISOString(),
    };
  }
}
