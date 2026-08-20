/**
 * ScreenerService — catalyst ingestion from real feeds (#648).
 * =====================================================================
 * Maps REAL news and earnings data into ScreenerHits (the #645 contract):
 * attention events, not directional conviction — the Signals area consumes
 * these and scoring computes conviction later.
 *
 *   source='news'      ← NewsArticle rows (DB, imported by NewsImportService)
 *   source='earnings'  ← EarningsEvent rows (DB, imported by EarningsService)
 *
 * Each hit carries `rawPayloadRef` so "why did this surface" is always
 * answerable. Dedupe is per (source, ticker, rawPayloadRef).
 *
 * Runs on a 15-min cron + an initial pass at boot; POST /api/screener/ingest
 * triggers it manually.
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { NewsImportService } from '../news/news-import.service';
import { EarningsService } from '../earnings/earnings.service';

const IMPACT_BONUS: Record<string, number> = {
  high: 20,
  medium: 10,
  low: 0,
  minimal: -10,
};

@Injectable()
export class ScreenerService implements OnModuleInit {
  private readonly logger = new Logger(ScreenerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly newsImport: NewsImportService,
    private readonly earnings: EarningsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Initial ingestion shortly after boot (DB-only reads — no external calls).
    setTimeout(() => {
      this.runIngestion().catch((err) =>
        this.logger.warn(`Initial screener ingestion failed: ${err.message}`),
      );
    }, 10_000);
  }

  /** Scheduled ingestion — real feeds → ScreenerHit. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async scheduledIngestion(): Promise<void> {
    try {
      await this.runIngestion();
    } catch (err) {
      this.logger.warn(`Screener ingestion failed: ${(err as Error).message}`);
    }
  }

  /** Run both feed mappers. */
  async runIngestion() {
    const news = await this.ingestNews(300);
    const earnings = await this.ingestEarnings(90);
    this.logger.log(
      `Screener ingestion: news +${news.created}/${news.created + news.skipped}, earnings +${earnings.created}/${earnings.created + earnings.skipped}`,
    );
    return { news, earnings };
  }

  /**
   * Map real news into news-mention ScreenerHits from both live feeds:
   *  1. news_item — RSS items (fresh; ticker-matched by the scraper)
   *  2. newsarticle — Finnhub company news (may lag on the free tier)
   */
  async ingestNews(limit = 300): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    const bump = async (
      ticker: string,
      ref: string,
      strength: number,
      reliability: number,
      ts: Date,
    ) => {
      const t = String(ticker || '').trim().toUpperCase();
      if (!t || !ref) { skipped++; return; }
      if (await this.exists('news', t, ref)) { skipped++; return; }
      await this.prisma.screenerHit.create({
        data: {
          ticker: t,
          source: 'news',
          catalystType: 'news-mention',
          catalystStrength: strength,
          sourceReliability: reliability,
          rawPayloadRef: ref,
          timestamp: ts,
        },
      });
      created++;
    };

    // RSS items (fresh) — news_item table.
    try {
      const rss: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT url, symbols, severity, publishedAt FROM news_item
         WHERE symbols IS NOT NULL AND symbols <> ''
           AND publishedAt >= DATE_SUB(NOW(), INTERVAL 2 DAY)
         ORDER BY publishedAt DESC LIMIT ?`,
        limit,
      );
      for (const r of rss) {
        const strength = Math.min(100, Math.max(10, Number(r.severity) || 45));
        for (const sym of String(r.symbols).split(',').map((s) => s.trim()).filter(Boolean)) {
          await bump(sym, r.url, strength, 40, new Date(r.publishedAt));
        }
      }
    } catch { /* news_item table may not exist yet */ }

    // Finnhub company news — 30-day window (free tier can lag).
    const articles = await this.newsImport.getArticles({ days: 30, limit });
    for (const a of articles) {
      await bump(
        a.symbol,
        a.url,
        this.newsStrength(a),
        (a.source as any)?.reliabilityScore ?? 50,
        a.publishedAt ?? new Date(),
      );
    }
    return { created, skipped };
  }

  /** Map upcoming EarningsEvent rows into earnings-date ScreenerHits. */
  async ingestEarnings(days = 90): Promise<{ created: number; skipped: number }> {
    const events = await this.earnings.getCalendar(days);
    let created = 0;
    let skipped = 0;
    for (const e of events) {
      const ticker = String(e.symbol).toUpperCase();
      const ref = `calendar:${ticker}:${e.reportDate.toISOString().slice(0, 10)}`;
      if (await this.exists('earnings', ticker, ref)) { skipped++; continue; }
      const daysAway = Math.max(
        0,
        Math.round((e.reportDate.getTime() - Date.now()) / 86_400_000),
      );
      // Proximity-weighted strength: the closer, the more actionable.
      const strength = Math.min(100, Math.max(5, 100 - daysAway * 2));
      await this.prisma.screenerHit.create({
        data: {
          ticker,
          source: 'earnings',
          catalystType: 'earnings-date',
          catalystStrength: strength,
          sourceReliability: 80,
          rawPayloadRef: ref,
          timestamp: e.reportDate,
        },
      });
      created++;
    }
    return { created, skipped };
  }

  /** Catalyst strength for a news article: sentiment magnitude + impact, 1–100. */
  private newsStrength(a: any): number {
    const sentiment = Number(a.sentiment) || 0; // -1..1
    const impactBonus = IMPACT_BONUS[String(a.impact || 'medium')] ?? 0;
    return Math.min(100, Math.max(1, Math.round(40 + Math.abs(sentiment) * 50 + impactBonus)));
  }

  private async exists(source: string, ticker: string, ref: string): Promise<boolean> {
    const row = await this.prisma.screenerHit.findFirst({
      where: { source, ticker, rawPayloadRef: ref },
      select: { id: true },
    });
    return !!row;
  }
}
