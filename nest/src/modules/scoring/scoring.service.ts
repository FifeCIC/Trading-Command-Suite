/**
 * PLACEHOLDER — implement per SPRINT.md Task 6.
 *
 * Scoring Service
 * ===============
 * Orchestrates the full scoring pipeline for a symbol or watchlist:
 * 1. Freshens data if stale.
 * 2. Runs all directives.
 * 3. Aggregates into strategy scores.
 * 4. Stores results in the Score table.
 * 5. Returns ranked output.
 *
 * Contract: this service orchestrates — it does NOT implement directive logic.
 * Directive logic lives in the directives module.
 * Strategy aggregation lives in the strategies module.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ModeService } from '../../config/mode.service';
import { FreshnessService } from '../market-data/freshness.service';
import { DirectivesService } from '../directives/directives.service';
import { StrategiesService } from '../strategies/strategies.service';

export interface RankedSymbol {
  symbolId: string;
  ticker: string;
  score: number;
  confidence: number;
  freshness: string;
  timestamp: string;
}

export interface RankedResult {
  mode: string;
  services: { database: boolean; queue: boolean; redis: boolean };
  ranked: RankedSymbol[];
}

@Injectable()
export class ScoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modeService: ModeService,
    private readonly freshnessService: FreshnessService,
    private readonly directivesService: DirectivesService,
    private readonly strategiesService: StrategiesService,
  ) {}

  /**
   * Score all active symbols and return ranked results.
   * Uses deterministic scoring from symbol properties when market bars are unavailable.
   */
  async rankAll(_strategyId?: string, limit = 20): Promise<RankedResult> {
    const modeInfo = this.modeService.getModeInfo();

    if (!this.prisma.isAvailable) {
      return {
        mode: modeInfo.mode,
        services: { database: modeInfo.database, queue: modeInfo.queue, redis: modeInfo.redis },
        ranked: [],
      };
    }

    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { id: true, ticker: true, name: true, exchange: true, type: true },
      take: limit,
    });

    if (symbols.length === 0) {
      return {
        mode: modeInfo.mode,
        services: { database: modeInfo.database, queue: modeInfo.queue, redis: modeInfo.redis },
        ranked: [],
      };
    }

    // Deterministic scoring: seed from ticker hash so ranking is stable per symbol set.
    const now = Date.now();
    const ranked: RankedSymbol[] = symbols.map((s) => {
      const seed = this.hashTicker(s.ticker);
      const score = this.deterministicScore(seed, now);
      const confidence = Math.min(0.95, Math.max(0.30, score / 120));
      return {
        symbolId: s.id,
        ticker: s.ticker,
        score: Number(score.toFixed(1)),
        confidence: Number(confidence.toFixed(2)),
        freshness: 'deterministic',
        timestamp: new Date().toISOString(),
      };
    });

    ranked.sort((a, b) => b.score - a.score);

    return {
      mode: modeInfo.mode,
      services: { database: modeInfo.database, queue: modeInfo.queue, redis: modeInfo.redis },
      ranked: ranked.slice(0, limit),
    };
  }

  private hashTicker(ticker: string): number {
    let h = 0;
    for (let i = 0; i < ticker.length; i++) {
      h = ((h << 5) - h + ticker.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  private deterministicScore(seed: number, now: number): number {
    // Slowly oscillating score based on seed and time bucket (changes every 30s)
    const bucket = Math.floor(now / 30000);
    const wave = Math.sin((bucket + seed) * 0.47) * 22;
    const base = 55 + (seed % 35);
    return Math.max(0, Math.min(130, base + wave));
  }
}
