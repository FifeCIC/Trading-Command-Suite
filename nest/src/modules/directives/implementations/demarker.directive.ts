/**
 * DeMarker Indicator — measures demand vs supply over period.
 * DeMarker > 0.7 = overbought, < 0.3 = oversold.
 * Derived from MT5 DeMarker indicator.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class DeMarkerDirective implements IDirective {
  readonly id = 'demarker';
  readonly name = 'DeMarker';
  readonly description = 'DeMarker < 0.3 signals oversold accumulation. > 0.7 signals overbought distribution. Derived from MT5 DeMarker.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly minBars = { '1d': 16 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 16) return { score: 0, confidence: 0.1, reason: `Need 16+ bars, have ${bars.length}`, signalClass: 'neutral' };

    const dm = this.calcDeMarker(bars, 14);
    if (dm < 0.3) {
      const depth = (0.3 - dm) / 0.3;
      return { score: Math.round(55 + depth * 35), confidence: 0.55 + depth * 0.3, reason: `DeMarker(14)=${dm.toFixed(2)} — oversold`, signalClass: 'bullish' };
    }
    if (dm > 0.7) {
      const depth = (dm - 0.7) / 0.3;
      return { score: Math.round(20 + depth * 30), confidence: 0.5 + depth * 0.2, reason: `DeMarker(14)=${dm.toFixed(2)} — overbought`, signalClass: 'bearish' };
    }
    return { score: 35, confidence: 0.3, reason: `DeMarker(14)=${dm.toFixed(2)} — neutral`, signalClass: 'neutral' };
  }

  private calcDeMarker(bars: DirectiveInput['bars'], period: number): number {
    let deMax = 0, deMin = 0;
    for (let i = bars.length - period; i < bars.length; i++) {
      deMax += bars[i].high > bars[i - 1]?.high ? bars[i].high - bars[i - 1].high : 0;
      deMin += bars[i - 1]?.low > bars[i].low ? bars[i - 1].low - bars[i].low : 0;
    }
    return deMax + deMin === 0 ? 0.5 : deMax / (deMax + deMin);
  }
}
