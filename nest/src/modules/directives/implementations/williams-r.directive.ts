/**
 * Williams %R Oversold Reversion
 * ==============================
 * Derived from MT5 Williams' Percent Range indicator.
 * %R < -80 = oversold (bullish reversion), %R > -20 = overbought (bearish).
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { williamsR } from '../utils/indicators';

@Injectable()
export class WilliamsRDirective implements IDirective {
  readonly id = 'williams-r';
  readonly name = 'Williams %R Oversold';
  readonly description = 'Williams %R < -80 signals oversold reversion. > -20 signals overbought. Derived from MT5 Williams Percent Range.';
  readonly directionBias = 'bearish' as const;
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minBars = { '1d': 16 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { highs, lows, closes } = this.extractSeries(input);
    if (closes.length < 16) return { score: 0, confidence: 0.1, reason: `Need 16+ bars, have ${closes.length}`, signalClass: 'neutral' };

    const wr = williamsR(highs, lows, closes, 14);
    const current = wr[wr.length - 1];
    const prev = wr.length > 1 ? wr[wr.length - 2] : current;

    if (current > -20) {
      const overbought = Math.min(1, (current + 20) / 20);
      return { score: Math.round(overbought * 20), confidence: 0.3, reason: `%R=${current.toFixed(1)} — overbought`, signalClass: 'bearish' };
    }

    if (current < -80) {
      const depth = Math.min(1, (-80 - current) / 20);
      const curling = current > prev ? 0.3 : 0;
      const score = 55 + depth * 30 + curling * 15;
      return {
        score: Math.round(score),
        confidence: Math.min(0.9, 0.55 + depth * 0.3 + curling * 0.1),
        reason: `%R=${current.toFixed(1)} — oversold${curling ? ', curling up' : ''}`,
        signalClass: 'bullish',
      };
    }

    return { score: 20, confidence: 0.3, reason: `%R=${current.toFixed(1)} — neutral zone`, signalClass: 'neutral' };
  }

  private extractSeries(input: DirectiveInput) {
    return {
      highs: input.bars.map((b) => b.high),
      lows: input.bars.map((b) => b.low),
      closes: input.bars.map((b) => b.close),
    };
  }
}
