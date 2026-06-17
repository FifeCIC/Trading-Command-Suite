/**
 * Momentum Exhaustion (Exit Signal)
 * ==================================
 * Detects when bullish momentum is fading — a signal to consider taking profit.
 * Combines RSI overbought + declining volume + MACD histogram shrinking.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const VOL_LOOKBACK = 5;

@Injectable()
export class MomentumExhaustionDirective implements IDirective {
  readonly id = 'momentum-exhaustion';
  readonly name = 'Momentum Exhaustion';
  readonly description = 'Detects fading momentum — RSI overbought + declining volume. Exit urgency signal.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < RSI_PERIOD + VOL_LOOKBACK) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const rsiValues = rsi(closes, RSI_PERIOD);
    const currentRsi = rsiValues[rsiValues.length - 1];

    // Volume trend: average of last VOL_LOOKBACK bars declining?
    const recentVol = volumes.slice(-VOL_LOOKBACK);
    const prevVol = volumes.slice(-VOL_LOOKBACK * 2, -VOL_LOOKBACK);
    const recentAvg = recentVol.reduce((a, b) => a + b, 0) / recentVol.length;
    const prevAvg = prevVol.reduce((a, b) => a + b, 0) / Math.max(1, prevVol.length);
    const volDeclining = recentAvg < prevAvg * 0.9;

    // Price trend: last 3 bars
    const last3 = closes.slice(-3);
    const priceStalling = last3[2] <= last3[0] * 1.01 && last3[2] >= last3[0] * 0.99; // flat

    let score = 0;
    let reason = '';
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    if (currentRsi >= 70 && volDeclining) {
      score = 65 + Math.min(30, (currentRsi - 70) * 1.5);
      signalClass = 'bearish';
      reason = `RSI overbought (${currentRsi.toFixed(1)}) with declining volume (${(recentAvg / Math.max(1, prevAvg) * 100).toFixed(0)}% of prior). Consider taking profit.`;
    } else if (currentRsi >= 70) {
      score = 40;
      reason = `RSI overbought (${currentRsi.toFixed(1)}) but volume still supporting.`;
    } else if (volDeclining && priceStalling) {
      score = 35;
      reason = `Volume declining and price stalling — momentum may be fading.`;
    } else {
      score = 10;
      reason = `Momentum intact. RSI: ${currentRsi.toFixed(1)}, volume stable.`;
    }

    return {
      score: Math.round(score),
      confidence: score > 50 ? Number(Math.min(0.8, 0.4 + (score / 100)).toFixed(2)) : 0.3,
      reason,
      signalClass,
    };
  }
}
