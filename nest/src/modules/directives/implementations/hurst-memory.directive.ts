/**
 * Hurst Memory
 * ============
 * Hurst Exponent estimation using R/S analysis.
 * H > 0.60 → trending / persistent (trend-following bias)
 * H < 0.40 → mean-reverting / anti-persistent
 * H ≈ 0.50 → random walk / efficient
 *
 * Confidence weighted by R² of the log-log regression.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const MIN_BARS = 50;
const RS_WINDOWS = [8, 16, 32];
const TREND_LEVEL = 0.65;
const REVERSION_LEVEL = 0.35;

/**
 * Tunable knobs (#1165). Defaults are the constants above — BASELINE proves the equality.
 *
 * ⚠️ These are the two levels that decide WHICH REGIME the directive reports, and they are the
 * reason it sat at one tier: the fixtures measured H = 0.99–1.00 on five of seven series, so the
 * strong-trend branch fired almost everywhere and a fixed 0.65 is effectively "always trending".
 * `mean-reverting` (H = 0.338) and `choppy` (H = 0.779) were added so both levels are reachable —
 * measured 2026-11-01, `trendLevel` at 0.9 drops choppy from 77 to 68, and `reversionLevel` at 0.2
 * drops mean-reverting from 68 to 56.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'trendLevel',
    label: 'Strong-trend level (H above)',
    type: 'number',
    default: TREND_LEVEL,
    min: 0.55,
    max: 0.99,
    step: 0.01,
    unit: 'H',
    chart: 'threshold',
    why: 'Measured 2026-11-01 on LIVE 1h bars (400 bars, seven symbols): H ran 0.917–1.000, so the published 0.6 breakpoint is passed by every instrument and even 0.9 separates none of them. The cap is 0.99 so the range REACHES the band that actually discriminates; the choppy fixture (H = 0.779) is what proves the knob moves, scoring 77 against 68.',
    source: 'hurst-memory.directive.ts:35 `h > 0.65`',
  },
  {
    key: 'reversionLevel',
    label: 'Strong mean-reversion level (H below)',
    type: 'number',
    default: REVERSION_LEVEL,
    min: 0.2,
    max: 0.44,
    step: 0.01,
    unit: 'H',
    chart: 'threshold',
    why: 'Measured 2026-11-01: the mean-reverting fixture measures H = 0.338, inside the 0.35 band boundary. At 0.2 it drops from 68 to 56 — the level decides whether a ranging symbol is reported as a counter-trend opportunity or as noise.',
    source: 'hurst-memory.directive.ts:50 `h < 0.35`',
  },
  {
    key: 'longestWindow',
    label: 'Longest R/S window',
    type: 'number',
    default: RS_WINDOWS[RS_WINDOWS.length - 1],
    min: 8,
    max: 96,
    step: 4,
    unit: 'bars',
    chart: 'series',
    why: 'R/S is regressed over three window sizes. The fixed [8, 16, 32] is a 32-bar horizon — four trading days on 1h, six weeks on 1d — and the estimate changes with it because a longer window averages over more regimes. The two shorter windows are derived as w/4 and w/2, so one knob controls the horizon without allowing an incoherent set (e.g. 8 and 64 in the same regression).',
    source: 'hurst-memory.directive.ts:34 RS_WINDOWS',
  },
];

@Injectable()
export class HurstMemoryDirective implements IDirective {
  readonly id = 'hurst-memory';
  readonly name = 'Hurst Memory';
  readonly category = 'oscillator' as const;
  readonly description =
    'Hurst exponent via R/S analysis. H>0.6 trending, H<0.4 mean-reverting.';
  readonly priority = 75;
  readonly maxScore = 95;
  readonly minScore = 1;
  readonly minBars = { '1d': 50 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    const { values } = resolveParams(this.id, this.params, input.params);
    const trendLevel = values.trendLevel as number;
    const reversionLevel = values.reversionLevel as number;

    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const closes = bars.map((b) => b.close);
    const h = this.hurstRS(closes, this.rsWindows(values.longestWindow as number));
    const rSquared = this.regressionQuality(closes);

    // Determine signal
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (h > trendLevel) {
      // Strong trend memory — continuation likely
      const trend = closes[closes.length - 1] > closes[closes.length - 20] ? 'bullish' : 'bearish';
      score = 55 + Math.min(1, (h - 0.5) * 2) * 40;
      signalClass = trend;
      reason = `H=${h.toFixed(3)} — strong trend memory (persistent). ${trend === 'bullish' ? 'Bullish' : 'Bearish'} continuation likely.`;
    } else if (h > 0.55) {
      // Mild trend
      const trend = closes[closes.length - 1] > closes[Math.floor(closes.length / 2)] ? 'bullish' : 'bearish';
      score = 40 + (h - 0.5) * 100;
      signalClass = trend;
      reason = `H=${h.toFixed(3)} — mild trend memory. ${trend === 'bullish' ? 'Bullish' : 'Bearish'} bias.`;
    } else if (h < reversionLevel) {
      // Strong mean-reversion
      score = 55 + Math.min(1, (0.5 - h) * 2) * 40;
      signalClass = 'bullish'; // Mean-reversion inherently favors buying dips
      reason = `H=${h.toFixed(3)} — strong mean-reversion. Favor counter-trend entries.`;
    } else if (h < 0.45) {
      // Mild mean-reversion
      score = 40 + (0.5 - h) * 100;
      signalClass = 'neutral';
      reason = `H=${h.toFixed(3)} — mild mean-reversion tendency.`;
    } else {
      // Random walk (between the two levels)
      score = 15;
      signalClass = 'neutral';
      reason = `H=${h.toFixed(3)} — near random walk. No memory bias.`;
    }

    return {
      score: Math.round(score),
      confidence: Number((0.3 + rSquared * 0.6).toFixed(2)),
      reason,
      signalClass,
    };
  }

  /**
   * Hurst exponent via R/S analysis.
   * For each window size n, compute R/S and regress log(R/S) vs log(n).
   */
  /**
   * Derive the R/S window set from the single `longestWindow` knob: w/4, w/2, w.
   * One knob rather than three, because a regression over an incoherent set (8 and 64 together)
   * is not a horizon — it is two horizons whose slope means nothing.
   */
  private rsWindows(longest: number): number[] {
    const w = Math.max(8, Math.round(longest));
    return [...new Set([Math.max(2, Math.round(w / 4)), Math.max(3, Math.round(w / 2)), w])];
  }

  private hurstRS(values: number[], windows: number[]): number {
    const points: { x: number; y: number }[] = [];

    for (const windowSize of windows) {
      if (windowSize > values.length / 2) continue;

      // Average R/S over non-overlapping windows
      let rsSum = 0;
      let count = 0;

      for (let i = 0; i + windowSize <= values.length; i += windowSize) {
        const segment = values.slice(i, i + windowSize);
        const mean = segment.reduce((a, b) => a + b, 0) / segment.length;
        const deviations = segment.map((v) => v - mean);
        const cumulativeDeviations = deviations.reduce(
          (acc, d, idx) => {
            const prev = idx > 0 ? acc[acc.length - 1] : 0;
            acc.push(prev + d);
            return acc;
          },
          [] as number[],
        );
        const r = Math.max(...cumulativeDeviations) - Math.min(...cumulativeDeviations);
        const std = Math.sqrt(deviations.reduce((a, d) => a + d * d, 0) / segment.length);
        if (std > 0) {
          rsSum += r / std;
          count++;
        }
      }

      if (count > 0) {
        points.push({ x: Math.log(windowSize), y: Math.log(rsSum / count) });
      }
    }

    if (points.length < 2) return 0.5;

    // Linear regression: log(R/S) = H × log(n) + constant
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return Math.max(0.1, Math.min(1, slope));
  }

  private regressionQuality(values: number[]): number {
    // Simple R² approximation based on price autocorrelation
    const n = values.length;
    if (n < 20) return 0.3;

    const mean = values.reduce((a, b) => a + b, 0) / n;
    let ssTotal = 0;
    let ssResidual = 0;

    for (let i = 1; i < n; i++) {
      ssTotal += (values[i] - mean) ** 2;
      ssResidual += (values[i] - values[i - 1]) ** 2;
    }

    if (ssTotal === 0) return 0.3;
    return Math.min(0.95, Math.max(0.1, 1 - ssResidual / ssTotal));
  }
}



