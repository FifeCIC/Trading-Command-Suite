/**
 * MT5 Star/Doji Directive
 * =======================
 * Morning Star = bearish → small/doji → bullish (3-candle reversal)
 * Evening Star = bullish → small/doji → bearish
 *
 * Confirmation: RSI(37) < 40 for buy, > 60 for sell
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

// ⚠️ MIN_BARS MUST COVER THE RSI PERIOD. It was 14 with `RSI_PERIOD = 37`, and `rsi()` returns an
// EMPTY array when `closes.length <= period` — so on the 14-37 bar window this directive declares,
// `latestRsi` fell back to the neutral 50 (line 40), `confirmed` could never be true, and the
// 90-point confirmed-star branch (#1131) was unreachable. The confident half of the directive could
// not fire on the very window it asked for.
const RSI_PERIOD = 37;
const MIN_BARS = RSI_PERIOD + 1;
const DOJI_BODY_RATIO = 0.15; // Body < 15% of range = doji-like

@Injectable()
export class Mt5StarDojiDirective implements IDirective {
  readonly id = 'mt5-star-doji';
  readonly name = 'MT5 Morning/Evening Star (with RSI confirmation)';
  readonly category = 'pattern' as const;
  readonly description = 'MT5-sourced 3-candle reversal pattern (morning/evening star) with RSI(37) confirmation.';
  readonly priority = 50;
  // ⚠️ maxScore corrected 100 → 90 (2026-10-20, #1131). MODE 9: the confirmed-star branch tops out
  // at 90; the extra 10 points were permanent, unearnable capacity. The reason that branch could
  // never fire at all on the declared window (RSI period vs MIN_BARS) is fixed at the constants.
  readonly maxScore = 90;
  readonly minScore = 1;
  readonly minBars = { '1d': RSI_PERIOD + 1 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars, symbol } = input;
    if (bars.length < MIN_BARS) {
      return { score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars.`, signalClass: 'neutral' };
    }

    const closes = bars.map((b) => b.close);
    const rsiValues = rsi(closes, RSI_PERIOD);
    const latestRsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;

    if (bars.length < 3) {
      return { score: 0, confidence: 0.2, reason: 'Need at least 3 bars.', signalClass: 'neutral' };
    }

    const c1 = bars[bars.length - 3]; // first candle
    const c2 = bars[bars.length - 2]; // middle (star)
    const c3 = bars[bars.length - 1]; // last candle

    const body1 = Math.abs(c1.close - c1.open);
    const body2 = Math.abs(c2.close - c2.open);
    const body3 = Math.abs(c3.close - c3.open);
    const range2 = c2.high - c2.low;
    const isDoji = range2 > 0 && body2 / range2 < DOJI_BODY_RATIO;
    const isSmall = body2 < body1 * 0.4 && body2 < body3 * 0.4;

    const c1Bearish = c1.close < c1.open;
    const c3Bullish = c3.close > c3.open;
    const c1Bullish = c1.close > c1.open;
    const c3Bearish = c3.close < c3.open;

    // ─── Morning Star ─────────────────────────────────────
    if (c1Bearish && (isDoji || isSmall) && c3Bullish) {
      const gapDown = c2.high < c1.open;
      const gapUp = c3.open > c2.close;
      const confirmed = latestRsi < 40;

      if (confirmed && gapDown && gapUp) {
        return {
          score: 90,
          confidence: 0.8,
          reason: `MT5: Morning Star at ${c3.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bullish',
        };
      }

      if (gapDown && gapUp) {
        return {
          score: 35,
          confidence: 0.3,
          reason: `MT5: Morning Star at ${c3.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
          signalClass: 'neutral',
        };
      }
    }

    // ─── Evening Star ────────────────────────────────────
    if (c1Bullish && (isDoji || isSmall) && c3Bearish) {
      const gapUp = c2.low > c1.close;
      const gapDown = c3.open < c2.close;
      const confirmed = latestRsi > 60;

      if (confirmed && gapUp && gapDown) {
        return {
          score: 90,
          confidence: 0.8,
          reason: `MT5: Evening Star at ${c3.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (confirmed)`,
          signalClass: 'bearish',
        };
      }

      if (gapUp && gapDown) {
        return {
          score: 35,
          confidence: 0.3,
          reason: `MT5: Evening Star at ${c3.close.toFixed(2)} | RSI=${latestRsi.toFixed(1)} (unconfirmed)`,
          signalClass: 'neutral',
        };
      }
    }

    return { score: 0, confidence: 0.2, reason: `MT5: No star pattern at ${c3.close.toFixed(2)}`, signalClass: 'neutral' };
  }
}
