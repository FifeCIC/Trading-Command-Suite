import { Controller, Get, Post, Patch, Delete, Param, Body, Logger } from '@nestjs/common';
import { TradingStrategyService } from './trading-strategy.service';
import { DEFAULT_TRADING_STRATEGIES } from './strategy-seed-data';

@Controller('trading/strategies')
export class TradingStrategyController {
  private readonly logger = new Logger(TradingStrategyController.name);
  constructor(private readonly service: TradingStrategyService) {}

  @Get()
  async findAll() { return this.service.findAll(); }

  @Get('with-ratios')
  async findAllWithRatios() { return this.service.findAllWithRatios(); }

  /**
   * POST /api/trading/strategies/seed — idempotent seed of default strategies.
   * Creates scoring strategies + trading strategies for all session pairs.
   */
  @Post('seed')
  async seedDefaults() {
    return this.service.seedDefaults(DEFAULT_TRADING_STRATEGIES);
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

  @Get('risk-limits')
  getRiskLimits() {
    return {
      maxPositionSize: parseFloat(process.env.MT5_MAX_POSITION_SIZE || '1.0'),
      maxDailyLoss: parseFloat(process.env.MT5_MAX_DAILY_LOSS || '100'),
      maxOpenPositions: parseInt(process.env.MT5_MAX_OPEN_POSITIONS || '5', 10),
      note: 'These are server-enforced hard limits. Change in nest/.env and restart NestJS.',
    };
  }
}
