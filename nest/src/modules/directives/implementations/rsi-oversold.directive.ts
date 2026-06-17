/**
 * RSI Oversold Reversion
 * ======================
 * Bullish when RSI(14) < 30 and curling upward.
 * Score scales with how oversold and how strongly RSI is recovering.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const OVERSOLD_THRESHOLD = 30;
const MIN_BARS = RSI_PERIOD + 2; // Need at least 2 RSI values to detect curl

@Injectable()
export class RsiOversoldDirective implements IDirective {
  readonly id = 'rsi-oversold';
  readonly name = 'RSI Oversold Reversion';
  readonly description =
    'Scores oversold symbols where RSI is below threshold and starting to curl up.';
  readonly priority = 85;
  readonly maxScore = 120;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    if (closes.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const rsiValues = rsi(closes, RSI_PERIOD);
    if (rsiValues.length < 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'Not enough RSI values to detect curl.',
        signalClass: 'neutral',
      };
    }

    const currentRsi = rsiValues[rsiValues.length - 1];
    const previousRsi = rsiValues[rsiValues.length - 2];
    const curling = currentRsi > previousRsi;

    if (currentRsi >= OVERSOLD_THRESHOLD) {
      // Not oversold — score based on proximity to threshold
      const proximity = Math.max(0, 1 - (currentRsi - OVERSOLD_THRESHOLD) / 20);
      const score = proximity * 25;
      return {
        score: Math.round(score),
        confidence: 0.4,
        reason: `RSI at ${currentRsi.toFixed(1)} — above oversold threshold (${OVERSOLD_THRESHOLD}).`,
        signalClass: 'neutral',
      };
    }

    // Oversold territory
    const depthFactor = Math.min(1, (OVERSOLD_THRESHOLD - currentRsi) / 20); // deeper = stronger signal
    const curlBonus = curling ? 0.4 : 0;
    const rawScore = 50 + depthFactor * 30 + curlBonus * 20;
    const confidence = curling
      ? Math.min(0.95, 0.6 + depthFactor * 0.3)
      : 0.4 + depthFactor * 0.2;

    return {
      score: Math.round(rawScore),
      confidence: Number(confidence.toFixed(2)),
      reason: `RSI(14) = ${currentRsi.toFixed(1)}, ${curling ? 'curling up' : 'still declining'}. Depth factor: ${(depthFactor * 100).toFixed(0)}%.`,
      signalClass: 'bullish',
    };
  }
}
