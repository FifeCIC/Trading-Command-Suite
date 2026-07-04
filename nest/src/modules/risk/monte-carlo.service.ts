/**
 * Monte Carlo Risk-of-Ruin Simulator
 * ==================================
 *
 * Takes strategy backtest results (sequence of trade PnLs) and generates
 * N random permutations (with replacement) to produce a probability
 * distribution of outcomes.
 *
 * Outputs:
 * - Final equity distribution (percentiles)
 * - Risk of ruin (probability of falling below ruin threshold)
 * - Optimal position size (maximizes median outcome while keeping RoR < 5%)
 * - Kelly fraction validation
 * - Drawdown distribution
 */

import { Injectable, Logger } from '@nestjs/common';

export interface MonteCarloInput {
  tradePnlSequence: number[];     // PnL per trade (absolute $ values)
  startingCapital?: number;       // Default $10,000
  positionSize?: number;          // Current position size (for scaling)
  iterations?: number;            // Default 10,000
  ruinThreshold?: number;         // Default 50% drawdown from starting capital
  positionSizeVariants?: number[]; // Test multiple position sizes (for optimization)
}

export interface MonteCarloResult {
  iterations: number;
  startingCapital: number;
  tradeCount: number;
  metrics: {
    medianFinalEquity: number;
    meanFinalEquity: number;
    minFinalEquity: number;
    maxFinalEquity: number;
    p5FinalEquity: number;        // 5th percentile (worst case)
    p95FinalEquity: number;       // 95th percentile (best case)
    stdDevFinalEquity: number;
    riskOfRuin: number;           // Probability of ruin (0-1)
    maxDrawdownMedian: number;    // Median max drawdown %
    maxDrawdownP5: number;        // 5th percentile drawdown %
    sharpeApproximation: number;
    profitFactor: number;
  };
  distribution: {
    percentiles: { pct: number; equity: number }[];  // 10 percentile buckets
    drawdownCurve: { drawdown: number; probability: number }[];
  };
  positionSizeAnalysis?: {       // Only if positionSizeVariants provided
    size: number;
    medianEquity: number;
    riskOfRuin: number;
    sharpe: number;
  }[];
  optimalPositionSize?: number;   // Size with best median equity and RoR < 5%
  recommendation: string;
}

@Injectable()
export class MonteCarloService {
  private readonly logger = new Logger(MonteCarloService.name);

  /**
   * Run Monte Carlo simulation on a trade PnL sequence.
   */
  simulate(input: MonteCarloInput): MonteCarloResult {
    const {
      tradePnlSequence,
      startingCapital = 10_000,
      positionSize = 1.0,
      iterations = 10_000,
      ruinThreshold = 0.5,       // 50% of starting capital
      positionSizeVariants,
    } = input;

    if (tradePnlSequence.length < 5) {
      return this.emptyResult(startingCapital, 'Need at least 5 trades for simulation');
    }

    const ruinCapital = startingCapital * ruinThreshold;

    // ── Single position size simulation ──
    const equityResults: number[] = [];
    const drawdownResults: number[] = [];
    let ruinCount = 0;
    let totalWinAmount = 0;
    let totalLossAmount = 0;

    for (let i = 0; i < iterations; i++) {
      let equity = startingCapital;
      let peak = startingCapital;
      let maxDrawdown = 0;

      // Randomly sample from trade sequence with replacement
      for (let t = 0; t < tradePnlSequence.length; t++) {
        const randomIndex = Math.floor(Math.random() * tradePnlSequence.length);
        const tradePnl = tradePnlSequence[randomIndex] * positionSize;

        if (tradePnl > 0) totalWinAmount += tradePnl;
        else totalLossAmount += Math.abs(tradePnl);

        equity += tradePnl;

        // Track peak and drawdown
        if (equity > peak) peak = equity;
        const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        // Check ruin
        if (equity <= ruinCapital) {
          ruinCount++;
          equity = ruinCapital; // Floor at ruin threshold
          break;
        }
      }

      equityResults.push(equity);
      drawdownResults.push(maxDrawdown);
    }

    // ── Compute metrics ──
    const sorted = [...equityResults].sort((a, b) => a - b);
    const p5Idx = Math.floor(sorted.length * 0.05);
    const p95Idx = Math.floor(sorted.length * 0.95);
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / sorted.length;
    const stdDev = Math.sqrt(variance);

    const sortedDD = [...drawdownResults].sort((a, b) => a - b);
    const medianDD = sortedDD[Math.floor(sortedDD.length * 0.5)];
    const p5DD = sortedDD[Math.floor(sortedDD.length * 0.05)];

    // Sharpe approximation: (mean excess return) / std dev
    const excessReturn = (mean - startingCapital) / startingCapital;
    const sharpeApprox = stdDev > 0 ? (excessReturn / (stdDev / startingCapital)) * Math.sqrt(tradePnlSequence.length) : 0;

    // Profit factor
    const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? 999 : 0;

    const avgWin = totalWinAmount / (iterations * tradePnlSequence.length);
    const avgLoss = totalLossAmount / (iterations * tradePnlSequence.length);

    // ── Distribution percentiles ──
    const percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99].map(pct => ({
      pct,
      equity: sorted[Math.floor(sorted.length * pct / 100)],
    }));

    // ── Drawdown curve ──
    const ddBuckets = [5, 10, 15, 20, 25, 30, 40, 50];
    const drawdownCurve = ddBuckets.map(dd => {
      const count = drawdownResults.filter(d => d >= dd).length;
      return { drawdown: dd, probability: count / iterations };
    });

    const result: MonteCarloResult = {
      iterations,
      startingCapital,
      tradeCount: tradePnlSequence.length,
      metrics: {
        medianFinalEquity: median,
        meanFinalEquity: mean,
        minFinalEquity: sorted[0],
        maxFinalEquity: sorted[sorted.length - 1],
        p5FinalEquity: sorted[p5Idx],
        p95FinalEquity: sorted[p95Idx],
        stdDevFinalEquity: stdDev,
        riskOfRuin: ruinCount / iterations,
        maxDrawdownMedian: medianDD,
        maxDrawdownP5: p5DD,
        sharpeApproximation: sharpeApprox,
        profitFactor,
      },
      distribution: { percentiles, drawdownCurve },
      recommendation: this.buildRecommendation(ruinCount / iterations, sharpeApprox, medianDD, profitFactor),
    };

    // ── Position size optimization ──
    if (positionSizeVariants && positionSizeVariants.length > 0) {
      result.positionSizeAnalysis = [];
      let bestSize = positionSize;
      let bestMedian = median;
      let bestRoR = ruinCount / iterations;

      for (const size of positionSizeVariants) {
        const variantResult = this.runSingleSize(tradePnlSequence, startingCapital, size, iterations / 4, ruinCapital);
        result.positionSizeAnalysis.push({
          size,
          medianEquity: variantResult.median,
          riskOfRuin: variantResult.ror,
          sharpe: variantResult.sharpe,
        });

        // Prefer size with best median equity where RoR < 5%
        if (variantResult.ror < 0.05 && variantResult.median > bestMedian) {
          bestSize = size;
          bestMedian = variantResult.median;
          bestRoR = variantResult.ror;
        }
      }

      if (bestRoR < 0.05) {
        result.optimalPositionSize = bestSize;
        result.recommendation += ` Optimal position size from analysis: ${bestSize}× (RoR: ${(bestRoR * 100).toFixed(1)}%).`;
      }
    }

    return result;
  }

  private runSingleSize(
    trades: number[], capital: number, size: number, iter: number, ruinCap: number,
  ): { median: number; ror: number; sharpe: number } {
    const results: number[] = [];
    let ruins = 0;

    for (let i = 0; i < iter; i++) {
      let equity = capital;
      for (let t = 0; t < trades.length; t++) {
        equity += trades[Math.floor(Math.random() * trades.length)] * size;
        if (equity <= ruinCap) { ruins++; break; }
      }
      results.push(equity);
    }

    const sorted = [...results].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length * 0.5)];
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    const variance = results.reduce((s, v) => s + (v - mean) ** 2, 0) / results.length;
    const stdDev = Math.sqrt(variance);
    const excess = (mean - capital) / capital;
    const sharpe = stdDev > 0 ? (excess / (stdDev / capital)) * Math.sqrt(trades.length) : 0;

    return { median, ror: ruins / iter, sharpe };
  }

  private buildRecommendation(ror: number, sharpe: number, medianDD: number, pf: number): string {
    if (ror > 0.10) return `⚠️ HIGH RISK: ${(ror * 100).toFixed(1)}% risk of ruin. Reduce position size immediately.`;
    if (ror > 0.05) return `⚡ ELEVATED RISK: ${(ror * 100).toFixed(1)}% RoR. Consider reducing position size by 25-50%.`;
    if (sharpe < 0) return `📉 Negative Sharpe (${sharpe.toFixed(2)}). Strategy may be unprofitable — review before trading.`;
    if (sharpe < 0.5) return `📊 Marginal: Sharpe ${sharpe.toFixed(2)}, RoR ${(ror*100).toFixed(1)}%. Proceed with minimum size.`;
    if (sharpe < 1.0) return `✅ Decent: Sharpe ${sharpe.toFixed(2)}, RoR ${(ror*100).toFixed(1)}%, MaxDD ${medianDD.toFixed(1)}%. Standard sizing OK.`;
    return `🎯 STRONG: Sharpe ${sharpe.toFixed(2)}, RoR ${(ror*100).toFixed(1)}%, MaxDD ${medianDD.toFixed(1)}%. Strategy is robust.`;
  }

  private emptyResult(capital: number, reason: string): MonteCarloResult {
    return {
      iterations: 0, startingCapital: capital, tradeCount: 0,
      metrics: {
        medianFinalEquity: capital, meanFinalEquity: capital,
        minFinalEquity: capital, maxFinalEquity: capital,
        p5FinalEquity: capital, p95FinalEquity: capital,
        stdDevFinalEquity: 0, riskOfRuin: 0,
        maxDrawdownMedian: 0, maxDrawdownP5: 0,
        sharpeApproximation: 0, profitFactor: 0,
      },
      distribution: { percentiles: [], drawdownCurve: [] },
      recommendation: reason,
    };
  }
}
