/**
 * Regime Shift Exit
 * =================
 * Detects when market structure is breaking — a signal to exit regardless of profit.
 * Uses entropy spike detection and trend strength collapse.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

const ENTROPY_WINDOW = 20;
const BINS = 8;

@Injectable()
export class RegimeShiftExitDirective implements IDirective {
  readonly id = 'regime-shift-exit';
  readonly name = 'Regime Shift Exit';
  readonly description = 'Detects market structure breakdown via entropy spike. Urgent exit signal.';
  readonly priority = 80;
  readonly maxScore = 100;
  readonly minBars = { '1d': 40 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < ENTROPY_WINDOW * 2) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const midpoint = Math.floor(closes.length / 2);

    const earlyEntropy = this.entropy(closes.slice(0, midpoint));
    const lateEntropy = this.entropy(closes.slice(midpoint));
    const entropyDelta = lateEntropy - earlyEntropy;
    const maxEntropy = Math.log2(BINS);

    let score = 0;
    let reason = '';

    if (entropyDelta > 0.25 * maxEntropy) {
      // Sharp entropy increase — regime breaking
      score = 70 + Math.min(30, (entropyDelta / maxEntropy) * 80);
      reason = `Regime shift detected: entropy spiked ${(entropyDelta / maxEntropy * 100).toFixed(0)}%. Market structure breaking. Exit recommended.`;
    } else if (entropyDelta > 0.1 * maxEntropy) {
      score = 40 + ((entropyDelta / maxEntropy) * 200);
      reason = `Moderate entropy increase (${(entropyDelta / maxEntropy * 100).toFixed(0)}%). Monitor positions.`;
    } else {
      score = Math.round(Math.max(5, (1 - (entropyDelta / maxEntropy + 0.3)) * 20));
      reason = `Regime stable. Entropy change: ${(entropyDelta / maxEntropy * 100).toFixed(0)}%.`;
    }

    return {
      score: Math.round(score),
      confidence: score > 50 ? Number(Math.min(0.85, 0.4 + (score / 150)).toFixed(2)) : 0.3,
      reason,
      signalClass: 'neutral',
    };
  }

  private entropy(values: number[]): number {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range === 0) return 0;

    const bins = new Array(BINS).fill(0);
    for (const v of values) {
      const idx = Math.min(BINS - 1, Math.floor(((v - min) / range) * BINS));
      bins[idx]++;
    }

    let h = 0;
    for (const c of bins) {
      if (c > 0) { const p = c / values.length; h -= p * Math.log2(p); }
    }
    return h;
  }
}
