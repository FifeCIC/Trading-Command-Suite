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
import { PositionSyncService } from './position-sync.service';
import { CacheInterceptor } from '../../common/interceptors/cache.interceptor';
import { Trading212Adapter } from './adapters/trading212.adapter';
import { CapitalComAdapter } from './adapters/capital-com.adapter';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly adapterFactory: AdapterFactory,
    private readonly t212Adapter: Trading212Adapter,
    private readonly capitalComAdapter: CapitalComAdapter,
    private readonly rateLimitGovernor: RateLimitGovernor,
    private readonly degradation: ProviderDegradationService,
    private readonly positionSync: PositionSyncService,
  ) {}

  /**
   * POST /api/providers/repair-pnl — re-price rows finalised as "position vanished" (#1014).
   *
   * ⚠️ DELIBERATELY NOT PART OF THE AUTOMATION LOOP. It rewrites historical rows, and the repo's own
   * rule is that the record is the evidence — a rewrite is an act with a count in the log, not a side
   * effect of a 2-minute tick. The normal pass cannot reach these rows at all (it filters
   * `status='open'`), which is why a separate, explicit call exists rather than a flag.
   *
   * Idempotent: a repaired row has `pnlInvalid` cleared and is not selected again. Returns the counts
   * so "nothing to do" is distinguishable from "nothing happened".
   */
  @Post('repair-pnl')
  @ApiOperation({ summary: 'Re-price closed trades whose P&L was never computable (#1014)' })
  async repairPnl(
    @Query('provider') provider = 'mt5',
    @Query('accountId') accountId?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Number(limit);
    return this.positionSync.repairClosedTradesWithUnknownPnl(
      provider,
      accountId ?? null,
      Number.isFinite(n) && n > 0 ? n : undefined,
    );
  }

  /**
   * GET /api/providers/exit-data/gaps (#1093) — closed trades with no attributed exit record.
   * The UI renders its recovery notice + button only while `count > 0`.
   */
  @Get('exit-data/gaps')
  @ApiOperation({ summary: 'Closed trades whose exit record is missing or unattributed (#1093)' })
  async exitDataGaps(@Query('provider') provider = 'mt5') {
    return this.positionSync.exitDataGaps(provider);
  }

  /**
   * POST /api/providers/exit-data/recover (#1093) — the optional in-app recovery attempt.
   * The owner's direction, 2026-10-08: the app owns this, not a terminal ritual. The response is
   * honest about what could not be recovered — see `note`.
   */
  @Post('exit-data/recover')
  @ApiOperation({ summary: 'Ask the broker terminals for missing deal history, then re-price what is readable (#1093)' })
  async recoverExitData(@Query('provider') provider = 'mt5') {
    return this.positionSync.recoverExitDataGaps(provider);
  }

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

  /**
   * GET /api/providers/rate-limits — live rate-limit state per provider (#940).
   *
   * ⚠️ This route used to return `{"adapters":[]}`: it read only the factory's own trackers, which
   * nothing ever registers. The state was real and available — in the RateLimitGovernor (#744) —
   * it just was not read. `adapters` now carries governor state (tracker entries override and are
   * marked `source`), and `registered` names every registered adapter so the COUNT has one source.
   */
  @Get('rate-limits')
  @ApiOperation({ summary: 'Get rate limit state for all provider adapters' })
  @ApiOkResponse({ description: 'Rate limit states with tripped/warning flags' })
  getRateLimits() {
    const states = this.adapterFactory.getAllRateLimits();
    const active = this.adapterFactory.getActive();
    const activeId = active ? this.findInstanceId(active) : null;
    return {
      adapters: states,
      registered: this.adapterFactory.listAdapters().map((c) => c.id),
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
      // ⚠️ #940 — this list is DERIVED from the registry, never typed. The literal it replaced
      // (['alpaca','alphavantage','trading212']) named two providers that were not registered and
      // omitted eight that were, so "available" read as "already supported" (see #697).
      return {
        error: 'Provider adapter not found',
        providerId,
        availableProviders: this.adapterFactory.listAdapters().map((c) => c.id),
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

  @Get('capital.com/account')
  @ApiOperation({ summary: 'Get Capital.com account details (balance, equity, margin)' })
  @ApiOkResponse({ description: 'Capital.com account summary' })
  async getCapitalComAccount() {
    try {
      const account = await this.capitalComAdapter.getAccount();
      return account ?? { connected: false, mode: 'demo', brokerName: 'Capital.com' };
    } catch (err) {
      return { connected: false, error: (err as Error).message, mode: 'demo', brokerName: 'Capital.com' };
    }
  }
}
