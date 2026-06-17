/** Chaikin Money Flow — volume-weighted accumulation/distribution over N periods. MT5 CMF. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class ChaikinMfDirective implements IDirective {
  readonly id = 'chaikin-mf';
  readonly name = 'Chaikin Money Flow';
  readonly description = 'Volume-weighted AD over 21 bars. CMF > 0.05 = accumulation. CMF < -0.05 = distribution. MT5 CMF.';
  readonly priority = 72;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 24) return { score: 0, confidence: 0.1, reason: `Need 24+ bars`, signalClass: 'neutral' };
    const period = 21;
    let sumMfVol = 0, sumVol = 0;
    const start = bars.length - period;
    for (let i = start; i < bars.length; i++) {
      const b = bars[i];
      const hl = b.high - b.low;
      const mf = hl === 0 ? 0 : ((b.close - b.low) - (b.high - b.close)) / hl * b.volume;
      sumMfVol += mf;
      sumVol += b.volume;
    }
    const cmf = sumVol === 0 ? 0 : sumMfVol / sumVol;
    if (cmf > 0.05) {
      const s = Math.min(1, cmf / 0.3);
      return { score: Math.round(60 + s * 35), confidence: 0.5 + s * 0.3, reason: `CMF(21)=+${cmf.toFixed(3)} — accumulation`, signalClass: 'bullish' };
    }
    if (cmf < -0.05) {
      const s = Math.min(1, Math.abs(cmf) / 0.3);
      return { score: Math.round(35 - s * 20), confidence: 0.45 + s * 0.2, reason: `CMF(21)=${cmf.toFixed(3)} — distribution`, signalClass: 'bearish' };
    }
    return { score: 45, confidence: 0.3, reason: `CMF(21)=${cmf.toFixed(3)} — neutral`, signalClass: 'neutral' };
  }
}
