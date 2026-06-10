/**
 * Scoring Service
 * ===============
 * Orchestrates the full scoring pipeline:
 * 1. Loads active symbols from DB.
 * 2. Fetches market bars (or uses deterministic fallback if none).
 * 3. Runs all directives via DirectivesService.
 * 4. Aggregates via strategy weights (Task 5).
 * 5. Returns ranked output.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { DirectivesService } from '../directives/directives.service';
import {
  DirectiveInput,
  MarketBar,
} from '../directives/interfaces/directive.interface';

/** Canonical directive weights from docs/CANONICAL-DIRECTIVE-REFERENCE.md */
const STRATEGY_WEIGHTS: Record<string, number> = {
  'rsi-oversold': 24,
  'macd-crossover': 22,
  'ema-structure': 20,
  'atr-dip': 18,
  'volume-confirmation': 16,
};

const ENTRY_THRESHOLD = 60;
const WATCH_THRESHOLD = 40;

export interface DirectiveBreakdown {
  directiveId: string;
  name: string;
  score: number;
  weight: number;
  contribution: number;
  confidence: number;
  reason: string;
}

export interface RankedSymbol {
  symbolId: string;
  ticker: string;
  score: number;
  confidence: number;
  freshness: string;
  signal: string;
  breakdown: DirectiveBreakdown[];
  timestamp: string;
}

export interface RankedResult {
  mode: string;
  services: { database: boolean; queue: boolean; redis: boolean };
  strategy: { name: string; entryThreshold: number; watchThreshold: number };
  ranked: RankedSymbol[];
}

@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly directivesService: DirectivesService,
  ) {}

  async rankAll(_strategyId?: string, limit = 20): Promise<RankedResult> {
    const modeInfo = this.modeService.getModeInfo();
    const base = {
      mode: modeInfo.mode,
      services: {
        database: modeInfo.database,
        queue: modeInfo.queue,
        redis: modeInfo.redis,
      },
      strategy: {
        name: 'Conviction Dip Accumulation',
        entryThreshold: ENTRY_THRESHOLD,
        watchThreshold: WATCH_THRESHOLD,
      },
    };

    if (!this.prisma.isAvailable) {
      return { ...base, ranked: [] };
    }

    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { id: true, ticker: true, name: true },
      take: limit,
    });

    if (symbols.length === 0) {
      return { ...base, ranked: [] };
    }

    const ranked: RankedSymbol[] = [];

    for (const symbol of symbols) {
      const bars = await this.loadBars(symbol.id);
      const input: DirectiveInput = { symbol: symbol.ticker, bars };
      const results = this.directivesService.runAll(input);

      const breakdown: DirectiveBreakdown[] = [];
      let totalScore = 0;
      let totalConfidence = 0;
      let weightSum = 0;

      for (const [id, result] of results) {
        const weight = STRATEGY_WEIGHTS[id] ?? 0;
        const contribution = (result.score * weight) / 100;
        totalScore += contribution;
        totalConfidence += result.confidence * weight;
        weightSum += weight;

        const directive = this.directivesService.get(id);
        breakdown.push({
          directiveId: id,
          name: directive?.name ?? id,
          score: result.score,
          weight,
          contribution: Number(contribution.toFixed(1)),
          confidence: result.confidence,
          reason: result.reason,
        });
      }

      const avgConfidence = weightSum > 0 ? totalConfidence / weightSum : 0;
      const finalScore = Math.min(100, Math.max(0, totalScore));
      const signal =
        finalScore >= ENTRY_THRESHOLD
          ? 'entry'
          : finalScore >= WATCH_THRESHOLD
            ? 'watch'
            : 'defensive';

      ranked.push({
        symbolId: symbol.id,
        ticker: symbol.ticker,
        score: Number(finalScore.toFixed(1)),
        confidence: Number(avgConfidence.toFixed(2)),
        freshness: bars.length > 0 ? 'live' : 'deterministic',
        signal,
        breakdown,
        timestamp: new Date().toISOString(),
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    return { ...base, ranked: ranked.slice(0, limit) };
  }

  private async loadBars(symbolId: string): Promise<MarketBar[]> {
    try {
      const rows = await this.prisma.marketBar.findMany({
        where: { symbolId },
        orderBy: { timestamp: 'asc' },
        take: 100,
      });

      return rows.map((r) => ({
        timestamp: r.timestamp,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));
    } catch {
      this.logger.warn(
        `No market bars for ${symbolId} — directives will score 0.`,
      );
      return [];
    }
  }
}
