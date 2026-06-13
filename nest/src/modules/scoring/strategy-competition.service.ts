/**
 * Strategy Competition Service
 * ==============================
 * Meta-strategy layer that compares signals across strategies and determines
 * the single best next move. Sits above individual strategy scoring.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DirectivesService } from '../directives/directives.service';

export interface StrategySignal {
  symbol: string;
  action: 'buy' | 'sell' | 'hold';
  score: number;
  normalizedScore: number;
  strategyId: string;
  strategyName: string;
  confidence: number;
  directiveAgreement: number; // 0-1 fraction of directives agreeing
  timestamp: string;
}

export interface StrategyWeight {
  strategyId: string;
  strategyName: string;
  winRate: number;
  totalTrades: number;
  weight: number;
}

export interface UnifiedRanking {
  symbol: string;
  action: string;
  score: number;
  strategyId: string;
  strategyName: string;
  conviction: number; // 0-1 — how convinced we should be
}

export interface CompetitionResult {
  unifiedRanking: UnifiedRanking[];
  strategyPerformance: StrategyWeight[];
  topStrategy: string | null;
  topSymbol: string | null;
  totalSignals: number;
  strategiesActive: number;
  timestamp: string;
}

@Injectable()
export class StrategyCompetitionService {
  private readonly logger = new Logger(StrategyCompetitionService.name);

  // Mock strategy performance (replaced by real PerformanceService in production)
  private strategyStats: Map<string, { winRate: number; totalTrades: number }> = new Map();

  constructor(private readonly directivesService: DirectivesService) {}

  /**
   * Run the competition: rank signals across all strategies.
   */
  compete(
    signals: StrategySignal[],
    options?: { symbols?: string[]; strategies?: string[]; limit?: number },
  ): CompetitionResult {
    const limit = options?.limit || 10;

    // Filter
    let filtered = signals;
    if (options?.symbols?.length) {
      const symSet = new Set(options.symbols.map((s) => s.toUpperCase()));
      filtered = filtered.filter((s) => symSet.has(s.symbol.toUpperCase()));
    }
    if (options?.strategies?.length) {
      const stratSet = new Set(options.strategies);
      filtered = filtered.filter((s) => stratSet.has(s.strategyId));
    }

    if (filtered.length === 0) {
      return {
        unifiedRanking: [],
        strategyPerformance: this.getStrategyWeights(),
        topStrategy: null,
        topSymbol: null,
        totalSignals: 0,
        strategiesActive: this.strategyStats.size,
        timestamp: new Date().toISOString(),
      };
    }

    // Step 1: Get strategy weights from performance
    const weights = this.getStrategyWeights();
    const weightMap = new Map(weights.map((w) => [w.strategyId, w.weight]));

    // Step 2: Compute conviction for each signal
    const ranked: UnifiedRanking[] = filtered.map((signal) => {
      const strategyWeight = weightMap.get(signal.strategyId) || 0.8;
      const conviction = this.computeConviction(signal, strategyWeight);

      return {
        symbol: signal.symbol,
        action: signal.action,
        score: signal.score,
        strategyId: signal.strategyId,
        strategyName: signal.strategyName,
        conviction: Number(conviction.toFixed(2)),
      };
    });

    // Step 3: Sort by conviction descending, then score
    ranked.sort((a, b) => {
      if (b.conviction !== a.conviction) return b.conviction - a.conviction;
      return b.score - a.score;
    });

    // Step 4: Keep top N per symbol (at most 3 per symbol)
    const perSymbol = new Map<string, UnifiedRanking[]>();
    for (const r of ranked) {
      const existing = perSymbol.get(r.symbol) || [];
      if (existing.length < 3) {
        existing.push(r);
        perSymbol.set(r.symbol, existing);
      }
    }

    // Flatten, keeping overall scoring rank
    const unified: UnifiedRanking[] = [];
    const seen = new Set<string>();
    for (const r of ranked) {
      const key = `${r.symbol}|${r.strategyId}`;
      if (!seen.has(key)) {
        seen.add(key);
        unified.push(r);
      }
    }

    const top = unified.slice(0, limit);
    const topStrategy = top[0]?.strategyName || null;
    const topSymbol = top[0]?.symbol || null;
    const activeStrategies = new Set(signals.map((s) => s.strategyId));

    this.logger.log(
      `Competition: ${unified.length} signals across ${activeStrategies.size} strategies → top: ${topSymbol} via ${topStrategy}`,
    );

    return {
      unifiedRanking: top,
      strategyPerformance: weights,
      topStrategy,
      topSymbol,
      totalSignals: unified.length,
      strategiesActive: activeStrategies.size,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate mock signals from the directives service for all symbols.
   * In production, this would pull from the scoring pipeline.
   */
  async generateSignalsFromDirectives(
    symbols: Array<{ ticker: string }>,
    strategyId = 'conviction-dip',
  ): Promise<StrategySignal[]> {
    const signals: StrategySignal[] = [];

    for (const sym of symbols) {
      try {
        // Generate a mock signal using directive count as a proxy
        const directiveCount = (this.directivesService as any).registry?.size || 32;
        const mockScore = 40 + Math.random() * 40;
        const mockAgreement = 0.3 + Math.random() * 0.5;

        signals.push({
          symbol: sym.ticker,
          action: mockScore >= 60 ? 'buy' : mockScore >= 40 ? 'hold' : 'sell',
          score: Number(mockScore.toFixed(1)),
          normalizedScore: Number(mockScore.toFixed(1)),
          strategyId,
          strategyName: 'Conviction Dip Accumulation',
          confidence: mockAgreement > 0.6 ? 0.75 : mockAgreement > 0.3 ? 0.5 : 0.3,
          directiveAgreement: Number(mockAgreement.toFixed(2)),
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        this.logger.warn(`Failed to generate signal for ${sym.ticker}: ${(err as Error).message}`);
      }
    }

    return signals;
  }

  /**
   * Update strategy performance stats (called by performance module).
   */
  updateStrategyStats(strategyId: string, stats: { winRate: number; totalTrades: number }): void {
    this.strategyStats.set(strategyId, stats);
  }

  /**
   * Get current competition status.
   */
  getStatus(): {
    activeStrategies: number;
    totalDirectives: number;
    strategiesTracked: number;
  } {
    return {
      activeStrategies: this.strategyStats.size,
      totalDirectives: 75,
      strategiesTracked: this.strategyStats.size,
    };
  }

  // ── Private ──

  private computeConviction(signal: StrategySignal, strategyWeight: number): number {
    const scoreComponent = signal.normalizedScore / 100; // 0-1
    const agreementComponent = signal.directiveAgreement; // 0-1
    const confidenceComponent = signal.confidence; // 0-1

    // Weighted blend: 40% score, 30% agreement, 20% confidence, 10% strategy weight
    return (
      scoreComponent * 0.4 +
      agreementComponent * 0.3 +
      confidenceComponent * 0.2 +
      strategyWeight * 0.1
    );
  }

  private getStrategyWeights(): StrategyWeight[] {
    const weights: StrategyWeight[] = [
      { strategyId: 'conviction-dip', strategyName: 'Conviction Dip', winRate: 0.65, totalTrades: 42, weight: 0 },
      { strategyId: 'momentum-breakout', strategyName: 'Momentum Breakout', winRate: 0.58, totalTrades: 28, weight: 0 },
      { strategyId: 'mean-reversion', strategyName: 'Mean Reversion', winRate: 0.62, totalTrades: 35, weight: 0 },
      { strategyId: 'trend-following', strategyName: 'Trend Following', winRate: 0.70, totalTrades: 20, weight: 0 },
      { strategyId: 'forex-mean-reversion', strategyName: 'Forex Mean Reversion', winRate: 0.55, totalTrades: 15, weight: 0 },
    ];

    for (const w of weights) {
      const stats = this.strategyStats.get(w.strategyId);
      if (stats) {
        w.winRate = stats.winRate;
        w.totalTrades = stats.totalTrades;
      }
      // Weight formula: winRate * sigmoid(totalTrades/20) — more trades = more confidence
      const tradeConfidence = 1 / (1 + Math.exp(-w.totalTrades / 20));
      w.weight = Number((w.winRate * (0.5 + 0.5 * tradeConfidence)).toFixed(2));
    }

    return weights;
  }
}
