/**
 * Williams %R Oscillator
 * =======================
 * Similar to stochastic but inverted. %R > -20 = overbought, < -80 = oversold.
 * Uses existing williamsR() utility from indicators.ts.
 * Scores mean reversion when %R is in oversold region with upward curl.
 */
import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { williamsR } from '../utils/indicators';

const PERIOD = 14;
const OVERSOLD = -80;
const OVERBOUGHT = -20;
const MIN_BARS = PERIOD + 2;

@Injectable()
export class WilliamsPercentRDirective implements IDirective {
  readonly id = 'williams-percent-r';
  readonly name = 'Williams %R Reversion';
  readonly description = 'Williams %R oscillator. Bullish when %R < -80 (oversold) with upward curl.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { high, low, close } = this.extractOHLC(input);
    if (close.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }
    const wR = williamsR(high, low, close, PERIOD);
    if (wR.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough %R values.', signalClass: 'neutral' };
    }
    const current = wR[wR.length - 1];
    const prev = wR[wR.length - 2];
    const curlingUp = current > prev;

    if (current <= OVERSOLD) {
      const depth = Math.min(1, (OVERSOLD - current) / 20);
      const curlBonus = curlingUp ? 0.3 : 0;
      const score = Math.round(40 + depth * 35 + curlBonus * 25);
      return {
        score: Math.min(100, score),
        confidence: curlingUp ? 0.7 + depth * 0.2 : 0.4,
        reason: `Williams %R = ${current.toFixed(1)} (oversold < ${OVERSOLD}), ${curlingUp ? 'curling up' : 'declining'}.`,
        signalClass: 'bullish',
      };
    }
    if (current >= OVERBOUGHT) {
      const depth = Math.min(1, (current - OVERBOUGHT) / 20);
      const score = Math.round(30 + depth * 30);
      return {
        score: Math.min(100, score),
        confidence: 0.5,
        reason: `Williams %R = ${current.toFixed(1)} (overbought > ${OVERBOUGHT}).`,
        signalClass: 'bearish',
      };
    }
    return { score: 10, confidence: 0.3, reason: `Williams %R = ${current.toFixed(1)} — neutral zone.`, signalClass: 'neutral' };
  }

  private extractOHLC(input: DirectiveInput): { high: number[]; low: number[]; close: number[] } {
    return {
      high: input.bars.map(b => b.high),
      low: input.bars.map(b => b.low),
      close: input.bars.map(b => b.close),
    };
  }
}
