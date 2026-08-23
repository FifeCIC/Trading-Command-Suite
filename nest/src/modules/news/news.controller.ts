import { Controller, Get, Post, Param, Query, Logger } from '@nestjs/common';
import { NewsCollectorService } from './news-collector.service';
import { NewsImportService } from './news-import.service';
import { AdapterFactory } from '../providers/adapter-factory';

@Controller('news')
export class NewsController {
  private readonly logger = new Logger(NewsController.name);

  constructor(
    private readonly newsService: NewsCollectorService,
    private readonly importService: NewsImportService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  // ── Sources & Patterns (Fluff Detector) ──

  @Get('sources')
  getSources() {
    return { sources: this.newsService.getSources() };
  }

  @Post('collect')
  collect() {
    const articles = this.newsService.collectHeadlines();
    return { collected: articles.length, articles };
  }

  @Get('sources/:id/patterns')
  getPatterns(@Param('id') id: string) {
    const patterns = this.newsService.getSourcePatterns(id);
    return { sourceId: id, patterns };
  }

  @Get('summary')
  getSummary() {
    return this.newsService.getWeeklySummary();
  }

  /**
   * GET /api/news/settings — active import filters (category allowlist,
   * impact floor, tier budgets). Editable via PUT /api/system/settings
   * under the `newsImport` key.
   */
  @Get('settings')
  getSettings() {
    return this.importService.getTierConfig();
  }

  // ── News Feed (DB-first, live Finnhub fallback) ──

  @Get('feed')
  async getFeed(
    @Query('symbol') symbol?: string,
    @Query('source') source?: string,
    @Query('sentiment') sentiment?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    // Try DB first — prefer the last 7 days. If the store is stale (nothing
    // within the window, e.g. imports have been dry for a while), widen to the
    // whole corpus so stored news is never hidden behind a date filter. The
    // frontend uses `stale` to label such results as older than 7 days.
    const filterBase = {
      symbol,
      source,
      sentiment,
      category,
      limit: limit ? parseInt(limit, 10) : 50,
    };
    let dbArticles = await this.importService.getArticles({ ...filterBase, days: 7 });
    let stale = false;
    if (dbArticles.length === 0) {
      stale = true;
      dbArticles = await this.importService.getArticles(filterBase);
    }

    if (dbArticles.length > 0) {
      const articles = dbArticles.map((a) => ({
        id: a.id,
        title: a.headline,
        source: (a.source as any)?.name || 'Unknown',
        sourceReliability: (a.source as any)?.reliabilityScore || 5.0,
        time: a.publishedAt?.toISOString(),
        sentiment: this.mapSentiment(a.sentiment),
        impact: a.impact,
        symbol: a.symbol,
        category: a.category,
        snippet: a.summary || '',
        url: a.url || '#',
      }));
      return { articles, live: true, source: 'db', count: articles.length, stale };
    }

    // Fallback to live Finnhub
    try {
      const adapter = this.adapterFactory.create('finnhub');
      if (!adapter || typeof (adapter as any).getNews !== 'function') {
        return { articles: [], live: false, reason: 'Finnhub adapter not available' };
      }

      const rawArticles: any[] = await (adapter as any).getNews(symbol || 'AAPL', 7) || [];
      const articles = rawArticles.map((a: any) => ({
        id: String(a.id || Math.random()),
        title: a.headline || '',
        source: a.source || 'Finnhub',
        time: a.datetime ? new Date(a.datetime * 1000).toISOString() : new Date().toISOString(),
        sentiment: this.mapSentiment(a.sentiment),
        symbol: symbol || 'AAPL',
        category: 'general',
        impact: 'medium',
        snippet: a.summary || '',
        url: a.url || '#',
      }));

      return { articles, live: true, source: 'finnhub', count: articles.length };
    } catch (err) {
      this.logger.warn(`News feed fetch failed: ${err}`);
      return { articles: [], live: false, error: 'No stored articles and live API unavailable' };
    }
  }

  // ── Market Tape headline (prioritized: global + symbol) ──

  @Get('tape')
  async getTape() {
    // Priority symbol sets from the shared resolver:
    //  - macro            → globally-impacting symbols (FX, indices, gold…) = the "global" headline
    //  - positions        → symbols with an open position (highest priority for the symbol headline)
    //  - active-protocols → symbols actively scored (fallback priority for the symbol headline)
    const [macroSymbols, positionSymbols, scoredSymbols] = await Promise.all([
      this.importService.resolveTierSymbols('macro'),
      this.importService.resolveTierSymbols('positions'),
      this.importService.resolveTierSymbols('active-protocols'),
    ]);

    const [globalArticles, positionArticles, scoredArticles] = await Promise.all([
      this.importService.getLatestForSymbols(macroSymbols, 1),
      this.importService.getLatestForSymbols(positionSymbols, 1),
      this.importService.getLatestForSymbols(scoredSymbols, 1),
    ]);

    const mapArticle = (a: any, priority?: string) => {
      if (!a) return null;
      return {
        title: a.headline,
        symbol: a.symbol,
        category: a.category,
        time: a.publishedAt?.toISOString(),
        url: a.url || '#',
        sentiment: a.sentiment,
        impact: a.impact,
        source: (a.source as any)?.name || 'Unknown',
        snippet: a.summary || '',
        priority: priority || null,
      };
    };

    // Symbol headline prefers an open position first, else a scored symbol.
    const symbolArticle = mapArticle(positionArticles[0], 'position')
      || mapArticle(scoredArticles[0], 'scored');

    return {
      global: mapArticle(globalArticles[0]),
      symbol: symbolArticle,
      counts: { macro: macroSymbols.length, positions: positionSymbols.length, scored: scoredSymbols.length },
      live: true,
    };
  }

  // ── Import ──

  @Get('import/last')
  async getLastImport() {
    const run = await this.importService.getLastImportRun();
    return { run };
  }

  @Post('import/run')
  async triggerImport() {
    this.logger.log('Manual news import triggered');
    const run = await this.importService.runImport();
    return { run, message: 'Import completed' };
  }

  // ── Categories ──

  @Get('counts')
  async getSourceCounts() {
    const counts = await this.importService.getSourceCounts();
    return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  @Get('categories')
  async getCategories() {
    const categories = await this.importService.getCategories();
    return { categories };
  }

  // ── Sentiment ──

  @Get('sentiment-summary')
  async getSentimentSummary(@Query('symbol') symbol?: string) {
    return this.importService.getSentimentSummary(symbol);
  }

  // ── Tracked Symbols ──

  @Get('tracked-symbols')
  async getTrackedSymbols() {
    const symbols = await this.importService.resolveTrackedSymbols();
    return { symbols, count: symbols.length };
  }

  // ── Stats (daily budget, tier status) ──

  @Get('stats')
  async getStats() {
    return this.importService.getNewsStats();
  }

  // ── Helpers ──

  private mapSentiment(val: any): string {
    if (val == null) return 'neutral';
    if (typeof val === 'number') {
      if (val > 0.15) return 'positive';
      if (val < -0.15) return 'negative';
      return 'neutral';
    }
    if (val === 'positive' || val === 'negative' || val === 'neutral') return val;
    return 'neutral';
  }
}
