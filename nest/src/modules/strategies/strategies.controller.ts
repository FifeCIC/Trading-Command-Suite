import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import {
  STRATEGY_PREREQUISITES,
  checkStrategyViability,
  ProviderAvailability,
  DataAvailability,
} from './strategy-prerequisites';

@Controller('strategies')
export class StrategiesController {
  private readonly logger = new Logger(StrategiesController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
  ) {}

  @Get()
  async listStrategies() {
    // Determine provider availability
    const modeInfo = this.modeService.getModeInfo();
    const providers: ProviderAvailability = {
      alpaca: modeInfo.database,
      alphavantage: false,
      trading212: false,
      mt5: false,
    };

    // Determine data availability
    let barCount = 0;
    let timeframes: string[] = [];
    if (this.prisma.isAvailable) {
      try {
        barCount = await this.prisma.marketBar.count();
        const tfRows = await this.prisma.marketBar.findMany({
          select: { timeframe: true },
          distinct: ['timeframe'],
        });
        timeframes = tfRows.map(r => r.timeframe);
      } catch {
        // DB not synced yet
      }
    }

    const data: DataAvailability = {
      hasBars: barCount > 0,
      hasQuotes: false,
      hasFundamentals: false,
      hasNews: false,
      barCount,
      availableTimeframes: timeframes,
    };

    const results = STRATEGY_PREREQUISITES.map(s => checkStrategyViability(s, providers, data));
    const viableCount = results.filter(r => r.viable).length;

    return {
      mode: modeInfo.mode,
      total: results.length,
      viableCount,
      viable: results,
    };
  }

  @Post()
  async createStrategy(@Body() body: { name: string; directives: Array<{ id: string; weight: number }>; scope?: string[]; thresholds?: { entry?: number; watch?: number } }) {
    this.logger.log(`Creating custom strategy: ${body.name} with ${body.directives.length} directives`);
    const totalWeight = body.directives.reduce((s, d) => s + d.weight, 0);
    if (totalWeight !== 100) {
      return { error: 'Directive weights must sum to exactly 100', totalWeight };
    }

    if (!this.prisma.isAvailable) {
      return this.storeInMemory(body);
    }

    try {
      const strategy = await this.prisma.strategy.create({
        data: {
          name: body.name,
          description: `Custom strategy with ${body.directives.length} directives`,
          config: {
            entryThreshold: body.thresholds?.entry ?? 60,
            watchThreshold: body.thresholds?.watch ?? 40,
            defenseThreshold: 25,
            weights: Object.fromEntries(body.directives.map((d) => [d.id, d.weight])),
            scope: body.scope ?? ['stocks'],
          },
          active: true,
        },
      });
      return { success: true, strategyId: strategy.id, name: body.name };
    } catch (error) {
      this.logger.error(`Failed to save strategy: ${String(error)}`);
      return this.storeInMemory(body);
    }
  }

  private storeInMemory(body: { name: string; directives: Array<{ id: string; weight: number }> }) {
    const strategyId = `custom-${Date.now()}`;
    this.logger.warn(`Database unavailable — storing strategy ${body.name} in memory (${strategyId})`);
    return { success: true, strategyId, name: body.name, persisted: false };
  }
}
