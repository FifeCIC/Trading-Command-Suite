/**
 * AlphaVantageNewsService — polls Alpha Vantage NEWS_SENTIMENT endpoint.
 *
 * Free tier: 25 requests/day. Polls once daily at 8 AM for key tickers.
 * Each ticker request returns up to 50 articles with sentiment scores (-1 to +1).
 *
 * #408 — Alpha Vantage NEWS_SENTIMENT integration
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import * as crypto from 'crypto';

const AV_BASE = 'https://www.alphavantage.co/query';

// Key tickers to poll (one API call each = 25/day budget max)
const TRACKED_TICKERS = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
  'SPY', 'QQQ', 'IWM', 'DIA',
  'JPM', 'BAC', 'XOM', 'CVX', 'WMT', 'JNJ', 'PG',
];

interface AvArticle {
  title: string;
  url: string;
  time_published: string;
  summary: string;
  source: string;
  overall_sentiment_score: number;
  overall_sentiment_label: string;
  ticker_sentiment?: Array<{ ticker: string; sentiment_score: number }>;
}

@Injectable()
export class AlphaVantageNewsService implements OnModuleInit {
  private readonly logger = new Logger(AlphaVantageNewsService.name);
  private apiKey: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    this.apiKey = process.env.ALPHA_VANTAGE_API_KEY || null;
    if (!this.apiKey) {
      this.logger.warn('ALPHA_VANTAGE_API_KEY not set — Alpha Vantage news disabled');
      return;
    }
    this.logger.log('Alpha Vantage news service ready (daily poll at 8 AM)');
    // Fire once on startup
    setTimeout(() => this.pollAll().catch(() => {}), 30_000);
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async scheduledPoll() {
    await this.pollAll();
  }

  async pollAll() {
    if (!this.apiKey) return;
    let total = 0;
    let stored = 0;

    for (const ticker of TRACKED_TICKERS) {
      try {
        const articles = await this.fetchNews(ticker);
        total += articles.length;
        for (const article of articles) {
          const saved = await this.storeIfNew(article, ticker);
          if (saved) stored++;
        }
        // Respect rate limit: 5 calls/min on free tier
        await new Promise(r => setTimeout(r, 12_000));
      } catch (err) {
        this.logger.warn(`AV news fetch failed for ${ticker}: ${(err as Error).message}`);
      }
    }

    if (stored > 0) {
      this.logger.log(`AV news: ${total} fetched, ${stored} new (${TRACKED_TICKERS.length} tickers)`);
    }
  }

  private async fetchNews(ticker: string): Promise<AvArticle[]> {
    const url = `${AV_BASE}?function=NEWS_SENTIMENT&tickers=${ticker}&apikey=${this.apiKey}&limit=20`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.Information?.includes('rate limit')) {
      throw new Error('Rate limited');
    }
    if (data.Note?.includes('higher request frequency')) {
      throw new Error('API call frequency exceeded');
    }

    return (data.feed || []).slice(0, 20).map((item: any) => ({
      title: item.title || '',
      url: item.url || '',
      time_published: item.time_published
        ? `${item.time_published.slice(0, 4)}-${item.time_published.slice(4, 6)}-${item.time_published.slice(6, 8)}T${item.time_published.slice(9, 11)}:${item.time_published.slice(11, 13)}:${item.time_published.slice(13, 15)}Z`
        : new Date().toISOString(),
      summary: (item.summary || '').slice(0, 500),
      source: item.source || 'Alpha Vantage',
      overall_sentiment_score: Number(item.overall_sentiment_score) || 0,
      overall_sentiment_label: item.overall_sentiment_label || 'Neutral',
      ticker_sentiment: (item.ticker_sentiment || []).map((ts: any) => ({
        ticker: ts.ticker,
        sentiment_score: Number(ts.ticker_sentiment_score) || 0,
      })),
    }));
  }

  private async storeIfNew(article: AvArticle, queryTicker: string): Promise<boolean> {
    if (!this.prisma.isAvailable) return false;

    const hash = crypto.createHash('sha256')
      .update(`av:${article.url}`)
      .digest('hex')
      .slice(0, 16);

    try {
      const existing = await (this.prisma as any).newsItem?.findFirst({
        where: { sourceHash: hash },
      });
      if (existing) return false;

      // Collect all mentioned tickers
      const tickers = new Set<string>([queryTicker]);
      if (article.ticker_sentiment) {
        for (const ts of article.ticker_sentiment) {
          tickers.add(ts.ticker);
        }
      }

      await (this.prisma as any).newsItem?.create({
        data: {
          title: article.title.slice(0, 300),
          url: article.url,
          source: `av:alphavantage`,
          sourceHash: hash,
          publishedAt: new Date(article.time_published),
          summary: article.summary,
          symbols: [...tickers].join(','),
          sentiment: article.overall_sentiment_score,
          severity: Math.abs(article.overall_sentiment_score) > 0.3 ? 3 : 1,
          status: 'new',
        },
      });
      return true;
    } catch {
      return false;
    }
  }
}
