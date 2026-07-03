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

  /**
   * Every 6 hours — fetch social sentiment for all tracked symbols.
   * Finnhub /stock/social-sentiment (free tier).
   * Stores in SocialMention table for use by social-buzz directive.
   */
  @Cron('0 */6 * * *') // Every 6 hours
  async importSocialSentiment() {
    this.logger.log('Starting social sentiment import...');
    const startTime = Date.now();

    try {
      const finnhub = this.providers.getAdapter('finnhub');
      if (!finnhub) {
        this.logger.warn('Finnhub adapter not available, skipping social sentiment import');
        return;
      }

      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });

      let fetched = 0;
      for (const { ticker } of symbols) {
        try {
          const data = await (finnhub as any).getSocialSentiment(ticker);
          if (!data) continue;

          await this.prisma.socialMention.create({
            data: {
              symbol: ticker,
              redditMentions: data.redditMentions ?? 0,
              redditSentiment: data.redditSentiment ?? 0,
              twitterMentions: data.twitterMentions ?? 0,
              twitterSentiment: data.twitterSentiment ?? 0,
              totalMentions: data.totalMentions ?? 0,
              avgSentiment: data.avgSentiment ?? 0,
              source: data.source || 'finnhub',
            },
          });
          fetched++;
        } catch (symbolErr) {
          this.logger.warn(`Social sentiment fetch failed for ${ticker}: ${(symbolErr as Error).message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Social sentiment import complete: ${fetched} symbols (${duration}s)`);
    } catch (err) {
      this.logger.error(`Social sentiment import failed: ${(err as Error).message}`);
    }
  }

  /**
   * Every 12 hours — fetch insider transactions for all tracked symbols.
   * Finnhub /stock/insider-transactions (free tier).
   * Stores in InsiderTransaction table for use by insider-activity directive.
   */
  @Cron('0 */12 * * *') // Every 12 hours
  async importInsiderTransactions() {
    this.logger.log('Starting insider transaction import...');
    const startTime = Date.now();

    try {
      const finnhub = this.providers.getAdapter('finnhub');
      if (!finnhub) {
        this.logger.warn('Finnhub adapter not available, skipping insider transaction import');
        return;
      }

      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });

      let totalInserted = 0;
      for (const { ticker } of symbols) {
        try {
          const transactions = await (finnhub as any).getInsiderTransactions(ticker);
          if (!transactions || !Array.isArray(transactions)) continue;

          for (const t of transactions) {
            // Skip if already stored
            const existing = await this.prisma.insiderTransaction.findFirst({
              where: {
                symbol: ticker,
                name: t.name,
                transactionDate: new Date(t.transactionDate),
                transactionCode: t.transactionCode,
              },
            });
            if (existing) continue;

            await this.prisma.insiderTransaction.create({
              data: {
                symbol: ticker,
                name: t.name,
                share: t.share ?? 0,
                change: t.change ?? 0,
                transactionDate: new Date(t.transactionDate),
                transactionCode: t.transactionCode,
                filingDate: t.filingDate ? new Date(t.filingDate) : new Date(),
                currency: t.currency || 'USD',
              },
            });
            totalInserted++;
          }
        } catch (symbolErr) {
          this.logger.warn(`Insider transaction fetch failed for ${ticker}: ${(symbolErr as Error).message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Insider transaction import complete: ${totalInserted} new records (${duration}s)`);
    } catch (err) {
      this.logger.error(`Insider transaction import failed: ${(err as Error).message}`);
    }
  }

  /**
   * Daily at 08:00 — fetch company metrics (share dilution, market cap) for all tracked symbols.
   * Finnhub /stock/metric (free tier).
   * Stores in CompanyMetric table for use by dilution-impact directive.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async importCompanyMetrics() {
    this.logger.log('Starting company metrics import...');
    const startTime = Date.now();

    try {
      const finnhub = this.providers.getAdapter('finnhub');
      if (!finnhub) {
        this.logger.warn('Finnhub adapter not available, skipping company metrics import');
        return;
      }

      const symbols = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });

      let fetched = 0;
      for (const { ticker } of symbols) {
        try {
          const metrics = await (finnhub as any).getCompanyMetrics(ticker);
          if (!metrics) continue;

          await this.prisma.companyMetric.upsert({
            where: { symbol: ticker },
            update: {
              sharesOutstanding: metrics.sharesOutstanding ?? 0,
              shareChange3m: metrics.shareChange3m ?? 0,
              shareChange12m: metrics.shareChange12m ?? 0,
              marketCap: metrics.marketCap ?? 0,
              fetchedAt: new Date(),
            },
            create: {
              symbol: ticker,
              sharesOutstanding: metrics.sharesOutstanding ?? 0,
              shareChange3m: metrics.shareChange3m ?? 0,
              shareChange12m: metrics.shareChange12m ?? 0,
              marketCap: metrics.marketCap ?? 0,
              source: metrics.source || 'finnhub',
            },
          });
          fetched++;
        } catch (symbolErr) {
          this.logger.warn(`Company metrics fetch failed for ${ticker}: ${(symbolErr as Error).message}`);
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(`Company metrics import complete: ${fetched} symbols (${duration}s)`);
    } catch (err) {
      this.logger.error(`Company metrics import failed: ${(err as Error).message}`);
    }
  }
}
