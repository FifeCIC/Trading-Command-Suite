import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { ProvidersService } from '../providers/providers.service';

@Injectable()
export class ResearchImportService {
  private readonly logger = new Logger(ResearchImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Daily at 07:00 — fetch earnings calendar for next 3 months and upsert into DB.
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async importEarningsCalendar() {
    this.logger.log('Starting daily earnings calendar import...');
    const startTime = Date.now();

    try {
      const finnhub = this.providers.getAdapter('finnhub');
      if (!finnhub) {
        this.logger.warn('Finnhub adapter not available, skipping earnings import');
        return;
      }
      const events = await (finnhub as any).getEarningsCalendar(undefined, 3);
      let inserted = 0;
      let updated = 0;

      for (const evt of events) {
        const existing = await this.prisma.earningsEvent.findFirst({
          where: {
            symbol: evt.symbol,
            reportDate: new Date(evt.reportDate),
            source: evt.source,
          },
        });

        const data = {
          symbol: evt.symbol,
          name: evt.name || null,
          reportDate: new Date(evt.reportDate),
          fiscalDateEnding: evt.fiscalDateEnding ? new Date(evt.fiscalDateEnding) : null,
          epsEstimate: evt.epsEstimate ?? null,
          epsActual: evt.epsActual ?? null,
          revenueEstimate: evt.revenueEstimate ?? null,
          revenueActual: evt.revenueActual ?? null,
          surprisePercent: evt.surprisePercent ?? null,
          timeOfDay: evt.timeOfDay || null,
          currency: evt.currency || null,
          source: evt.source,
        };

        if (existing) {
          await this.prisma.earningsEvent.update({
            where: { id: existing.id },
            data,
          });
          updated++;
        } else {
          await this.prisma.earningsEvent.create({ data });
          inserted++;
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `Earnings import complete: ${inserted} new, ${updated} updated, ${events.length} total (${duration}s)`,
      );
    } catch (err) {
      this.logger.error(`Earnings import failed: ${(err as Error).message}`);
    }
  }

  /**
   * Weekly on Sunday at 08:00 — fetch analyst price targets.
   * NOTE: Finnhub free tier does NOT include price-target data.
   * This will log a warning until a premium key is configured.
   */
  @Cron('0 8 * * 0') // Sunday at 08:00
  async importAnalystTargets() {
    this.logger.log('Starting weekly analyst target import...');
    const startTime = Date.now();

    try {
      // Get all tracked symbols
      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });

      let fetched = 0;
      for (const { ticker } of symbols) {
        const finnhub = this.providers.getAdapter('finnhub');
        if (!finnhub) continue;
        const target = await (finnhub as any).getPriceTarget(ticker);
        if (!target) continue;

        const data = {
          symbol: target.symbol,
          companyName: target.companyName || null,
          currentPrice: target.currentPrice,
          avgTarget: target.avgTarget,
          highTarget: target.highTarget,
          lowTarget: target.lowTarget,
          consensus: target.consensus,
          analystCount: target.analystCount ?? null,
          upside: target.upside ?? null,
          source: target.source,
          fetchedAt: new Date(),
        };

        const existing = await this.prisma.analystTarget.findFirst({
          where: { symbol: target.symbol, source: target.source },
        });

        if (existing) {
          await this.prisma.analystTarget.update({
            where: { id: existing.id },
            data,
          });
        } else {
          await this.prisma.analystTarget.create({ data });
        }
        fetched++;
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      if (fetched === 0) {
        this.logger.warn(
          'Analyst target import: 0 symbols fetched. Finnhub free tier does not include price-target data. Upgrade to premium for this feature.',
        );
      } else {
        this.logger.log(
          `Analyst target import complete: ${fetched} symbols (${duration}s)`,
        );
      }
    } catch (err) {
      this.logger.error(`Analyst target import failed: ${(err as Error).message}`);
    }
  }
}
