/**
 * Sigma Score (Z-Score)
 * ======================
 * Z-Score of log returns: (latestReturn - mean) / stddev
 *
 * Thresholds:
 *   ±2 sigma → significant deviation
 *   ±3 sigma → extreme deviation
 *
 * Mean-reversion signal at extremes (buy at -3σ, sell at +3σ)
 * Momentum signal at moderate values (trend continuation)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 20;
const RETURN_PERIOD = 1; // 1-bar returns

@Injectable()
export class SigmaScoreDirective implements IDirective {
  readonly id = 'sigma-score';
  readonly name = 'Sigma Score (Z-Score)';
  readonly description =
    'Z-score of log returns. ±2σ = significant, ±3σ = extreme. Mean-reversion at extremes.';
  readonly priority = 60;

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

    // Calculate log returns
    const returns: number[] = [];
    for (let i = RETURN_PERIOD; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - RETURN_PERIOD]));
    }

    if (returns.length < 10) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient return data: ${returns.length} returns.`,
        signalClass: 'neutral',
      };
    }

    // Mean and standard deviation
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const stddev = Math.sqrt(variance);

    if (stddev === 0) {
      return {
        score: 0,
        confidence: 0.2,
        reason: 'Zero variance in returns — flat market.',
        signalClass: 'neutral',
      };
    }

    // Latest return z-score
    const latestReturn = returns[returns.length - 1];
    const zScore = (latestReturn - mean) / stddev;
    const absZ = Math.abs(zScore);

    // Determine signal
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (absZ >= 3) {
      // Extreme: mean-reversion signal
      if (zScore < -3) {
        // Extreme negative — oversold, bounce expected
        score = 75;
        signalClass = 'bullish';
        reason = `Extreme z-score (${zScore.toFixed(2)}σ). Deeply oversold — mean reversion bounce expected.`;
      } else {
        // Extreme positive — overbought, pullback expected
        score = 75;
        signalClass = 'bearish';
        reason = `Extreme z-score (+${zScore.toFixed(2)}σ). Deeply overbought — mean reversion pullback expected.`;
      }
    } else if (absZ >= 2) {
      // Significant: weighted between mean-reversion and momentum
      if (zScore < -2) {
        score = 55;
        signalClass = 'bullish';
        reason = `Significant negative z-score (${zScore.toFixed(2)}σ). Oversold — mild bounce expected.`;
      } else {
        score = 55;
        signalClass = 'bearish';
        reason = `Significant positive z-score (+${zScore.toFixed(2)}σ). Overbought — mild pullback expected.`;
      }
    } else if (absZ >= 0.5) {
      // Moderate: slight momentum signal
      if (zScore > 0) {
        score = 30 + absZ * 10;
        signalClass = 'bullish';
        reason = `Moderate positive deviation (${zScore.toFixed(2)}σ). Weak bullish momentum.`;
      } else {
        score = 30 + absZ * 10;
        signalClass = 'bearish';
        reason = `Moderate negative deviation (${zScore.toFixed(2)}σ). Weak bearish momentum.`;
      }
    } else {
      // Near mean — no strong signal
      score = 10;
      signalClass = 'neutral';
      reason = `Near mean (${zScore.toFixed(2)}σ). No significant deviation.`;
    }

    return {
      score: Math.min(100, Math.round(score)),
      confidence: Number(Math.min(0.9, 0.3 + (absZ / 3) * 0.6).toFixed(2)),
      reason,
      signalClass,
    };
  }
}



