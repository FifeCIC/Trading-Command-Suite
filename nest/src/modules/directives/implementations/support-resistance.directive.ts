/**
 * Support & Resistance Levels Directive
 * =====================================
 * Detects local support/resistance from swing pivots in recent price action.
 *
 * Near support + bounce = bullish (buyers defending level).
 * Near resistance = bearish for longs (supply overhead).
 * Scores proximity to levels and bounce quality.
 *
 * TradePress source: includes/scoring-system/directives/support-resistance-levels.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { resolveParams, type NumericParamSpec } from '../parameters';

const LOOKBACK = 30; // Bars to scan for pivot points
const PIVOT_WINDOW = 3; // Bars each side of a pivot
const PROXIMITY_PCT = 2; // Within 2% of level = "near"

/**
 * S/R is the charted indicator the owner named directly (2026-11-01): *"The one for resistance and
 * support would also be a good charted indicator."* All three knobs chart naturally — two bracket the
 * time axis (`window`) and one is a distance band around the price line (`proximity`), so the levels it
 * finds can be DRAWN, not just scored.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'lookback',
    label: 'Lookback window',
    type: 'number',
    default: LOOKBACK,
    min: 10,
    max: 200,
    step: 5,
    unit: 'bars',
    chart: 'window',
    why: 'The scan window decides which pivots ARE a level. A 30-bar window on a 1h chart looks 30 hours back; the same 30 on a daily chart looks 6 weeks back — so one constant cannot mean the same thing across timeframes.',
    source: 'support-resistance.directive.ts:16 LOOKBACK',
  },
  {
    key: 'pivotWindow',
    label: 'Pivot window',
    type: 'number',
    default: PIVOT_WINDOW,
    min: 1,
    max: 20,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Bars each side that must be lower (or higher) for a pivot. Small values find many shallow pivots, large values find few major ones — the difference between noise and a level.',
    source: 'support-resistance.directive.ts:17 PIVOT_WINDOW',
  },
  {
    key: 'proximityPct',
    label: 'Near-a-level band',
    type: 'number',
    default: PROXIMITY_PCT,
    min: 0.2,
    max: 10,
    step: 0.1,
    unit: '%',
    chart: 'proximity',
    why: 'How close counts as "near". A fixed 2% is a long way on a quiet index and almost touching on a volatile one, so this is the knob that decides whether the directive fires at all on a given symbol.',
    source: 'support-resistance.directive.ts:18 PROXIMITY_PCT',
  },
];

@Injectable()
export class SupportResistanceLevelsDirective implements IDirective {
  readonly id = 'support-resistance-levels';
  readonly name = 'Support & Resistance Levels';
  readonly description = 'Detects local S/R levels from swing pivots. Near support = bullish, near resistance = bearish.';
  readonly category = 'pattern' as const;
  readonly priority = 50;
  readonly maxScore = 95; // corrected 100→95 2026-08-14 — real max = 65 + (2 - 0)*15 = 95 (bounce branch clamps to 95)
  readonly minScore = 1;
  readonly minBars = { '1d': 35 };
  readonly version = '1.3.0'; // maxScore corrected + Infinity reason fix
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const lookback = values.lookback as number;
    const pivotWindow = values.pivotWindow as number;
    const proximityPct = values.proximityPct as number;
    const bars = input.bars;
    const minBars = lookback + pivotWindow + 2;
    if (bars.length < minBars) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${minBars} bars, have ${bars.length}.` };
    }

    // Find swing highs and lows in the lookback window
    const swingLows: number[] = [];
    const swingHighs: number[] = [];
    const scanStart = bars.length - lookback - pivotWindow;
    const scanEnd = bars.length - pivotWindow;

    for (let i = scanStart + pivotWindow; i < scanEnd - pivotWindow; i++) {
      const curr = bars[i].low;
      let isSwingLow = true;
      let isSwingHigh = true;
      for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
        if (j === i) continue;
        if (bars[j].low <= curr) isSwingLow = false;
        if (bars[j].high >= bars[i].high) isSwingHigh = false;
      }
      if (isSwingLow) swingLows.push(curr);
      if (isSwingHigh) swingHighs.push(bars[i].high);
    }

    if (swingLows.length === 0 && swingHighs.length === 0) {
      return { signalClass: 'neutral', score: 0, confidence: 0.2, reason: 'No clear support or resistance levels detected in lookback window.' };
    }

    const currentPrice = bars[bars.length - 1].close;
    const prevPrice = bars[bars.length - 2].close;

    // Find nearest support and resistance
    let nearestSupport = Infinity;
    let nearestResistance = Infinity;
    for (const s of swingLows) {
      if (currentPrice > s && currentPrice - s < currentPrice - nearestSupport) nearestSupport = s;
    }
    for (const r of swingHighs) {
      if (currentPrice < r && r - currentPrice < nearestResistance - currentPrice) nearestResistance = r;
    }

    const supportDist = nearestSupport < Infinity ? ((currentPrice - nearestSupport) / currentPrice) * 100 : Infinity;
    const resistDist = nearestResistance < Infinity ? ((nearestResistance - currentPrice) / currentPrice) * 100 : Infinity;

    // Bounce detection: price was near support and is now rising
    const nearSupport = supportDist <= proximityPct;
    const nearResistance = resistDist <= proximityPct;
    const bouncing = nearSupport && currentPrice > prevPrice;

    if (bouncing) {
      const score = Math.round(65 + (proximityPct - supportDist) * 15);
      return {
        signalClass: 'bullish',
        score: Math.min(95, score),
        confidence: 0.55 + (proximityPct - supportDist) * 0.2,
        reason: `Bouncing off support at ${nearestSupport.toFixed(2)} (${supportDist.toFixed(1)}% away). Buyers defending level.`,
      };
    }

    if (nearSupport) {
      // ⚠️ CLAMPED because proximityPct became tunable (M2, #1165): at the old fixed 2% this topped out
      // at 70, but the knob allows 10, where the expression reaches 150 — above maxScore 95. Reachable only
      // through the new parameter, so it is a defect this change made possible rather than created.
      const score = Math.max(0, Math.min(this.maxScore, Math.round(50 + (proximityPct - supportDist) * 10)));
      return {
        signalClass: 'neutral',
        score,
        confidence: 0.4,
        reason: `Near support at ${nearestSupport.toFixed(2)} (${supportDist.toFixed(1)}% away). Watching for bounce confirmation.`,
      };
    }

    if (nearResistance) {
      return {
        signalClass: 'bearish',
        // ⚠️ CLAMPED for the same reason. At the fixed 2% the floor was 5; with proximity 4 and a level
        // 0.1% away this returned -14 (measured on SPY 1h, 2026-11-01), violating the contract's 0..maxScore.
        score: Math.max(0, Math.min(this.maxScore, Math.round(25 - (proximityPct - resistDist) * 10))),
        confidence: 0.4,
        reason: `Near resistance at ${nearestResistance.toFixed(2)} (${resistDist.toFixed(1)}% away). Supply overhead — reduced long score.`,
      };
    }

    const supportLabel = Number.isFinite(supportDist) ? `${supportDist.toFixed(1)}% below` : 'none below';
    const resistLabel = Number.isFinite(resistDist) ? `${resistDist.toFixed(1)}% above` : 'none above';
    return {
      signalClass: 'neutral',
      score: 0,
      confidence: 0.3,
      reason: `Mid-range: support ${supportLabel}, resistance ${resistLabel}. ${swingLows.length} supports, ${swingHighs.length} resistances found.`,
    };
  }
}
