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

  // ── News Feed (DB-first, live Finnhub fallback) ──

  @Get('feed')
  async getFeed(
    @Query('symbol') symbol?: string,
    @Query('source') source?: string,
    @Query('sentiment') sentiment?: string,
    @Query('category') category?: string,
    @Query('limit') limit?: string,
  ) {
    // Try DB first
    const dbArticles = await this.importService.getArticles({
      symbol,
      source,
      sentiment,
      category,
      limit: limit ? parseInt(limit, 10) : 50,
      days: 7,
    });

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
      return { articles, live: true, source: 'db', count: articles.length };
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
