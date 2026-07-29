/** Parabolic SAR — trailing stop that flips with trend. MT5 PSAR. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class ParabolicSarDirective implements IDirective {
  readonly id = 'parabolic-sar';
  readonly name = 'Parabolic SAR';
  readonly description = 'SAR below price = uptrend. Flips signal reversal. Step 0.02, max 0.2. MT5 Parabolic SAR.';
  readonly priority = 70;
  readonly maxScore = 100;
  readonly minBars = { '1d': 12 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;
  private readonly AF_STEP = 0.02;
  private readonly AF_MAX = 0.2;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 12) return { score: 0, confidence: 0.1, reason: `Need 12+ bars`, signalClass: 'neutral' };
    const sar = this.calcSar(bars);
    const lastClose = bars[bars.length - 1].close;
    const isUptrend = sar < lastClose;
    const distance = Math.abs(lastClose - sar) / lastClose * 100;
    if (isUptrend && distance > 0.5) {
      return { score: 65 + Math.min(20, Math.round(distance * 10)), confidence: 0.55 + Math.min(0.2, distance * 0.1), reason: `SAR below price (${distance.toFixed(1)}%) — uptrend`, signalClass: 'bullish' };
    }
    if (!isUptrend && distance > 0.5) {
      return { score: 30, confidence: 0.5, reason: `SAR above price (${distance.toFixed(1)}%) — downtrend`, signalClass: 'bearish' };
    }
    return { score: 45, confidence: 0.3, reason: `SAR near price`, signalClass: 'neutral' };
  }

  private calcSar(bars: DirectiveInput['bars']): number {
    let isLong = true, af = this.AF_STEP, ep = bars[0].high, sar = bars[0].low;
    for (let i = 1; i < bars.length; i++) {
      const prevSar = sar;
      sar = prevSar + af * (ep - prevSar);
      if (isLong) {
        if (bars[i].low < sar) { isLong = false; af = this.AF_STEP; ep = bars[i].low; sar = Math.max(bars[i].high, prevSar); }
        else { if (bars[i].high > ep) { ep = bars[i].high; af = Math.min(this.AF_MAX, af + this.AF_STEP); } sar = Math.min(sar, bars[i - 1].low); }
      } else {
        if (bars[i].high > sar) { isLong = true; af = this.AF_STEP; ep = bars[i].high; sar = Math.min(bars[i].low, prevSar); }
        else { if (bars[i].low < ep) { ep = bars[i].low; af = Math.min(this.AF_MAX, af + this.AF_STEP); } sar = Math.max(sar, bars[i - 1].high); }
      }
    }
    return sar;
  }
}
