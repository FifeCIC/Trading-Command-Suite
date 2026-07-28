/**
 * OBV Divergence Scanner
 * ======================
 * Detects bullish divergence (price lower low, OBV higher low) and
 * bearish divergence (price higher high, OBV lower high).
 *
 * OBV (On-Balance Volume) divergence is considered the strongest
 * divergence signal because it incorporates volume — "smart money"
 * accumulation/distribution that contradicts price action.
 *
 * OBV divergence is rare but high-conviction when it appears.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { obv } from '../utils/indicators';

const SWING_LOOKBACK = 5;
const MIN_BARS = SWING_LOOKBACK * 3 + 5;

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
export class ObvDivergenceDirective implements IDirective {
  readonly id = 'obv-divergence';
  readonly name = 'OBV Divergence Scanner';
  readonly description =
    'Detects bullish/bearish OBV (On-Balance Volume) divergence — price extremes not confirmed by volume flow. Strongest divergence signal — indicates smart money accumulation/distribution.';
  readonly priority = 86;
  readonly maxScore = 120;
  readonly minBars = { '1d': 20 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map((b) => b.close);
    const lows = input.bars.map((b) => b.low);
    const highs = input.bars.map((b) => b.high);
    const volumes = input.bars.map((b) => b.volume);

    if (closes.length < MIN_BARS) {
      return {
        score: 0, confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.`,
        signalClass: 'neutral',
      };
    }

    const obvValues = obv(closes, volumes);
    if (obvValues.length < SWING_LOOKBACK * 2 + 2) {
      return {
        score: 0, confidence: 0.1,
        reason: 'Not enough OBV values.',
        signalClass: 'neutral',
      };
    }

    const getObv = (barIdx: number): number => {
      if (barIdx < 0 || barIdx >= obvValues.length) return obvValues[obvValues.length - 1];
      return obvValues[barIdx];
    };

    const swingLows = findSwingLows(lows, SWING_LOOKBACK, getObv);
    const swingHighs = findSwingHighs(highs, SWING_LOOKBACK, getObv);

    const bullDiv = checkBullishDivergence(swingLows);
    const bearDiv = checkBearishDivergence(swingHighs);

    if (bullDiv) {
      const strength = computeDivergenceStrength(bullDiv);
      const score = 70 + strength * 40;
      return {
        score: Math.round(Math.min(score, this.maxScore)),
        confidence: Math.min(0.96, 0.65 + strength * 0.25),
        reason: `Bullish OBV divergence — SMART MONEY: price lower low (${bullDiv.price1.toFixed(2)}→${bullDiv.price2.toFixed(2)}) but OBV higher low (accumulation). Strength: ${(strength*100).toFixed(0)}%.`,
        signalClass: 'bullish',
      };
    }

    if (bearDiv) {
      const strength = computeDivergenceStrength(bearDiv);
      const score = 10 - strength * 8;
      return {
        score: Math.round(Math.max(score, 0)),
        confidence: Math.min(0.96, 0.65 + strength * 0.25),
        reason: `Bearish OBV divergence — DISTRIBUTION: price higher high (${bearDiv.price1.toFixed(2)}→${bearDiv.price2.toFixed(2)}) but OBV lower high (selling into strength). Strength: ${(strength*100).toFixed(0)}%.`,
        signalClass: 'bearish',
      };
    }

    return {
      score: 25,
      confidence: 0.25,
      reason: 'No OBV divergence detected.',
      signalClass: 'neutral',
    };
  }
}

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
  const indMove = Math.abs(div.ind2 - div.ind1) / Math.max(Math.abs(div.ind1), 1);
  return Math.min(1.0, priceMove * 2.5 + indMove * 2.0);
}
