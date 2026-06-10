/**
 * MA Crossover Directive
 * ======================
 * Detects crossover of fast EMA over slow EMA.
 *
 * Fast > Slow = bullish (golden cross signal).
 * Fast < Slow = bearish (death cross signal).
 * Scores freshness of crossover and separation between MAs.
 *
 * Differs from MACD: simple EMA crossover, no histogram/divergence.
 *
 * TradePress source: includes/scoring-system/directives/ma-crossover.php
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { ema } from '../utils/indicators';

const FAST_PERIOD = 10;
const SLOW_PERIOD = 30;
const MIN_BARS = SLOW_PERIOD + 5;

@Injectable()
export class MaCrossoverDirective implements IDirective {
  readonly id = 'ma-crossover';
  readonly name = 'MA Crossover';
  readonly description =
    'Detects fast EMA crossing above/below slow EMA. Scores crossover freshness and separation.';

  readonly priority = 50;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    if (closes.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    const fast = ema(closes, FAST_PERIOD);
    const slow = ema(closes, SLOW_PERIOD);
    if (fast.length < 3 || slow.length < 3) {
      return { score: 0, confidence: 0.1, reason: 'Not enough EMA values.' };
    }

    const currFast = fast[fast.length - 1];
    const prevFast = fast[fast.length - 2];
    const currSlow = slow[slow.length - 1];
    const prevSlow = slow[slow.length - 2];

    const wasBelow = prevFast <= prevSlow;
    const nowAbove = currFast > currSlow;
    const wasAbove = prevFast >= prevSlow;
    const nowBelow = currFast < currSlow;

    const crossUp = wasBelow && nowAbove;
    const crossDown = wasAbove && nowBelow;
    const separation = Math.abs(currFast - currSlow) / currSlow;

    if (crossUp) {
      const score = Math.round(65 + Math.min(1, separation * 50) * 25); // 65–90
      return {
        score,
        confidence: 0.55 + Math.min(1, separation * 30) * 0.25,
        reason: `Bullish MA crossover: EMA(${FAST_PERIOD}) crossed above EMA(${SLOW_PERIOD}). Separation ${(separation * 100).toFixed(2)}%. Golden cross signal.`,
      };
    }

    if (crossDown) {
      return {
      signalClass: 'neutral',
      score: 15,
        confidence: 0.5,
        reason: `Bearish MA crossover: EMA(${FAST_PERIOD}) crossed below EMA(${SLOW_PERIOD}). Death cross — reduced long score.`,
      };
    }

    if (nowAbove) {
      // Already above: score based on separation
      const score = Math.round(50 + Math.min(1, separation * 40) * 20); // 50–70
      return {
        score,
        confidence: 0.4 + Math.min(1, separation * 20) * 0.2,
        reason: `EMA(${FAST_PERIOD}) above EMA(${SLOW_PERIOD}) — bullish alignment. No new crossover.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 25,
      confidence: 0.35,
      reason: `EMA(${FAST_PERIOD}) below EMA(${SLOW_PERIOD}) — bearish alignment.`,
    };
  }
}
