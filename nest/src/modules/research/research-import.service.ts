import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { NasdaqEarningsService } from './nasdaq-earnings.service';
import { EarningsImportSettingsService, EarningsImportSettings } from './earnings-import-settings.service';
import { EarningsEvent } from '../providers/interfaces/provider-adapter.interface';

@Injectable()
export class ResearchImportService {
  private readonly logger = new Logger(ResearchImportService.name);
  private finnhubUnavailableLogged = false;
  private earningsImportRunning = false;

  /** Returns the Finnhub adapter, or null — logs once if unavailable. */
  private getFinnhub(): any {
    const adapter = this.providers.getAdapter('finnhub');
    if (!adapter && !this.finnhubUnavailableLogged) {
      this.logger.warn('Finnhub adapter not available — earnings imports will use the Nasdaq fallback (logged once)');
      this.finnhubUnavailableLogged = true;
    }
    return adapter;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly nasdaqEarnings: NasdaqEarningsService,
    private readonly settingsService: EarningsImportSettingsService,
  ) {}

  /**
   * Daily at 07:00 — fetch earnings calendar and upsert into DB, honoring the
   * user's import settings (scope / min market cap / session / horizon).
   * `force=true` runs even when auto-import is disabled (manual trigger).
   */
  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async importEarningsCalendar(
    force = false,
  ): Promise<{
    skipped?: boolean;
    reason?: string;
    inserted: number;
    updated: number;
    total: number;
    fetched: number;
    dropped: Record<string, number>;
    source: string | null;
    filters: Record<string, unknown>;
  }> {
    if (this.earningsImportRunning) {
      this.logger.warn('Earnings import already running — skipping duplicate trigger');
      return { inserted: 0, updated: 0, total: 0, fetched: 0, dropped: {}, source: null, filters: {} };
    }

    const settings = await this.settingsService.getSettings();
    if (!force && !settings.autoImportEnabled) {
      this.logger.log('Earnings auto-import disabled in settings — skipping scheduled run');
      return { skipped: true, reason: 'Auto-import disabled in settings', inserted: 0, updated: 0, total: 0, fetched: 0, dropped: {}, source: null, filters: {} };
    }

    this.earningsImportRunning = true;
    this.settingsService.markRunning();
    this.logger.log(
      `Starting earnings calendar import (horizon=${settings.horizonMonths}m, scope=${settings.scope}, minCap=${settings.minMarketCap}, session=${settings.timeOfDay})...`,
    );
    const startTime = Date.now();

    try {
      const horizon = settings.horizonMonths;

      // ── Sources: Finnhub (primary, full horizon) + Nasdaq (keyless cross-check) ──
      const finnhub = this.getFinnhub();
      const events: EarningsEvent[] = [];
      const seenKeys = new Set<string>();
      let finnhubCount = 0;
      let nasdaqCount = 0;

      if (finnhub && typeof (finnhub as any).getEarningsCalendar === 'function') {
        const fhEvents: EarningsEvent[] = await (finnhub as any).getEarningsCalendar(undefined, horizon);
        for (const e of fhEvents || []) {
          events.push(e);
          seenKeys.add(`${e.symbol}|${e.reportDate}`);
        }
        finnhubCount = events.length;
      }

      const nasdaqEvents = await this.nasdaqEarnings.getCalendar(horizon);
      for (const e of nasdaqEvents) {
        const key = `${e.symbol}|${e.reportDate}`;
        if (seenKeys.has(key)) continue; // Finnhub already covers this event
        seenKeys.add(key);
        events.push(e);
        nasdaqCount++;
      }

      const source = events.length
        ? (finnhubCount > 0 && nasdaqCount > 0 ? 'finnhub+nasdaq' : finnhubCount > 0 ? 'finnhub' : 'nasdaq')
        : null;

      if (!source || events.length === 0) {
        this.logger.warn('Earnings import: no events from Finnhub or Nasdaq — nothing stored');
        return { inserted: 0, updated: 0, total: 0, fetched: 0, dropped: {}, source: null, filters: {} };
      }

      // ── Settings filters: scope → session → market cap ──
      const scopeSymbols = await this.settingsService.loadScopeSymbols(settings.scope);
      const { kept, stats } = this.settingsService.applyFilters(events, settings, scopeSymbols);
      if (kept.length === 0) {
        this.logger.warn(
          `Earnings import: settings filters removed all ${events.length} events (${JSON.stringify(stats)}) — nothing stored`,
        );
        const summary = {
          inserted: 0, updated: 0, total: 0, fetched: events.length,
          dropped: { ...stats }, source, filters: { scope: settings.scope, minMarketCap: settings.minMarketCap, timeOfDay: settings.timeOfDay },
          at: new Date().toISOString(), durationMs: Date.now() - startTime,
        };
        await this.settingsService.recordLastImport(summary);
        return summary;
      }

      let inserted = 0;
      let updated = 0;

      // Upsert in concurrent batches of 20 — sequential Prisma upserts of 5k+
      // events exceed the HTTP timeout when triggered manually.
      const upsertOne = async (evt: EarningsEvent): Promise<'inserted' | 'updated' | 'skipped'> => {
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
          return 'updated';
        }
        await this.prisma.earningsEvent.create({ data });
        return 'inserted';
      };

      const BATCH = 20;
      for (let i = 0; i < kept.length; i += BATCH) {
        const results = await Promise.all(
          kept.slice(i, i + BATCH).map((evt) =>
            upsertOne(evt).catch((err) => {
              this.logger.warn(`Earnings upsert failed for ${evt.symbol}: ${(err as Error).message}`);
              return 'skipped' as const;
            }),
          ),
        );
        for (const r of results) {
          if (r === 'inserted') inserted++;
          else if (r === 'updated') updated++;
        }
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.log(
        `Earnings import complete (${source}): ${inserted} new, ${updated} updated, ${kept.length} stored of ${events.length} fetched (${JSON.stringify(stats)} dropped, ${duration}s)`,
      );
      const summary = {
        inserted,
        updated,
        total: kept.length,
        fetched: events.length,
        dropped: { ...stats },
        source,
        filters: { scope: settings.scope, minMarketCap: settings.minMarketCap, timeOfDay: settings.timeOfDay, horizonMonths: settings.horizonMonths },
        at: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      };
      await this.settingsService.recordLastImport(summary);
      return summary;
    } catch (err) {
      this.logger.error(`Earnings import failed: ${(err as Error).message}`);
      return { inserted: 0, updated: 0, total: 0, fetched: 0, dropped: {}, source: null, filters: {} };
    } finally {
      this.earningsImportRunning = false;
      this.settingsService.markIdle();
    }
  }

  /**
   * Non-blocking trigger for the manual import endpoint. Manual triggers run
   * even when auto-import is disabled (force=true).
   * Returns false when an import is already running.
   */
  triggerEarningsImport(): boolean {
    if (this.earningsImportRunning) return false;
    this.importEarningsCalendar(true)
      .then((summary) => this.logger.log(`Manual earnings import finished: ${JSON.stringify(summary)}`))
      .catch((err) => this.logger.error(`Manual earnings import failed: ${(err as Error).message}`));
    return true;
  }

  /** Import progress for the status endpoint — cheap single count query. */
  async getEarningsImportStatus(): Promise<{
    running: boolean;
    storedEvents: number;
    settings: EarningsImportSettings;
    lastImport: Record<string, unknown> | null;
  }> {
    let storedEvents = 0;
    try {
      const count: any = await this.prisma.earningsEvent.count();
      storedEvents = count ?? 0;
    } catch { /* table may not exist */ }
    return {
      running: this.earningsImportRunning,
      storedEvents,
      settings: await this.settingsService.getSettings(),
      lastImport: await this.settingsService.getLastImport(),
    };
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

      const finnhub = this.getFinnhub();
      if (!finnhub) return;

      let fetched = 0;
      for (const { ticker } of symbols) {
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
      const finnhub = this.getFinnhub();
      if (!finnhub) return;

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
   * Bulk import — fetch insider transactions for ALL tracked symbols.
   * No longer cron-scheduled. Called manually or via admin endpoint.
   * Finnhub /stock/insider-transactions (free tier).
   */
  async importInsiderTransactionsBulk() {
    this.logger.log('Starting bulk insider transaction import...');
    const startTime = Date.now();

    try {
      const finnhub = this.getFinnhub();
      if (!finnhub) return;

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
      this.logger.log(`Bulk insider transaction import complete: ${totalInserted} new records (${duration}s)`);
    } catch (err) {
      this.logger.error(`Bulk insider transaction import failed: ${(err as Error).message}`);
    }
  }

  /**
   * On-demand single-symbol import — called by insider-activity directive when DB data is missing/stale.
   * Fetches insider transactions for one symbol and upserts into InsiderTransaction table.
   * Returns the count of new records inserted.
   */
  async importInsiderTransactionsForSymbol(symbol: string): Promise<number> {
    try {
      const finnhub = this.getFinnhub();
      if (!finnhub) return 0;

      const transactions = await (finnhub as any).getInsiderTransactions(symbol);
      if (!transactions || !Array.isArray(transactions)) return 0;

      let inserted = 0;
      for (const t of transactions) {
        const existing = await this.prisma.insiderTransaction.findFirst({
          where: {
            symbol: symbol.toUpperCase(),
            name: t.name,
            transactionDate: new Date(t.transactionDate),
            transactionCode: t.transactionCode,
          },
        });
        if (existing) continue;

        await this.prisma.insiderTransaction.create({
          data: {
            symbol: symbol.toUpperCase(),
            name: t.name,
            share: t.share ?? 0,
            change: t.change ?? 0,
            transactionDate: new Date(t.transactionDate),
            transactionCode: t.transactionCode,
            filingDate: t.filingDate ? new Date(t.filingDate) : new Date(),
            currency: t.currency || 'USD',
          },
        });
        inserted++;
      }

      if (inserted > 0) {
        this.logger.log(`On-demand insider import for ${symbol}: ${inserted} new records`);
      }
      return inserted;
    } catch (err) {
      this.logger.warn(`On-demand insider import failed for ${symbol}: ${(err as Error).message}`);
      return 0;
    }
  }

  /**
   * Bulk import — fetch company metrics for ALL tracked symbols.
   * No longer cron-scheduled. Called manually or via admin endpoint.
   * Finnhub /stock/metric (free tier).
   */
  async importCompanyMetricsBulk() {
    this.logger.log('Starting bulk company metrics import...');
    const startTime = Date.now();

    try {
      const finnhub = this.getFinnhub();
      if (!finnhub) return;

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
      this.logger.log(`Bulk company metrics import complete: ${fetched} symbols (${duration}s)`);
    } catch (err) {
      this.logger.error(`Bulk company metrics import failed: ${(err as Error).message}`);
    }
  }

  /**
   * On-demand single-symbol import — called by dilution-impact directive when DB data is missing/stale.
   * Fetches company metrics for one symbol and upserts into CompanyMetric table.
   * Returns true if data was successfully fetched and stored.
   */
  async importCompanyMetricsForSymbol(symbol: string): Promise<boolean> {
    try {
      const finnhub = this.getFinnhub();
      if (!finnhub) return false;

      const metrics = await (finnhub as any).getCompanyMetrics(symbol);
      if (!metrics) return false;

      await this.prisma.companyMetric.upsert({
        where: { symbol: symbol.toUpperCase() },
        update: {
          sharesOutstanding: metrics.sharesOutstanding ?? 0,
          shareChange3m: metrics.shareChange3m ?? 0,
          shareChange12m: metrics.shareChange12m ?? 0,
          marketCap: metrics.marketCap ?? 0,
          fetchedAt: new Date(),
        },
        create: {
          symbol: symbol.toUpperCase(),
          sharesOutstanding: metrics.sharesOutstanding ?? 0,
          shareChange3m: metrics.shareChange3m ?? 0,
          shareChange12m: metrics.shareChange12m ?? 0,
          marketCap: metrics.marketCap ?? 0,
          source: metrics.source || 'finnhub',
        },
      });

      this.logger.log(`On-demand company metrics import for ${symbol}: stored`);
      return true;
    } catch (err) {
      this.logger.warn(`On-demand company metrics import failed for ${symbol}: ${(err as Error).message}`);
      return false;
    }
  }
}
