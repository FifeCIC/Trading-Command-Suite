/** SuperTrend — ATR-based trend following indicator. MT5 SuperTrend. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';

@Injectable()
export class SuperTrendDirective implements IDirective {
  readonly id = 'supertrend';
  readonly name = 'SuperTrend';
  readonly description = 'ATR(10) × 3.0 multiplier. Price above SuperTrend = uptrend, below = downtrend. MT5 SuperTrend.';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly minBars = { '1d': 14 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map((b) => b.high);
    const lows = input.bars.map((b) => b.low);
    const closes = input.bars.map((b) => b.close);
    if (closes.length < 14) return { score: 0, confidence: 0.1, reason: `Need 14+ bars`, signalClass: 'neutral' };
    const atrVals = atr(highs, lows, closes, 10);
    const lastAtr = atrVals[atrVals.length - 1];
    const lastClose = closes[closes.length - 1];
    const hl2 = (highs[highs.length - 1] + lows[lows.length - 1]) / 2;
    const upper = hl2 + 3.0 * lastAtr;
    const lower = hl2 - 3.0 * lastAtr;
    const isUp = lastClose > (upper + lower) / 2 ? true : lastClose > lower;
    const dist = isUp ? (lastClose - lower) / lastClose * 100 : (upper - lastClose) / lastClose * 100;
    if (isUp && dist > 1) {
      return { score: Math.round(62 + Math.min(25, dist * 5)), confidence: 0.55, reason: `SuperTrend bullish (${dist.toFixed(1)}% above)`, signalClass: 'bullish' };
    }
    if (!isUp && dist > 1) {
      return { score: Math.round(35 - Math.min(20, dist * 4)), confidence: 0.5, reason: `SuperTrend bearish (${dist.toFixed(1)}% below)`, signalClass: 'bearish' };
    }
    return { score: 45, confidence: 0.3, reason: `SuperTrend neutral`, signalClass: 'neutral' };
  }
}
