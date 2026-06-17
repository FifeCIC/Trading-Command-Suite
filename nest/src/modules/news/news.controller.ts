import { Controller, Get, Post, Param, Query, Logger } from '@nestjs/common';
import { NewsCollectorService } from './news-collector.service';
import { AdapterFactory } from '../providers/adapter-factory';

@Controller('news')
export class NewsController {
  private readonly logger = new Logger(NewsController.name);

  constructor(
    private readonly newsService: NewsCollectorService,
    private readonly adapterFactory: AdapterFactory,
  ) {}

  @Get('sources')
  getSources() {
    return { sources: this.newsService.getSources() };
  }

  @Post('collect')
  collect() {
    const articles = this.newsService.collectHeadlines();
    return { collected: articles.length, articles };
  }

  @Get('feed')
  async getFeed(
    @Query('symbol') symbol?: string,
    @Query('source') source?: string,
    @Query('sentiment') sentiment?: string,
  ) {
    try {
      const adapter = this.adapterFactory.create('finnhub');
      if (!adapter || typeof (adapter as any).getNews !== 'function') {
        return { articles: [], fallback: true, reason: 'Finnhub adapter not available' };
      }

      const days = 7;
      const rawArticles: any[] = await (adapter as any).getNews(symbol || 'AAPL', days) || [];

      const articles = rawArticles.map((a: any) => ({
        id: String(a.id || Math.random()),
        title: a.headline || '',
        source: a.source || 'Finnhub',
        time: a.datetime ? new Date(a.datetime).toLocaleString() : 'Unknown',
        sentiment: this.mapSentiment(a.sentiment),
        symbols: a.related?.split(',')?.map((s: string) => s.trim()) || (symbol ? [symbol] : []),
        impact: 'medium',
        snippet: a.summary || '',
        url: a.url || '#',
      }));

      return { articles, live: true, source: 'finnhub' };
    } catch (err) {
      this.logger.warn(`News feed fetch failed: ${err}`);
      return { articles: [], live: false, error: 'News API unavailable — using reference data' };
    }
  }

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

  @Get('sources/:id/patterns')
  getPatterns(@Param('id') id: string) {
    const patterns = this.newsService.getSourcePatterns(id);
    return { sourceId: id, patterns };
  }

  @Get('summary')
  getSummary() {
    return this.newsService.getWeeklySummary();
  }
}
