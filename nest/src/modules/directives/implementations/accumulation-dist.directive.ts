/** Accumulation/Distribution Line — cumulative volume × CLV. MT5 A/D. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class AccumDistDirective implements IDirective {
  readonly id = 'accumulation-dist';
  readonly name = 'Accumulation/Distribution';
  readonly description = 'A/D line trending up while price flat = accumulation. Divergence = reversal signal. MT5 A/D.';
  readonly priority = 68;
  readonly maxScore = 100;
  readonly minBars = { '1d': 22 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 22) return { score: 0, confidence: 0.1, reason: `Need 22+ bars`, signalClass: 'neutral' };
    let ad = 0;
    for (const b of bars) {
      const hl = b.high - b.low;
      const clv = hl === 0 ? 0 : ((b.close - b.low) - (b.high - b.close)) / hl;
      ad += clv * b.volume;
    }
    const recent = bars.slice(-10);
    let recentAd = 0;
    for (const b of recent) {
      const hl = b.high - b.low;
      const clv = hl === 0 ? 0 : ((b.close - b.low) - (b.high - b.close)) / hl;
      recentAd += clv * b.volume;
    }
    const ratio = Math.abs(ad) > 0 ? recentAd / Math.abs(ad) : 0;
    if (ratio > 0.3) return { score: 70, confidence: 0.6, reason: `A/D rising strongly — accumulation`, signalClass: 'bullish' };
    if (ratio > 0) return { score: 55, confidence: 0.4, reason: `A/D rising`, signalClass: 'bullish' };
    if (ratio < -0.3) return { score: 25, confidence: 0.5, reason: `A/D falling — distribution`, signalClass: 'bearish' };
    return { score: 40, confidence: 0.3, reason: `A/D neutral`, signalClass: 'neutral' };
  }
}
