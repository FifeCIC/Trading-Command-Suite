/**
 * Liquidity Sweep
 * ===============
 * Detects stop hunts via wick-ratio thresholds and engulfing confirmation.
 * Single-wick and dual-candle pattern recognition for liquidity grabs.
 *
 * Liquidity sweep = price briefly pierces a level to trigger stops,
 * then reverses. Characterized by long wicks and engulfing patterns.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 15;
const WICK_RATIO_THRESHOLD = 0.6; // Wick is 60%+ of total candle range
const SWEEP_LOOKBACK = 10;

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
    key: 'wickRatioThreshold',
    label: 'Sweep wick ratio',
    type: 'number',
    default: WICK_RATIO_THRESHOLD,
    min: 0.3,
    max: 0.95,
    step: 0.05,
    unit: 'fraction of range',
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166 method): a stop-run is defined by the WICK dominating the bar. At 0.3 an ordinary bar qualifies; at 0.95 only a pure rejection does.',
    source: 'liquidity-sweep.directive.ts:WICK_RATIO_THRESHOLD',
  },
  {
    key: 'sweepLookback',
    label: 'Sweep lookback',
    type: 'number',
    default: SWEEP_LOOKBACK,
    min: 5,
    max: 80,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: the swept liquidity is the high/low of this window, so it decides which level was run.',
    source: 'liquidity-sweep.directive.ts:SWEEP_LOOKBACK',
  },
];

@Injectable()
export class LiquiditySweepDirective implements IDirective {
  readonly id = 'liquidity-sweep';
  readonly name = 'Liquidity Sweep';
  readonly category = 'pattern' as const;
  readonly description =
    'Detects stop hunts via wick-ratio thresholds and engulfing confirmation.';
  readonly priority = 68;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 15 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const wickRatioThreshold = values.wickRatioThreshold as number;
    const sweepLookback = values.sweepLookback as number;

    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-sweepLookback);
    const sweeps = this.findSweeps(recentBars, wickRatioThreshold);

    if (sweeps.length === 0) {
      return {
        score: 0,
        confidence: 0.4,
        reason: 'No liquidity sweep patterns detected.',
        signalClass: 'neutral',
      };
    }

    // Aggregate sweep signals
    const bullishSweeps = sweeps.filter((s) => s.direction === 'bullish');
    const bearishSweeps = sweeps.filter((s) => s.direction === 'bearish');

    const totalStrength = sweeps.reduce((sum, s) => sum + s.strength, 0);
    const netDirection = bullishSweeps.length - bearishSweeps.length;

    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (netDirection > 1) {
      score = 50 + Math.min(50, totalStrength * 4);
      signalClass = 'bullish';
      reason = `${bullishSweeps.length} bullish liquidity sweep(s). Stops below likely cleared — reversal up expected.`;
    } else if (netDirection < -1) {
      score = 50 + Math.min(50, totalStrength * 4);
      signalClass = 'bearish';
      reason = `${bearishSweeps.length} bearish liquidity sweep(s). Stops above likely cleared — reversal down expected.`;
    } else {
      score = Math.min(50, totalStrength * 3);
      signalClass = 'neutral';
      reason = `${bullishSweeps.length} bullish, ${bearishSweeps.length} bearish sweeps. Mixed signals.`;
    }

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.85, 0.3 + sweeps.length * 0.15).toFixed(2)),
      reason,
      signalClass,
    };
  }

  private findSweeps(
    bars: DirectiveInput['bars'],
    wickRatioThreshold: number,
  ): { direction: 'bullish' | 'bearish'; strength: number }[] {
    const sweeps: { direction: 'bullish' | 'bearish'; strength: number }[] = [];

    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i];
      const prevBar = bars[i - 1];
      const range = bar.high - bar.low;
      if (range === 0) continue;

      const body = Math.abs(bar.close - bar.open);
      const upperWick = bar.high - Math.max(bar.open, bar.close);
      const lowerWick = Math.min(bar.open, bar.close) - bar.low;

      // Bullish sweep: long lower wick, close near high
      const lowerWickRatio = lowerWick / range;
      const upperWickRatio = upperWick / range;

      if (lowerWickRatio >= wickRatioThreshold && bar.close > bar.open) {
        // Check if price swept below recent low
        const recentLow = Math.min(...bars.slice(Math.max(0, i - 5), i).map((b) => b.low));
        const sweptBelow = bar.low < recentLow;

        const strength = Math.min(10, lowerWickRatio * 8 + (sweptBelow ? 3 : 0) + (bar.close > prevBar.close ? 2 : 0));
        sweeps.push({ direction: 'bullish', strength });
      }

      // Bearish sweep: long upper wick, close near low
      if (upperWickRatio >= wickRatioThreshold && bar.close < bar.open) {
        const recentHigh = Math.max(...bars.slice(Math.max(0, i - 5), i).map((b) => b.high));
        const sweptAbove = bar.high > recentHigh;

        const strength = Math.min(10, upperWickRatio * 8 + (sweptAbove ? 3 : 0) + (bar.close < prevBar.close ? 2 : 0));
        sweeps.push({ direction: 'bearish', strength });
      }

      // Dual-candle sweep: engulfing bear then reversal bull (or vice versa)
      if (i >= 2) {
        const bar2 = bars[i - 2];
        if (bar.low < bar2.low && bar.close > bar.open && prevBar.close < prevBar.open) {
          // Bearish engulf past 2 bars, current bar reverses — bullish sweep
          sweeps.push({ direction: 'bullish', strength: 7 });
        }
        if (bar.high > bar2.high && bar.close < bar.open && prevBar.close > prevBar.open) {
          // Bullish engulf past 2 bars, current bar reverses — bearish sweep
          sweeps.push({ direction: 'bearish', strength: 7 });
        }
      }
    }

    return sweeps;
  }
}



