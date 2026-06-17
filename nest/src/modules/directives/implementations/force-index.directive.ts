/** Force Index — volume × price change over period. MT5 Force Index. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';

@Injectable()
export class ForceIndexDirective implements IDirective {
  readonly id = 'force-index';
  readonly name = 'Force Index';
  readonly description = 'Volume × (close - prevClose), smoothed with EMA(13). Positive = buying pressure. MT5 Force Index.';
  readonly priority = 68;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    const volumes = input.bars.map((b) => b.volume);
    if (closes.length < 16) return { score: 0, confidence: 0.1, reason: `Need 16+ bars`, signalClass: 'neutral' };
    const raw: number[] = [];
    for (let i = 1; i < closes.length; i++) raw.push((closes[i] - closes[i - 1]) * volumes[i]);
    const smoothed = ema(raw, 13);
    const fi = smoothed[smoothed.length - 1];
    const prevFi = smoothed.length > 1 ? smoothed[smoothed.length - 2] : fi;
    if (fi > 0 && fi > prevFi) {
      return { score: 65 + Math.min(25, Math.round(fi / 1e6)), confidence: 0.6, reason: `Force Index positive & rising`, signalClass: 'bullish' };
    }
    if (fi > 0) {
      return { score: 55, confidence: 0.45, reason: `Force Index positive`, signalClass: 'bullish' };
    }
    if (fi < 0 && fi < prevFi) {
      return { score: 25, confidence: 0.5, reason: `Force Index negative & falling — selling pressure`, signalClass: 'bearish' };
    }
    return { score: 35, confidence: 0.3, reason: `Force Index neutral`, signalClass: 'neutral' };
  }
}
