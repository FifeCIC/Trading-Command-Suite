/**
 * Chaikin Money Flow (CMF)
 * ========================
 * CMF = sum(MFV, 20) / sum(volume, 20). Positive = accumulation.
 * > 0.2 = strong buying pressure. < -0.2 = strong selling.
 * Derived from MT5 standard CMF indicator.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { chaikinMoneyFlow } from '../utils/indicators';

const PERIOD = 20;
const THRESHOLD = 0.2;
const MIN_BARS = PERIOD + 2;

@Injectable()
export class ChaikinMoneyFlowDirective implements IDirective {
  readonly id = 'chaikin-money-flow';
  readonly name = 'Chaikin Money Flow';
  readonly category = 'oscillator' as const;
  readonly description = 'CMF > 0.2 = accumulation (bullish). < -0.2 = distribution (bearish). Scores institutional flow.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 22 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { high, low, close, volume } = this.extractOHLCV(input);
    if (close.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const cmf = chaikinMoneyFlow(high, low, close, volume, PERIOD);
    if (cmf.length === 0) {
      return { score: 0, confidence: 0.1, reason: 'Could not calculate CMF.', signalClass: 'neutral' };
    }
    const cur = cmf[cmf.length - 1];
    const prev = cmf.length > 1 ? cmf[cmf.length - 2] : 0;
    const strengthening = Math.abs(cur) > Math.abs(prev);

    if (cur > THRESHOLD) {
      const strength = Math.min(1, (cur - THRESHOLD) / 0.3);
      const score = Math.round(50 + strength * 40 + (strengthening ? 10 : 0));
      return {
        score: Math.min(this.maxScore, score),
        confidence: 0.7 + strength * 0.2,
        reason: `CMF = ${cur.toFixed(3)} (> ${THRESHOLD}), strong accumulation. Volume-weighted buying pressure.`,
        signalClass: 'bullish',
      };
    }
    if (cur > 0) {
      return { score: 35, confidence: 0.4, reason: `CMF = ${cur.toFixed(3)} — mild accumulation.`, signalClass: 'bullish' };
    }
    if (cur < -THRESHOLD) {
      const strength = Math.min(1, (Math.abs(cur) - THRESHOLD) / 0.3);
      return {
        score: Math.round(40 + strength * 30),
        confidence: 0.6,
        reason: `CMF = ${cur.toFixed(3)} (< -${THRESHOLD}), strong distribution.`,
        signalClass: 'bearish',
      };
    }
    return { score: 10, confidence: 0.25, reason: `CMF = ${cur.toFixed(3)} — neutral.`, signalClass: 'neutral' };
  }

  private extractOHLCV(input: DirectiveInput): { high: number[]; low: number[]; close: number[]; volume: number[] } {
    return {
      high: input.bars.map(b => b.high),
      low: input.bars.map(b => b.low),
      close: input.bars.map(b => b.close),
      volume: input.bars.map(b => b.volume),
    };
  }
}
