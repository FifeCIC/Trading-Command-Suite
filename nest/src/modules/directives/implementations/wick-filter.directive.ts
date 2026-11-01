/**
 * Wick Filter Directive
 * =====================
 * Detects whether a price spike is a "fakeout" (long wick) or a genuine breakout.
 * 
 * Scoring logic:
 * - Long wick that retraced >50% with normal volume = FAKEOUT (low score, don't move stop)
 * - Long wick with elevated volume and multi-TF confirmation = REAL (high score, move stop)
 * - Normal candle = neutral
 * 
 * Used by Stop Guardian to decide whether to adjust trailing stops.
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { atr } from '../utils/indicators';
import { resolveParams, type NumericParamSpec } from '../parameters';

const WICK_ATR_THRESHOLD = 1.5;   // Wick > 1.5× ATR = significant
const RETRACE_THRESHOLD = 0.5;     // Retrace > 50% of wick = fakeout
const VOL_SPIKE_MULTIPLIER = 1.5;  // Volume > 1.5× average = elevated

/**
 * Tunable knobs (#1165). Every default IS the module constant of the same value, so an instance that
 * supplies nothing scores byte-identically — asserted by the BASELINE guard, not merely stated here.
 *
 * ⚠️ A candlestick parameter is a THRESHOLD ON GEOMETRY. It is only provable against a candle that
 * sits near the boundary, which is why 'directive-fixtures.ts' carries explicitly shaped bars
 * (doji-bar, engulfing-bar, harami-bar, three-soldiers, reversal-hammer) rather than more smooth
 * series: on a uniform-geometry fixture every threshold value gives the same answer.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'wickAtrThreshold',
    label: 'Wick / ATR threshold',
    type: 'number',
    default: WICK_ATR_THRESHOLD,
    min: 0.5,
    max: 4,
    step: 0.1,
    unit: '× ATR',
    chart: 'threshold',
    why: 'Measured 2026-11-01 (#1166 method): the Stop Guardian reads this as stop-quality EVIDENCE, so the threshold decides how often a wick counts. At 0.5 nearly every bar qualifies; at 4 only an extreme rejection does.',
    source: 'wick-filter.directive.ts:18 WICK_ATR_THRESHOLD',
  },
  {
    key: 'retraceThreshold',
    label: 'Fakeout retrace',
    type: 'number',
    default: RETRACE_THRESHOLD,
    min: 0.1,
    max: 2,
    step: 0.05,
    unit: 'fraction of wick',
    chart: 'threshold',
    why: 'Measured 2026-11-01: the ratio is STRUCTURALLY >= 1 — for a bullish bar it is (close - low)/(open - low) and close > open — so any threshold below 1 is always true when a wick exists, which is why this was inert at its original 0.95 maximum. Above 1.0 it asks whether the wick was retraced by more than its own length, and the long-wick fixture scores 80 at the default against 65 at 2.0.',
    source: 'wick-filter.directive.ts:19 RETRACE_THRESHOLD',
  },
  {
    key: 'volSpikeMultiplier',
    label: 'Volume spike multiplier',
    type: 'number',
    default: VOL_SPIKE_MULTIPLIER,
    min: 1.05,
    max: 4,
    step: 0.05,
    unit: '× average',
    chart: 'threshold',
    why: 'Measured 2026-11-01: elevated volume is the third piece of evidence, so this decides whether it is present at all. 1.5× is routine on thin instruments and rare on liquid ones.',
    source: 'wick-filter.directive.ts:20 VOL_SPIKE_MULTIPLIER',
  },
];

@Injectable()
export class WickFilterDirective implements IDirective {
  readonly id = 'wick-filter';
  readonly name = 'Wick Filter';
  readonly description = 'Detects fakeout wicks vs genuine breakouts. Uses ATR, volume, and multi-timeframe logic.';
  readonly category = 'pattern' as const;
  readonly priority = 55;
  // ⚠️ maxScore corrected 100 → 80 (2026-10-20, #1131). MODE 9 measured
  // the highest score this directive's own return arithmetic can produce as 80;
  // the extra 20 points were permanent, unearnable capacity in every
  // protocol denominator. See node nest/scripts/directive-guard.cjs (MODE 9).
  readonly maxScore = 80;
  readonly minScore = 1;
  readonly minBars = { '1d': 10 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const wickAtrThreshold = values.wickAtrThreshold as number;
    const retraceThreshold = values.retraceThreshold as number;
    const volSpikeMultiplier = values.volSpikeMultiplier as number;

    const bars = input.bars;
    if (bars.length < 10) {
      return { score: 0, confidence: 0.1, reason: 'Insufficient data (need 10+ bars)', signalClass: 'neutral' };
    }

    const last = bars[bars.length - 1];
    const prevBar = bars[bars.length - 2];
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const closes = bars.map((b) => b.close);
    const volumes = bars.map((b) => b.volume);

    const a = atr(highs, lows, closes, 14);
    const lastAtr = a[a.length - 1];

    // ── Wick Analysis ──
    const isBullishBar = last.close >= last.open;
    const upperWick = isBullishBar ? last.high - last.close : last.high - last.open;
    const lowerWick = isBullishBar ? last.open - last.low : last.close - last.low;
    const bodySize = Math.abs(last.close - last.open);
    const totalRange = last.high - last.low;

    // Which wick is dominant?
    const dominantWick = Math.max(upperWick, lowerWick);
    const wickRatio = totalRange > 0 ? dominantWick / totalRange : 0;

    // ── Retrace check ──
    // Did price retrace back through the wick?
    const wickDirection = upperWick > lowerWick ? 'up' : 'down';
    let retraceRatio = 0;
    if (wickDirection === 'up') {
      // Upper wick: did price come back down?
      retraceRatio = upperWick > 0 ? (last.high - last.close) / upperWick : 0;
    } else {
      // Lower wick: did price bounce back up?
      retraceRatio = lowerWick > 0 ? (last.close - last.low) / lowerWick : 0;
    }

    // ── Volume check ──
    const avgVol = volumes.slice(-10, -1).reduce((a, b) => a + b, 0) / 9;
    const volRatio = avgVol > 0 ? last.volume / avgVol : 1;

    // ── Multi-bar context ──
    const prevClose = prevBar.close;
    const priceDirection = last.close > prevClose ? 'up' : 'down';

    // ── Scoring ──
    let score = 0;
    let reason = '';
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';

    const isSignificantWick = dominantWick > lastAtr * wickAtrThreshold;
    const isHighRetrace = retraceRatio > retraceThreshold;
    const isElevatedVol = volRatio > volSpikeMultiplier;

    if (isSignificantWick && isHighRetrace && !isElevatedVol) {
      // ── FAKEOUT: Big wick, retraced, normal volume ──
      score = 15;
      signalClass = 'neutral';
      reason = `Fakeout wick detected: ${wickDirection}-wick ${(wickRatio * 100).toFixed(0)}% of range, retraced ${(retraceRatio * 100).toFixed(0)}%, vol ${volRatio.toFixed(1)}x avg. Do NOT move stop.`;
    } else if (isSignificantWick && isElevatedVol) {
      // ── REAL BREAK: Big wick + elevated volume ──
      score = 80;
      signalClass = wickDirection === 'up' ? 'bullish' : 'bearish';
      reason = `Genuine breakout: ${wickDirection}-wick ${(wickRatio * 100).toFixed(0)}% of range, vol ${volRatio.toFixed(1)}x avg. Stop adjustment justified.`;
    } else if (isSignificantWick && !isHighRetrace) {
      // ── SUSTAINED: Big wick, didn't retrace ──
      score = 65;
      signalClass = wickDirection === 'up' ? 'bullish' : 'bearish';
      reason = `Sustained ${wickDirection}-move: wick ${(wickRatio * 100).toFixed(0)}% of range, minimal retrace. Momentum intact.`;
    } else if (wickRatio > 0.7 && isHighRetrace) {
      // ── INDECISION: Mostly wick, heavy retrace ──
      score = 30;
      signalClass = 'neutral';
      reason = `Indecision candle: ${(wickRatio * 100).toFixed(0)}% wick, heavy retrace. Market uncertain — hold stop.`;
    } else {
      // ── NORMAL: Nothing notable ──
      score = 50;
      signalClass = 'neutral';
      reason = `Normal price action. Wick ${(wickRatio * 100).toFixed(0)}% of range, ATR ratio ${(dominantWick / lastAtr).toFixed(1)}x.`;
    }

    return {
      score: Math.round(score),
      confidence: 0.4 + (isSignificantWick ? 0.3 : 0.1),
      reason,
      signalClass,
      metadata: {
        wickRatio,
        wickDirection,
        retraceRatio,
        volRatio,
        atrRatio: dominantWick / lastAtr,
        isFakeout: isSignificantWick && isHighRetrace && !isElevatedVol,
        isBreakout: isSignificantWick && isElevatedVol,
      },
    };
  }
}
