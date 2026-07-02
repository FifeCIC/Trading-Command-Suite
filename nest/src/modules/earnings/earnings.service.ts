import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProvidersService } from '../providers/providers.service';

export interface ImportResult {
  imported: number;
  skipped: number;
  total: number;
  horizonMonths: number;
  logId?: number;
}

@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);

  constructor(
    private readonly providers: ProvidersService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Fetch ALL upcoming earnings from Alpha Vantage in ONE API call
   * and bulk upsert to the EarningsEvent table.
   */
  async importCalendar(horizonMonths = 3): Promise<ImportResult> {
    const startedAt = Date.now();
    let rateLimitHits = 0;
    let errorMessage: string | null = null;

    const alpha = this.providers.getAdapter('alphavantage');
    const events = alpha && typeof (alpha as any).getEarningsCalendar === 'function'
      ? await (alpha as any).getEarningsCalendar(undefined, horizonMonths)
      : [];

    if (!events.length) {
      this.logger.warn('No earnings events returned from Alpha Vantage');
      // Log the empty/failed import
      const log = await this.prisma.dataImportLog.create({
        data: {
          dataType: 'earnings',
          source: 'alphavantage',
          status: 'failed',
          recordsFetched: 0,
          recordsStored: 0,
          recordsSkipped: 0,
          errorMessage: 'No earnings events returned from Alpha Vantage',
          durationMs: Date.now() - startedAt,
        },
      });
      return { imported: 0, skipped: 0, total: 0, horizonMonths, logId: log.id };
    }

    let imported = 0;
    let skipped = 0;

    for (const event of events) {
      try {
        const reportDate = new Date(event.reportDate);
        if (isNaN(reportDate.getTime())) {
          skipped++;
          continue;
        }

        // Check if this symbol+date combination already exists
        const existing = await this.prisma.earningsEvent.findFirst({
          where: { symbol: event.symbol, reportDate },
          select: { id: true },
        });

        if (existing) {
          await this.prisma.earningsEvent.update({
            where: { id: existing.id },
            data: {
              epsEstimate: event.epsEstimate ?? null,
              name: event.name || undefined,
              source: event.source || 'alphavantage',
            },
          });
        } else {
          await this.prisma.earningsEvent.create({
            data: {
              symbol: event.symbol,
              name: event.name || null,
              reportDate,
              fiscalDateEnding: event.fiscalDateEnding ? new Date(event.fiscalDateEnding) : null,
              epsEstimate: event.epsEstimate ?? null,
              epsActual: event.epsActual ?? null,
              revenueEstimate: event.revenueEstimate ?? null,
              revenueActual: event.revenueActual ?? null,
              surprisePercent: event.surprisePercent ?? null,
              timeOfDay: event.timeOfDay || null,
              currency: event.currency || 'USD',
              source: event.source || 'alphavantage',
            },
          });
        }
        imported++;
      } catch (err) {
        skipped++;
        if (!errorMessage) errorMessage = (err as Error).message;
      }
    }

    const durationMs = Date.now() - startedAt;
    const status = imported > 0 ? 'success' : 'partial';

    // Record the import in DataImportLog
    const log = await this.prisma.dataImportLog.create({
      data: {
        dataType: 'earnings',
        source: 'alphavantage',
        status,
        recordsFetched: events.length,
        recordsStored: imported,
        recordsSkipped: skipped,
        rateLimitHits,
        durationMs,
        errorMessage,
      },
    });

    this.logger.log(
      `Earnings import complete: ${imported} imported, ${skipped} skipped (${events.length} total, horizon=${horizonMonths}m) [log #${log.id}]`,
    );

    return { imported, skipped, total: events.length, horizonMonths, logId: log.id };
  }

  /**
   * Read earnings from DB — zero API calls.
   */
  async getCalendar(days = 90) {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + days);

    return this.prisma.earningsEvent.findMany({
      where: {
        reportDate: { gte: start, lte: end },
      },
      orderBy: { reportDate: 'asc' },
    });
  }

  /**
   * Get next earnings date for a specific symbol.
   */
  async getForSymbol(symbol: string) {
    return this.prisma.earningsEvent.findFirst({
      where: {
        symbol: symbol.toUpperCase(),
        reportDate: { gte: new Date() },
      },
      orderBy: { reportDate: 'asc' },
    });
  }

  /**
   * Check if stored earnings data is stale (>7 days since last fetch).
   */
  async isStale(): Promise<boolean> {
    const latest = await this.prisma.earningsEvent.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    if (!latest) return true;

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return latest.createdAt < sevenDaysAgo;
  }

  /**
   * Auto-import if data is stale. Safe to call on startup.
   */
  async refreshIfStale(): Promise<ImportResult | null> {
    const stale = await this.isStale();
    if (!stale) {
      this.logger.log('Earnings data is fresh — skipping import');
      return null;
    }
    this.logger.log('Earnings data is stale — auto-importing...');
    return this.importCalendar(3);
  }
}
