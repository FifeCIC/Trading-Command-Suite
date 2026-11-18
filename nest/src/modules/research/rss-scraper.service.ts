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
import { classifyNewsCategory, DEFAULT_NEWS_CATEGORY_ALLOWLIST } from '../news/news-taxonomy';
import { writeCanonicalArticle } from './news-writer';

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

    try {
      // Match tickers in title + snippet
      const text = `${article.title} ${article.contentSnippet || ''}`.toUpperCase();
      const matchedSymbols = WATCH_TICKERS.filter(t => text.includes(t));

      // Default import filters (see news-taxonomy.ts):
      //  1. No matched ticker → not about anything we track → never stored
      //     (e.g. "Krafton agrees to pay Subnautica 2 bonuses").
      //  2. Category outside the allowlist (product/commentary fluff) → skip.
      if (matchedSymbols.length === 0) return false;
      const category = classifyNewsCategory(article.title, article.contentSnippet || '');
      if (!DEFAULT_NEWS_CATEGORY_ALLOWLIST.includes(category)) return false;

      // ⚠️ #1290 — WRITES THE CANONICAL TABLE NOW. `news_item` was a second news store read by ONE
      // consumer; `newsarticle` is read by nine and owns the taxonomy. Dedupe is `url`, which is
      // UNIQUE there, so no hash column is needed. `news-writer.ts` holds the rules in one place.
      const outcome = await writeCanonicalArticle(this.prisma as any, {
        headline: article.title,
        url: article.link,
        source: `rss:${article.source.toLowerCase().replace(/\s+/g, '-')}`,
        symbols: matchedSymbols,
        summary: article.contentSnippet || null,
        publishedAt: new Date(article.pubDate),
        sentiment: null, // DeepSeek enrichment happens later
        severity: 0,
        category,
      });
      if (outcome.status === 'written') return true;
      if (outcome.status === 'skipped') {
        // A refusal is reported, not swallowed — an empty log must not read as "nothing to import".
        this.logger.debug(`RSS skip (${article.link}): ${outcome.reason}`);
      }
      return false;
    } catch (err) {
      this.logger.warn(`RSS store failed: ${(err as Error).message}`);
      return false;
    }
  }
}
