/** Chandelier Exit — highest high - 3× ATR. Long exit signal. MT5 Chandelier. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

@Injectable()
export class ChandelierExitDirective implements IDirective {
  readonly id = 'chandelier-exit';
  readonly name = 'Chandelier Exit';
  readonly description = 'Long exit: highest high(22) - 3×ATR(22). Price below exit = trend weakening. MT5 Chandelier Exit.';
  readonly priority = 64;

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 26) return { score: 0, confidence: 0.1, reason: `Need 26+ bars`, signalClass: 'neutral' };
    const a = atr(highs, lows, closes, 22);
    const lastAtr = a[a.length - 1];
    const highest22 = Math.max(...highs.slice(-22));
    const exit = highest22 - 3 * lastAtr;
    const lastClose = closes[closes.length - 1];
    const aboveExit = lastClose > exit;
    const distance = Math.abs(lastClose - exit) / lastClose * 100;
    if (aboveExit && distance > 3) {
      return { score: 65 + Math.min(15, Math.round(distance * 2)), confidence: 0.55, reason: `Chandelier: ${distance.toFixed(1)}% above exit — hold long`, signalClass: 'bullish' };
    }
    if (!aboveExit) {
      return { score: 25, confidence: 0.5, reason: `Chandelier: price below exit — consider closing long`, signalClass: 'bearish' };
    }
    return { score: 45, confidence: 0.3, reason: `Chandelier: near exit level`, signalClass: 'neutral' };
  }
}
