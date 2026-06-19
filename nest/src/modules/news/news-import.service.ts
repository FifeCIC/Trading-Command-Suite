import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';

/**
 * News Import Service
 * ====================
 * Scheduled and manual news ingestion pipeline.
 *
 * Flow:
 *   1. Resolve which symbols to track (active + positions + starred + giants + key people)
 *   2. Fetch per-symbol news from Finnhub adapter
 *   3. Deduplicate by URL (unique constraint on NewsArticle.url)
 *   4. Categorize by content patterns
 *   5. Store in NewsArticle table
 *   6. Log run stats in NewsImportRun
 */

// ── Category Definitions ──

const CATEGORY_RULES: { category: string; patterns: RegExp[] }[] = [
  {
    category: 'earnings',
    patterns: [
      /earnings?/i, /revenue/i, /eps/i, /quarterly results/i,
      /beat|miss/i, /guidance/i, /outlook/i, /forecast/i,
    ],
  },
  {
    category: 'fed',
    patterns: [
      /\bfed\b/i, /federal reserve/i, /fomc/i, /powell/i,
      /interest rate/i, /rate (cut|hike|decision)/i,
      /monetary policy/i, /inflation/i, /cpi/i, /ppi/i,
      /treasury/i, /bond/i, /\byield\b/i,
    ],
  },
  {
    category: 'geopolitical',
    patterns: [
      /tariff/i, /trade war/i, /sanction/i, /embargo/i,
      /war/i, /conflict/i, /election/i, /congress/i,
      /white house/i, /regulation/i, /sec/i, /cfpb/i,
    ],
  },
  {
    category: 'product',
    patterns: [
      /launch/i, /announce/i, /unveil/i, /release/i,
      /new (chip|phone|model|product|feature)/i,
      /ai (chip|accelerator|model|training)/i,
      /gpu/i, /\bh200\b/i, /\bb200\b/i, /blackwell/i,
    ],
  },
  {
    category: 'executive',
    patterns: [
      /\bceo\b/i, /\bcfo\b/i, /executive/i, /board/i,
      /musk/i, /\btesla\b/i, /\bspacex\b/i,
      /bezos/i, /buffett/i, /dimon/i, /cook\b/i,
      /huang\b/i, /\bnvidia\b/i, /altman/i,
    ],
  },
  {
    category: 'sector',
    patterns: [
      /sector/i, /rotation/i, /industry/i, /semiconductor/i,
      /tech (stock|sector)/i, /energy sector/i, /financial/i,
      /healthcare/i, /real estate/i, /consumer/i,
    ],
  },
];

// ── Key People (headline scanning) ──

const KEY_PEOPLE_PATTERNS: RegExp[] = [
  /elon musk/i, /donald trump/i, /jerome powell/i, /janet yellen/i,
  /warren buffett/i, /jeff bezos/i, /tim cook\b/i, /jensen huang/i,
  /sam altman/i, /jamie dimon/i, /cathie wood/i, /michael saylor/i,
  /gary gensler/i, /volodymyr zelenskyy/i, /xi jinping/i,
  /vladimir putin/i, /mark zuckerberg/i, /sundar pichai/i,
  /satya nadella/i, /brian armstrong/i,
];

// ── Giant Symbols (always tracked) ──

const GIANT_SYMBOLS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  'BRK.B', 'JPM', 'V', 'JNJ', 'WMT', 'MA', 'PG', 'UNH',
  'HD', 'DIS', 'BAC', 'XOM', 'NFLX', 'ADBE', 'CRM', 'AMD',
];

// ── Known ticker pattern for headline scanning ──

const TICKER_PATTERN = /\b[A-Z]{1,5}\b/g;

// ── Fluff keywords (carried from NewsCollectorService) ──

const FLUFF_KEYWORDS = [
  'shocking', 'plunge', 'skyrocket', 'collapse', 'panic', 'fear',
  'greed', 'bubble', 'crash', 'meltdown', 'bloodbath', 'massacre',
  'explode', 'wipeout', 'apocalypse', 'armageddon', 'carnage',
  'freefall', 'turmoil', 'chaos', 'doom', 'catastrophe',
  'unstoppable', 'guaranteed', 'secret', "they don't want you",
  "you won't believe", 'this changes everything',
];

// ── Service ──

@Injectable()
export class NewsImportService {
  private readonly logger = new Logger(NewsImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  // ── Public API ──

  /**
   * Scheduled news import — runs every 6 hours.
   * Covers all tracked symbols (active + positions + starred + giants).
   */
  @Cron('0 */6 * * *', { name: 'news-import' })
  async scheduledImport() {
    this.logger.log('Scheduled news import starting...');
    try {
      const result = await this.runImport();
      this.logger.log(
        `Scheduled import done: ${result.symbolsCount} symbols, ${result.newArticles} new articles`,
      );
    } catch (err) {
      this.logger.error(`Scheduled news import failed: ${(err as Error).message}`);
    }
  }

  /**
   * Resolve the full set of symbols that should be tracked for news.
   * Priority order: active symbols + position symbols + starred + giants.
   * Returns deduplicated, uppercase array.
   */
  async resolveTrackedSymbols(): Promise<string[]> {
    const set = new Set<string>();

    // 1. Giants (always tracked)
    for (const s of GIANT_SYMBOLS) set.add(s);

    // 2. Active symbols from DB
    try {
      const active = await this.prisma.symbol.findMany({
        where: { active: true },
        select: { ticker: true },
      });
      for (const s of active) set.add(s.ticker.toUpperCase());
    } catch (err) {
      this.logger.warn(`Could not load active symbols: ${(err as Error).message}`);
    }

    // 3. Symbols with open positions
    try {
      const positions = await this.prisma.position.findMany({
        select: { symbol: true },
        distinct: ['symbol'],
      });
      for (const p of positions) set.add(p.symbol.toUpperCase());
    } catch (err) {
      this.logger.warn(`Could not load position symbols: ${(err as Error).message}`);
    }

    // 4. Starred symbols from watchlists
    try {
      const watchlists = await this.prisma.watchlist.findMany({
        select: { symbols: true },
      });
      for (const w of watchlists) {
        const syms = (w.symbols as any[]) || [];
        for (const s of syms) {
          if (typeof s === 'string') set.add(s.toUpperCase());
          if (typeof s === 'object' && s?.ticker) set.add(s.ticker.toUpperCase());
        }
      }
    } catch (err) {
      this.logger.warn(`Could not load watchlist symbols: ${(err as Error).message}`);
    }

    return Array.from(set).sort();
  }

  /**
   * Run a full import cycle for the given symbols (or resolve tracked if none provided).
   * Returns the import run record.
   */
  async runImport(symbols?: string[]): Promise<any> {
    const targetSymbols = symbols?.length ? symbols : await this.resolveTrackedSymbols();

    const run = await this.prisma.newsImportRun.create({
      data: {
        status: 'running',
        symbolsCount: targetSymbols.length,
        startedAt: new Date(),
      },
    });

    let fetched = 0;
    let newArticles = 0;
    let duplicates = 0;
    let errors = 0;
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
            const category = this.classifyCategory(headline, raw.summary || '');
            const sentiment = typeof raw.sentiment === 'number' ? raw.sentiment : 0;
            const impact = this.assessImpact(headline, raw.summary || '', sentiment);

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
      `News import complete: ${targetSymbols.length} symbols, ${fetched} fetched, ${newArticles} new, ${duplicates} dupes, ${errors} errors`,
    );

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
   * Get sentiment summary for a symbol.
   */
  async getSentimentSummary(symbol?: string) {
    const where: any = {};
    if (symbol) where.symbol = symbol.toUpperCase();
    where.publishedAt = { gte: new Date(Date.now() - 7 * 86_400_000) };

    const articles = await this.prisma.newsArticle.findMany({
      where,
      select: { sentiment: true, category: true },
    });

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
   */
  async getCategories() {
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT category, COUNT(*) as count FROM NewsArticle WHERE publishedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY category ORDER BY count DESC`,
    );
    return rows;
  }

  // ── Helpers ──

  private classifyCategory(headline: string, summary: string): string {
    const text = `${headline} ${summary}`;
    for (const rule of CATEGORY_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) return rule.category;
      }
    }
    // Check key people
    for (const pattern of KEY_PEOPLE_PATTERNS) {
      if (pattern.test(text)) return 'executive';
    }
    return 'general';
  }

  private assessImpact(headline: string, summary: string, sentiment: number): string {
    const text = `${headline} ${summary}`.toLowerCase();
    // High-impact signals
    if (/\b(crash|plunge|skyrocket|surge|collapse|breakthrough|crisis)\b/i.test(text)) return 'high';
    if (Math.abs(sentiment) > 0.5) return 'high';
    // Medium
    if (/\b(rally|drop|slide|jump|spike|warn|cut|hike)\b/i.test(text)) return 'medium';
    if (Math.abs(sentiment) > 0.25) return 'medium';
    return 'low';
  }

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
