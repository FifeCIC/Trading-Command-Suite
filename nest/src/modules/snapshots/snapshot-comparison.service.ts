import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ScoringService } from '../scoring/scoring.service';
import { SeasonalAffinityService } from '../scoring/seasonal-affinity.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
import { MarketBar } from '../directives/interfaces/directive.interface';

/**
 * SnapshotComparisonService
 * =========================
 * Deep date-range comparison engine for stock research.
 *
 * For two dates and a symbol, this service:
 *  1. Fetches OHLCV bars around each date
 *  2. Runs the full directive scoring pipeline at both dates
 *  3. Cross-references news articles between the dates
 *  4. Computes directive-level attribution (which directives changed?)
 *  5. Calculates seasonality/regime context for both dates
 *  6. Returns a comprehensive comparison with deltas
 *
 * This powers the date-range comparison feature in SnapshotLibraryPage
 * and provides the foundation for the "research two moments in time" use case.
 */

export interface DateSnapshot {
  date: string;
  closestBar: {
    timestamp: string;
    open: number; high: number; low: number; close: number;
    volume: number;
  } | null;
  barCount: number;
  chartBars: Array<{
    time: string; open: number; high: number; low: number; close: number;
  }>;
  scoring: {
    composite: number;
    normalizedScore: number;
    signal: string;
    confidence: number;
    directiveCount: number;
    activeDirectives: number;
    breakouts: Record<string, number>;
    subScores: { technical: number; sentiment: number; risk: number };
    seasonalityMultiplier: number;
  } | null;
  newsCount: number;
  newsSummary: Array<{
    headline: string; sentiment: number; impact: string; publishedAt: string;
  }>;
}

export interface SnapshotComparison {
  symbol: string;
  snapA: DateSnapshot;
  snapB: DateSnapshot;
  delta: {
    priceChange: number;
    priceChangePct: number;
    compositeChange: number;
    signalChanged: boolean;
    signalA: string;
    signalB: string;
    biggestDirectiveMover: { id: string; delta: number } | null;
    newsBetween: number;
    seasonalityShift: string | null;
  };
}

@Injectable()
export class SnapshotComparisonService {
  private readonly logger = new Logger(SnapshotComparisonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scoringService: ScoringService,
    private readonly seasonality: SeasonalAffinityService,
    private readonly protocolGating: ProtocolGatingService,
  ) {}

  async compare(
    symbol: string,
    dateA: string,
    dateB: string,
    protocolId?: string,
  ): Promise<SnapshotComparison> {
    const ticker = symbol.toUpperCase();
    const sym = await this.prisma.symbol.findFirst({ where: { ticker } });
    if (!sym) throw new Error(`Symbol ${ticker} not found`);

    const [snapA, snapB] = await Promise.all([
      this.buildSnapshot(sym.id, ticker, dateA, protocolId),
      this.buildSnapshot(sym.id, ticker, dateB, protocolId),
    ]);

    // News between dates
    const newsBetween = await this.prisma.newsArticle.count({
      where: {
        symbol: ticker,
        publishedAt: {
          gte: new Date(Math.min(
            new Date(dateA).getTime(),
            new Date(dateB).getTime(),
          )),
          lte: new Date(Math.max(
            new Date(dateA).getTime(),
            new Date(dateB).getTime(),
          )),
        },
      },
    });

    // Compute attribution
    const attribution = this.computeAttribution(snapA, snapB);

    // Seasonality shift
    const seasonalityA = this.seasonality.getMultiplier(
      protocolId || 'spy-day-v1',
      new Date(dateA),
    );
    const seasonalityB = this.seasonality.getMultiplier(
      protocolId || 'spy-day-v1',
      new Date(dateB),
    );
    const seasonalityShift =
      Math.abs(seasonalityB - seasonalityA) > 0.05
        ? `${(seasonalityA * 100).toFixed(0)}% → ${(seasonalityB * 100).toFixed(0)}%`
        : null;

    return {
      symbol: ticker,
      snapA,
      snapB,
      delta: {
        priceChange: +(snapB.closestBar!.close - snapA.closestBar!.close).toFixed(2),
        priceChangePct: +(
          ((snapB.closestBar!.close - snapA.closestBar!.close) /
            snapA.closestBar!.close) *
          100
        ).toFixed(2),
        compositeChange: snapA.scoring && snapB.scoring
          ? +(snapB.scoring.composite - snapA.scoring.composite).toFixed(1)
          : 0,
        signalChanged: snapA.scoring?.signal !== snapB.scoring?.signal,
        signalA: snapA.scoring?.signal || 'unknown',
        signalB: snapB.scoring?.signal || 'unknown',
        biggestDirectiveMover: attribution.biggestMover,
        newsBetween,
        seasonalityShift,
      },
    };
  }

  // ── Private helpers ────────────────────────────────────

  private async buildSnapshot(
    symbolId: string,
    ticker: string,
    date: string,
    protocolId?: string,
  ): Promise<DateSnapshot> {
    const targetDate = new Date(date);

    // Fetch bars around target date (±7 days)
    const bars = await this.prisma.marketBar.findMany({
      where: {
        symbolId,
        timestamp: {
          gte: new Date(targetDate.getTime() - 7 * 24 * 60 * 60 * 1000),
          lte: new Date(targetDate.getTime() + 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { timestamp: 'asc' },
      take: 200,
    });

    // Closest bar to target date
    const closest = bars.length > 0
      ? bars.reduce((prev, curr) =>
          Math.abs(curr.timestamp.getTime() - targetDate.getTime()) <
          Math.abs(prev.timestamp.getTime() - targetDate.getTime())
            ? curr
            : prev,
        )
      : null;

    // Run directive scoring if we have bars
    let scoring: DateSnapshot['scoring'] = null;
    if (bars.length >= 20) {
      try {
        const marketBars: MarketBar[] = bars.map((b) => ({
          timestamp: b.timestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        }));

        // Use gated pipeline if protocol specified, otherwise raw scoring
        if (protocolId) {
          // Supply the full 1d/1h/15m bundle — a snapshot that scores without it
          // records a number no live path would produce, so the comparison it
          // exists to make is invalid (#735, MST-004).
          const sym = await this.prisma.symbol.findFirst({ where: { ticker: ticker.toUpperCase() } });
          const { dayBars, hourBars, min15Bars } = sym
            ? await this.protocolGating.loadHigherTfBundle(sym.id, protocolId)
            : { dayBars: [], hourBars: [], min15Bars: [] };
          const gated = await this.protocolGating.scoreWithGating(
            ticker,
            marketBars,
            protocolId,
            { dayBars, hourBars, min15Bars },
          );
          scoring = {
            composite: gated.composite,
            normalizedScore: gated.signalPct,
            signal: gated.signal,
            confidence: 0.5,
            directiveCount: gated.meta?.directiveCount ?? 0,
            activeDirectives: gated.meta?.gatedCount ?? 0,
            breakouts: this.flattenBreakouts(gated.breakouts),
            subScores: {
              technical: gated.subScores?.technical ?? 50,
              sentiment: gated.subScores?.sentiment ?? 50,
              risk: gated.subScores?.risk ?? 50,
            },
            seasonalityMultiplier: this.seasonality.getMultiplier(
              protocolId || 'spy-day-v1',
              targetDate,
            ),
          };
        } else {
          // Run full scoring pipeline for this symbol
          const result = await this.scoringService.runScoring([ticker]);
          const scored = result.ranked.find((r) => r.ticker === ticker);
          if (scored && scored.score > 0) {
            const breakouts: Record<string, number> = {};
            if (scored.breakdown && Array.isArray(scored.breakdown)) {
              for (const b of scored.breakdown) {
                breakouts[b.directiveId || b.name || 'unknown'] =
                  b.contribution ?? b.score ?? 0;
              }
            }
            scoring = {
              composite: scored.score,
              normalizedScore: scored.normalizedScore ?? scored.score,
              signal: scored.signal || 'HOLD',
              confidence: scored.confidence ?? 0.5,
              directiveCount: scored.totalDirectives ?? 0,
              activeDirectives: scored.activeDirectives ?? 0,
              breakouts,
              subScores: { technical: 50, sentiment: 50, risk: 50 },
              seasonalityMultiplier: this.seasonality.getMultiplier(
                protocolId || 'spy-day-v1',
                targetDate,
              ),
            };
          }
        }
      } catch (err) {
        this.logger.warn(
          `Scoring failed for ${ticker} at ${date}: ${(err as Error).message}`,
        );
      }
    }

    // News around this date (±3 days)
    const news = await this.prisma.newsArticle.findMany({
      where: {
        symbol: ticker,
        publishedAt: {
          gte: new Date(targetDate.getTime() - 3 * 24 * 60 * 60 * 1000),
          lte: new Date(targetDate.getTime() + 3 * 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 10,
    });

    return {
      date,
      closestBar: closest
        ? {
            timestamp: closest.timestamp.toISOString(),
            open: closest.open,
            high: closest.high,
            low: closest.low,
            close: closest.close,
            volume: closest.volume,
          }
        : null,
      barCount: bars.length,
      chartBars: bars.slice(-60).map((b) => ({
        time: b.timestamp.toISOString().split('T')[0],
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
      })),
      scoring,
      newsCount: news.length,
      newsSummary: news.slice(0, 5).map((n) => ({
        headline: n.headline?.substring(0, 120) || '',
        sentiment: n.sentiment,
        impact: n.impact,
        publishedAt: n.publishedAt.toISOString(),
      })),
    };
  }

  private computeAttribution(snapA: DateSnapshot, snapB: DateSnapshot) {
    let biggestMover: { id: string; delta: number } | null = null;

    if (snapA.scoring?.breakouts && snapB.scoring?.breakouts) {
      let maxDelta = 0;
      const allKeys = new Set([
        ...Object.keys(snapA.scoring.breakouts),
        ...Object.keys(snapB.scoring.breakouts),
      ]);

      for (const key of allKeys) {
        const a = snapA.scoring.breakouts[key] || 0;
        const b = snapB.scoring.breakouts[key] || 0;
        const delta = Math.abs(b - a);
        if (delta > maxDelta) {
          maxDelta = delta;
          biggestMover = { id: key, delta: +(b - a).toFixed(1) };
        }
      }
    }

    return { biggestMover };
  }

  /** Flatten grouped directive breakouts into simple key→score map */
  private flattenBreakouts(
    breakouts: Record<string, Array<{ directiveId?: string; contribution?: number; score?: number }>>,
  ): Record<string, number> {
    const flat: Record<string, number> = {};
    for (const [group, directives] of Object.entries(breakouts)) {
      if (Array.isArray(directives)) {
        for (const d of directives) {
          const key = d.directiveId || group;
          flat[key] = d.contribution ?? d.score ?? 0;
        }
      }
    }
    return flat;
  }
}
