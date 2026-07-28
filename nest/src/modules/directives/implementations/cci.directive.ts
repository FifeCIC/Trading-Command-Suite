/**
 * CCI (Commodity Channel Index) Directive
 * =======================================
 * Measures current price level relative to average price over time.
 *
 * CCI < -100 = oversold (bullish bounce potential).
 * CCI > +100 = overbought (bearish for longs).
 * CCI crossing above -100 from below = bullish signal.
 *
 * TradePress source: includes/scoring-system/directives/cci.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { cci } from '../utils/indicators';

const CCI_PERIOD = 20;
const OVERSOLD = -100;
const OVERBOUGHT = 100;
const MIN_BARS = CCI_PERIOD + 3;

@Injectable()
export class CciDirective implements IDirective {
  readonly id = 'cci';
  readonly name = 'Commodity Channel Index';
  readonly description = 'Measures price vs statistical mean. CCI < -100 = oversold bounce. CCI > 100 = overbought.';
  readonly directionBias = 'bearish' as const;

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 23 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const highs = input.bars.map(b => b.high);
    const lows = input.bars.map(b => b.low);
    const closes = input.bars.map(b => b.close);

    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const cciValues = cci(highs, lows, closes, CCI_PERIOD);
    if (cciValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough CCI values.' };
    }

    const current = cciValues[cciValues.length - 1];
    const previous = cciValues[cciValues.length - 2];
    const crossingUp = previous <= OVERSOLD && current > OVERSOLD;

    if (current <= OVERSOLD) {
      const depth = Math.min(1, (OVERSOLD - current) / 200); // -100 to -300 → 0–1
      const score = Math.round(55 + depth * 25 + (current > previous ? 10 : 0));
      return {
        score,
        confidence: 0.5 + depth * 0.2,
        reason: `CCI oversold at ${current.toFixed(1)}${current > previous ? ' and rising' : ''}. Statistical bounce potential.`,
      };
    }

    if (crossingUp) {
      return {
      signalClass: 'neutral',
      score: 70,
        confidence: 0.55,
        reason: `CCI crossing above -100 (${current.toFixed(1)}). Bullish recovery from oversold — strong signal.`,
      };
    }

    if (current >= OVERBOUGHT) {
      const height = Math.min(1, (current - OVERBOUGHT) / 200);
      return {
      signalClass: 'neutral',
      score: Math.round(20 - height * 10),
        confidence: 0.45 + height * 0.15,
        reason: `CCI overbought at ${current.toFixed(1)}. Statistical extreme — reduced long score.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 38,
      confidence: 0.3,
      reason: `CCI neutral at ${current.toFixed(1)}. No extreme signal.`,
    };
  }
}
