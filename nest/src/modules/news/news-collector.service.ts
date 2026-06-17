import { Injectable, Logger } from '@nestjs/common';

/**
 * News source patterns and seed data for the Fluff Detector.
 * In production this would pull from RSS feeds, Finnhub API, etc.
 */

export interface SourcePattern {
  sourceId: string;
  sourceName: string;
  reliabilityScore: number;
  patterns: {
    dayOfWeek: number;
    hourOfDay: number;
    avgSentiment: number;
    articleCount: number;
  }[];
}

export interface ArticleHeadline {
  sourceId: string;
  sourceName: string;
  headline: string;
  url: string;
  publishedAt: string;
  sentiment: number;
  fluffScore?: number;
}

/** Emotional/clickbait keywords for fluff scoring */
const FLUFF_KEYWORDS = [
  'shocking', 'plunge', 'skyrocket', 'collapse', 'panic', 'fear',
  'greed', 'bubble', 'crash', 'meltdown', 'bloodbath', 'massacre',
  'explode', 'wipeout', 'apocalypse', 'armageddon', 'carnage',
  'freefall', 'turmoil', 'chaos', 'doom', 'catastrophe',
  'unstoppable', 'guaranteed', 'secret', 'they don\'t want you',
  'you won\'t believe', 'this changes everything',
];

const FLUFF_SOURCES = [
  'Motley Fool', 'Seeking Alpha', 'Benzinga', 'Zacks',
  'InvestorPlace', 'MarketBeat', 'TipRanks',
];

/** Seed sources */
const SEED_SOURCES: { name: string; url: string; reliabilityScore: number }[] = [
  { name: 'Bloomberg', url: 'https://www.bloomberg.com/markets', reliabilityScore: 8.5 },
  { name: 'Reuters', url: 'https://www.reuters.com/markets', reliabilityScore: 9.0 },
  { name: 'CNBC', url: 'https://www.cnbc.com/markets', reliabilityScore: 7.0 },
  { name: 'Yahoo Finance', url: 'https://finance.yahoo.com/news', reliabilityScore: 6.5 },
  { name: 'Benzinga', url: 'https://www.benzinga.com', reliabilityScore: 4.5 },
  { name: 'Motley Fool', url: 'https://www.fool.com', reliabilityScore: 4.0 },
  { name: 'Seeking Alpha', url: 'https://seekingalpha.com', reliabilityScore: 5.5 },
  { name: 'MarketWatch', url: 'https://www.marketwatch.com', reliabilityScore: 7.0 },
];

/** Generate synthetic article samples for demo */
const SEED_ARTICLES: ArticleHeadline[] = [
  { sourceId: 'bloomberg', sourceName: 'Bloomberg', headline: 'Fed Signals Patience on Rate Cuts as Inflation Moderates', url: '#', publishedAt: '2026-06-16T09:00:00Z', sentiment: 0.2 },
  { sourceId: 'reuters', sourceName: 'Reuters', headline: 'Global Markets Steady Ahead of Key Central Bank Decisions', url: '#', publishedAt: '2026-06-16T08:30:00Z', sentiment: 0.1 },
  { sourceId: 'cnbc', sourceName: 'CNBC', headline: 'Tech Stocks Rally on AI Optimism, NVIDIA Leads Gains', url: '#', publishedAt: '2026-06-16T10:15:00Z', sentiment: 0.4 },
  { sourceId: 'yahoo', sourceName: 'Yahoo Finance', headline: 'Is the Bull Market Over? Experts Weigh In On What\'s Next', url: '#', publishedAt: '2026-06-16T11:00:00Z', sentiment: -0.1 },
  { sourceId: 'benzinga', sourceName: 'Benzinga', headline: 'SHOCKING: Why NVIDIA Could CRASH 50% By Next Week', url: '#', publishedAt: '2026-06-16T07:00:00Z', sentiment: -0.6 },
  { sourceId: 'fool', sourceName: 'Motley Fool', headline: 'You Won\'t Believe What This Analyst Just Said About Tesla', url: '#', publishedAt: '2026-06-16T06:30:00Z', sentiment: 0.0 },
  { sourceId: 'seekingalpha', sourceName: 'Seeking Alpha', headline: 'Apple: The Secret Growth Story Wall Street Is Missing', url: '#', publishedAt: '2026-06-16T12:00:00Z', sentiment: 0.3 },
  { sourceId: 'marketwatch', sourceName: 'MarketWatch', headline: 'Treasury Yields Edge Lower as Bond Market Rallies', url: '#', publishedAt: '2026-06-16T09:30:00Z', sentiment: 0.1 },
  { sourceId: 'benzinga', sourceName: 'Benzinga', headline: 'Tesla Stock PLUNGES — Here\'s What You Need To Know', url: '#', publishedAt: '2026-06-15T14:00:00Z', sentiment: -0.5 },
  { sourceId: 'fool', sourceName: 'Motley Fool', headline: '3 Stocks That Could Make You a Millionaire by 2030', url: '#', publishedAt: '2026-06-15T10:00:00Z', sentiment: 0.7 },
  { sourceId: 'cnbc', sourceName: 'CNBC', headline: 'Oil Prices Drop as OPEC+ Considers Output Increase', url: '#', publishedAt: '2026-06-15T08:00:00Z', sentiment: -0.2 },
  { sourceId: 'bloomberg', sourceName: 'Bloomberg', headline: 'UK Inflation Data Surprises to the Upside — GBP Rallies', url: '#', publishedAt: '2026-06-15T07:00:00Z', sentiment: 0.3 },
  { sourceId: 'reuters', sourceName: 'Reuters', headline: 'Asia Markets Mixed as China Stimulus Hopes Fade', url: '#', publishedAt: '2026-06-15T06:00:00Z', sentiment: 0.0 },
  { sourceId: 'benzinga', sourceName: 'Benzinga', headline: 'Another Hedge Fund Just DOUBLED Its Bitcoin Position — Here\'s Why', url: '#', publishedAt: '2026-06-14T15:00:00Z', sentiment: 0.5 },
  { sourceId: 'seekingalpha', sourceName: 'Seeking Alpha', headline: 'Microsoft Earnings Preview: The Numbers That Matter', url: '#', publishedAt: '2026-06-14T13:00:00Z', sentiment: 0.2 },
];

@Injectable()
export class NewsCollectorService {
  private readonly logger = new Logger(NewsCollectorService.name);
  private articles: ArticleHeadline[] = [...SEED_ARTICLES];

  getSources() {
    return SEED_SOURCES.map((s, i) => ({
      id: s.name.toLowerCase().replace(/\s+/g, ''),
      ...s,
      articleCount: this.articles.filter((a) => a.sourceName === s.name).length,
    }));
  }

  collectHeadlines(): ArticleHeadline[] {
    // In production: fetch from RSS/Finnhub API
    // For prototype: return seeded data with fluff scores
    return this.articles.map((a) => ({
      ...a,
      fluffScore: this.calculateFluffScore(a),
    }));
  }

  calculateFluffScore(article: ArticleHeadline): number {
    const headline = article.headline.toLowerCase();
    let score = 0;

    // Check for emotional keywords
    const matches = FLUFF_KEYWORDS.filter((kw) => headline.includes(kw.toLowerCase()));
    score += matches.length * 15;

    // All caps words (like SHOCKING, CRASH, PLUNGES)
    const capsWords = article.headline.match(/\b[A-Z]{4,}\b/g) || [];
    score += capsWords.length * 10;

    // Clickbait patterns
    if (/you won'?t believe/i.test(headline)) score += 25;
    if (/\?$/.test(headline.trim())) score += 5;  // Question headlines
    if (/here'?s (what|why|how)/i.test(headline)) score += 10;

    // Source bias
    if (FLUFF_SOURCES.includes(article.sourceName)) score += 10;

    // Sentiment extremes → more likely fluff
    if (Math.abs(article.sentiment) > 0.5) score += 10;

    return Math.min(100, score);
  }

  getSourcePatterns(sourceId: string) {
    const sourceArticles = this.articles.filter(
      (a) => a.sourceName.toLowerCase().replace(/\s+/g, '') === sourceId,
    );
    const byDayHour = new Map<string, { count: number; sentimentTotal: number }>();

    for (const a of sourceArticles) {
      const dt = new Date(a.publishedAt);
      const key = `${dt.getDay()}-${dt.getHours()}`;
      const existing = byDayHour.get(key) || { count: 0, sentimentTotal: 0 };
      existing.count++;
      existing.sentimentTotal += a.sentiment;
      byDayHour.set(key, existing);
    }

    const patterns: { dayOfWeek: number; hourOfDay: number; avgSentiment: number; articleCount: number }[] = [];
    for (const [key, val] of byDayHour) {
      const [day, hour] = key.split('-').map(Number);
      patterns.push({
        dayOfWeek: day,
        hourOfDay: hour,
        avgSentiment: +(val.sentimentTotal / val.count).toFixed(2),
        articleCount: val.count,
      });
    }

    return patterns;
  }

  getWeeklySummary() {
    const articles = this.collectHeadlines();
    const totalArticles = articles.length;
    const avgFluff = articles.reduce((s, a) => s + (a.fluffScore || 0), 0) / totalArticles;
    const highFluff = articles.filter((a) => (a.fluffScore || 0) > 60).length;
    const sources = this.getSources();

    const mostReliable = [...sources].sort((a, b) => b.reliabilityScore - a.reliabilityScore)[0];
    const mostFluffy = [...sources].sort((a, b) => a.reliabilityScore - b.reliabilityScore)[0];

    return {
      totalArticles,
      avgFluff: +avgFluff.toFixed(1),
      highFluffCount: highFluff,
      highFluffPct: +((highFluff / totalArticles) * 100).toFixed(0),
      mostReliableSource: mostReliable?.name,
      mostFluffySource: mostFluffy?.name,
      generatedAt: new Date().toISOString(),
    };
  }
}
