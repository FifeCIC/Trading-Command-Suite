/** Bears Power (Elder) — Low - EMA(13). Negative = bears in control. MT5 Bears Power.
 *  Category: oscillator — Elder's indicator, bounded range.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';

@Injectable()
export class BearsPowerDirective implements IDirective {
  readonly id = 'bears-power';
  readonly name = 'Bears Power (Elder)';
  readonly description = 'Low - EMA(13). Negative values signal bearish pressure. Derived from MT5 Bears Power.';
  readonly category = 'oscillator' as const;
  readonly priority = 65;
  readonly maxScore = 65;
  readonly minScore = 1;
  readonly minBars = { '1d': 16 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 16) return { score: 0, confidence: 0.1, reason: `Need 16+ bars`, signalClass: 'neutral' };
    const e = ema(closes, 13);
    const bp = lows[lows.length - 1] - e[e.length - 1];
    if (bp >= 0) {
      return { score: 65, confidence: 0.5, reason: `Bears Power=${bp.toFixed(4)} — bears absent`, signalClass: 'bullish' };
    }
    const pct = Math.min(1, Math.abs(bp) / closes[closes.length - 1] * 100);
    return { score: Math.max(10, Math.round(35 - pct * 25)), confidence: 0.4 + pct * 0.3, reason: `Bears Power=${bp.toFixed(4)} — bearish pressure`, signalClass: 'bearish' };
  }
}
