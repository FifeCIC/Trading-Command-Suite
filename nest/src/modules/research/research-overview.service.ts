import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/**
 * ResearchOverviewService
 * ========================
 * Aggregates data from multiple subsystems into a single research dashboard payload.
 *
 * Data sources:
 *  - Scoring pipeline (top ranked symbols)
 *  - Portfolio positions (from DB Position table)
 *  - Earnings calendar (cross-referenced with positions)
 *  - Automation decisions (recent trades/decisions)
 *  - News sentiment (for held positions)
 *  - Macro indicators (VIX, rates from DB)
 *  - Timeline events (upcoming market events)
 */

export interface ResearchOverview {
  generatedAt: string;
  topSignals: Array<{
    ticker: string; score: number; normalizedScore: number;
    signal: string; confidence: number;
  }>;
  portfolio: {
    positionCount: number;
    totalValue: number;
    totalPnl: number;
    totalPnlPct: number;
    positions: Array<{
      symbol: string; quantity: number; avgPrice: number;
      currentPrice: number | null; value: number; pnl: number | null;
      hasEarningsSoon: boolean; earningsDate: string | null;
    }>;
  };
  marketContext: {
    vixLevel: number | null;
    vixChange: number | null;
    fedRate: number | null;
    us10y: number | null;
    goldPrice: number | null;
    oilPrice: number | null;
    bitcoinPrice: number | null;
    spxLevel: number | null;
  };
  recentDecisions: Array<{
    symbol: string; decision: string; composite: number;
    reason: string; timestamp: string;
  }>;
  upcomingEvents: Array<{
    type: string; label: string; icon: string;
    startsAt: string; affectsPositions: string[];
  }>;
  newsForPositions: Array<{
    symbol: string; headline: string; sentiment: number;
    impact: string; publishedAt: string;
  }>;
  sectorPerformance: Array<{
    sector: string; etf: string; changePct: number;
  }>;
}

@Injectable()
export class ResearchOverviewService {
  private readonly logger = new Logger(ResearchOverviewService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<ResearchOverview> {
    const [
      topSignals,
      portfolio,
      marketContext,
      recentDecisions,
      upcomingEvents,
      newsForPositions,
      sectorPerformance,
    ] = await Promise.all([
      this.fetchTopSignals(),
      this.fetchPortfolio(),
      this.fetchMarketContext(),
      this.fetchRecentDecisions(),
      this.fetchUpcomingEvents(),
      this.fetchPositionNews(),
      this.fetchSectorPerformance(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      topSignals,
      portfolio,
      marketContext,
      recentDecisions,
      upcomingEvents,
      newsForPositions,
      sectorPerformance,
    };
  }

  // ── Private fetchers ───────────────────────────────────

  private async fetchTopSignals() {
    try {
      const scores = await this.prisma.score.findMany({
        orderBy: { timestamp: 'desc' },
        take: 200,
        include: { symbol: { select: { ticker: true } } },
      });

      // Group by symbol, take latest score per symbol
      const latest = new Map<string, typeof scores[0]>();
      for (const s of scores) {
        if (!latest.has(s.symbolId)) {
          latest.set(s.symbolId, s);
        }
      }

      const tickerMap = new Map<string, string>();
      for (const s of scores) {
        tickerMap.set(s.symbolId, (s as any).symbol?.ticker || s.symbolId);
      }

      return [...latest.values()]
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
        .map((s) => ({
          ticker: tickerMap.get(s.symbolId) || s.symbolId,
          score: s.value,
          normalizedScore: s.value,
          signal: s.value >= 60 ? 'BUY' : s.value >= 40 ? 'HOLD' : 'SELL',
          confidence: 0.7,
        }));
    } catch {
      return [];
    }
  }

  private async fetchPortfolio() {
    try {
      const positions = await this.prisma.position.findMany({
        orderBy: { updatedAt: 'desc' },
      });

      let totalValue = 0;
      let totalPnl = 0;
      let totalCost = 0;
      const enriched: ResearchOverview['portfolio']['positions'] = [];

      for (const p of positions) {
        const currentPrice = p.currentPrice || p.avgPrice;
        const value = currentPrice * p.quantity;
        const cost = p.avgPrice * p.quantity;
        const pnl = p.pnl ?? (value - cost);
        totalValue += value;
        totalPnl += pnl;
        totalCost += cost;

        // Check for upcoming earnings
        const earnings = await this.prisma.earningsEvent.findFirst({
          where: {
            symbol: p.symbol,
            reportDate: { gte: new Date() },
          },
          orderBy: { reportDate: 'asc' },
        });

        enriched.push({
          symbol: p.symbol,
          quantity: p.quantity,
          avgPrice: p.avgPrice,
          currentPrice: p.currentPrice || null,
          value: +value.toFixed(2),
          pnl: pnl != null ? +pnl.toFixed(2) : null,
          hasEarningsSoon: !!earnings,
          earningsDate: earnings?.reportDate?.toISOString()?.split('T')[0] || null,
        });
      }

      return {
        positionCount: positions.length,
        totalValue: +totalValue.toFixed(2),
        totalPnl: +totalPnl.toFixed(2),
        totalPnlPct: totalCost > 0 ? +((totalPnl / totalCost) * 100).toFixed(2) : 0,
        positions: enriched,
      };
    } catch {
      return { positionCount: 0, totalValue: 0, totalPnl: 0, totalPnlPct: 0, positions: [] };
    }
  }

  private async fetchMarketContext() {
    try {
      const indicators = await this.prisma.macroIndicator.findMany({
        where: {
          indicator: { in: ['VIX', 'FEDFUNDS', 'DGS10', 'GOLD', 'WTI', 'BTC', 'SPX'] },
        },
        orderBy: { date: 'desc' },
        take: 20,
      });

      const latest = new Map<string, typeof indicators[0]>();
      for (const ind of indicators) {
        if (!latest.has(ind.indicator)) latest.set(ind.indicator, ind);
      }

      const vix = latest.get('VIX');
      const fedRate = latest.get('FEDFUNDS');
      const us10y = latest.get('DGS10');
      const gold = latest.get('GOLD');
      const oil = latest.get('WTI');
      const btc = latest.get('BTC');
      const spx = latest.get('SPX');

      return {
        vixLevel: vix?.value ?? null,
        vixChange: vix?.previous != null ? +(vix.value - vix.previous).toFixed(2) : null,
        fedRate: fedRate?.value ?? null,
        us10y: us10y?.value ?? null,
        goldPrice: gold?.value ?? null,
        oilPrice: oil?.value ?? null,
        bitcoinPrice: btc?.value ?? null,
        spxLevel: spx?.value ?? null,
      };
    } catch {
      return { vixLevel: null, vixChange: null, fedRate: null, us10y: null, goldPrice: null, oilPrice: null, bitcoinPrice: null, spxLevel: null };
    }
  }

  private async fetchRecentDecisions() {
    try {
      const trades = await this.prisma.trade.findMany({
        where: { origin: { in: ['agent', 'strategy'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      return trades.map((t) => ({
        symbol: t.symbol,
        decision: t.side === 'buy' ? 'ENTRY' : 'EXIT',
        composite: t.entryPrice || 0,
        reason: `${t.strategy || 'manual'} — ${t.side} ${t.quantity} @ ${t.entryPrice}`,
        timestamp: t.createdAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }

  private async fetchUpcomingEvents() {
    try {
      const events = await this.prisma.earningsEvent.findMany({
        where: { reportDate: { gte: new Date() } },
        orderBy: { reportDate: 'asc' },
        take: 10,
      });

      // Get user's positions to cross-reference
      const positions = await this.prisma.position.findMany({ select: { symbol: true } });
      const heldSymbols = new Set(positions.map((p) => p.symbol));

      return events.map((e) => ({
        type: 'earnings',
        label: `${e.symbol} Earnings${e.epsEstimate ? ` (est $${e.epsEstimate})` : ''}`,
        icon: '📊',
        startsAt: e.reportDate.toISOString(),
        affectsPositions: heldSymbols.has(e.symbol) ? [e.symbol] : [],
      }));
    } catch {
      return [];
    }
  }

  private async fetchPositionNews() {
    try {
      const positions = await this.prisma.position.findMany({ select: { symbol: true } });
      const heldSymbols = positions.map((p) => p.symbol);

      if (heldSymbols.length === 0) return [];

      const news = await this.prisma.newsArticle.findMany({
        where: { symbol: { in: heldSymbols } },
        orderBy: { publishedAt: 'desc' },
        take: 15,
      });

      return news.map((n) => ({
        symbol: n.symbol,
        headline: n.headline?.substring(0, 100) || '',
        sentiment: n.sentiment,
        impact: n.impact,
        publishedAt: n.publishedAt.toISOString(),
      }));
    } catch {
      return [];
    }
  }

  private async fetchSectorPerformance() {
    // ETF-based sector performance — uses hardcoded sector map since
    // we don't have live sector ETF data in DB yet. Falls back gracefully.
    const sectors = [
      { sector: 'Technology', etf: 'XLK' },
      { sector: 'Financials', etf: 'XLF' },
      { sector: 'Energy', etf: 'XLE' },
      { sector: 'Healthcare', etf: 'XLV' },
      { sector: 'Consumer Disc', etf: 'XLY' },
      { sector: 'Industrials', etf: 'XLI' },
    ];

    try {
      const results = await Promise.allSettled(
        sectors.map(async (s) => {
          const bar = await this.prisma.marketBar.findFirst({
            where: { symbol: { ticker: s.etf } },
            orderBy: { timestamp: 'desc' },
          });
          if (!bar) return { ...s, changePct: 0 };
          const prevBar = await this.prisma.marketBar.findFirst({
            where: {
              symbol: { ticker: s.etf },
              timestamp: { lt: bar.timestamp },
            },
            orderBy: { timestamp: 'desc' },
          });
          const changePct = prevBar ? +(((bar.close - prevBar.close) / prevBar.close) * 100).toFixed(2) : 0;
          return { ...s, changePct };
        }),
      );
      return results.map((r) => (r.status === 'fulfilled' ? r.value : { sector: '—', etf: '—', changePct: 0 }));
    } catch {
      return sectors.map((s) => ({ ...s, changePct: 0 }));
    }
  }
}
