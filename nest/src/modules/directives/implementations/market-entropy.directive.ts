/**
 * Market Entropy
 * ==============
 * Shannon entropy applied to price distribution.
 * Low entropy = trending/structured market.
 * High entropy = chaotic/random market.
 *
 * Score: bullish when entropy is falling (structure emerging from chaos)
 *        bearish when entropy is rising (structure breaking down)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const LOOKBACK = 30;
const BINS = 10;
const ENTROPY_MAX = Math.log2(BINS); // Max possible entropy = log2(N bins)

@Injectable()
export class MarketEntropyDirective implements IDirective {
  readonly id = 'market-entropy';
  readonly name = 'Market Entropy';
  readonly description =
    'Shannon entropy of price distribution. Low entropy = trending, high = chaotic.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly minBars = { '1d': 30 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < LOOKBACK) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${LOOKBACK} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    // Split into two windows: earlier half vs later half
    const midpoint = Math.floor(bars.length / 2);
    const earlyBars = bars.slice(0, midpoint);
    const lateBars = bars.slice(midpoint);

    const earlyEntropy = this.shannonEntropy(earlyBars);
    const lateEntropy = this.shannonEntropy(lateBars);
    const currentEntropy = lateEntropy;

    // Normalize entropy to 0-1
    const entropyRatio = currentEntropy / ENTROPY_MAX;
    const entropyDelta = (earlyEntropy - lateEntropy) / ENTROPY_MAX;

    // Score and signal
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (entropyDelta > 0.15) {
      // Entropy falling — structure emerging (bullish)
      score = 40 + Math.min(1, entropyDelta * 2) * 50;
      signalClass = 'bullish';
      reason = `Entropy falling (${(earlyEntropy * 100 / ENTROPY_MAX).toFixed(0)}% → ${(lateEntropy * 100 / ENTROPY_MAX).toFixed(0)}%). Structure emerging.`;
    } else if (entropyDelta < -0.15) {
      // Entropy rising — chaos increasing (bearish)
      score = 40 + Math.min(1, -entropyDelta * 2) * 50;
      signalClass = 'bearish';
      reason = `Entropy rising (${(earlyEntropy * 100 / ENTROPY_MAX).toFixed(0)}% → ${(lateEntropy * 100 / ENTROPY_MAX).toFixed(0)}%). Chaos increasing.`;
    } else if (entropyRatio < 0.4) {
      // Low entropy = trending
      score = 60;
      signalClass = 'neutral'; // Directional bias from other directives
      reason = `Market is structured (entropy ${(entropyRatio * 100).toFixed(0)}%). Continuation bias.`;
    } else if (entropyRatio > 0.7) {
      score = 25;
      signalClass = 'neutral';
      reason = `Market is chaotic (entropy ${(entropyRatio * 100).toFixed(0)}%). Low conviction in any direction.`;
    } else {
      score = 40;
      signalClass = 'neutral';
      reason = `Market entropy stable at ${(entropyRatio * 100).toFixed(0)}%. Neither structured nor chaotic.`;
    }

    return {
      score: Math.round(score),
      confidence: Number((0.5 + Math.abs(entropyDelta)).toFixed(2)),
      reason,
      signalClass,
    };
  }

  private shannonEntropy(bars: DirectiveInput['bars']): number {
    const closes = bars.map((b) => b.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const range = max - min;
    if (range === 0) return 0;

    // Bin prices
    const bins = new Array(BINS).fill(0);
    for (const close of closes) {
      const binIdx = Math.min(BINS - 1, Math.floor(((close - min) / range) * BINS));
      bins[binIdx]++;
    }

    // Shannon entropy: H = -Σ p(x) × log2(p(x))
    let entropy = 0;
    for (const count of bins) {
      if (count > 0) {
        const p = count / closes.length;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy;
  }
}



