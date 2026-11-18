/**
 * FinnhubNewsService — polls Finnhub company news for portfolio/watchlist symbols.
 *
 * Free tier: 60 calls/min. Polls every 5 min for tracked symbols.
 * Each symbol call returns news for the last 7 days.
 *
 * #406 — News Pipeline Phase 1
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { classifyNewsCategory, DEFAULT_NEWS_CATEGORY_ALLOWLIST } from '../news/news-taxonomy';
import { writeCanonicalArticle } from './news-writer';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

// Tracked symbols — populated from active strategies + watchlists
const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA', 'SPY', 'QQQ'];

@Injectable()
export class FinnhubNewsService implements OnModuleInit {
  private readonly logger = new Logger(FinnhubNewsService.name);
  private apiKey: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.apiKey = process.env.FINNHUB_API_KEY || null;
    if (!this.apiKey) {
      this.logger.warn('FINNHUB_API_KEY not set — Finnhub news disabled');
      return;
    }
    this.logger.log('Finnhub news service ready (polling every 5 min)');
    setTimeout(() => this.poll().catch(() => {}), 15_000);
    this.timer = setInterval(() => this.poll().catch(() => {}), 300_000);
  }

  async poll() {
    if (!this.apiKey) return;
    let total = 0;
    let stored = 0;

    for (const symbol of DEFAULT_SYMBOLS) {
      try {
        const articles = await this.fetchNews(symbol);
        total += articles.length;
        for (const a of articles) {
          if (await this.store(a, symbol)) stored++;
        }
        await new Promise(r => setTimeout(r, 1000)); // ~60/min rate
      } catch (err) {
        this.logger.warn(`Finnhub news failed for ${symbol}: ${(err as Error).message}`);
      }
    }
    if (stored > 0) {
      this.logger.log(`Finnhub news: ${total} fetched, ${stored} new`);
    }
  }

  private async fetchNews(symbol: string): Promise<any[]> {
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    const url = `${FINNHUB_BASE}/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${this.apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) || [];
  }

  private async store(article: any, symbol: string): Promise<boolean> {
    if (!this.prisma.isAvailable) return false;

    // Default import filters — categories outside the allowlist (product
    // fluff, market commentary) are never stored. See news-taxonomy.ts.
    const category = classifyNewsCategory(article.headline || '', article.summary || '');
    if (!DEFAULT_NEWS_CATEGORY_ALLOWLIST.includes(category)) return false;

    try {
      // ⚠️ #1290 — WRITES THE CANONICAL TABLE NOW, and `url` (UNIQUE) is the whole dedupe. The
      // `sourceHash` check against `news_item` is gone with the table: comparing a story only against
      // the duplicate store was how 17,245 stories ended up in both. See `news-writer.ts`.
      const outcome = await writeCanonicalArticle(this.prisma as any, {
        headline: article.headline || '',
        url: article.url || '',
        source: 'fh:finnhub',
        symbols: [symbol],
        summary: (article.summary || '').slice(0, 500),
        publishedAt: new Date(article.datetime * 1000),
        sentiment: null,
        severity: 1,
        category,
      });
      if (outcome.status === 'written') return true;
      if (outcome.status === 'skipped') {
        this.logger.debug(`Finnhub skip (${article.url}): ${outcome.reason}`);
      }
      return false;
    } catch (err) {
      this.logger.warn(`Finnhub store failed: ${(err as Error).message}`);
      return false;
    }
  }
}
