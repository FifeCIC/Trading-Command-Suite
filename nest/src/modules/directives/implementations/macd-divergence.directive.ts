/**
 * MACD Divergence Scanner
 * ========================
 * Detects bullish divergence (price lower low, MACD histogram higher low)
 * and bearish divergence (price higher high, MACD histogram lower high).
 *
 * Uses the shared divergence utilities from rsi-divergence.directive.ts
 * but applies them to MACD histogram values instead of RSI.
 *
 * MACD divergence is considered stronger than RSI divergence because
 * MACD incorporates both trend and momentum.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { macd } from '../utils/indicators';

const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const SWING_LOOKBACK = 5;
const MIN_BARS = MACD_SLOW + MACD_SIGNAL + SWING_LOOKBACK * 3 + 2;

interface SwingPoint {
  index: number;
  price: number;
  indicatorValue: number;
}

interface DivergencePair {
  price1: number;
  price2: number;
  ind1: number;
  ind2: number;
  index: number;
}

@Injectable()
export class MacdDivergenceDirective implements IDirective {
  readonly id = 'macd-divergence';
  readonly name = 'MACD Divergence Scanner';
  readonly category = 'oscillator' as const;
  readonly description =
    'Detects bullish/bearish MACD histogram divergence — price making new extremes while MACD momentum fails to confirm. Stronger than RSI divergence.';
  readonly priority = 84;
  readonly maxScore = 105;
  readonly minScore = 1;
  readonly minBars = { '1d': 52 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    const lows = input.bars.map((b) => b.low);
    const highs = input.bars.map((b) => b.high);

    if (closes.length < MIN_BARS) {
      return {
        score: 0, confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const macdResult = macd(closes, MACD_FAST, MACD_SLOW, MACD_SIGNAL);
    if (macdResult.histogram.length < SWING_LOOKBACK * 2 + 2) {
      return {
        score: 0, confidence: 0.1,
        reason: 'Not enough MACD histogram values.',
        signalClass: 'neutral',
      };
    }

    // Align histogram with price bars
    const histOffset = closes.length - macdResult.histogram.length;
    const getHist = (barIdx: number): number => {
      const hIdx = barIdx - histOffset;
      if (hIdx < 0 || hIdx >= macdResult.histogram.length) return 0;
      return macdResult.histogram[hIdx];
    };

    const swingLows = findSwingLows(lows, SWING_LOOKBACK, getHist);
    const swingHighs = findSwingHighs(highs, SWING_LOOKBACK, getHist);

    const bullDiv = checkBullishDivergence(swingLows);
    const bearDiv = checkBearishDivergence(swingHighs);

    if (bullDiv) {
      const strength = computeDivergenceStrength(bullDiv);
      const score = 65 + strength * 40;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.94, 0.6 + strength * 0.28),
        reason: `Bullish MACD divergence: price lower low (${bullDiv.price1.toFixed(2)}→${bullDiv.price2.toFixed(2)}) but MACD histogram higher low (${bullDiv.ind1.toFixed(4)}→${bullDiv.ind2.toFixed(4)}). Strength: ${(strength*100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    }

    if (bearDiv) {
      const strength = computeDivergenceStrength(bearDiv);
      const score = 12 - strength * 10;
      return {
        score: Math.round(Math.max(score, 0)),
        confidence: Math.min(0.94, 0.6 + strength * 0.28),
        reason: `Bearish MACD divergence: price higher high (${bearDiv.price1.toFixed(2)}→${bearDiv.price2.toFixed(2)}) but MACD histogram lower high (${bearDiv.ind1.toFixed(4)}→${bearDiv.ind2.toFixed(4)}). Strength: ${(strength*100).toFixed(0)}%.`,
        signalClass: 'bearish',
      };
    }

    const lastHist = macdResult.histogram[macdResult.histogram.length - 1];
    return {
      score: lastHist > 0 ? 30 : 20,
      confidence: 0.3,
      reason: `No MACD divergence. Histogram: ${lastHist.toFixed(4)}.`,
      signalClass: 'neutral',
    };
  }
}

// ── Local copies of shared utilities (avoid cross-file imports) ──

function findSwingLows(lows: number[], lookback: number, getInd: (i: number) => number): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < lows.length - lookback; i++) {
    const cur = lows[i];
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (lows[j] < cur) { isSwing = false; break; }
    }
    if (isSwing) swings.push({ index: i, price: cur, indicatorValue: getInd(i) });
  }
  return swings;
}

function findSwingHighs(highs: number[], lookback: number, getInd: (i: number) => number): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < highs.length - lookback; i++) {
    const cur = highs[i];
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] > cur) { isSwing = false; break; }
    }
    if (isSwing) swings.push({ index: i, price: cur, indicatorValue: getInd(i) });
  }
  return swings;
}

function checkBullishDivergence(swingLows: SwingPoint[]): DivergencePair | null {
  if (swingLows.length < 2) return null;
  const prev = swingLows[swingLows.length - 2];
  const last = swingLows[swingLows.length - 1];
  if (last.price < prev.price && last.indicatorValue > prev.indicatorValue) {
    return { price1: prev.price, price2: last.price, ind1: prev.indicatorValue, ind2: last.indicatorValue, index: last.index };
  }
  return null;
}

function checkBearishDivergence(swingHighs: SwingPoint[]): DivergencePair | null {
  if (swingHighs.length < 2) return null;
  const prev = swingHighs[swingHighs.length - 2];
  const last = swingHighs[swingHighs.length - 1];
  if (last.price > prev.price && last.indicatorValue < prev.indicatorValue) {
    return { price1: prev.price, price2: last.price, ind1: prev.indicatorValue, ind2: last.indicatorValue, index: last.index };
  }
  return null;
}

function computeDivergenceStrength(div: DivergencePair): number {
  const priceMove = Math.abs(div.price2 - div.price1) / Math.max(Math.abs(div.price1), 0.01);
  const indMove = Math.abs(div.ind2 - div.ind1) / Math.max(Math.abs(div.ind1), 0.0001);
  return Math.min(1.0, priceMove * 3 + indMove * 1.5);
}
