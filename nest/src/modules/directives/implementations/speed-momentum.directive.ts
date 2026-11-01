/**
 * Speed Momentum
 * ===============
 * Core speed-trading directive. Measures short-term price velocity
 * (5-candle rate of change) on the active timeframe, amplified by
 * volume confirmation.
 *
 * maxScore: 120 — high ceiling because this is the primary signal
 * for the Bitcoin Speed Protocol and high-vol scalping strategies.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const LOOKBACK = 5; // 5-candle velocity window
const MIN_BARS = LOOKBACK + 5; // Need extra bars for volume comparison

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
    key: 'lookback',
    label: 'Momentum lookback',
    type: 'number',
    default: LOOKBACK,
    min: 2,
    max: 30,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01 (#1166 method): "speed" is displacement over this window, so a 3-bar lookback reports bursts and a 20-bar one reports drift.',
    source: 'speed-momentum.directive.ts:LOOKBACK',
  },
];

@Injectable()
export class SpeedMomentumDirective implements IDirective {
  readonly id = 'speed-momentum';
  readonly name = 'Speed Momentum';
  readonly category = 'oscillator' as const;
  readonly description =
    'Short-term price velocity over 5 candles, amplified by volume confirmation. Core signal for speed/scalp trading on M1-M15 timeframes.';
  readonly priority = 85;
  readonly maxScore = 120;
  readonly minScore = 1;
  readonly minBars = { '1d': 10 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const lookback = values.lookback as number;

    const bars = input.bars;
    if (!bars || bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.0,
        reason: `Insufficient bars: need ${MIN_BARS}, have ${bars?.length ?? 0}.`,
        signalClass: 'neutral',
      };
    }

    // ── 5-candle Rate of Change ─────────────────────────
    const latest = bars[bars.length - 1];
    const previous = bars[bars.length - 1 - lookback];
    const roc = previous.close > 0
      ? ((latest.close - previous.close) / previous.close) * 100
      : 0;

    // ── Volume Confirmation ─────────────────────────────
    const recentBars = bars.slice(-lookback);
    const olderBars = bars.slice(-lookback * 2, -lookback);

    const recentVol = recentBars.reduce((s, b) => s + (b.volume || 0), 0) / lookback;
    const olderVol = olderBars.length > 0
      ? olderBars.reduce((s, b) => s + (b.volume || 0), 0) / olderBars.length
      : recentVol;

    const volRatio = olderVol > 0 ? recentVol / olderVol : 1;

    // ── Score: ROC magnitude × volume multiplier ────────
    const absRoc = Math.abs(roc);
    let score = Math.min(this.maxScore, absRoc * 80); // 1.5%+ move = 120

    // Volume can amplify up to 2x
    const volMultiplier = Math.min(2.0, Math.max(0.5, volRatio));
    score = Math.round(score * volMultiplier);

    // ── Direction ───────────────────────────────────────
    const direction = roc > 0.15
      ? 'bullish'
      : roc < -0.15
        ? 'bearish'
        : 'neutral';

    // ── Confidence ──────────────────────────────────────
    const confidence = Math.min(0.95, absRoc * 0.4 + (volRatio > 1.2 ? 0.15 : 0));

    // Clamp to declared maxScore
    const clampedScore = Math.min(this.maxScore, Math.max(0, score));

    return {
      score: clampedScore,
      confidence: Number(confidence.toFixed(2)),
      reason: `${direction} velocity: ${roc >= 0 ? '+' : ''}${roc.toFixed(2)}% over ${lookback} bars. Volume: ${volRatio.toFixed(1)}x avg.`,
      signalClass: direction,
    };
  }
}
