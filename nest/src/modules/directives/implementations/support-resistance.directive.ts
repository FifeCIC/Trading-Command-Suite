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

const LOOKBACK = 30; // Bars to scan for pivot points
const PIVOT_WINDOW = 3; // Bars each side of a pivot
const PROXIMITY_PCT = 2; // Within 2% of level = "near"
const MIN_BARS = LOOKBACK + PIVOT_WINDOW + 2;

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
  readonly version = '1.2.0'; // maxScore corrected + Infinity reason fix
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.` };
    }

    // Find swing highs and lows in the lookback window
    const swingLows: number[] = [];
    const swingHighs: number[] = [];
    const scanStart = bars.length - LOOKBACK - PIVOT_WINDOW;
    const scanEnd = bars.length - PIVOT_WINDOW;

    for (let i = scanStart + PIVOT_WINDOW; i < scanEnd - PIVOT_WINDOW; i++) {
      const curr = bars[i].low;
      let isSwingLow = true;
      let isSwingHigh = true;
      for (let j = i - PIVOT_WINDOW; j <= i + PIVOT_WINDOW; j++) {
        if (j === i) continue;
        if (bars[j].low <= curr) isSwingLow = false;
        if (bars[j].high >= bars[i].high) isSwingHigh = false;
      }
      if (isSwingLow) swingLows.push(curr);
      if (isSwingHigh) swingHighs.push(bars[i].high);
    }

    if (swingLows.length === 0 && swingHighs.length === 0) {
      return { signalClass: 'neutral', score: 35, confidence: 0.2, reason: 'No clear support or resistance levels detected in lookback window.' };
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
    const nearSupport = supportDist <= PROXIMITY_PCT;
    const nearResistance = resistDist <= PROXIMITY_PCT;
    const bouncing = nearSupport && currentPrice > prevPrice;

    if (bouncing) {
      const score = Math.round(65 + (PROXIMITY_PCT - supportDist) * 15);
      return {
        signalClass: 'bullish',
        score: Math.min(95, score),
        confidence: 0.55 + (PROXIMITY_PCT - supportDist) * 0.2,
        reason: `Bouncing off support at ${nearestSupport.toFixed(2)} (${supportDist.toFixed(1)}% away). Buyers defending level.`,
      };
    }

    if (nearSupport) {
      const score = Math.round(50 + (PROXIMITY_PCT - supportDist) * 10);
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
        score: Math.round(25 - (PROXIMITY_PCT - resistDist) * 10),
        confidence: 0.4,
        reason: `Near resistance at ${nearestResistance.toFixed(2)} (${resistDist.toFixed(1)}% away). Supply overhead — reduced long score.`,
      };
    }

    const supportLabel = Number.isFinite(supportDist) ? `${supportDist.toFixed(1)}% below` : 'none below';
    const resistLabel = Number.isFinite(resistDist) ? `${resistDist.toFixed(1)}% above` : 'none above';
    return {
      signalClass: 'neutral',
      score: 38,
      confidence: 0.3,
      reason: `Mid-range: support ${supportLabel}, resistance ${resistLabel}. ${swingLows.length} supports, ${swingHighs.length} resistances found.`,
    };
  }
}
