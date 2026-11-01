/**
 * RSI Divergence Scanner
 * ======================
 * Detects bullish divergence (price lower low, RSI higher low) and
 * bearish divergence (price higher high, RSI lower high).
 *
 * Swing point detection uses a 5-bar lookback to identify local
 * highs and lows in both price and RSI, then compares the last
 * two swing points of matching direction.
 *
 * Bullish divergence = reversal signal (bearish trend weakening).
 * Bearish divergence = continuation warning (bullish trend weakening).
 *
 * The swing and divergence ALGORITHM is imported from ../utils/divergence — ONE copy,
 * shared with macd- and obv-divergence. Only the strength CALIBRATION stays local.
 *
 * ⚠️ Before 2026-09-21 this file held a private block headed "Shared Divergence
 * Utilities", with a comment claiming it was "extracted for reuse by MACD/OBV".
 * Nothing imported it. Both other directives kept their own copies. A comment that
 * describes a decision nobody made is worse than no comment, because the reader
 * trusts it and stops looking.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';
import {
  checkBearishDivergence,
  checkBullishDivergence,
  computeDivergenceStrength,
  findSwingHighs,
  findSwingLows,
  type StrengthModel,
} from '../utils/divergence';
import { resolveParams, type NumericParamSpec } from '../parameters';

const RSI_PERIOD = 14;
const SWING_LOOKBACK = 5; // Bars to confirm a swing point
const MIN_BARS = RSI_PERIOD + SWING_LOOKBACK * 3 + 2;

/**
 * Tunable knobs (#1165). Defaults ARE the constants above — BASELINE proves the equality.
 *
 * ⚠️ A divergence is a comparison between TWO SWINGS, so the swing lookback decides which swings
 * exist at all: at 2 bars a small pullback is a swing, at 10 only a major one is. That is why this is
 * the knob #605 needs for TradingView parity — TradingView's default is 5 and every parity test has
 * to state it. Measured on the `noisy-downtrend` fixture, the detected pair changes between 2 and 10.
 */
const PARAMS: readonly NumericParamSpec[] = [
  {
    key: 'rsiPeriod',
    label: 'RSI period',
    type: 'number',
    default: RSI_PERIOD,
    min: 2,
    max: 60,
    step: 1,
    unit: 'bars',
    chart: 'series',
    why: 'Measured 2026-11-01 (#1166 method): the RSI series is one half of every comparison, so a shorter period reacts at different swing points — a different divergence, not a differently-scored one.',
    source: 'rsi-divergence.directive.ts:40 RSI_PERIOD',
  },
  {
    key: 'swingLookback',
    label: 'Swing lookback',
    type: 'number',
    default: SWING_LOOKBACK,
    min: 2,
    max: 20,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: this is the TradingView parity knob (#605). At 2 bars minor pullbacks qualify as swings; at 10 only major ones do, so the pair being compared is different and the divergence can disappear entirely.',
    source: 'rsi-divergence.directive.ts:41 SWING_LOOKBACK',
  },
];

/**
 * RSI is BOUNDED 0-100 by construction, so the indicator move is normalised by a
 * CONSTANT 100 rather than by the value at the swing — the only one of the three that
 * can do this. Carried across UNCHANGED from the local copy this file used to hold.
 *
 * ⚠️ The three models differ (RSI weights the indicator 2.0 vs MACD's 1.5; OBV uses
 * 2.5/2.0). That was invisible while each lived in its own file. See StrengthModel in
 * ../utils/divergence for the scale table.
 */
const STRENGTH_MODEL: StrengthModel = {
  priceWeight: 3,
  indWeight: 2,
  indDenominator: () => 100,
};

@Injectable()
export class RsiDivergenceDirective implements IDirective {
  readonly id = 'rsi-divergence';
  readonly name = 'RSI Divergence Scanner';
  readonly category = 'oscillator' as const;
  readonly description =
    'Detects bullish/bearish RSI divergence — price making new extremes while RSI fails to confirm. Strong reversal signal.';
  readonly priority = 82;
  readonly maxScore = 110;
  readonly minScore = 1;
  readonly minBars = { '1d': 31 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;
  readonly params = PARAMS;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const swingLookback = values.swingLookback as number;

    const closes = input.bars.map((b) => b.close);
    const lows = input.bars.map((b) => b.low);
    const highs = input.bars.map((b) => b.high);

    if (closes.length < Math.max(MIN_BARS, rsiPeriod + swingLookback * 3 + 2)) {
      return this.insufficient(closes.length);
    }

    const rsiValues = rsi(closes, rsiPeriod);
    if (rsiValues.length < swingLookback * 2 + 2) {
      return this.insufficient(closes.length);
    }

    // Align RSI with price bars (RSI starts at index rsiPeriod)
    const rsiOffset = closes.length - rsiValues.length;
    const getRsi = (barIdx: number): number => {
      const rsiIdx = barIdx - rsiOffset;
      if (rsiIdx < 0 || rsiIdx >= rsiValues.length) return 50;
      return rsiValues[rsiIdx];
    };

    // ── Find swing lows (price) ──
    const swingLows = findSwingLows(lows, swingLookback, getRsi);
    // ── Find swing highs (price) ──
    const swingHighs = findSwingHighs(highs, swingLookback, getRsi);

    // ── Check for bullish divergence (last two swing lows) ──
    const bullDiv = checkBullishDivergence(swingLows);

    // ── Check for bearish divergence (last two swing highs) ──
    const bearDiv = checkBearishDivergence(swingHighs);

    // ── Score ──
    if (bullDiv) {
      const strength = computeDivergenceStrength(bullDiv, STRENGTH_MODEL);
      const score = 60 + strength * 40;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.92, 0.55 + strength * 0.3),
        reason: `Bullish RSI divergence: price made lower low (${bullDiv.price1.toFixed(2)} → ${bullDiv.price2.toFixed(2)}) but RSI made higher low (${bullDiv.ind1.toFixed(1)} → ${bullDiv.ind2.toFixed(1)}). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    }

    if (bearDiv) {
      const strength = computeDivergenceStrength(bearDiv, STRENGTH_MODEL);
      const score = 15 - strength * 12; // Low score = bearish for long-biased
      return {
        score: Math.round(Math.max(score, 0)),
        confidence: Math.min(0.92, 0.55 + strength * 0.3),
        reason: `Bearish RSI divergence: price made higher high (${bearDiv.price1.toFixed(2)} → ${bearDiv.price2.toFixed(2)}) but RSI made lower high (${bearDiv.ind1.toFixed(1)} → ${bearDiv.ind2.toFixed(1)}). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bearish',
      };
    }

    // No divergence — light neutral score based on RSI position
    const lastRsi = rsiValues[rsiValues.length - 1];
    const neutralScore = lastRsi < 40 ? 35 : lastRsi > 60 ? 15 : 25;
    return {
      score: neutralScore,
      confidence: 0.3,
      reason: `No RSI divergence detected. RSI(14)=${lastRsi.toFixed(1)}.`,
      signalClass: 'neutral',
    };
  }

  private insufficient(bars: number): DirectiveResult {
    return {
      score: 0,
      confidence: 0.1,
      reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars}.`,
      signalClass: 'neutral',
    };
  }
}

// The block that used to sit here called itself "Shared Divergence Utilities" and
// claimed it had been "extracted for reuse by MACD/OBV divergence directives". Nobody
// imported it — this file was the one place it existed, and both other directives
// carried their own private copies. The algorithm now lives in exactly one place:
// ../utils/divergence, imported above.
