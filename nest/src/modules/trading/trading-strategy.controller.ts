import { Controller, Get, Post, Patch, Delete, Param, Body, Logger } from '@nestjs/common';
import { TradingStrategyService } from './trading-strategy.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';

@Controller('trading/strategies')
export class TradingStrategyController {
  private readonly logger = new Logger(TradingStrategyController.name);
  constructor(private readonly service: TradingStrategyService, private readonly settings: SettingsResolverService) {}

  @Get()
  async findAll() { return this.service.findAll(); }

  @Get('with-ratios')
  async findAllWithRatios() { return this.service.findAllWithRatios(); }

  /** GET /api/trading/strategies/queues — all pending bot queues (#714 Stage 2). */
  @Get('queues')
  async getAllQueues() { return this.service.getAllQueues(); }

  /**
   * POST /api/trading/strategies/seed — idempotent seed of default strategies.
   * Creates scoring strategies + trading strategies for all session pairs.
   */
  @Post('seed')
  async seedDefaults() {
    return this.service.seedDefaults(DEFAULT_TRADING_STRATEGIES);
  }

  /**
   * GET /api/trading/strategies/risk-limits — server-enforced hard limits.
   *
   * ⚠️ MUST BE DECLARED ABOVE `@Get(':id')` (2026-09-16).
   * It was at the BOTTOM of this controller, below the `:id` route, and Express matches in
   * declaration order — so every request for `risk-limits` was captured by `findOne('risk-limits')`,
   * found no strategy with that id, and returned 200 with an EMPTY BODY. No error, no 404, just
   * nothing: the "Server-Enforced Hard Limits" panel in Settings could never render, and every
   * build was green while it was missing.
   *
   * Same shape as every other silent failure in this repo — a plausible-looking call that
   * succeeds and returns nothing. A 200 with an empty body is not evidence the endpoint exists.
   */
  @Get('risk-limits')
  async getRiskLimits() {
    return {
      maxPositionSize: await this.settings.get<number>('risk.maxPositionSize'),
      maxDailyLoss: await this.settings.get<number>('risk.maxDailyLoss'),
      maxOpenPositions: await this.settings.get<number>('risk.maxOpenPositions'),
      note: 'Server-enforced hard limits, read LIVE from global_setting (risk.*). Change them in Settings; no restart needed. Provenance per value: GET /api/system/settings/registry.',
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Post()
  async create(@Body() body: any) { return this.service.create(body); }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: any) { return this.service.update(id, body); }

  @Delete(':id')
  async remove(@Param('id') id: string) { return this.service.remove(id); }

  @Post(':id/toggle')
  async toggle(@Param('id') id: string) { return this.service.toggle(id); }

  /** GET /api/trading/strategies/:id/protocols — subscription list (#712). */
  @Get(':id/protocols')
  async getProtocols(@Param('id') id: string) {
    return this.service.getProtocolSubscriptions(id);
  }

  /** POST /api/trading/strategies/:id/protocols — subscribe a protocol (#712). */
  @Post(':id/protocols')
  async addProtocol(@Param('id') id: string, @Body() body: { protocolId: string; role?: string }) {
    return this.service.addProtocolSubscription(id, body.protocolId, body.role ?? 'long');
  }

  /** DELETE /api/trading/strategies/:id/protocols/:subId — remove a subscription (#712). */
  @Delete(':id/protocols/:subId')
  async removeProtocol(@Param('id') id: string, @Param('subId') subId: string) {
    return this.service.removeProtocolSubscription(id, subId);
  }

  /** GET /api/trading/strategies/:id/queue — pending signal queue (#714). */
  @Get(':id/queue')
  async getQueue(@Param('id') id: string) {
    return this.service.getSignalQueue(id);
  }

  @Post(':id/evaluate')
  async evaluate(@Param('id') id: string) {
    try {
      return await this.service.evaluate(id);
    } catch (err: any) {
      this.logger.error(`Evaluate failed: ${err.message}`, err.stack);
      return { error: err.message, stack: err.stack?.split('\n').slice(0, 3) };
    }
  }

  @Post(':id/execute')
  async execute(@Param('id') id: string) {
    try {
      return await this.service.execute(id);
    } catch (err: any) {
      this.logger.error(`Execute failed: ${err.message}`, err.stack);
      return { error: err.message, stack: err.stack?.split('\n').slice(0, 3) };
    }
  }
}
