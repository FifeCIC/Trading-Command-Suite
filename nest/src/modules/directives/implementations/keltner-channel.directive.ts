/** Keltner Channel — EMA-based envelope with ATR width. MT5 Keltner. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema, atr } from '../utils/indicators';

@Injectable()
export class KeltnerChannelDirective implements IDirective {
  readonly id = 'keltner-channel';
  readonly name = 'Keltner Channel';
  readonly description = 'EMA(20) ± 2×ATR(10). Price at lower band = oversold. Break above upper = momentum. MT5 Keltner.';
  readonly priority = 68;
  readonly maxScore = 100;
  readonly minBars = { '1d': 24 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 24) return { score: 0, confidence: 0.1, reason: `Need 24+ bars`, signalClass: 'neutral' };
    const e = ema(closes, 20);
    const a = atr(highs, lows, closes, 10);
    const mid = e[e.length - 1];
    const width = 2 * a[a.length - 1];
    const lower = mid - width;
    const upper = mid + width;
    const lastClose = closes[closes.length - 1];
    if (lastClose <= lower) {
      const depth = (lower - lastClose) / width;
      return { score: Math.round(60 + depth * 30), confidence: 0.5 + depth * 0.25, reason: `Price at lower Keltner — oversold`, signalClass: 'bullish' };
    }
    if (lastClose >= upper) {
      const depth = (lastClose - upper) / width;
      return { score: Math.round(55 + depth * 25), confidence: 0.5 + depth * 0.2, reason: `Price above upper Keltner — breakout`, signalClass: 'bullish' };
    }
    const pos = (lastClose - lower) / (upper - lower);
    return { score: Math.round(30 + pos * 30), confidence: 0.35, reason: `Keltner: ${(pos * 100).toFixed(0)}% within band`, signalClass: 'neutral' };
  }
}
