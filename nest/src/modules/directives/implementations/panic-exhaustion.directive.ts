/**
 * Panic Exhaustion & Absorption Directive
 * =======================================
 * Detects the multi-phase capitulation sequence:
 * 1. Panic leg — sharp price drop
 * 2. Capitulation spike — volume climax
 * 3. Seller exhaustion — volume dry-up
 * 4. Base stabilization — price stops falling
 *
 * Scores high when exhaustion and stabilization are detected.
 *
 * TradePress source: includes/scoring-system/directives/panic-exhaustion-absorption.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const PANIC_LOOKBACK = 10; // Bars to detect panic drop
const STABILIZE_LOOKBACK = 4; // Bars to confirm stabilization
const VOL_SPIKE_MULT = 2.0; // Volume > 2x average = capitulation spike
const DROP_THRESHOLD = 5; // 5% drop in lookback = panic
const MIN_BARS = PANIC_LOOKBACK + STABILIZE_LOOKBACK + 5;

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
    key: 'panicLookback',
    label: 'Panic lookback',
    type: 'number',
    default: PANIC_LOOKBACK,
    min: 3,
    max: 40,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): the panic leg is the drop over this window, so it defines how sharp a fall counts as capitulation.',
    source: 'panic-exhaustion.directive.ts:PANIC_LOOKBACK',
  },
  {
    key: 'stabilizeLookback',
    label: 'Stabilisation lookback',
    type: 'number',
    default: STABILIZE_LOOKBACK,
    min: 2,
    max: 30,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: absorption is the stabilisation AFTER the drop, so this window decides how patient the directive is before calling it.',
    source: 'panic-exhaustion.directive.ts:STABILIZE_LOOKBACK',
  },
  {
    key: 'dropThreshold',
    label: 'Drop threshold',
    type: 'number',
    default: DROP_THRESHOLD,
    min: 0.5,
    max: 15,
    step: 0.5,
    unit: '% drop',
    chart: 'threshold',
    why: 'Measured 2026-11-01: 3% is a correction on an index and a normal afternoon on crypto. This is the gate that decides whether the setup exists.',
    source: 'panic-exhaustion.directive.ts:DROP_THRESHOLD',
  },
];

@Injectable()
export class PanicExhaustionAbsorptionDirective implements IDirective {
  readonly id = 'panic-exhaustion-absorption';
  readonly name = 'Panic Exhaustion & Absorption';
  readonly description = 'Detects panic → capitulation → exhaustion → stabilization sequence.';
  readonly category = 'pattern' as const;
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 19 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'bullish' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const panicLookback = values.panicLookback as number;
    const stabilizeLookback = values.stabilizeLookback as number;
    const dropThreshold = values.dropThreshold as number;

    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.` };
    }

    const closes = bars.map(b => b.close);
    const volumes = bars.map(b => b.volume);
    const n = closes.length;

    // Detect panic phase: sharp drop in recent panicLookback bars
    const panicStart = closes[n - 1 - panicLookback - stabilizeLookback];
    const panicEnd = closes[n - 1 - stabilizeLookback];
    const panicDrop = ((panicStart - panicEnd) / panicStart) * 100;

    if (panicDrop < dropThreshold) {
      return { signalClass: 'neutral', score: 0, confidence: 0.3, reason: `No panic detected: max drop ${panicDrop.toFixed(1)}% (threshold ${dropThreshold}%).` };
    }

    // Detect volume climax during panic
    const panicVolumes = volumes.slice(n - 1 - panicLookback - stabilizeLookback, n - stabilizeLookback);
    const avgPanicVol = panicVolumes.reduce((a, b) => a + b, 0) / panicVolumes.length;
    const maxPanicVol = Math.max(...panicVolumes);
    const priorAvgVol = sma(volumes.slice(0, n - panicLookback - stabilizeLookback), panicLookback);
    const hadSpike = priorAvgVol > 0 && maxPanicVol >= priorAvgVol * VOL_SPIKE_MULT;

    // Detect stabilization: recent bars flat or curling up
    const stabilizeBars = closes.slice(-stabilizeLookback);
    const stabilizeFirst = stabilizeBars[0];
    const stabilizeLast = stabilizeBars[stabilizeBars.length - 1];
    const stabilizeChange = ((stabilizeLast - stabilizeFirst) / stabilizeFirst) * 100;

    // Volume dry-up in stabilization
    const stabilizeVolumes = volumes.slice(-stabilizeLookback);
    const avgStabilizeVol = stabilizeVolumes.reduce((a, b) => a + b, 0) / stabilizeLookback;
    const volumeDryingUp = avgPanicVol > 0 && avgStabilizeVol < avgPanicVol * 0.7;

    // Score based on phase completion
    let phaseScore = 0;
    let phaseReasons: string[] = [];

    if (panicDrop >= dropThreshold) {
      phaseScore += 20;
      phaseReasons.push(`panic drop ${panicDrop.toFixed(1)}%`);
    }
    if (hadSpike) {
      phaseScore += 25;
      phaseReasons.push(`${(maxPanicVol/priorAvgVol).toFixed(1)}x volume spike`);
    }
    if (stabilizeChange >= -0.5) {
      phaseScore += 20;
      phaseReasons.push('price stabilizing');
      if (stabilizeChange > 0) phaseReasons.push('curling up');
    }
    if (volumeDryingUp) {
      phaseScore += 20;
      phaseReasons.push('volume drying up');
    }

    const score = Math.round(45 + phaseScore);
    const signalClass = phaseScore >= 60 ? 'bullish' : phaseScore >= 30 ? 'neutral' : 'bearish';

    return {
      signalClass,
      score: Math.min(95, score),
      confidence: 0.35 + (phaseScore / 85) * 0.4,
      reason: `${phaseReasons.length}/4 phases complete: ${phaseReasons.join(', ')}. ${phaseScore >= 60 ? 'Capitulation sequence maturing.' : 'Monitor for exhaustion.'}`,
    };
  }
}
