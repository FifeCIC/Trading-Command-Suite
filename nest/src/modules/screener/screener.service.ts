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

  /**
   * Attention-weight ranking (#647 / epic #682 Phase 4.1) — computed on read,
   * never stored. Groups ScreenerHits per ticker and ranks by
   * `strength × reliability × recency`:
   *
   *   - Earnings hits carry a FUTURE event date → recency is proximity to the
   *     event (closer = higher).
   *   - News hits carry a PAST timestamp → recency is age decay
   *     (half-life 24h).
   *
   * Also returns transparency counts (#682 decision 9): how many DB symbols
   * have catalysts vs how many are quiet, so the UI can show what the app
   * filtered out in the background.
   */
  async ranked(limit = 100, source?: string) {
    const baseWhere: any = {};
    if (source) baseWhere.source = source;

    // Two windows, both ordered so the most ACTIONABLE hits survive the take
    // cap: future events ascending (nearest first — proximity matters most),
    // recent past events descending (freshest first). A single global
    // timestamp-desc query would push the nearest earnings dates out past the
    // 2000-row cap and surface the farthest ones instead.
    const now = new Date();
    const newsCutoff = new Date(now.getTime() - 7 * 86_400_000);

    let rows;
    try {
      const [futureRows, pastRows] = await Promise.all([
        this.prisma.screenerHit.findMany({
          where: { ...baseWhere, timestamp: { gte: now } },
          orderBy: { timestamp: 'asc' },
          take: 2000,
        }),
        this.prisma.screenerHit.findMany({
          where: { ...baseWhere, timestamp: { lt: now, gte: newsCutoff } },
          orderBy: { timestamp: 'desc' },
          take: 2000,
        }),
      ]);
      rows = [...futureRows, ...pastRows];
    } catch {
      rows = [];
    }

    const nowMs = now.getTime();
    const groups = new Map<string, typeof rows>();
    for (const h of rows) {
      const t = String(h.ticker || '').trim().toUpperCase();
      if (!t) continue;
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(h);
    }

    const ranked = [];
    for (const [ticker, hits] of groups) {
      const strength = Math.max(...hits.map((h) => Number(h.catalystStrength) || 0));
      const reliability = Math.max(...hits.map((h) => Number(h.sourceReliability) || 50));
      const times = hits.map((h) => new Date(h.timestamp).getTime());
      const latest = Math.max(...times);
      const nextFuture = times.filter((ts) => ts > nowMs).sort((a, b) => a - b)[0];

      let recency: number;
      if (nextFuture != null) {
        // Earnings-style: future event → proximity weighting (closer = higher).
        const daysAway = Math.max(0, (nextFuture - nowMs) / 86_400_000);
        recency = 1 / (1 + daysAway);
      } else {
        // News-style: past event → age decay, half-life 24h.
        const ageHours = Math.max(0, (nowMs - latest) / 3_600_000);
        recency = Math.pow(0.5, ageHours / 24);
      }

      const rawWeight = (strength / 100) * (reliability / 100) * recency * 100;
      ranked.push({
        ticker,
        sources: [...new Set(hits.map((h) => h.source))],
        catalystTypes: [...new Set(hits.map((h) => h.catalystType))],
        hitCount: hits.length,
        strength,
        reliability,
        recency: Number(recency.toFixed(3)),
        attentionWeight: 0, // normalised below (relative to the strongest catalyst)
        rawAttentionWeight: Number(rawWeight.toFixed(2)),
        latestTimestamp: new Date(latest).toISOString(),
        nextEventAt: nextFuture != null ? new Date(nextFuture).toISOString() : null,
        bestHitRef: hits[0].rawPayloadRef ?? null,
      });
    }

    // Attention is RELATIVE — normalise to 0–100 against the strongest current
    // catalyst so the UI never shows an all-zero board when every event is far
    // out (e.g. earnings 3 months away → tiny raw weights but a clear ranking).
    const maxRaw = Math.max(0, ...ranked.map((r) => r.rawAttentionWeight));
    for (const r of ranked) {
      r.attentionWeight = maxRaw > 0 ? Math.round((r.rawAttentionWeight / maxRaw) * 100) : 0;
    }
    ranked.sort((a, b) => b.attentionWeight - a.attentionWeight);

    // Transparency counts (best-effort — never block ranking on them).
    let universe = { totalSymbols: 0, hitSymbols: 0, quietSymbols: 0 };
    let inDbTickers = new Set<string>();
    try {
      const totalSymbols = await this.prisma.symbol.count({ where: { active: true } });
      const hitTickers = [...new Set(ranked.map((r) => r.ticker))];
      const inDb = await this.prisma.symbol.findMany({
        where: { ticker: { in: hitTickers } },
        select: { ticker: true },
      });
      inDbTickers = new Set(inDb.map((s) => s.ticker.toUpperCase()));
      universe = {
        totalSymbols,
        hitSymbols: inDbTickers.size,
        quietSymbols: Math.max(0, totalSymbols - inDbTickers.size),
      };
    } catch { /* leave zeroed */ }

    // Flag rows the user can actually act on (symbol exists in their DB) —
    // the rest are discovery candidates surfaced by the attention funnel.
    for (const r of ranked) {
      r.inDb = inDbTickers.has(r.ticker);
    }

    return {
      universe,
      totalHits: rows.length,
      rankedCount: ranked.length,
      ranked: ranked.slice(0, limit),
    };
  }

  private async exists(source: string, ticker: string, ref: string): Promise<boolean> {
    const row = await this.prisma.screenerHit.findFirst({
      where: { source, ticker, rawPayloadRef: ref },
      select: { id: true },
    });
    return !!row;
  }
}
