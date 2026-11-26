/**
 * Hurst Memory
 * ============
 * Hurst Exponent estimation using R/S analysis.
 * H > 0.60 → trending / persistent (trend-following bias)
 * H < 0.40 → mean-reverting / anti-persistent
 * H ≈ 0.50 → random walk / efficient
 *
 * Confidence weighted by the R² of the SAME log-log regression that produced H.
 *
 * ⚠️ R² is measured over the regression POINTS (`log(n)`, `log(R/S)`), never over the price series.
 * Computing it from the prices measures how much the price moves relative to its own variance — a
 * quantity correlated with H itself — so a trending series earned both a high score and a high
 * confidence, and a quiet mean-reverting series was penalised twice. Measured 2026-11-25 on the
 * committed fixtures: the price-based form returned confidence **0.87 on 8 of 9 fixtures** (it is
 * `0.3 + 0.95 × 0.6` once `ΣΔ²/Σ(x−x̄)² → 6/n`), and its only low reading, **0.36**, was the
 * maximally anti-persistent alternating series — the one case where H is most decisive.
 *
 * ⚠️ KNOWN LIMIT, not a defect: with three R/S windows a straight line usually fits by chance, so R²
 * sits near 1 on almost every series. That is a property of R/S at three points, not of this
 * weighting. Widening the window set would move H itself and is a maths change (A/B required).
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
 * A straight line through TWO points always fits perfectly, so an R² of 1 from two points is
 * arithmetic, not evidence. Fit quality is only measurable from three regression points.
 */
const MIN_FIT_POINTS = 3;

/** Confidence spans `FLOOR` (no fit) … `FLOOR + SPAN` (perfect fit). */
const CONFIDENCE_FLOOR = 0.3;
const CONFIDENCE_SPAN = 0.6;

/**
 * The fit quality to assume when R² cannot be measured — the MIDPOINT of 0 (no fit) and 1 (perfect
 * fit), i.e. no discount and no bonus.
 *
 * ⚠️ NOT the floor. Two R/S windows are real evidence about memory; they are silent only about
 * linearity. Measured 2026-11-25: flooring the unmeasurable case put a 50–63-bar series (two windows
 * at the default `longestWindow`) at **0.30**, which crosses `scoring.service`'s 0.5 low-confidence
 * suppression threshold and would have silently dropped the directive's vote under group consensus.
 */
const NEUTRAL_FIT_QUALITY = 0.5;

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
  readonly version = '1.2.0';
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
    const estimate = this.hurstRS(closes, this.rsWindows(values.longestWindow as number));
    const h = estimate.h;

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

    const confidence = Number(
      (CONFIDENCE_FLOOR + (estimate.rSquared ?? NEUTRAL_FIT_QUALITY) * CONFIDENCE_SPAN).toFixed(2),
    );

    return {
      score: Math.round(score),
      confidence,
      // "Cannot judge" must not render as "judged well": when only two windows fit the series there
      // is no third point to test linearity against, so the reason says so rather than leaving an
      // unmoved confidence unexplained.
      reason:
        estimate.rSquared === null
          ? `${reason} Fit quality unmeasurable on ${estimate.windowCount} R/S windows — confidence left neutral.`
          : reason,
      signalClass,
    };
  }

  /**
   * Derive the R/S window set from the single `longestWindow` knob: w/4, w/2, w.
   * One knob rather than three, because a regression over an incoherent set (8 and 64 together)
   * is not a horizon — it is two horizons whose slope means nothing.
   */
  private rsWindows(longest: number): number[] {
    const w = Math.max(8, Math.round(longest));
    return [...new Set([Math.max(2, Math.round(w / 4)), Math.max(3, Math.round(w / 2)), w])];
  }

  /**
   * Hurst exponent via R/S analysis.
   * For each window size n, compute R/S and regress log(R/S) vs log(n); H is that slope, and the
   * returned `rSquared` is the fit quality of THAT regression over those SAME points.
   *
   * `rSquared` is null — not 1 — when fewer than `MIN_FIT_POINTS` points remain, because two points
   * are collinear by construction and an R² of 1 there would be a fabricated perfect fit.
   */
  private hurstRS(
    values: number[],
    windows: number[],
  ): { h: number; rSquared: number | null; windowCount: number } {
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

    if (points.length < 2) return { h: 0.5, rSquared: null, windowCount: points.length };

    // Linear regression: log(R/S) = H × log(n) + constant
    const n = points.length;
    const sumX = points.reduce((s, p) => s + p.x, 0);
    const sumY = points.reduce((s, p) => s + p.y, 0);
    const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    const yMean = sumY / n;
    let ssTotal = 0;
    let ssResidual = 0;
    // ⚠️ Same arithmetic as `linearRegression()` in `modules/trend/trend-read.math.ts`, and
    // deliberately NOT shared yet. That one regresses PRICE against bar index, where a flat series
    // means an undefined fit (it returns 0); here a flat LOG-LOG plot means every window agreed
    // exactly, which is a perfect fit. Converting that live trend path is a maths change under the
    // A/B rule, so it is named here instead — an edit to R² semantics must find both sites.
    for (const p of points) {
      ssTotal += (p.y - yMean) ** 2;
      ssResidual += (p.y - (slope * p.x + intercept)) ** 2;
    }

    // ssTotal === 0 means every window agreed exactly (a flat log-log plot, e.g. a pure sawtooth):
    // the line is then BOTH the fit and the mean, so the residuals are zero and the fit is perfect.
    // That is measured agreement across 3 points, not the vacuous 1 that two points would give.
    const rSquared =
      n < MIN_FIT_POINTS
        ? null
        : ssTotal > 0
          ? Math.max(0, Math.min(1, 1 - ssResidual / ssTotal))
          : 1;

    return { h: Math.max(0.1, Math.min(1, slope)), rSquared, windowCount: n };
  }
}



