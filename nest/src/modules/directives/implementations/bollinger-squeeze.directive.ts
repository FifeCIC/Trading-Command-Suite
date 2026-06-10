/**
 * Bollinger Band Squeeze Directive
 * ================================
 * Detects Bollinger Band squeezes — bandwidth at multi-period low signaling imminent expansion.
 *
 * Squeeze = low volatility consolidation before a breakout.
 * Scores based on squeeze tightness and duration.
 *
 * TradePress source: includes/scoring-system/directives/bollinger-band-squeeze.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { bollingerBands } from '../utils/indicators';

const BB_PERIOD = 20;
const SQUEEZE_LOOKBACK = 50; // Compare current bandwidth to 50-period range
const MIN_BARS = BB_PERIOD + SQUEEZE_LOOKBACK + 2;

@Injectable()
export class BollingerBandSqueezeDirective implements IDirective {
  readonly id = 'bollinger-band-squeeze';
  readonly name = 'Bollinger Band Squeeze';
  readonly description = 'Detects bandwidth at multi-period low — signals imminent volatility expansion.';
  readonly priority = 50;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const { bandwidth } = bollingerBands(closes, BB_PERIOD);
    if (bandwidth.length < SQUEEZE_LOOKBACK) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: 'Not enough bandwidth values.' };
    }

    const currentBW = bandwidth[bandwidth.length - 1];
    const lookbackSlice = bandwidth.slice(-SQUEEZE_LOOKBACK);
    const minBW = Math.min(...lookbackSlice);
    const maxBW = Math.max(...lookbackSlice);
    const bwRange = maxBW - minBW;

    if (bwRange === 0) {
      return { signalClass: 'neutral', score: 0, confidence: 0, reason: 'Zero bandwidth range — insufficient data.' };
    }

    // Percentile: where current BW sits in the lookback range (0 = minimum, 1 = maximum)
    const percentile = (currentBW - minBW) / bwRange;

    // Squeeze detected when bandwidth is in bottom quartile
    if (percentile <= 0.25) {
      const tightness = 1 - (percentile / 0.25); // How close to the absolute minimum
      const score = Math.round(60 + tightness * 30);
      return {
        signalClass: 'bullish',
        score,
        confidence: 0.5 + tightness * 0.25,
        reason: `Bollinger squeeze detected: bandwidth at ${(percentile * 100).toFixed(0)}th percentile of ${SQUEEZE_LOOKBACK}-bar range (${currentBW.toFixed(2)}%). Volatility expansion likely.`,
      };
    }

    // Expansion already happening: bandwidth in top quartile
    if (percentile >= 0.75) {
      return {
        signalClass: 'neutral',
        score: 35,
        confidence: 0.3,
        reason: `Bollinger bands expanding: bandwidth at ${(percentile * 100).toFixed(0)}th percentile (${currentBW.toFixed(2)}%). Squeeze already released.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 40,
      confidence: 0.25,
      reason: `Bollinger bands normal: bandwidth at ${(percentile * 100).toFixed(0)}th percentile (${currentBW.toFixed(2)}%). No squeeze signal.`,
    };
  }
}
