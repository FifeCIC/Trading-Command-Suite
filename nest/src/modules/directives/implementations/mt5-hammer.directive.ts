/**
 * MT5 Hammer/Shooting Star Directive
 * ===================================
 * Hammer = small body at top, long lower wick (2x+ body), at support
 * Shooting Star = small body at bottom, long upper wick (2x+ body), at resistance
 *
 * Confirmation: RSI(37) < 40 for buy, > 60 for sell
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const MIN_BARS = 14;
const RSI_PERIOD = 37;
const WICK_BODY_RATIO = 2; // Wick must be 2x body size
const BODY_RANGE_RATIO = 0.35; // Body < 35% of total range

@Injectable()
export class Mt5HammerDirective implements IDirective {
  readonly id = 'mt5-hammer';
  readonly name = 'MT5 Hammer/Shooting Star (with RSI confirmation)';
  readonly category = 'pattern' as const;
  readonly description = 'MT5-sourced hammer and shooting star reversal patterns with RSI(37) confirmation.';
  readonly priority = 50;
  // ⚠️ maxScore corrected 100 → 80 (2026-10-20, #1131). MODE 9 measured
  // the highest score this directive's own return arithmetic can produce as 80;
  // the extra 20 points were permanent, unearnable capacity in every
  // protocol denominator. See node nest/scripts/directive-guard.cjs (MODE 9).
  readonly maxScore = 80;
  readonly minScore = 1;
  readonly minBars = { '1d': 14 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const; // Dynamic two-sided evidence (2026-09-08)

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, RSI_PERIOD);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    const curr = bars[bars.length - 1];
    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    if (range === 0) return { score: 0, confidence: 0.2, reason: 'No range on current candle.', signalClass: 'neutral' };

    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const bodyRatio = body / range;

    // Must be a small body candle
    if (bodyRatio > BODY_RANGE_RATIO) {
      return { score: 0, confidence: 0.2, reason: `MT5: Body too large for hammer at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
    }

    // ─── Hammer (bullish) ─────────────────────────────────
    // Small body at top, long lower wick, at support
    if (lowerWick > body * WICK_BODY_RATIO && upperWick < body * 0.5) {
      const confirmed = latestRsi < 40;

      if (confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Hammer at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      return {
        score: 25,
        confidence: 0.25,
        reason: `MT5: Hammer at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
        signalClass: 'neutral',
      };
    }

    // ─── Shooting Star (bearish) ──────────────────────────
    // Small body at bottom, long upper wick, at resistance
    if (upperWick > body * WICK_BODY_RATIO && lowerWick < body * 0.5) {
      const confirmed = latestRsi > 60;

      if (confirmed) {
        return {
          score: 80,
          confidence: 0.7,
          reason: `MT5: Shooting Star at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      return {
        score: 25,
        confidence: 0.25,
        reason: `MT5: Shooting Star at ${curr.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
        signalClass: 'neutral',
      };
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No hammer/shooting star at ${curr.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
