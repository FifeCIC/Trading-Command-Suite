/**
 * Regime Shift Exit
 * =================
 * Detects when market structure is breaking — a signal to exit regardless of profit.
 * Uses entropy spike detection and trend strength collapse.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const ENTROPY_WINDOW = 20;
const BINS = 8;

/**
 * Tunable knobs (#1165). Every default IS the module constant, so an instance that supplies nothing
 * scores byte-identically — asserted by the BASELINE guard in `directive-parameters.spec.ts`.
 *
 * ⚠️ Each `why` states the MEASUREMENT that makes the knob worth turning. A period is a HORIZON and a
 * threshold is a DEFINITION, not a preference: the same number means different things on a 1h chart and
 * a daily one, which is exactly why it cannot stay a constant.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'entropyWindow',
    label: 'Entropy window',
    type: 'number',
    default: ENTROPY_WINDOW,
    min: 10,
    max: 120,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): the regime test compares entropy across this window, so it sets how quickly a regime change is noticed — the exit reaction time.',
    source: 'regime-shift-exit.directive.ts:ENTROPY_WINDOW',
  },
];

@Injectable()
export class RegimeShiftExitDirective implements IDirective {
  readonly id = 'regime-shift-exit';
  readonly name = 'Regime Shift Exit';
  readonly description = 'Detects market structure breakdown via entropy spike. Urgent exit signal.';
  readonly category = 'structural' as const;
  readonly priority = 80;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 40 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;
  /**
   * ⚠️ #1020 — THIS DIRECTIVE HAS NO DIRECTION TO OFFER, SO IT SPEAKS THROUGH ITS SCORE.
   *
   * "Market structure is breaking" is true for a long and a short alike, so `signalClass: 'neutral'`
   * is CORRECT here — and until this threshold was declared, that `neutral` made the verdict
   * structurally unable to see this directive at all. MEASURED 2026-09-29: the score reached 100
   * carrying the reason "Regime shift detected … Exit recommended." while `arguesExit` was `false`
   * on every one of 17 open positions, because the consumer derives `arguesExit` from `signalClass`
   * and this class returns nothing else.
   *
   * 70 is NOT a round number chosen to make it fire — it is this class's OWN band boundary. The
   * branch `entropyDelta > 0.25 * maxEntropy` scores `70 + min(30, …)` and is the only branch whose
   * reason text recommends leaving; below it the reason reads "Monitor positions."
   */
  readonly exitScoreThreshold = 70;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const entropyWindow = values.entropyWindow as number;

    const bars = input.bars;
    if (bars.length < entropyWindow * 2) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const midpoint = Math.floor(closes.length / 2);

    const earlyEntropy = this.entropy(closes.slice(0, midpoint));
    const lateEntropy = this.entropy(closes.slice(midpoint));
    const entropyDelta = lateEntropy - earlyEntropy;
    const maxEntropy = Math.log2(BINS);

    let score = 0;
    let reason = '';

    if (entropyDelta > 0.25 * maxEntropy) {
      // Sharp entropy increase — regime breaking
      score = 70 + Math.min(30, (entropyDelta / maxEntropy) * 80);
      reason = `Regime shift detected: entropy spiked ${(entropyDelta / maxEntropy * 100).toFixed(0)}%. Market structure breaking. Exit recommended.`;
    } else if (entropyDelta > 0.1 * maxEntropy) {
      score = 40 + ((entropyDelta / maxEntropy) * 200);
      reason = `Moderate entropy increase (${(entropyDelta / maxEntropy * 100).toFixed(0)}%). Monitor positions.`;
    } else {
      score = Math.round(Math.max(5, (1 - (entropyDelta / maxEntropy + 0.3)) * 20));
      reason = `Regime stable. Entropy change: ${(entropyDelta / maxEntropy * 100).toFixed(0)}%.`;
    }

    return {
      score: Math.round(score),
      confidence: score > 50 ? Number(Math.min(0.85, 0.4 + (score / 150)).toFixed(2)) : 0.3,
      reason,
      signalClass: 'neutral',
    };
  }

  private entropy(values: number[]): number {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    if (range === 0) return 0;

    const bins = new Array(BINS).fill(0);
    for (const v of values) {
      const idx = Math.min(BINS - 1, Math.floor(((v - min) / range) * BINS));
      bins[idx]++;
    }

    let h = 0;
    for (const c of bins) {
      if (c > 0) { const p = c / values.length; h -= p * Math.log2(p); }
    }
    return h;
  }
}
