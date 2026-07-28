/**
 * Stochastic Oscillator Directive
 * ================================
 * %K = fast stochastic, %D = slow (3-period SMA of %K).
 *
 * Oversold: %K < 20 with %K crossing above %D = bullish bounce signal.
 * Overbought: %K > 80 with %K crossing below %D = bearish for longs.
 *
 * TradePress source: includes/scoring-system/directives/stochastic.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { stochastic } from '../utils/indicators';

const K_PERIOD = 14;
const D_PERIOD = 3;
const OVERSOLD = 20;
const OVERBOUGHT = 80;
const MIN_BARS = K_PERIOD + D_PERIOD + 2;

@Injectable()
export class StochasticDirective implements IDirective {
  readonly id = 'stochastic';
  readonly name = 'Stochastic Oscillator';
  readonly description =
    'Momentum oscillator. %K < 20 with crossover = oversold bounce. %K > 80 = overbought.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 19 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);

    if (closes.length < MIN_BARS) {
      return {
      signalClass: 'neutral',
      score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
      };
    }

    const { k, d } = stochastic(highs, lows, closes, K_PERIOD, D_PERIOD);
    if (k.length < 4 || d.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough stochastic values.' };
    }

    const currentK = k[k.length - 1];
    const prevK = k[k.length - 2];
    const currentD = d[d.length - 1];
    const prevD = d[d.length - 2];

    const crossUp = prevK <= prevD && currentK > currentD;
    const crossDown = prevK >= prevD && currentK < currentD;
    const kRising = currentK > prevK;

    if (currentK <= OVERSOLD) {
      const depth = (OVERSOLD - currentK) / OVERSOLD; // 0–1
      if (crossUp) {
        const score = Math.round(65 + depth * 25 + 10); // 75–100 (crossover bonus)
        return {
          score,
          confidence: 0.6 + depth * 0.3,
          reason: `Stochastic oversold (K=${currentK.toFixed(1)}, D=${currentD.toFixed(1)}) with bullish crossover. Strong bounce signal.`,
        };
      }
      if (kRising) {
        const score = Math.round(55 + depth * 25); // 55–80
        return {
          score,
          confidence: 0.5 + depth * 0.25,
          reason: `Stochastic oversold (K=${currentK.toFixed(1)}) and rising. Potential reversal building.`,
        };
      }
      return {
      signalClass: 'neutral',
      score: 45,
        confidence: 0.4,
        reason: `Stochastic oversold at K=${currentK.toFixed(1)} but no crossover yet. Watching for bounce.`,
      };
    }

    if (currentK >= OVERBOUGHT) {
      if (crossDown) {
        return {
      signalClass: 'neutral',
      score: 15,
          confidence: 0.55,
          reason: `Stochastic overbought (K=${currentK.toFixed(1)}) with bearish crossover. Reduced long score.`,
        };
      }
      return {
      signalClass: 'neutral',
      score: 25,
        confidence: 0.4,
        reason: `Stochastic overbought at K=${currentK.toFixed(1)}. Caution for longs.`,
      };
    }

    if (crossUp) {
      return {
      signalClass: 'neutral',
      score: 50,
        confidence: 0.35,
        reason: `Stochastic bullish crossover (K ${currentK.toFixed(1)} > D ${currentD.toFixed(1)}) in neutral zone. Moderate signal.`,
      };
    }

    if (crossDown) {
      return {
      signalClass: 'neutral',
      score: 30,
        confidence: 0.35,
        reason: `Stochastic bearish crossover in neutral zone. Weak long signal.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 38,
      confidence: 0.3,
      reason: `Stochastic neutral (K=${currentK.toFixed(1)}, D=${currentD.toFixed(1)}). No signal.`,
    };
  }
}
