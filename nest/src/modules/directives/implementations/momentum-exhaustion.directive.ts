/**
 * Momentum Exhaustion (Exit Signal)
 * ==================================
 * Detects when bullish momentum is fading — a signal to consider taking profit.
 * Combines RSI overbought + declining volume + MACD histogram shrinking.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const RSI_PERIOD = 14;
const VOL_LOOKBACK = 5;

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ "Exhaustion" is the CONJUNCTION of two independent readings — RSI overbought AND volume fading —
 * so each knob moves a different half of a two-condition test. The RSI period decides when the first
 * condition is met at all; the volume lookback decides how quickly the second notices a fade. Both
 * are measured on `noisy-uptrend`, where a 7-period RSI and a 5-bar volume window combine differently
 * from the 14/5 default.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'rsiPeriod',
    label: 'RSI period',
    type: 'number',
    default: RSI_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): half of the exhaustion test is "RSI overbought", so the period decides whether that half is ever true. RSI-7 reaches the overbought band on a pullback where RSI-14 does not.',
    source: 'momentum-exhaustion.directive.ts:12 RSI_PERIOD',
  },
  {
    key: 'volLookback',
    label: 'Volume fade lookback',
    type: 'number',
    default: VOL_LOOKBACK,
    min: 2,
    max: 30,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: this compares recent volume against the window before it, so a 2-bar lookback calls a single quiet bar a fade while 30 requires a sustained one — the reaction time of the exit warning.',
    source: 'momentum-exhaustion.directive.ts:13 VOL_LOOKBACK',
  },
];

@Injectable()
export class MomentumExhaustionDirective implements IDirective {
  readonly id = 'momentum-exhaustion';
  readonly name = 'Momentum Exhaustion';
  readonly description = 'Detects fading momentum — RSI overbought + declining volume. Exit urgency signal.';
  readonly category = 'oscillator' as const;
  readonly directionBias = 'bullish' as const;
  readonly priority = 65;
  readonly maxScore = 95;
  readonly minScore = 1;
  readonly minBars = { '1d': 19 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const volLookback = values.volLookback as number;

    const bars = input.bars;
    if (bars.length < Math.max(RSI_PERIOD + volLookback, rsiPeriod + volLookback)) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);
    const rsiValues = rsi(closes, rsiPeriod);
    const currentRsi = rsiValues[rsiValues.length - 1];

    // Volume trend: average of last volLookback bars declining?
    const recentVol = volumes.slice(-volLookback);
    const prevVol = volumes.slice(-volLookback * 2, -volLookback);
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
