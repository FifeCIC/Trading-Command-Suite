import { Controller, Get, Post, Patch, Delete, Param, Body, Logger } from '@nestjs/common';
import { TradingStrategyService } from './trading-strategy.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';
import { BOT_RULES, LIVE_RULES, NOT_LIVE_RULES, ruleEnforcementCounts } from './bot-rules';

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
      // ⚠️ Added 2026-09-18 (#865/#863). `risk.maxPerSymbol` became a SETTING that day, so it
      // belongs in this response — the Settings page renders it as an enforced limit and read
      // `undefined * 100` before this, displaying `NaN%`. A panel headed "Server-Enforced Hard
      // Limits" must not omit one of the hard limits.
      maxPerSymbol: await this.settings.get<number>('risk.maxPerSymbol'),
      note: 'Server-enforced hard limits, read LIVE from global_setting (risk.*). Change them in Settings; no restart needed. Provenance per value: GET /api/system/settings/registry.',
    };
  }

  /**
   * GET /api/trading/strategies/bot-rules — WHAT A BOT IS, and what actually applies.
   *
   * ⚠️ DECLARED ABOVE `@Get(':id')`. This is the SECOND time this exact mistake was made in this
   * controller — `risk-limits` was ordered wrongly on 2026-09-16 and returned 200 with an EMPTY
   * BODY (a comment warning about it already existed, and this route was still written below the
   * `:id` route on 2026-09-17). A comment is not a guard. The class is now closed by
   * `route-order.spec.cjs`, which fails if any literal route in this file is declared after a
   * parameterised one.
   *
   * This endpoint is the honest counterpart to the create form. The form offers every column; this
   * says which ones can actually change a trade. Measured 2026-09-17: 8 of 29 behavioural columns
   * were enforced nowhere, yet the form still offered all of them, and nothing failed when the two
   * disagreed.
   */
  @Get('bot-rules')
  getBotRules() {
    return {
      counts: ruleEnforcementCounts(),
      /** Can block or shape a live trade. */
      live: LIVE_RULES,
      /** Might be assumed to apply, but does not — the list that matters. */
      notLive: NOT_LIVE_RULES,
      all: BOT_RULES,
      note:
        '`enforcement` is the axis that matters: live = can stop or shape a trade on the queue ' +
        'path; legacy-only = enforced ONLY on POST /:id/execute, so a UI action can behave ' +
        'differently to the loop; display-only = read but cannot affect a trade; none = no reader. ' +
        'Guarded by nest/scripts/validate-bot-rules.cjs, which fails the build if a behavioural ' +
        'column on trading_strategy has no declaration here — but note that check is STATIC: it ' +
        'proves ownership, not that a rule fires.',
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

  /**
   * POST /api/trading/strategies/:id/duplicate — copy a bot AND its protocol as the B of a pair.
   *
   * The copy is a complete, independent configuration: its own protocol (groups, entries,
   * symbol wiring, watchlists), its own scoring strategy, and its own subscriptions. Nothing is
   * shared with the source, so editing either side cannot change the other. It starts INACTIVE.
   * Lineage: the copy's `duplicatedFromId` names the source bot, and the copied protocol's
   * `derivedFrom` names the source protocol slug — the A/B link is read from those two fields.
   */
  @Post(':id/duplicate')
  async duplicate(@Param('id') id: string) { return this.service.duplicate(id); }

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
