/**
 * RSI Overbought Directive
 * ========================
 * Mirror of rsi-oversold. RSI(14) > 70 = overbought, curling down = bearish.
 * Scores LOW for long-only strategies (anti-long signal).
 *
 * TradePress source: includes/scoring-system/directives/rsi-overbought.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const OVERBOUGHT_THRESHOLD = 70;
const MIN_BARS = RSI_PERIOD + 2;

@Injectable()
export class RsiOverboughtDirective implements IDirective {
  readonly id = 'rsi-overbought';
  readonly name = 'RSI Overbought Warning';
  readonly description =
    'Scores overbought symbols where RSI > 70 and starting to curl down. Anti-long signal.';

  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 16 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const rsiValues = rsi(closes, RSI_PERIOD);
    if (rsiValues.length < 2) {
      return { score: 0, confidence: 0.1, reason: 'Not enough RSI values.' };
    }

    const currentRsi = rsiValues[rsiValues.length - 1];
    const previousRsi = rsiValues[rsiValues.length - 2];
    const curlingDown = currentRsi < previousRsi;

    if (currentRsi <= OVERBOUGHT_THRESHOLD) {
      return { score: 0, confidence: 0.3, reason: `RSI ${currentRsi.toFixed(1)} not overbought (threshold >${OVERBOUGHT_THRESHOLD}).` };
    }

    const overboughtDepth = (currentRsi - OVERBOUGHT_THRESHOLD) / (100 - OVERBOUGHT_THRESHOLD); // 0–1
    const score = Math.round(15 - overboughtDepth * 10 - (curlingDown ? 5 : 0)); // 0–15

    return {
      signalClass: 'neutral',
      score: Math.max(0, score),
      confidence: 0.55 + overboughtDepth * 0.25 + (curlingDown ? 0.1 : 0),
      reason: `RSI overbought at ${currentRsi.toFixed(1)}${curlingDown ? ' and curling down' : ''}. ${curlingDown ? 'Bearish reversal risk — minimal long score.' : 'Extended rally — caution for new longs.'}`,
    };
  }
}
