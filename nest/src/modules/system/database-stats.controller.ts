import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * Database Table Stats — provides last insert timestamps and row counts
 * for the Database Tables page (/data/database-tables).
 *
 * GET /api/database/table-stats
 */
@Controller('database')
export class DatabaseStatsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('table-stats')
  async getTableStats() {
    // Models with timestamps — maps Prisma model name → SQL table name
    const models = [
      'Symbol',
      'Strategy',
      'Directive',
      'Score',
      'Signal',
      'MarketBar',
      'ImportRun',
      'ProviderHealth',
      'ApiActivityLog',
      'ApiTrace',
      'FaqEntry',
      'CorrelationPair',
      'SymbolCalibration',
      'NewsSource',
      'ArticleSample',
      'PublishingPattern',
      'NewsArticle',
      'NewsImportRun',
      'TickRecordingSession',
      'BacktestRun',
      'BacktestTrade',
      'SymbolTechnical',
      'StrategyMeta',
      'StrategyPerformance',
      'Watchlist',
      'UserPreferences',
      'MarketSessions',
      'Order',
      'OrderExecution',
      'Position',
      'Trade',
    ];

    const tables: Record<string, { lastInsert?: string; lastUpdate?: string; rowCount?: number }> = {};

    // Query each table in parallel using raw SQL for efficiency
    const results = await Promise.allSettled(
      models.map(async (model) => {
        // Prisma table names are the model name (case-sensitive)
        const rows = await this.prisma.$queryRawUnsafe<Array<{
          lastInsert: Date | null;
          lastUpdate: Date | null;
          rowCount: number;
        }>>(
          `SELECT MAX(createdAt) as lastInsert, MAX(updatedAt) as lastUpdate, COUNT(*) as rowCount FROM \`${model}\``
        );
        return { model, data: rows[0] };
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { model, data } = result.value;
        tables[model] = {
          lastInsert: data?.lastInsert ? new Date(data.lastInsert).toISOString() : undefined,
          lastUpdate: data?.lastUpdate ? new Date(data.lastUpdate).toISOString() : undefined,
          rowCount: data?.rowCount ?? 0,
        };
      }
      // Silently skip tables that don't exist yet
    }

    return { tables };
  }
}
