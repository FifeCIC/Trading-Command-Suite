/**
 * Rate of Change (Momentum)
 * Derived from MT5 Momentum / RoC indicator.
 * Positive RoC = upward momentum. Measures speed of price change over period.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { roc } from '../utils/indicators';

@Injectable()
export class MomentumRocDirective implements IDirective {
  readonly id = 'momentum-roc';
  readonly name = 'Momentum (Rate of Change)';
  readonly description = 'Rate of Change over 12 bars. Strong positive/negative RoC signals momentum. Derived from MT5 Momentum.';
  readonly category = 'oscillator' as const;
  readonly priority = 70;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 16 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 15) return { score: 0, confidence: 0.1, reason: `Need 15+ bars, have ${closes.length}`, signalClass: 'neutral' };
    const values = roc(closes, 12);
    const cur = values[values.length - 1];
    const prev = values.length > 1 ? values[values.length - 2] : cur;
    const accelerating = Math.abs(cur) > Math.abs(prev);

    if (cur > 5) {
      const strength = Math.min(1, cur / 15);
      return { score: Math.round(60 + strength * 30 + (accelerating ? 10 : 0)), confidence: Math.min(0.85, 0.5 + strength * 0.3), reason: `RoC(12)=+${cur.toFixed(1)}% — strong momentum`, signalClass: 'bullish' };
    }
    if (cur < -5) {
      const strength = Math.min(1, Math.abs(cur) / 15);
      return { score: Math.round(40 + strength * 30), confidence: Math.min(0.85, 0.5 + strength * 0.3), reason: `RoC(12)=${cur.toFixed(1)}% — negative momentum`, signalClass: 'bearish' };
    }
    const pos = cur > 0 ? 40 + cur * 2 : 40 + cur * 2;
    return { score: Math.max(0, Math.min(60, Math.round(pos))), confidence: 0.35, reason: `RoC(12)=${cur.toFixed(1)}% — neutral`, signalClass: 'neutral' };
  }
}
