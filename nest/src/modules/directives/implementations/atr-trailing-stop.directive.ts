/** ATR Trailing Stop — dynamic stop based on ATR multiple. MT5 ATR Trailing. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

@Injectable()
export class AtrTrailingStopDirective implements IDirective {
  readonly id = 'atr-trailing-stop';
  readonly name = 'ATR Trailing Stop';
  readonly description = 'Trailing stop at 3× ATR(14) from highest high. Price above stop = trend intact. MT5 ATR Trailing.';
  readonly priority = 64;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 18) return { score: 0, confidence: 0.1, reason: `Need 18+ bars`, signalClass: 'neutral' };
    const a = atr(highs, lows, closes, 14);
    const lastAtr = a[a.length - 1];
    const lastClose = closes[closes.length - 1];
    const highestHigh = Math.max(...highs.slice(-14));
    const stop = highestHigh - 3 * lastAtr;
    const isAbove = lastClose > stop;
    const distance = Math.abs(lastClose - stop) / lastClose * 100;
    if (isAbove && distance > 2) {
      return { score: Math.round(60 + Math.min(25, distance * 3)), confidence: 0.5 + Math.min(0.2, distance * 0.03), reason: `ATR stop intact (${distance.toFixed(1)}% above)`, signalClass: 'bullish' };
    }
    if (!isAbove && distance > 1) {
      return { score: Math.round(35 - Math.min(15, distance * 2)), confidence: 0.45, reason: `Price below ATR stop (${distance.toFixed(1)}%) — caution`, signalClass: 'bearish' };
    }
    return { score: 45, confidence: 0.3, reason: `Near ATR trailing stop`, signalClass: 'neutral' };
  }
}
