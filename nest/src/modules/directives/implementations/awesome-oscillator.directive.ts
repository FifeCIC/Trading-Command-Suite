/** Awesome Oscillator — 5-period SMA - 34-period SMA of midpoint. MT5 AO. */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class AwesomeOscillatorDirective implements IDirective {
  readonly id = 'awesome-oscillator';
  readonly name = 'Awesome Oscillator';
  readonly description = '5-bar SMA - 34-bar SMA of (H+L)/2. Positive & rising = bullish. MT5 Awesome Oscillator.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly minBars = { '1d': 36 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < 36) return { score: 0, confidence: 0.1, reason: `Need 36+ bars, have ${bars.length}`, signalClass: 'neutral' };
    const mid = bars.map((b) => (b.high + b.low) / 2);
    const sma5 = mid.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const sma34 = mid.slice(-34).reduce((a, b) => a + b, 0) / 34;
    const ao = sma5 - sma34;
    // Previous AO
    const prevMid5 = mid.slice(-6, -1).reduce((a, b) => a + b, 0) / 5;
    const prevMid34 = mid.slice(-35, -1).reduce((a, b) => a + b, 0) / 34;
    const prevAo = prevMid5 - prevMid34;
    const rising = ao > prevAo;
    if (ao > 0 && rising) return { score: 75, confidence: 0.7, reason: `AO positive & rising — strong bullish`, signalClass: 'bullish' };
    if (ao > 0) return { score: 55, confidence: 0.45, reason: `AO positive`, signalClass: 'bullish' };
    if (ao < 0 && !rising) return { score: 30, confidence: 0.4, reason: `AO negative — bearish`, signalClass: 'bearish' };
    return { score: 40, confidence: 0.3, reason: `AO crossing`, signalClass: 'neutral' };
  }
}
