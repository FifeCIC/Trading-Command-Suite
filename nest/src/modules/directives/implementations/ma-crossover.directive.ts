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
import { resolveParams, type NumericParamSpec } from '../parameters';

const FAST_PERIOD = 10;
const SLOW_PERIOD = 30;
const MIN_BARS = SLOW_PERIOD + 5;

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ These two are the cleanest example of why a period is not a preference but a HORIZON. On the
 * `noisy-range` fixture EMA(10)/EMA(30) reads bullish alignment while EMA(3)/EMA(8) reads a fresh
 * bearish cross on the same bars — one is a trend statement, the other a turn. `min`/`max` are
 * enforced so fast can never be raised above slow by accident: the sweep asserts the pair stays
 * ordered (a fast above slow would invert every signal).
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'fastPeriod',
    label: 'Fast EMA period',
    type: 'number',
    default: FAST_PERIOD,
    min: 3,
    max: 50,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): a 10/30 pair states the medium trend; a 3/8 pair states the last few bars. On the noisy-range fixture the same series reads bullish alignment at 10/30 and a fresh bearish cross at 3/8.',
    source: 'ma-crossover.directive.ts:23 FAST_PERIOD',
  },
  {
    key: 'slowPeriod',
    label: 'Slow EMA period',
    type: 'number',
    default: SLOW_PERIOD,
    min: 8,
    max: 200,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01: separation percent (which drives the score) is measured between the two EMAs, so widening slow from 30 to 100 changes both the alignment and how fresh it looks — the golden-cross score moves without any price change.',
    source: 'ma-crossover.directive.ts:24 SLOW_PERIOD',
  },
];

@Injectable()
export class MaCrossoverDirective implements IDirective {
  readonly id = 'ma-crossover';
  readonly name = 'MA Crossover';
  readonly category = 'oscillator' as const;
  readonly description =
    'Detects fast EMA crossing above/below slow EMA. Scores crossover freshness and separation.';

  readonly priority = 50;
  readonly maxScore = 90;
  readonly minScore = 1;
  readonly minBars = { '1d': 35 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    // ⚠️ ORDER IS RE-ESTABLISHED HERE, not assumed. The specs bound fast (3–50) and slow (8–200)
    // independently, so a caller can legitimately send fast 50 with slow 8 — which would invert every
    // signal this directive exists to detect, silently. Fast is clamped below slow, so the pair is
    // always a fast/slow pair whatever comes in. `resolveParams` already reports the clamp.
    const fastPeriod = Math.min(values.fastPeriod as number, (values.slowPeriod as number) - 1);
    const slowPeriod = values.slowPeriod as number;

    const closes = input.bars.map(b => b.close);
    const minBars = Math.max(MIN_BARS, slowPeriod + 5);
    if (closes.length < minBars) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${closes.length}.` };
    }

    const fast = ema(closes, fastPeriod);
    const slow = ema(closes, slowPeriod);
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
        reason: `Bullish MA crossover: EMA(${fastPeriod}) crossed above EMA(${slowPeriod}). Separation ${(separation * 100).toFixed(2)}%. Golden cross signal.`,
      };
    }

    if (crossDown) {
      return {
      signalClass: 'neutral',
      score: 15,
        confidence: 0.5,
        reason: `Bearish MA crossover: EMA(${fastPeriod}) crossed below EMA(${slowPeriod}). Death cross — reduced long score.`,
      };
    }

    if (nowAbove) {
      // Already above: score based on separation
      const score = Math.round(50 + Math.min(1, separation * 40) * 20); // 50–70
      return {
        score,
        confidence: 0.4 + Math.min(1, separation * 20) * 0.2,
        reason: `EMA(${fastPeriod}) above EMA(${slowPeriod}) — bullish alignment. No new crossover.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 25,
      confidence: 0.35,
      reason: `EMA(${fastPeriod}) below EMA(${slowPeriod}) — bearish alignment.`,
    };
  }
}
