import { Controller, Get, Logger } from '@nestjs/common';
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
}
