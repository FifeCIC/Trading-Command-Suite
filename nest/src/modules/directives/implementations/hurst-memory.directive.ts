/**
 * Hurst Memory
 * ============
 * Hurst Exponent estimation using R/S analysis.
 * H > 0.60 → trending / persistent (trend-following bias)
 * H < 0.40 → mean-reverting / anti-persistent
 * H ≈ 0.50 → random walk / efficient
 *
 * Confidence weighted by R² of the log-log regression.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 50;
const RS_WINDOWS = [8, 16, 32];

@Injectable()
export class HurstMemoryDirective implements IDirective {
  readonly id = 'hurst-memory';
  readonly name = 'Hurst Memory';
  readonly description =
    'Hurst exponent via R/S analysis. H>0.6 trending, H<0.4 mean-reverting.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minBars = { '1d': 50 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const closes = bars.map((b) => b.close);
    const h = this.hurstRS(closes);
    const rSquared = this.regressionQuality(closes);

    // Determine signal
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (h > 0.65) {
      // Strong trend memory — continuation likely
      const trend = closes[closes.length - 1] > closes[closes.length - 20] ? 'bullish' : 'bearish';
      score = 55 + Math.min(1, (h - 0.5) * 2) * 40;
      signalClass = trend;
      reason = `H=${h.toFixed(3)} — strong trend memory (persistent). ${trend === 'bullish' ? 'Bullish' : 'Bearish'} continuation likely.`;
    } else if (h > 0.55) {
      // Mild trend
      const trend = closes[closes.length - 1] > closes[Math.floor(closes.length / 2)] ? 'bullish' : 'bearish';
      score = 40 + (h - 0.5) * 100;
      signalClass = trend;
      reason = `H=${h.toFixed(3)} — mild trend memory. ${trend === 'bullish' ? 'Bullish' : 'Bearish'} bias.`;
    } else if (h < 0.35) {
      // Strong mean-reversion
      score = 55 + Math.min(1, (0.5 - h) * 2) * 40;
      signalClass = 'bullish'; // Mean-reversion inherently favors buying dips
      reason = `H=${h.toFixed(3)} — strong mean-reversion. Favor counter-trend entries.`;
    } else if (h < 0.45) {
      // Mild mean-reversion
      score = 40 + (0.5 - h) * 100;
      signalClass = 'neutral';
      reason = `H=${h.toFixed(3)} — mild mean-reversion tendency.`;
    } else {
      // Random walk (0.45-0.55)
      score = 15;
      signalClass = 'neutral';
      reason = `H=${h.toFixed(3)} — near random walk. No memory bias.`;
    }

    return {
      score: Math.round(score),
      confidence: Number((0.3 + rSquared * 0.6).toFixed(2)),
      reason,
      signalClass,
    };
  }

  /**
   * Hurst exponent via R/S analysis.
   * For each window size n, compute R/S and regress log(R/S) vs log(n).
   */
  private hurstRS(values: number[]): number {
    const points: { x: number; y: number }[] = [];

    for (const windowSize of RS_WINDOWS) {
      if (windowSize > values.length / 2) continue;

      // Average R/S over non-overlapping windows
      let rsSum = 0;
      let count = 0;

      for (let i = 0; i + windowSize <= values.length; i += windowSize) {
        const segment = values.slice(i, i + windowSize);
        const mean = segment.reduce((a, b) => a + b, 0) / segment.length;
        const deviations = segment.map((v) => v - mean);
        const cumulativeDeviations = deviations.reduce(
          (acc, d, idx) => {
            const prev = idx > 0 ? acc[acc.length - 1] : 0;
            acc.push(prev + d);
            return acc;
          },
          [] as number[],
        );
        const r = Math.max(...cumulativeDeviations) - Math.min(...cumulativeDeviations);
        const std = Math.sqrt(deviations.reduce((a, d) => a + d * d, 0) / segment.length);
        if (std > 0) {
          rsSum += r / std;
          count++;
        }
      }

      if (count > 0) {
        points.push({ x: Math.log(windowSize), y: Math.log(rsSum / count) });
      }
    }

    if (points.length < 2) return 0.5;

    // Linear regression: log(R/S) = H × log(n) + constant
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return Math.max(0.1, Math.min(1, slope));
  }

  private regressionQuality(values: number[]): number {
    // Simple R² approximation based on price autocorrelation
    const n = values.length;
    if (n < 20) return 0.3;

    const mean = values.reduce((a, b) => a + b, 0) / n;
    let ssTotal = 0;
    let ssResidual = 0;

    for (let i = 1; i < n; i++) {
      ssTotal += (values[i] - mean) ** 2;
      ssResidual += (values[i] - values[i - 1]) ** 2;
    }

    if (ssTotal === 0) return 0.3;
    return Math.min(0.95, Math.max(0.1, 1 - ssResidual / ssTotal));
  }
}



