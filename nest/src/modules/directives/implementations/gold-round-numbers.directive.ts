/**
 * Gold Round Numbers Directive
 * ==============================
 * Gold (XAUUSD) powerfully respects psychological price levels.
 * This directive detects proximity to round-number zones and
 * adjusts scores based on whether price is approaching a level
 * from above (potential support) or below (potential resistance).
 *
 * ── Level Hierarchy ─────────────────────────────────────
 * Major levels: every $100 (2600, 2700, 2800...) — strong reactions
 * Minor levels: every $50  (2650, 2750, 2850...) — moderate reactions
 * Micro levels: every $10  (2610, 2620, 2630...) — weak but tradeable
 *
 * ── Proximity Zones ─────────────────────────────────────
 * Within 0.15% of a major level → strong signal (score ±25 from baseline)
 * Within 0.30% of a minor level → moderate signal (score ±15)
 * Within 0.50% of a micro level → weak signal (score ±8)
 *
 * ── Direction Logic ─────────────────────────────────────
 * Price ABOVE a round number → potential support (bullish if bouncing)
 * Price BELOW a round number → potential resistance (bearish if rejected)
 * Price AT a round number → highest reversal probability (neutral-watch)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

// ── Constants ────────────────────────────────────────────

const MAJOR_STEP = 100;   // $100 intervals
const MINOR_STEP = 50;    // $50 intervals
const MICRO_STEP = 10;    // $10 intervals

const MAJOR_ZONE_PCT = 0.0015;  // 0.15% proximity
const MINOR_ZONE_PCT = 0.0030;  // 0.30% proximity
const MICRO_ZONE_PCT = 0.0050;  // 0.50% proximity

const MAJOR_SCORE_SHIFT = 25;
const MINOR_SCORE_SHIFT = 15;
const MICRO_SCORE_SHIFT = 8;

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class GoldRoundNumbersDirective implements IDirective {
  readonly id = 'gold-round-numbers';
  readonly name = 'Gold Round Numbers';
  readonly description =
    'Gold psychological levels at $50/$100 intervals. ' +
    'Gold respects round numbers more consistently than any other asset — ' +
    'market makers and institutional algos cluster orders at these levels.';
  readonly priority = 58;
  readonly maxScore = 100;
  readonly minBars = { '1d': 2 }; // Only needs current price
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const sym = input.symbol.toUpperCase();
    if (sym !== 'XAUUSD' && sym !== 'XAU' && sym !== 'XAGUSD' && sym !== 'XAG') {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0,
        reason: `${input.symbol} is not a gold/silver symbol — round-number psychology applies primarily to XAUUSD.`,
      };
    }

    const bars = input.bars;
    if (!bars || bars.length === 0) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.1,
        reason: 'No price data available for round-number analysis.',
      };
    }

    const price = bars[bars.length - 1].close;
    if (!price || price <= 0) {
      return { signalClass: 'neutral', score: 50, confidence: 0, reason: 'Invalid price data.' };
    }

    // ── Find nearest round numbers ────────────────────────
    const nearestMajor = Math.round(price / MAJOR_STEP) * MAJOR_STEP;
    const nearestMinor = Math.round(price / MINOR_STEP) * MINOR_STEP;
    const nearestMicro = Math.round(price / MICRO_STEP) * MICRO_STEP;

    const distMajorPct = Math.abs(price - nearestMajor) / price;
    const distMinorPct = Math.abs(price - nearestMinor) / price;
    const distMicroPct = Math.abs(price - nearestMicro) / price;

    // ── Score based on strongest proximity ────────────────
    let score = 50;
    const signals: string[] = [];
    let bestLevel = 0;
    let bestDistPct = Infinity;

    // Check major levels first (strongest signal)
    if (distMajorPct <= MAJOR_ZONE_PCT) {
      bestLevel = nearestMajor;
      bestDistPct = distMajorPct;
      const direction = price > nearestMajor ? 'above (potential support)' : 'below (potential resistance)';
      const bullish = price > nearestMajor;
      score = 50 + (bullish ? MAJOR_SCORE_SHIFT : -MAJOR_SCORE_SHIFT);
      signals.push(`Major level $${nearestMajor}: price ${direction}, ${(distMajorPct * 100).toFixed(2)}% away`);
    } else if (distMinorPct <= MINOR_ZONE_PCT) {
      bestLevel = nearestMinor;
      bestDistPct = distMinorPct;
      const direction = price > nearestMinor ? 'above (potential support)' : 'below (potential resistance)';
      const bullish = price > nearestMinor;
      score = 50 + (bullish ? MINOR_SCORE_SHIFT : -MINOR_SCORE_SHIFT);
      signals.push(`Minor level $${nearestMinor}: price ${direction}, ${(distMinorPct * 100).toFixed(2)}% away`);
    } else if (distMicroPct <= MICRO_ZONE_PCT) {
      bestLevel = nearestMicro;
      bestDistPct = distMicroPct;
      const direction = price > nearestMicro ? 'above (potential support)' : 'below (potential resistance)';
      const bullish = price > nearestMicro;
      score = 50 + (bullish ? MICRO_SCORE_SHIFT : -MICRO_SCORE_SHIFT);
      signals.push(`Micro level $${nearestMicro}: price ${direction}, ${(distMicroPct * 100).toFixed(2)}% away`);
    } else {
      // No level nearby — note the nearest ones for reference
      signals.push(`Between $${nearestMajor - MAJOR_STEP} and $${nearestMajor} (${(distMajorPct * 100).toFixed(1)}% from nearest major)`);
    }

    // Clamp
    score = Math.max(10, Math.min(90, score));

    const signalClass = score > 55 ? 'bullish' : score < 45 ? 'bearish' : 'neutral';
    const confidence = bestDistPct < MAJOR_ZONE_PCT ? 0.7 : bestDistPct < MINOR_ZONE_PCT ? 0.55 : bestDistPct < MICRO_ZONE_PCT ? 0.4 : 0.2;

    return {
      signalClass,
      score,
      confidence,
      reason: `Gold at $${price.toFixed(2)}: ${signals.join(' | ')} → score=${score}/100`,
    };
  }
}
