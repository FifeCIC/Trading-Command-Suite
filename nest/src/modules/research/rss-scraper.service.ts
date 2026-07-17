/**
 * RssScraperService — polls free RSS feeds for financial news.
 *
 * Feeds:
 *  - Yahoo Finance
 *  - MarketWatch
 *  - Seeking Alpha
 *  - Reuters
 *
 * Polls every 120s. Deduplicates by headline hash.
 * Enriches with symbol matching. Feeds into news_item table.
 *
 * #407 — Phase 1: RSS Feed Scraper
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const RssParser = require('rss-parser');

interface RssArticle {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  contentSnippet?: string;
}

const FEEDS: Array<{ name: string; url: string }> = [
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news/rssindex' },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'Seeking Alpha', url: 'https://seekingalpha.com/feed.xml' },
  { name: 'Reuters', url: 'https://www.reutersagency.com/feed/' },
];

// Common financial tickers — matched against article title/snippet
const WATCH_TICKERS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'JPM', 'BAC',
  'SPY', 'QQQ', 'IWM', 'DIA', 'VIX', 'BTC', 'ETH', 'EURUSD', 'GBPUSD',
  'USDJPY', 'XAUUSD', 'USOIL', 'GLD', 'SLV', 'TLT', 'HYG',
];

@Injectable()
export class RssScraperService implements OnModuleInit {
  private readonly logger = new Logger(RssScraperService.name);
  private readonly parser = new RssParser({ timeout: 10000 });
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Wait for DB, then start polling
    setTimeout(() => this.start(), 5000);
  }

  start() {
    if (this.timer) return;
    this.logger.log('RSS scraper started — polling 4 feeds every 120s');
    this.pollAll().catch(() => {});
    this.timer = setInterval(() => this.pollAll().catch(() => {}), 120_000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async pollAll() {
    let total = 0;
    let stored = 0;
    for (const feed of FEEDS) {
      try {
        const articles = await this.fetchFeed(feed);
        total += articles.length;
        for (const article of articles) {
          const saved = await this.storeIfNew(article);
          if (saved) stored++;
        }
      } catch (err) {
        this.logger.warn(`RSS feed ${feed.name} failed: ${(err as Error).message}`);
      }
    }
    if (stored > 0) {
      this.logger.log(`RSS: ${total} articles fetched, ${stored} new (${FEEDS.length} feeds)`);
    }
  }

  private async fetchFeed(feed: { name: string; url: string }): Promise<RssArticle[]> {
    const data = await this.parser.parseURL(feed.url);
    if (!data?.items?.length) return [];

    return data.items.slice(0, 20).map((item: any) => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      source: feed.name,
      contentSnippet: (item.contentSnippet || item.content || '').slice(0, 500),
    }));
  }

  private async storeIfNew(article: RssArticle): Promise<boolean> {
    if (!this.prisma.isAvailable) return false;

    const hash = crypto.createHash('sha256')
      .update(`${article.source}:${article.title}`)
      .digest('hex')
      .slice(0, 16);

    try {
      // Deduplicate by hash
      const existing = await (this.prisma as any).newsItem?.findFirst({
        where: { sourceHash: hash },
      });
      if (existing) return false;

      // Match tickers in title + snippet
      const text = `${article.title} ${article.contentSnippet || ''}`.toUpperCase();
      const matchedSymbols = WATCH_TICKERS.filter(t => text.includes(t));

      await (this.prisma as any).newsItem?.create({
        data: {
          title: article.title.slice(0, 300),
          url: article.link,
          source: `rss:${article.source.toLowerCase().replace(/\s+/g, '-')}`,
          sourceHash: hash,
          publishedAt: new Date(article.pubDate),
          summary: article.contentSnippet || null,
          symbols: matchedSymbols.length > 0 ? matchedSymbols.join(',') : null,
          sentiment: null, // DeepSeek enrichment happens later
          severity: 0,
          status: 'new',
        },
      });
      return true;
    } catch (err) {
      // Table may not exist yet — skip silently
      return false;
    }
  }
}
