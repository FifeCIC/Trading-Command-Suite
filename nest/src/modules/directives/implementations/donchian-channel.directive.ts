/** Donchian Channel — N-period high/low breakout. MT5 Donchian. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class DonchianChannelDirective implements IDirective {
  readonly id = 'donchian-channel';
  readonly name = 'Donchian Channel Breakout';
  readonly description = '20-bar high/low channel. Price near upper = bullish breakout. Near lower = bearish. MT5 Donchian.';
  readonly priority = 66;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 22) return { score: 0, confidence: 0.1, reason: `Need 22+ bars`, signalClass: 'neutral' };
    const period = 20;
    const window = bars.slice(-period);
    const h = Math.max(...window.map((b) => b.high));
    const l = Math.min(...window.map((b) => b.low));
    const lastClose = bars[bars.length - 1].close;
    const range = h - l;
    const pos = range > 0 ? (lastClose - l) / range : 0.5;
    if (pos > 0.8) {
      return { score: Math.round(65 + (pos - 0.8) * 150), confidence: 0.55 + (pos - 0.8) * 1.5, reason: `Price at ${(pos * 100).toFixed(0)}% of Donchian — breakout`, signalClass: 'bullish' };
    }
    if (pos < 0.2) {
      return { score: Math.round(35 - (0.2 - pos) * 100), confidence: 0.5, reason: `Price at ${(pos * 100).toFixed(0)}% of Donchian — breakdown`, signalClass: 'bearish' };
    }
    return { score: Math.round(30 + pos * 40), confidence: 0.3, reason: `Donchian: ${(pos * 100).toFixed(0)}% within channel`, signalClass: 'neutral' };
  }
}
