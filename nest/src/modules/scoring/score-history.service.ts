/**
 * Score History Service
 * =====================
 * Stores and retrieves scoring result snapshots from the Score table.
 *
 * GET /api/scoring/history/:symbolId       → recent snapshots
 * GET /api/scoring/history/:symbolId/latest → most recent snapshot
 *
 * The Score model requires symbolId + strategyId as foreign keys.
 * strategyId is resolved dynamically (find-or-create) in the caller.
 */

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ScoreSnapshot {
  id: string;
  symbolId: string;
  strategyId: string;
  value: number;
  breakdown: any;
  timestamp: Date;
}

export interface ScoreHistoryEntry {
  id: string;
  value: number;
  confidence: number;
  mode: string;
  breakdown: any;
  timestamp: Date;
}

export interface RecentlyAnalysedSymbol {
  symbolId: string;
  ticker: string;
  latestScore: number;
  latestConfidence: number;
  lastAnalysedAt: string;
  totalRuns: number;
  signal: string;
}

@Injectable()
export class ScoreHistoryService {
  private readonly logger = new Logger(ScoreHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Save a scoring snapshot to the Score table.
   * Caller must supply a valid strategyId (resolved from the DB).
   */
  async storeSnapshot(
    symbolId: string,
    strategyId: string,
    value: number,
    breakdown: any,
  ): Promise<ScoreSnapshot> {
    if (!this.prisma.isAvailable) {
      this.logger.warn('Database unavailable — skipping score snapshot');
      return null as unknown as ScoreSnapshot;
    }

    const record = await this.prisma.score.create({
      data: {
        symbolId,
        strategyId,
        value,
        breakdown,
      },
    });

    this.logger.debug(
      `Stored score snapshot: symbolId=${symbolId} value=${value.toFixed(1)}`,
    );

    return {
      id: record.id,
      symbolId: record.symbolId,
      strategyId: record.strategyId,
      value: record.value,
      breakdown: record.breakdown,
      timestamp: record.timestamp,
    };
  }

  /**
   * Return the most recent score snapshots for a symbol.
   */
  async getHistory(
    symbolId: string,
    limit = 20,
  ): Promise<ScoreHistoryEntry[]> {
    if (!this.prisma.isAvailable) {
      return [];
    }

    const rows = await this.prisma.score.findMany({
      where: { symbolId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      value: r.value,
      confidence: 0,
      mode: 'pipeline',
      breakdown: r.breakdown,
      timestamp: r.timestamp,
    }));
  }

  /**
   * Return the single most recent score snapshot for a symbol.
   * Throws NotFoundException if no scores exist.
   */
  async getLatest(symbolId: string): Promise<ScoreHistoryEntry> {
    if (!this.prisma.isAvailable) {
      throw new NotFoundException(
        `Database unavailable — cannot get latest for ${symbolId}`,
      );
    }

    const row = await this.prisma.score.findFirst({
      where: { symbolId },
      orderBy: { timestamp: 'desc' },
    });

    if (!row) {
      throw new NotFoundException(
        `No score history found for symbolId=${symbolId}`,
      );
    }

    return {
      id: row.id,
      value: row.value,
      confidence: 0,
      mode: 'pipeline',
      breakdown: row.breakdown,
      timestamp: row.timestamp,
    };
  }

  /**
   * Get scoring runs grouped by time + strategy.
   * Supports search, pagination, and per-run signal summaries.
   *
   * Query params:
   *   search    — filter by ticker or strategy name
   *   page      — page number (1-based, default 1)
   *   limit     — runs per page (default 30, max 100)
   *   strategyId — filter by specific strategy
   */
  async getRuns(opts?: {
    search?: string;
    page?: number;
    limit?: number;
    strategyId?: string;
  }): Promise<{
    runs: Array<{
      id: string;
      timestamp: string;
      strategyId: string;
      strategyName: string;
      symbolsScored: number;
      avgScore: number;
      signalSummary: { buy: number; sell: number; neutral: number };
      topSymbol: { ticker: string; value: number } | null;
      scores: Array<{ ticker: string; value: number; confidence: number }>;
    }>;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    queryTimeMs: number;
  }> {
    const startTime = Date.now();
    const page = Math.max(1, opts?.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts?.limit ?? 30));
    const search = opts?.search?.trim() || null;
    const strategyFilter = opts?.strategyId || null;

    if (!this.prisma.isAvailable) {
      return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
    }

    // Build where clause for search
    const where: any = {};
    if (strategyFilter) where.strategyId = strategyFilter;

    // Fetch raw scores — if search is active, also fetch symbol tickers to filter
    let scores;
    if (search) {
      // Find matching symbols first
      const matchingSymbols = await this.prisma.symbol.findMany({
        where: { ticker: { contains: search.toUpperCase() } },
        select: { id: true, ticker: true },
      });
      const matchingIds = matchingSymbols.map((s) => s.id);

      // Also check strategy names
      const matchingStrategies = await this.prisma.strategy.findMany({
        where: { name: { contains: search } },
        select: { id: true },
      });

      const symbolFilter = matchingIds.length > 0 ? { symbolId: { in: matchingIds } } : {};
      const strategyNameFilter = matchingStrategies.length > 0 ? { strategyId: { in: matchingStrategies.map((s) => s.id) } } : {};

      if (matchingIds.length === 0 && matchingStrategies.length === 0) {
        return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
      }

      where.OR = [];
      if (matchingIds.length > 0) where.OR.push(symbolFilter);
      if (matchingStrategies.length > 0) where.OR.push(strategyNameFilter);
    }

    scores = await this.prisma.score.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { timestamp: 'desc' },
      take: 1000,
      include: { symbol: { select: { ticker: true } } },
    });

    if (scores.length === 0) {
      return { runs: [], total: 0, page, pageSize, totalPages: 0, queryTimeMs: Date.now() - startTime };
    }

    // Resolve strategy names
    const strategyIds = [...new Set(scores.map((s) => s.strategyId).filter(Boolean))];
    const strategies = strategyIds.length > 0
      ? await this.prisma.strategy.findMany({
          where: { id: { in: strategyIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameMap = new Map(strategies.map((s) => [s.id, s.name]));

    // Group by minute + strategyId (each unique run)
    const groups = new Map<string, typeof scores>();
    for (const s of scores) {
      const ts = new Date(s.timestamp);
      ts.setSeconds(0, 0);
      const key = `${ts.toISOString()}::${s.strategyId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    }

    // Build run objects with signal summaries
    const allRuns = Array.from(groups.entries())
      .map(([key, entries]) => {
        const [timestamp] = key.split('::');
        const strategyId = entries[0]?.strategyId || 'unknown';
        const values = entries.map((e) => e.value);
        const avgScore = values.reduce((a, b) => a + b, 0) / values.length;

        // Signal classification
        let buy = 0, sell = 0, neutral = 0;
        for (const e of entries) {
          if (e.value >= 60) buy++;
          else if (e.value <= 40) sell++;
          else neutral++;
        }

        // Top symbol
        const best = entries.reduce((best, e) =>
          e.value > (best?.value ?? -999) ? e : best, null as any);
        const topSymbol = best ? { ticker: (best as any).symbol?.ticker || best.symbolId, value: best.value } : null;

        return {
          id: `run-${new Date(timestamp).getTime()}-${strategyId.slice(0, 8)}`,
          timestamp,
          strategyId,
          strategyName: nameMap.get(strategyId) || 'Unknown Strategy',
          symbolsScored: entries.length,
          avgScore: Math.round(avgScore * 10) / 10,
          signalSummary: { buy, sell, neutral },
          topSymbol,
          scores: entries.map((e) => ({
            ticker: (e as any).symbol?.ticker || e.symbolId,
            value: e.value,
            confidence: 0,
          })),
        };
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = allRuns.length;
    const totalPages = Math.ceil(total / pageSize);
    const offset = (page - 1) * pageSize;
    const runs = allRuns.slice(offset, offset + pageSize);

    return { runs, total, page, pageSize, totalPages, queryTimeMs: Date.now() - startTime };
  }

  /**
   * Get detailed scores for a specific run (by timestamp + strategyId).
   */
  async getRunScores(runId: string): Promise<{
    run: {
      id: string;
      timestamp: string;
      strategyId: string;
      strategyName: string;
      scores: Array<{
        ticker: string;
        value: number;
        breakdown: any;
      }>;
    } | null;
  }> {
    // runId format: "run-{epochMs}-{strategyPrefix}"
    const parts = runId.replace('run-', '').split('-');
    const epochMs = parseInt(parts[0], 10);
    if (isNaN(epochMs)) return { run: null };

    const runDate = new Date(epochMs);
    const windowStart = new Date(runDate);
    windowStart.setSeconds(0, 0);
    const windowEnd = new Date(windowStart.getTime() + 60000);

    const strategyPrefix = parts.slice(1).join('-');

    const scores = await this.prisma.score.findMany({
      where: {
        timestamp: { gte: windowStart, lt: windowEnd },
        ...(strategyPrefix ? { strategyId: { startsWith: strategyPrefix } } : {}),
      },
      orderBy: { value: 'desc' },
      include: { symbol: { select: { ticker: true } } },
    });

    if (scores.length === 0) return { run: null };

    const strategyId = scores[0].strategyId;
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
      select: { name: true },
    });

    return {
      run: {
        id: runId,
        timestamp: windowStart.toISOString(),
        strategyId,
        strategyName: strategy?.name || 'Unknown',
        scores: scores.map((s) => ({
          ticker: (s as any).symbol?.ticker || s.symbolId,
          value: s.value,
          breakdown: s.breakdown,
        })),
      },
    };
  }

  /**
   * GET /api/scoring/recently-analysed
   * Returns distinct symbols that have been scored, with their latest score
   * and ticker name, ordered by most recent first.
   */
  async getRecentlyAnalysed(limit = 30): Promise<RecentlyAnalysedSymbol[]> {
    if (!this.prisma.isAvailable) return [];

    const scores = await this.prisma.score.findMany({
      select: { symbolId: true, value: true, breakdown: true, timestamp: true },
      orderBy: { timestamp: 'desc' },
      take: 500,
    });

    const symbolMap = new Map<string, { symbolId: string; latestScore: number; latestConfidence: number; lastAnalysedAt: Date; totalRuns: number }>();
    for (const s of scores) {
      const existing = symbolMap.get(s.symbolId);
      if (!existing) {
        symbolMap.set(s.symbolId, {
          symbolId: s.symbolId, latestScore: s.value,
          latestConfidence: (s.breakdown as any)?.confidence ?? 0,
          lastAnalysedAt: s.timestamp, totalRuns: 1,
        });
      } else {
        existing.totalRuns++;
      }
    }

    const symbolIds = Array.from(symbolMap.keys());
    const symbols = symbolIds.length > 0
      ? await this.prisma.symbol.findMany({ where: { id: { in: symbolIds } }, select: { id: true, ticker: true } }).catch(() => [])
      : [];
    const tickerMap = new Map(symbols.map((s) => [s.id, s.ticker]));

    return Array.from(symbolMap.values())
      .map((entry) => {
        const ticker = tickerMap.get(entry.symbolId) || entry.symbolId.slice(0, 8);
        const signal = entry.latestScore >= 60 ? 'entry' : entry.latestScore >= 40 ? 'watch' : 'defensive';
        return {
          symbolId: entry.symbolId, ticker,
          latestScore: Number(entry.latestScore.toFixed(1)),
          latestConfidence: Number(entry.latestConfidence.toFixed(2)),
          lastAnalysedAt: entry.lastAnalysedAt.toISOString(),
          totalRuns: entry.totalRuns, signal,
        };
      })
      .sort((a, b) => new Date(b.lastAnalysedAt).getTime() - new Date(a.lastAnalysedAt).getTime())
      .slice(0, limit);
  }
}
