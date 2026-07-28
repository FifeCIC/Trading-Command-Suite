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

const PANIC_LOOKBACK = 10; // Bars to detect panic drop
const STABILIZE_LOOKBACK = 4; // Bars to confirm stabilization
const VOL_SPIKE_MULT = 2.0; // Volume > 2x average = capitulation spike
const DROP_THRESHOLD = 5; // 5% drop in lookback = panic
const MIN_BARS = PANIC_LOOKBACK + STABILIZE_LOOKBACK + 5;

@Injectable()
export class PanicExhaustionAbsorptionDirective implements IDirective {
  readonly id = 'panic-exhaustion-absorption';
  readonly name = 'Panic Exhaustion & Absorption';
  readonly description = 'Detects panic → capitulation → exhaustion → stabilization sequence.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 19 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.` };
    }

    const closes = bars.map(b => b.close);
    const volumes = bars.map(b => b.volume);
    const n = closes.length;

    // Detect panic phase: sharp drop in recent PANIC_LOOKBACK bars
    const panicStart = closes[n - 1 - PANIC_LOOKBACK - STABILIZE_LOOKBACK];
    const panicEnd = closes[n - 1 - STABILIZE_LOOKBACK];
    const panicDrop = ((panicStart - panicEnd) / panicStart) * 100;

    if (panicDrop < DROP_THRESHOLD) {
      return { signalClass: 'neutral', score: 0, confidence: 0.3, reason: `No panic detected: max drop ${panicDrop.toFixed(1)}% (threshold ${DROP_THRESHOLD}%).` };
    }

    // Detect volume climax during panic
    const panicVolumes = volumes.slice(n - 1 - PANIC_LOOKBACK - STABILIZE_LOOKBACK, n - STABILIZE_LOOKBACK);
    const avgPanicVol = panicVolumes.reduce((a, b) => a + b, 0) / panicVolumes.length;
    const maxPanicVol = Math.max(...panicVolumes);
    const priorAvgVol = sma(volumes.slice(0, n - PANIC_LOOKBACK - STABILIZE_LOOKBACK), PANIC_LOOKBACK);
    const hadSpike = priorAvgVol > 0 && maxPanicVol >= priorAvgVol * VOL_SPIKE_MULT;

    // Detect stabilization: recent bars flat or curling up
    const stabilizeBars = closes.slice(-STABILIZE_LOOKBACK);
    const stabilizeFirst = stabilizeBars[0];
    const stabilizeLast = stabilizeBars[stabilizeBars.length - 1];
    const stabilizeChange = ((stabilizeLast - stabilizeFirst) / stabilizeFirst) * 100;

    // Volume dry-up in stabilization
    const stabilizeVolumes = volumes.slice(-STABILIZE_LOOKBACK);
    const avgStabilizeVol = stabilizeVolumes.reduce((a, b) => a + b, 0) / STABILIZE_LOOKBACK;
    const volumeDryingUp = avgPanicVol > 0 && avgStabilizeVol < avgPanicVol * 0.7;

    // Score based on phase completion
    let phaseScore = 0;
    let phaseReasons: string[] = [];

    if (panicDrop >= DROP_THRESHOLD) {
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
