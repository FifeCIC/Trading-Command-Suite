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
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const SWING_LOOKBACK = 5; // Bars to confirm a swing point
const MIN_BARS = RSI_PERIOD + SWING_LOOKBACK * 3 + 2;

interface SwingPoint {
  index: number;
  price: number;
  indicatorValue: number;
}

@Injectable()
export class RsiDivergenceDirective implements IDirective {
  readonly id = 'rsi-divergence';
  readonly name = 'RSI Divergence Scanner';
  readonly description =
    'Detects bullish/bearish RSI divergence — price making new extremes while RSI fails to confirm. Strong reversal signal.';
  readonly priority = 82;
  readonly maxScore = 110;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    const lows = input.bars.map((b) => b.low);
    const highs = input.bars.map((b) => b.high);

    if (closes.length < MIN_BARS) {
      return this.insufficient(closes.length);
    }

    const rsiValues = rsi(closes, RSI_PERIOD);
    if (rsiValues.length < SWING_LOOKBACK * 2 + 2) {
      return this.insufficient(closes.length);
    }

    // Align RSI with price bars (RSI starts at index RSI_PERIOD)
    const rsiOffset = closes.length - rsiValues.length;
    const getRsi = (barIdx: number): number => {
      const rsiIdx = barIdx - rsiOffset;
      if (rsiIdx < 0 || rsiIdx >= rsiValues.length) return 50;
      return rsiValues[rsiIdx];
    };

    // ── Find swing lows (price) ──
    const swingLows = findSwingLows(lows, SWING_LOOKBACK, getRsi);
    // ── Find swing highs (price) ──
    const swingHighs = findSwingHighs(highs, SWING_LOOKBACK, getRsi);

    // ── Check for bullish divergence (last two swing lows) ──
    const bullDiv = checkBullishDivergence(swingLows);

    // ── Check for bearish divergence (last two swing highs) ──
    const bearDiv = checkBearishDivergence(swingHighs);

    // ── Score ──
    if (bullDiv) {
      const strength = computeDivergenceStrength(bullDiv);
      const score = 60 + strength * 40;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.92, 0.55 + strength * 0.3),
        reason: `Bullish RSI divergence: price made lower low (${bullDiv.price1.toFixed(2)} → ${bullDiv.price2.toFixed(2)}) but RSI made higher low (${bullDiv.ind1.toFixed(1)} → ${bullDiv.ind2.toFixed(1)}). Strength: ${(strength * 100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    }

    if (bearDiv) {
      const strength = computeDivergenceStrength(bearDiv);
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

// ── Shared Divergence Utilities ──
// (Extracted for reuse by MACD/OBV divergence directives)

interface DivergencePair {
  price1: number;
  price2: number;
  ind1: number;
  ind2: number;
  /** Bar index of price2 (most recent swing) */
  index: number;
}

function findSwingLows(
  lows: number[],
  lookback: number,
  getIndicator: (idx: number) => number,
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    const current = lows[i];
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (lows[j] < current) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) {
      swings.push({ index: i, price: current, indicatorValue: getIndicator(i) });
    }
  }
  return swings;
}

function findSwingHighs(
  highs: number[],
  lookback: number,
  getIndicator: (idx: number) => number,
): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    const current = highs[i];
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] > current) {
        isSwing = false;
        break;
      }
    }
    if (isSwing) {
      swings.push({ index: i, price: current, indicatorValue: getIndicator(i) });
    }
  }
  return swings;
}

function checkBullishDivergence(swingLows: SwingPoint[]): DivergencePair | null {
  if (swingLows.length < 2) return null;
  // Compare last two swing lows
  const prev = swingLows[swingLows.length - 2];
  const last = swingLows[swingLows.length - 1];
  // Bullish: price makes LOWER low but indicator makes HIGHER low
  if (last.price < prev.price && last.indicatorValue > prev.indicatorValue) {
    return {
      price1: prev.price,
      price2: last.price,
      ind1: prev.indicatorValue,
      ind2: last.indicatorValue,
      index: last.index,
    };
  }
  return null;
}

function checkBearishDivergence(swingHighs: SwingPoint[]): DivergencePair | null {
  if (swingHighs.length < 2) return null;
  const prev = swingHighs[swingHighs.length - 2];
  const last = swingHighs[swingHighs.length - 1];
  // Bearish: price makes HIGHER high but indicator makes LOWER high
  if (last.price > prev.price && last.indicatorValue < prev.indicatorValue) {
    return {
      price1: prev.price,
      price2: last.price,
      ind1: prev.indicatorValue,
      ind2: last.indicatorValue,
      index: last.index,
    };
  }
  return null;
}

function computeDivergenceStrength(div: DivergencePair): number {
  // Price movement magnitude (normalized)
  const priceMove = Math.abs(div.price2 - div.price1) / Math.max(Math.abs(div.price1), 0.01);
  // Indicator divergence magnitude
  const indMove = Math.abs(div.ind2 - div.ind1) / 100;
  // Combined strength capped at 1.0
  return Math.min(1.0, priceMove * 3 + indMove * 2);
}
