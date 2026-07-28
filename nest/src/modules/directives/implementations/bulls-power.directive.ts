/**
 * Bulls Power (Elder) — measures buying pressure above EMA.
 * Positive = bulls in control. Derived from MT5 Bulls Power.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';

@Injectable()
export class BullsPowerDirective implements IDirective {
  readonly id = 'bulls-power';
  readonly name = 'Bulls Power (Elder)';
  readonly description = 'High - EMA(13). Positive values signal bullish pressure. Derived from MT5 Bulls Power.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly minBars = { '1d': 16 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map((b) => b.high);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 16) return { score: 0, confidence: 0.1, reason: `Need 16+ bars`, signalClass: 'neutral' };
    const e = ema(closes, 13);
    const bp = highs[highs.length - 1] - e[e.length - 1];
    const prevBp = highs[highs.length - 2] - (e.length > 1 ? e[e.length - 2] : e[e.length - 1]);
    const rising = bp > prevBp;
    if (bp > 0) {
      const pct = Math.min(1, bp / closes[closes.length - 1] * 100);
      return { score: Math.round(60 + pct * 35 + (rising ? 5 : 0)), confidence: Math.min(0.85, 0.5 + pct * 0.3), reason: `Bulls Power=+${bp.toFixed(4)}${rising ? ' rising' : ''}`, signalClass: 'bullish' };
    }
    const pct = Math.min(1, Math.abs(bp) / closes[closes.length - 1] * 100);
    return { score: Math.max(5, Math.round(30 - pct * 25)), confidence: 0.35, reason: `Bulls Power=${bp.toFixed(4)} — bears control`, signalClass: 'bearish' };
  }
}
