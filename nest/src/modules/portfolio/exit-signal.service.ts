import { Injectable, Logger } from '@nestjs/common';
import { PortfolioService } from './portfolio.service';
import { ScoreHistoryService } from '../scoring/score-history.service';

export interface ExitSignal {
  symbol: string;
  ticker: string;
  /** Current composite score (0–1000) */
  currentScore: number | null;
  /** Trend over last 5 scoring periods */
  scoreTrend: 'rising' | 'stable' | 'declining' | 'collapsing' | 'no_data';
  /** Points lost in last 3 periods (negative = declining) */
  scoreVelocity: number | null;
  /** Position P&L percentage */
  pnlPct: number | null;
  /** Position value in portfolio currency */
  positionValue: number | null;
  /** Signal: buy/hold/sell/no_data */
  signal: string;
  /** Multi-factor urgency level */
  urgency: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  /** Urgency score 0–100 (higher = more urgent to exit) */
  urgencyScore: number;
  /** Specific, actionable reasons for the exit signal */
  reasons: string[];
  /** When the score was last updated */
  lastUpdated: string | null;
}

@Injectable()
export class ExitSignalService {
  private readonly logger = new Logger(ExitSignalService.name);

  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly scoreHistory: ScoreHistoryService,
  ) {}

  /**
   * Analyze all portfolio positions for exit urgency.
   *
   * Multi-signal approach:
   *   1. Score trend — is the composite score declining over time?
   *   2. Score velocity — how fast is it dropping?
   *   3. P&L status — are we in profit (less urgent) or loss (more urgent)?
   *   4. Signal degradation — has the signal shifted from buy→hold→sell?
   */
  async analyzeAll(): Promise<ExitSignal[]> {
    const [scores, portfolio] = await Promise.all([
      this.portfolioService.getPortfolioScores(),
      this.portfolioService.getPortfolio(),
    ]);

    if (!scores.length) return [];

    const positionMap = new Map(
      portfolio.positions.map((p) => [p.symbol, p]),
    );

    const signals: ExitSignal[] = [];

    for (const score of scores) {
      const pos = positionMap.get(score.symbol) ?? positionMap.get(score.ticker);
      const signal = await this.analyzeSymbol(score, pos ?? null);
      signals.push(signal);
    }

    // Sort by urgency (CRITICAL first)
    const urgencyOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
    signals.sort(
      (a, b) => (urgencyOrder[a.urgency] ?? 5) - (urgencyOrder[b.urgency] ?? 5),
    );

    return signals;
  }

  /**
   * Analyze a single symbol for exit urgency.
   */
  private async analyzeSymbol(
    score: { symbol: string; ticker: string; score: number | null; signal: string; strength: string; dataStatus: string },
    position: { shares: number; value: number; pnl: number; allocation: number } | null,
  ): Promise<ExitSignal> {
    const reasons: string[] = [];
    let urgencyScore = 0; // 0 = no urgency, 100 = exit immediately

    // ── 1. Score trend analysis ──
    const trend = await this.computeTrend(score);
    switch (trend.trend) {
      case 'collapsing':
        urgencyScore += 40;
        reasons.push(`Score collapsing: dropped ${Math.abs(trend.velocity ?? 0)} pts in recent periods — structural deterioration likely.`);
        break;
      case 'declining':
        urgencyScore += 25;
        reasons.push(`Score declining (${trend.velocity} pts/period) — monitor closely for acceleration.`);
        break;
      case 'stable':
        urgencyScore += 5;
        break;
      case 'rising':
        urgencyScore -= 10; // Reducing urgency — improving trend
        reasons.push('Score trending upward — hold if fundamentals support.');
        break;
      case 'no_data':
        reasons.push('Insufficient score history for trend analysis.');
        break;
    }

    // ── 2. Absolute score level ──
    if (score.score !== null) {
      if (score.score < 200) {
        urgencyScore += 30;
        reasons.push(`Critical score level (${score.score}/1000) — deep in sell territory.`);
      } else if (score.score < 400) {
        urgencyScore += 20;
        reasons.push(`Low score (${score.score}/1000) — below conviction threshold.`);
      } else if (score.score < 600) {
        urgencyScore += 8;
        reasons.push(`Moderate score (${score.score}/1000) — warrants monitoring.`);
      }
    } else {
      urgencyScore += 5;
      reasons.push('No composite score available — data gap.');
    }

    // ── 3. Position P&L analysis ──
    if (position && position.value > 0) {
      const pnlPct = position.pnl
        ? (position.pnl / (position.value - position.pnl)) * 100
        : null;

      if (pnlPct !== null) {
        if (pnlPct < -10) {
          urgencyScore += 15;
          reasons.push(`Deep loss (${pnlPct.toFixed(1)}%) — consider stop-loss discipline.`);
        } else if (pnlPct < -5) {
          urgencyScore += 8;
          reasons.push(`Moderate loss (${pnlPct.toFixed(1)}%) — position is underwater.`);
        } else if (pnlPct > 20) {
          urgencyScore += 5;
          reasons.push(`Strong profit (${pnlPct.toFixed(1)}%) — consider partial take-profit.`);
        } else if (pnlPct > 10) {
          urgencyScore += 2;
          reasons.push(`In profit (${pnlPct.toFixed(1)}%) — trailing stop recommended.`);
        }
      }

      // Large position concentration risk
      if (position.allocation > 15) {
        urgencyScore += 5;
        reasons.push(`High allocation (${position.allocation.toFixed(1)}%) — concentration risk.`);
      }
    }

    // ── 4. Signal consistency check ──
    if (score.signal === 'sell') {
      urgencyScore += 10;
      reasons.push('Current aggregate signal is SELL.');
    } else if (score.signal === 'no_data') {
      urgencyScore += 3;
      reasons.push('Insufficient data for reliable signal.');
    }

    // ── 5. Deduplicate and limit reasons ──
    const uniqueReasons = [...new Set(reasons)].slice(0, 6);

    // ── Determine urgency level ──
    const urgency = this.classifyUrgency(urgencyScore);

    return {
      symbol: score.symbol,
      ticker: score.ticker,
      currentScore: score.score,
      scoreTrend: trend.trend,
      scoreVelocity: trend.velocity,
      pnlPct: position && position.value > 0
        ? (position.pnl ? (position.pnl / (position.value - position.pnl)) * 100 : 0)
        : null,
      positionValue: position?.value ?? null,
      signal: score.signal,
      urgency,
      urgencyScore: Math.max(0, Math.min(100, urgencyScore)),
      reasons: uniqueReasons,
      lastUpdated: trend.lastTimestamp,
    };
  }

  /**
   * Compute score trend by examining recent history.
   * Uses linear regression slope over available data points.
   */
  private async computeTrend(
    score: { symbol: string; ticker: string; score: number | null; signal: string; dataStatus: string },
  ): Promise<{ trend: ExitSignal['scoreTrend']; velocity: number | null; lastTimestamp: string | null }> {
    try {
      // We need the symbol ID from the DB — use ticker as fallback
      const history = await this.scoreHistory.getHistory(score.ticker, 10);

      if (!history || history.length < 2) {
        return { trend: 'no_data', velocity: null, lastTimestamp: null };
      }

      const values = history.map((h) => h.value);
      const timestamps = history.map((h) => h.timestamp);

      // Simple linear regression slope over the last N points
      const n = values.length;
      const indices = Array.from({ length: n }, (_, i) => i);
      const meanX = (n - 1) / 2;
      const meanY = values.reduce((a, b) => a + b, 0) / n;

      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (indices[i] - meanX) * (values[i] - meanY);
        den += (indices[i] - meanX) ** 2;
      }

      const slope = den !== 0 ? num / den : 0;
      const velocity = Math.round(slope * n); // Total change across the window

      let trend: ExitSignal['scoreTrend'];
      if (slope < -15) trend = 'collapsing';
      else if (slope < -5) trend = 'declining';
      else if (slope > 5) trend = 'rising';
      else trend = 'stable';

      const lastTimestamp = timestamps[timestamps.length - 1]?.toISOString() ?? null;

      return { trend, velocity, lastTimestamp };
    } catch (err) {
      this.logger.warn(`Trend computation failed for ${score.ticker}: ${(err as Error).message}`);
      return { trend: 'no_data', velocity: null, lastTimestamp: null };
    }
  }

  /**
   * Classify urgency from cumulative score.
   */
  private classifyUrgency(score: number): ExitSignal['urgency'] {
    if (score >= 60) return 'CRITICAL';
    if (score >= 35) return 'HIGH';
    if (score >= 15) return 'MEDIUM';
    if (score > 0) return 'LOW';
    return 'NONE';
  }
}
