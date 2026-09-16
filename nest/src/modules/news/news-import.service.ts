import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { SettingsService, NEWS_IMPORT_DEFAULTS, type NewsImportSettings, type NewsTierConfig } from '../system/settings.service';
import { SymbolResolverService, MACRO_SYMBOLS, SECTOR_SYMBOLS } from '../symbols/symbol-resolver.service';
import {
  classifyNewsCategory,
  assessNewsImpact,
} from './news-taxonomy';

/**
 * News Import Service
 * ====================
 * Scheduled and manual news ingestion pipeline.
 *
 * Flow:
 *   1. Resolve which symbols to track (active + positions + starred + giants + key people)
 *   2. Fetch per-symbol news from Finnhub adapter
 *   3. Deduplicate by URL (unique constraint on NewsArticle.url)
 *   4. Categorize by content patterns (shared news-taxonomy.ts)
 *   5. Apply default import filters (category allowlist + impact floor) —
 *      filtered articles are counted but NEVER stored
 *   6. Store in NewsArticle table
 *   7. Log run stats in NewsImportRun
 */

// ── Tier-Based Symbol Lists ──
// Replaces the hardcoded GIANT_SYMBOLS constant.
// Symbols are now resolved per-tier based on positions, protocols, and config.
// MACRO_SYMBOLS and SECTOR_SYMBOLS are imported from SymbolResolverService.

// ── Known ticker pattern for headline scanning ──

const TICKER_PATTERN = /\b[A-Z]{1,5}\b/g;

// ── Service ──

@Injectable()
export class NewsImportService {
  private readonly logger = new Logger(NewsImportService.name);

  /** Tracks the last run time per tier ID (in-memory, resets on restart). */
  private readonly tierLastRun = new Map<string, Date>();

  /** Tracks today's article count per tier (in-memory, resets on restart). */
  private readonly tierDailyCounts = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
    private readonly settingsService: SettingsService,
    private readonly symbolResolver: SymbolResolverService,
  ) {}

  // ── Public API ──

  /**
   * Tiered news import dispatcher — runs every hour.
   * Checks which tiers are due and dispatches them with budget enforcement.
   *
   * Tier schedule (configurable via Settings):
   *   Tier 1 (positions):        Every 2h  — max 30/day
   *   Tier 2 (active-protocols): Every 4h  — max 20/day
   *   Tier 3 (macro):            Every 6h  — max 15/day
   *   Tier 4 (sector):           Every 6h  — max 15/day
   *   Tier 5 (other):            Daily     — max 20/day (disabled by default)
   */
  @Cron('0 * * * *', { name: 'news-import-tiered' })
  async scheduledImport() {
    const config = await this.getTierConfig();

    // Check daily budget before doing anything
    const usedToday = await this.getDailyArticleCount();
    if (usedToday >= config.dailyLimit) {
      this.logger.warn(`Daily news budget exhausted: ${usedToday}/${config.dailyLimit} — skipping all tiers`);
      return;
    }

    const remaining = config.dailyLimit - usedToday;
    this.logger.log(`News tier dispatch: used ${usedToday}/${config.dailyLimit}, ${remaining} remaining`);

    for (const tier of config.tiers) {
      if (!tier.enabled) continue;
      if (tier.maxPerDay <= 0) continue;

      // Check if tier is due
      const lastRun = this.tierLastRun.get(tier.id);
      if (lastRun) {
        const elapsedMin = (Date.now() - lastRun.getTime()) / 60_000;
        if (elapsedMin < tier.intervalMin) continue;
      }

      // Check tier budget (proportional share of daily limit)
      const tierUsedToday = await this.getDailyArticleCount(tier.id);
      if (tierUsedToday >= tier.maxPerDay) {
        this.logger.debug(`Tier "${tier.id}" daily budget exhausted: ${tierUsedToday}/${tier.maxPerDay}`);
        continue;
      }

      const tierRemaining = Math.min(tier.maxPerDay - tierUsedToday, remaining);
      if (tierRemaining <= 0) continue;

      this.logger.log(`Dispatching tier "${tier.id}": ${tierRemaining} article slots, ${tier.intervalMin}m interval`);
      this.tierLastRun.set(tier.id, new Date());

      // Fire and forget (don't block other tiers)
      this.runTierImport(tier).catch((err) =>
        this.logger.error(`Tier "${tier.id}" import failed: ${(err as Error).message}`),
      );
    }
  }

  /**
   * Import news for a single tier.
   */
  async runTierImport(tier: NewsTierConfig): Promise<any> {
    const symbols = await this.resolveTierSymbols(tier.id);
    if (!symbols.length) {
      this.logger.debug(`Tier "${tier.id}": no symbols to fetch`);
      return null;
    }

    // Cap symbols if needed to stay within tier budget
    // (We import all matching symbols but the article budget is the real gate)
    this.logger.log(`Tier "${tier.id}": fetching news for ${symbols.length} symbols`);
    return this.runImport(symbols, tier.id);
  }

  /**
   * Resolve symbols for a specific priority tier.
   * Delegates to the shared SymbolResolverService.
   */
  async resolveTierSymbols(tierId: string): Promise<string[]> {
    // Map legacy news tier IDs to shared resolver tiers
    const tierMap: Record<string, import('../symbols/symbol-resolver.service').SymbolTier> = {
      'positions': 'positions',
      'active-protocols': 'active-protocols',
      'macro': 'macro',
      'sector': 'sector',
      'other': 'all-active',
    };
    const resolverTier = tierMap[tierId];
    if (!resolverTier) {
      this.logger.warn(`Unknown tier "${tierId}" — returning empty`);
      return [];
    }
    return this.symbolResolver.getSymbolsByTier(resolverTier);
  }

  /**
   * Resolve the full legacy set of symbols (kept for backward-compat with manual import).
   * Delegates to the shared SymbolResolverService.
   */
  async resolveTrackedSymbols(): Promise<string[]> {
    const selection = await this.symbolResolver.getSymbolsForFeature('news');
    return selection.symbols;
  }

  /**
   * Get today's article import count, optionally scoped to a tier.
   * Tier-level counts use in-memory tracking (resets on restart).
   * Global count queries the DB.
   */
  async getDailyArticleCount(tierId?: string): Promise<number> {
    if (tierId) {
      // In-memory tier tracking (resets on restart — acceptable for rate limiting)
      return this.tierDailyCounts.get(tierId) || 0;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const runs = await this.prisma.newsImportRun.findMany({
        where: {
          status: 'completed',
          startedAt: { gte: today },
        },
        select: { newArticles: true },
      });
      return runs.reduce((sum, r) => sum + r.newArticles, 0);
    } catch {
      return 0;
    }
  }

  /**
   * Increment the in-memory daily article counter for a tier.
   */
  private bumpTierCount(tierId: string, count: number): void {
    const current = this.tierDailyCounts.get(tierId) || 0;
    this.tierDailyCounts.set(tierId, current + count);
  }

  /**
   * Get the current tier configuration, merged from settings with defaults.
   * New settings keys (categoryAllowlist, minImpact) may be absent from
   * previously-stored settings JSON — merge defensively.
   */
  async getTierConfig(): Promise<NewsImportSettings> {
    try {
      const settings = await this.settingsService.get();
      const stored: Partial<NewsImportSettings> = settings.newsImport ?? {};
      return {
        ...NEWS_IMPORT_DEFAULTS,
        ...stored,
        tiers: Array.isArray(stored.tiers) && stored.tiers.length ? stored.tiers : NEWS_IMPORT_DEFAULTS.tiers,
        categoryAllowlist:
          Array.isArray(stored.categoryAllowlist) && stored.categoryAllowlist.length
            ? stored.categoryAllowlist
            : [...NEWS_IMPORT_DEFAULTS.categoryAllowlist],
        minImpact: ['low', 'medium', 'high'].includes(stored.minImpact as string)
          ? (stored.minImpact as 'low' | 'medium' | 'high')
          : NEWS_IMPORT_DEFAULTS.minImpact,
      };
    } catch {
      // Fallback defaults if settings unavailable
      return {
        dailyLimit: 100,
        tiers: [
          { id: 'positions', enabled: true, maxPerDay: 30, intervalMin: 120 },
          { id: 'active-protocols', enabled: true, maxPerDay: 20, intervalMin: 240 },
          { id: 'macro', enabled: true, maxPerDay: 15, intervalMin: 360 },
          { id: 'sector', enabled: true, maxPerDay: 15, intervalMin: 360 },
          { id: 'other', enabled: false, maxPerDay: 20, intervalMin: 1440 },
        ],
        categoryAllowlist: [...NEWS_IMPORT_DEFAULTS.categoryAllowlist],
        minImpact: 'low',
      };
    }
  }

  /**
   * Get comprehensive import stats for the dashboard.
   */
  async getNewsStats(): Promise<{
    today: { articles: number; limit: number; remaining: number };
    byTier: Record<string, { articles: number; limit: number; lastRun: string | null }>;
    totalStored: number;
    lastRun: any;
  }> {
    const config = await this.getTierConfig();
    const todayArticles = await this.getDailyArticleCount();

    // Per-tier stats
    const byTier: Record<string, any> = {};
    for (const tier of config.tiers) {
      const tierArticles = await this.getDailyArticleCount(tier.id);
      const lastRun = this.tierLastRun.get(tier.id);
      byTier[tier.id] = {
        articles: tierArticles,
        limit: tier.maxPerDay,
        lastRun: lastRun?.toISOString() || null,
      };
    }

    // Total stored articles
    let totalStored = 0;
    try {
      totalStored = await this.prisma.newsArticle.count();
    } catch { /* ignore */ }

    const lastRun = await this.getLastImportRun();

    return {
      today: {
        articles: todayArticles,
        limit: config.dailyLimit,
        remaining: Math.max(0, config.dailyLimit - todayArticles),
      },
      byTier,
      totalStored,
      lastRun,
    };
  }

  /**
   * Run a full import cycle for the given symbols (or resolve tracked if none provided).
   * Returns the import run record.
   */
  async runImport(symbols?: string[], tierId?: string): Promise<any> {
    const targetSymbols = symbols?.length ? symbols : await this.resolveTrackedSymbols();
    // Import filters come from settings (defaults applied) — loaded once per run.
    const config = await this.getTierConfig();

    const run = await this.prisma.newsImportRun.create({
      data: {
        status: 'running',
        tierId: tierId || null,
        symbolsCount: targetSymbols.length,
        startedAt: new Date(),
      },
    });

    let fetched = 0;
    let newArticles = 0;
    let duplicates = 0;
    let errors = 0;
    let filteredByCategory = 0;
    let filteredByImpact = 0;
    const errorMessages: string[] = [];

    const adapter = this.adapterFactory.create('finnhub');
    if (!adapter || typeof (adapter as any).getNews !== 'function') {
      await this.finishRun(run.id, 'failed', { fetched, newArticles, duplicates, errors, errorMessages });
      this.logger.error('Finnhub adapter not available for news import');
      return run;
    }

    for (const symbol of targetSymbols) {
      try {
        const articles = await (adapter as any).getNews(symbol, 1); // last 24h
        if (!articles || !Array.isArray(articles)) continue;

        fetched += articles.length;

        for (const raw of articles) {
          try {
            const url = raw.url || `finnhub://${raw.id}`;
            const headline = raw.headline || '';
            const category = classifyNewsCategory(headline, raw.summary || '');
            const sentiment = typeof raw.sentiment === 'number' ? raw.sentiment : 0;
            const impact = assessNewsImpact(headline, raw.summary || '', sentiment, category);

            // ── Default import filters (applied BEFORE storage) ──
            // Categories outside the allowlist are junk for this app
            // (product fluff, market commentary) — never stored.
            if (!config.categoryAllowlist.includes(category)) {
              filteredByCategory++;
              continue;
            }
            // Impact floor — default 'low' means no filter; the allowlist
            // does the real work. Low-impact predictions still pass because
            // assessNewsImpact gives directive categories a medium floor.
            if (config.minImpact !== 'low' && impact === 'low') {
              filteredByImpact++;
              continue;
            }

            // Build or find source record
            const sourceName = raw.source || 'Finnhub';
            let source = await this.prisma.newsSource.findUnique({ where: { name: sourceName } });
            if (!source) {
              source = await this.prisma.newsSource.create({
                data: { name: sourceName, url: '', reliabilityScore: 5.0, patterns: {} },
              });
            }

            await this.prisma.newsArticle.create({
              data: {
                symbol,
                sourceId: source.id,
                category,
                headline,
                url,
                summary: raw.summary || null,
                sentiment,
                impact,
                publishedAt: raw.datetime
                  ? new Date(raw.datetime * 1000)
                  : new Date(),
              },
            });

            newArticles++;
          } catch (err: any) {
            // Unique constraint violation = duplicate
            if (err?.code === 'P2002') {
              duplicates++;
            } else {
              errors++;
              errorMessages.push(`${symbol}: ${(err as Error).message}`);
            }
          }
        }
      } catch (err) {
        errors++;
        errorMessages.push(`${symbol}: ${(err as Error).message}`);
      }
    }

    await this.finishRun(run.id, 'completed', { fetched, newArticles, duplicates, errors, errorMessages });
    this.logger.log(
      `News import complete: ${targetSymbols.length} symbols, ${fetched} fetched, ${newArticles} new, ${duplicates} dupes, ${filteredByCategory} category-filtered, ${filteredByImpact} impact-filtered, ${errors} errors`,
    );

    // Bump tier daily count
    if (tierId) {
      this.bumpTierCount(tierId, newArticles);
    }

    return this.prisma.newsImportRun.findUnique({ where: { id: run.id } });
  }

  /**
   * Get recent articles, optionally filtered.
   */
  async getArticles(filters?: {
    symbol?: string;
    category?: string;
    sentiment?: string;
    source?: string;
    limit?: number;
    days?: number;
  }) {
    const where: any = {};
    const limit = filters?.limit || 50;

    if (filters?.symbol) where.symbol = filters.symbol.toUpperCase();
    if (filters?.category) where.category = filters.category;
    if (filters?.sentiment) {
      if (filters.sentiment === 'positive') where.sentiment = { gt: 0.15 };
      else if (filters.sentiment === 'negative') where.sentiment = { lt: -0.15 };
      else where.sentiment = { gte: -0.15, lte: 0.15 };
    }
    if (filters?.days) {
      where.publishedAt = { gte: new Date(Date.now() - filters.days * 86_400_000) };
    }

    if (filters?.source) {
      const source = await this.prisma.newsSource.findFirst({
        where: { name: { contains: filters.source } },
      });
      if (source) where.sourceId = source.id;
    }

    return this.prisma.newsArticle.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { source: { select: { name: true, reliabilityScore: true } } },
    });
  }

  /**
   * Get the most recent articles for a SET of symbols (market-tape use).
   * Unlike getArticles() (single symbol filter), this queries any article whose
   * primary ticker is in the given set — used by GET /api/news/tape to surface a
   * headline for the priority symbols (open positions first, then scored symbols).
   */
  async getLatestForSymbols(symbols: string[], limit = 3): Promise<any[]> {
    if (!symbols || symbols.length === 0) return [];
    const normalized = [...new Set(symbols.map((s) => String(s).toUpperCase()))];
    return this.prisma.newsArticle.findMany({
      where: { symbol: { in: normalized } },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      include: { source: { select: { name: true, reliabilityScore: true } } },
    });
  }

  /**
   * Get sentiment summary for a symbol.
   *
   * Prefers the last 7 days; when the store is stale (no rows in the window)
   * it falls back to the whole corpus so the counts match the articles the
   * feed endpoint actually displays (see getFeed's widening fallback).
   */
  async getSentimentSummary(symbol?: string) {
    const baseWhere: any = {};
    if (symbol) baseWhere.symbol = symbol.toUpperCase();

    const select = { sentiment: true, category: true } as const;
    let articles = await this.prisma.newsArticle.findMany({
      where: { ...baseWhere, publishedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select,
    });
    if (articles.length === 0) {
      articles = await this.prisma.newsArticle.findMany({ where: baseWhere, select });
    }

    const positive = articles.filter((a) => a.sentiment > 0.15).length;
    const negative = articles.filter((a) => a.sentiment < -0.15).length;
    const neutral = articles.length - positive - negative;

    const byCategory: Record<string, { positive: number; negative: number; neutral: number }> = {};
    for (const a of articles) {
      if (!byCategory[a.category]) byCategory[a.category] = { positive: 0, negative: 0, neutral: 0 };
      if (a.sentiment > 0.15) byCategory[a.category].positive++;
      else if (a.sentiment < -0.15) byCategory[a.category].negative++;
      else byCategory[a.category].neutral++;
    }

    return { total: articles.length, positive, negative, neutral, byCategory };
  }

  /**
   * Get the most recent import run.
   */
  async getLastImportRun() {
    return this.prisma.newsImportRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });
  }

  /**
   * Get available categories with counts.
   *
   * Same staleness fallback as getSentimentSummary: 7-day window first, whole
   * corpus when nothing recent exists, so the category tabs always reflect
   * the stored articles the feed can display.
   */
  async getCategories() {
    // NOTE: MySQL COUNT(*) reaches Prisma as a BigInt (CAST AS SIGNED doesn't
    // help — the driver maps any BIGINT column to BigInt), so counts must be
    // converted with Number() before JSON serialisation (see getSourceCounts).
    const recent: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT category, COUNT(*) as count FROM NewsArticle WHERE publishedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY) GROUP BY category ORDER BY count DESC`,
    );
    const rows = recent.length > 0
      ? recent
      : await this.prisma.$queryRawUnsafe(
          `SELECT category, COUNT(*) as count FROM NewsArticle GROUP BY category ORDER BY count DESC`,
        );
    return (rows as any[]).map((r) => ({ category: r.category, count: Number(r.count) }));
  }

  /**
   * Get article counts grouped by source, for dashboard health display.
   * Returns counts per source name (e.g. { finnhub: 2341, fmp: 0 }).
   * Only counts articles from the last 30 days.
   */
  async getSourceCounts(): Promise<Record<string, number>> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT s.name, COUNT(a.id) as count
       FROM NewsArticle a
       JOIN NewsSource s ON a.sourceId = s.id
       WHERE a.importedAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
       GROUP BY s.name`,
    );
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.name] = Number(row.count);
    }
    return counts;
  }

  // ── Helpers ──
  // (Classification + impact assessment moved to news-taxonomy.ts so every
  // news pipeline — tiered import, per-symbol polling, RSS — applies the
  // same rules. Do NOT re-add local category rules here.)

  /**
   * Scan headline for mentioned ticker symbols (beyond the primary symbol).
   */
  extractMentionedSymbols(headline: string, summary: string): string[] {
    const text = `${headline} ${summary}`;
    const matches = text.match(TICKER_PATTERN) || [];
    // Filter out common non-ticker words
    const noise = new Set([
      'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'ITS', 'HAS', 'HAD', 'WAS',
      'ALL', 'NEW', 'CEO', 'CFO', 'IPO', 'ETF', 'API', 'AI', 'GPU', 'CPU',
      'USA', 'UK', 'EU', 'USD', 'GBP', 'EUR', 'JPY', 'OIL', 'GAS', 'CPI',
      'PPI', 'GDP', 'PMI', 'FOMC', 'SEC', 'IPO', 'YOY', 'QOQ', 'EPS',
    ]);
    return [...new Set(matches.filter((m) => !noise.has(m)))];
  }

  private async finishRun(
    id: string,
    status: string,
    stats: { fetched: number; newArticles: number; duplicates: number; errors: number; errorMessages: string[] },
  ) {
    await this.prisma.newsImportRun.update({
      where: { id },
      data: {
        status,
        fetched: stats.fetched,
        newArticles: stats.newArticles,
        duplicates: stats.duplicates,
        errors: stats.errors,
        errorLog: stats.errorMessages.slice(0, 20).join('\n') || null,
        completedAt: new Date(),
      },
    });
  }
}
