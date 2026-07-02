import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProvidersService } from '../providers/providers.service';

interface InvestigationFindings {
  price: number;
  priceChangePct: number | null;
  analystTarget: { high: number; low: number; mean: number; consensus: string } | null;
  newsSentiment: { bullish: number; bearish: number; buzz: number } | null;
  socialSentiment: { reddit: number; twitter: number } | null;
  articles: { headline: string; source: string; sentiment: number; age: string }[];
  earningsProximity: { nextDate: string | null; daysUntil: number | null };
  convictionScore: number;
  convictionLabel: string;
}

@Injectable()
export class InvestigationService {
  private readonly logger = new Logger(InvestigationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
  ) {}

  /**
   * Run a real investigation against live market data.
   * Pulls quote, news, social sentiment, analyst targets, and computes
   * a conviction score from multi-source data.
   */
  async investigate(symbol: string, trigger: string) {
    const sym = symbol.toUpperCase();
    this.logger.log(`🔍 Investigating ${sym} (trigger: ${trigger})`);

    const findings = await this.gatherFindings(sym);

    // Build a human-readable summary from actual data
    const summary = this.buildSummary(sym, trigger, findings);

    // Generate action items based on conviction
    const actionItems = this.buildActionItems(sym, findings);

    const sources = [
      { name: 'Finnhub Quote', reliability: 8 },
      { name: 'Finnhub News', reliability: 7 },
      { name: 'Finnhub Social Sentiment', reliability: 5 },
      ...findings.articles.map((a) => ({ name: a.source, reliability: 6 })),
    ];

    const investigation = await this.prisma.stockInvestigation.create({
      data: {
        symbol: sym,
        trigger,
        priceAtTime: findings.price,
        priceChangePct: findings.priceChangePct,
        analystConsensus: findings.analystTarget?.consensus ?? null,
        keyFindings: findings as any,
        summary,
        actionItems: actionItems as any,
        newsCount: findings.articles.length,
        sources: sources as any,
        status: 'open',
      },
    });

    this.logger.log(
      `✅ Investigation ${investigation.id} for ${sym}: conviction=${findings.convictionLabel} (${findings.convictionScore}/100), ${findings.articles.length} articles`,
    );
    return investigation;
  }

  private emptyFindings(symbol: string): InvestigationFindings {
    return {
      price: 0,
      priceChangePct: null,
      analystTarget: null,
      newsSentiment: null,
      socialSentiment: null,
      articles: [],
      earningsProximity: { nextDate: null, daysUntil: null },
      convictionScore: 0,
      convictionLabel: 'No Data',
    };
  }

  /**
   * Gather all available data for a symbol.
   */
  private async gatherFindings(symbol: string): Promise<InvestigationFindings> {
    const finnhub = this.providers.getAdapter('finnhub');
    if (!finnhub) {
      this.logger.warn('Finnhub adapter not available via factory');
      return this.emptyFindings(symbol);
    }

    // Fire all API calls in parallel
    const [quote, news, socialSentiment, priceTarget] = await Promise.allSettled([
      (finnhub as any).getQuote(symbol),
      (finnhub as any).getNews(symbol, 14),
      (finnhub as any).getSocialSentiment(symbol),
      (finnhub as any).getPriceTarget(symbol),
    ]);

    const price = quote.status === 'fulfilled' && quote.value ? (quote.value.last ?? quote.value.bid ?? 0) : 0;
    const priceChangePct =
      quote.status === 'fulfilled' && quote.value && price > 0
        ? null // ProviderQuote doesn't include change% — derived from candles elsewhere
        : null;

    // Parse news articles
    const articles: InvestigationFindings['articles'] = [];
    let newsSentiment: InvestigationFindings['newsSentiment'] = null;

    if (news.status === 'fulfilled' && Array.isArray(news.value)) {
      let bullish = 0;
      let bearish = 0;
      let totalSentiment = 0;
      let sentimentCount = 0;

      for (const article of news.value.slice(0, 20)) {
        const sentiment =
          typeof article.sentiment === 'number'
            ? article.sentiment
            : article.sentimentScore ?? 0;

        articles.push({
          headline: article.headline ?? article.title ?? 'Untitled',
          source: article.source ?? 'Unknown',
          sentiment,
          age: article.datetime
            ? `${Math.round((Date.now() - new Date(article.datetime).getTime()) / 3600000)}h`
            : 'unknown',
        });

        if (sentiment > 0.15) bullish++;
        else if (sentiment < -0.15) bearish++;
        totalSentiment += sentiment;
        sentimentCount++;
      }

      const avgSentiment = sentimentCount > 0 ? totalSentiment / sentimentCount : 0;
      const buzz = Math.min(100, articles.length * 5);

      newsSentiment = {
        bullish,
        bearish,
        buzz,
      };
    }

    // Parse social sentiment
    let socialSentimentResult: InvestigationFindings['socialSentiment'] = null;
    if (socialSentiment.status === 'fulfilled' && socialSentiment.value) {
      socialSentimentResult = {
        reddit: socialSentiment.value.redditMentions ?? 0,
        twitter: socialSentiment.value.twitterMentions ?? 0,
      };
    }

    // Parse price target
    let analystTarget: InvestigationFindings['analystTarget'] = null;
    if (priceTarget.status === 'fulfilled' && priceTarget.value) {
      const pt = priceTarget.value;
      analystTarget = {
        high: pt.highTarget ?? 0,
        low: pt.lowTarget ?? 0,
        mean: pt.avgTarget ?? 0,
        consensus: pt.consensus ?? null,
      };
    }

    // Compute conviction score from multi-source signals
    const { convictionScore, convictionLabel } = this.computeConviction(
      price,
      newsSentiment,
      analystTarget,
      socialSentimentResult,
    );

    return {
      price,
      priceChangePct,
      analystTarget,
      newsSentiment,
      socialSentiment: socialSentimentResult,
      articles,
      earningsProximity: { nextDate: null, daysUntil: null },
      convictionScore,
      convictionLabel,
    };
  }

  /**
   * Multi-signal conviction score (0–100).
   *
   * Components:
   *   - News sentiment: 0–30pts (bullish ratio vs bearish)
   *   - Analyst upside: 0–25pts (distance from mean target)
   *   - Social buzz: 0–20pts (mention volume)
   *   - Article volume: 0–15pts (coverage depth)
   *   - Price momentum: 0–10pts (recent direction)
   */
  private computeConviction(
    price: number,
    newsSentiment: InvestigationFindings['newsSentiment'],
    analystTarget: InvestigationFindings['analystTarget'],
    socialSentiment: InvestigationFindings['socialSentiment'],
  ): { convictionScore: number; convictionLabel: string } {
    let score = 0;
    const components: string[] = [];

    // 1. News sentiment (30pts max)
    if (newsSentiment) {
      const total = newsSentiment.bullish + newsSentiment.bearish || 1;
      const bullRatio = newsSentiment.bullish / total;
      const sentimentPoints = Math.round(bullRatio * 30);
      score += sentimentPoints;
      if (sentimentPoints >= 20) components.push('strong news sentiment');
      else if (sentimentPoints >= 10) components.push('moderate news sentiment');
      else components.push('weak/negative news sentiment');
    }

    // 2. Analyst upside (25pts max)
    if (analystTarget && analystTarget.mean > 0 && price > 0) {
      const upside = ((analystTarget.mean - price) / price) * 100;
      const analystPoints = Math.min(25, Math.max(0, Math.round(upside * 2.5)));
      score += analystPoints;
      if (upside > 10) components.push(`strong analyst upside (${Math.round(upside)}%)`);
      else if (upside > 0) components.push('moderate analyst upside');
      else components.push('analyst target below price');
    }

    // 3. Social buzz (20pts max)
    if (socialSentiment) {
      const mentions = (socialSentiment.reddit || 0) + (socialSentiment.twitter || 0);
      const buzzPoints = Math.min(20, Math.round(mentions / 5));
      score += buzzPoints;
      if (buzzPoints >= 15) components.push('high social buzz');
      else if (buzzPoints >= 5) components.push('moderate social buzz');
    }

    // 4. Article volume (15pts max)
    if (newsSentiment) {
      const articlePoints = Math.min(15, Math.round(newsSentiment.buzz / 6.67));
      score += articlePoints;
      if (articlePoints >= 10) components.push('high article volume');
    }

    // 5. Momentum placeholder (10pts max) — neutral default
    score += 5; // Neutral momentum baseline

    // Clamp
    score = Math.max(0, Math.min(100, score));

    let label: string;
    if (score >= 75) label = 'Strong Conviction';
    else if (score >= 50) label = 'Moderate Conviction';
    else if (score >= 25) label = 'Weak Conviction';
    else label = 'Low Confidence';

    return { convictionScore: score, convictionLabel: label };
  }

  /**
   * Build a human-readable summary from actual findings.
   */
  private buildSummary(symbol: string, trigger: string, f: InvestigationFindings): string {
    const lines: string[] = [];
    lines.push(`${symbol} investigated via ${trigger}.`);

    if (f.price > 0) {
      lines.push(
        `Current price: $${f.price.toFixed(2)}${f.priceChangePct != null ? ` (${f.priceChangePct >= 0 ? '+' : ''}${f.priceChangePct.toFixed(2)}%)` : ''}.`,
      );
    }

    if (f.analystTarget?.consensus) {
      lines.push(`Analyst consensus: ${f.analystTarget.consensus}. Mean target: $${f.analystTarget.mean.toFixed(2)}.`);
    }

    if (f.newsSentiment) {
      const { bullish, bearish, buzz } = f.newsSentiment;
      lines.push(
        `Recent news: ${bullish} bullish / ${bearish} bearish articles. Buzz score: ${buzz}/100.`,
      );
    }

    if (f.socialSentiment) {
      const total = (f.socialSentiment.reddit || 0) + (f.socialSentiment.twitter || 0);
      if (total > 0) lines.push(`Social mentions: ${total} across Reddit/Twitter.`);
    }

    lines.push(`Overall conviction: ${f.convictionLabel} (${f.convictionScore}/100).`);

    return lines.join(' ');
  }

  /**
   * Generate actionable follow-up items based on conviction strength and data gaps.
   */
  private buildActionItems(symbol: string, f: InvestigationFindings): string[] {
    const items: string[] = [];

    if (f.convictionScore >= 75) {
      items.push(`HIGH CONVICTION: Review position sizing for ${symbol} — consider entry within 1-3 days.`);
      items.push(`Set price alert at analyst mean target $${f.analystTarget?.mean?.toFixed(2) ?? 'N/A'}.`);
    } else if (f.convictionScore >= 50) {
      items.push(`MODERATE: Monitor ${symbol} for 3-5 days. Watch for conviction increase before entry.`);
      items.push(`Review recent news sentiment trend — is it improving or deteriorating?`);
    } else {
      items.push(`LOW CONVICTION: Add ${symbol} to watchlist. Re-evaluate in 1 week.`);
      items.push(`Check for upcoming earnings or events that could shift sentiment.`);
    }

    if (f.newsSentiment && f.newsSentiment.bearish > f.newsSentiment.bullish) {
      items.push(`⚠️ Bearish news skew detected — investigate catalyst before committing capital.`);
    }

    if (f.analystTarget?.mean && f.price > 0 && f.analystTarget.mean < f.price) {
      items.push(`⚠️ Price above analyst mean target — upside may be limited.`);
    }

    if (!f.analystTarget) {
      items.push(`Data gap: No analyst coverage data available. Consider fundamental research.`);
    }

    return items;
  }

  async findAll(symbol?: string, limit = 20) {
    const where: any = {};
    if (symbol) where.symbol = symbol.toUpperCase();
    return this.prisma.stockInvestigation.findMany({
      where,
      orderBy: { investigatedAt: 'desc' },
      take: limit,
    });
  }

  async findOne(id: string) {
    return this.prisma.stockInvestigation.findUnique({ where: { id } });
  }

  async updateStatus(id: string, status: string, outcome?: string) {
    return this.prisma.stockInvestigation.update({
      where: { id },
      data: {
        status,
        ...(outcome ? { outcome } : {}),
        ...(status === 'closed' ? { followedUpAt: new Date() } : {}),
      },
    });
  }

  async deleteStale(daysOld = 30) {
    const cutoff = new Date(Date.now() - daysOld * 86400000);
    const result = await this.prisma.stockInvestigation.deleteMany({
      where: {
        status: 'open',
        investigatedAt: { lt: cutoff },
      },
    });
    this.logger.log(`Cleaned ${result.count} stale investigations`);
    return result;
  }
}
