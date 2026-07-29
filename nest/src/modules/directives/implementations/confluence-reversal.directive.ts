/**
 * Confluence Reversal Combo Directive
 * ===================================
 * Composite: RSI oversold + reversal candle + near support.
 * Only fires when at least 2 of 3 signals are present.
 *
 * TradePress source: includes/scoring-system/directives/confluence-reversal-combo.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { rsi } from '../utils/indicators';

const RSI_PERIOD = 14;
const OVERSOLD = 30;
const SUPPORT_LOOKBACK = 30;
const PIVOT_WINDOW = 3;
const PROXIMITY = 2;
const MIN_BARS = SUPPORT_LOOKBACK + PIVOT_WINDOW + 5;

@Injectable()
export class ConfluenceReversalComboDirective implements IDirective {
  readonly id = 'confluence-reversal-combo';
  readonly name = 'Confluence Reversal Combo';
  readonly description = 'Composite: RSI oversold + reversal candle + near support.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 38 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.` };
    }

    // 1. RSI oversold
    const closes = bars.map(b => b.close);
    const rsiValues = rsi(closes, RSI_PERIOD);
    const currentRsi = rsiValues[rsiValues.length - 1];
    const rsiOversold = currentRsi < OVERSOLD;

    // 2. Reversal candle in last 3 bars
    let reversalCandle = false;
    let reversalReason = '';
    for (let i = bars.length - 3; i < bars.length; i++) {
      const b = bars[i];
      const body = Math.abs(b.close - b.open);
      const lowerWick = Math.min(b.open, b.close) - b.low;
      const upperWick = b.high - Math.max(b.open, b.close);
      const range = b.high - b.low;

      // Hammer: small body, long lower wick
      if (range > 0 && body > 0 && body < range * 0.3 && lowerWick > body * 1.5 && upperWick < body * 0.5) {
        reversalCandle = true;
        reversalReason = 'hammer';
        break;
      }
      // Doji: very small body
      if (range > 0 && body < range * 0.08) {
        reversalCandle = true;
        reversalReason = 'doji';
        break;
      }
    }

    // 3. Near support
    const scanStart = bars.length - SUPPORT_LOOKBACK - PIVOT_WINDOW;
    const scanEnd = bars.length - PIVOT_WINDOW;
    let nearestSupport = Infinity;

    for (let i = scanStart + PIVOT_WINDOW; i < scanEnd - PIVOT_WINDOW; i++) {
      let isSwingLow = true;
      for (let j = i - PIVOT_WINDOW; j <= i + PIVOT_WINDOW; j++) {
        if (j === i) continue;
        if (bars[j].low <= bars[i].low) { isSwingLow = false; break; }
      }
      if (isSwingLow) {
        const dist = bars[bars.length - 1].close - bars[i].low;
        if (dist > 0 && dist < nearestSupport) nearestSupport = bars[i].low;
      }
    }

    const currentPrice = bars[bars.length - 1].close;
    const nearSupport = nearestSupport < Infinity && ((currentPrice - nearestSupport) / currentPrice) * 100 <= PROXIMITY;

    const signals = [rsiOversold, reversalCandle, nearSupport];
    const signalCount = signals.filter(Boolean).length;

    if (signalCount < 2) {
      return {
        signalClass: 'neutral',
        score: 20,
        confidence: 0.25,
        reason: `Only ${signalCount}/3 reversal signals. RSI: ${rsiOversold ? '✓('+currentRsi.toFixed(1)+')' : '✗('+currentRsi.toFixed(1)+')'}, Candle: ${reversalCandle ? '✓('+reversalReason+')' : '✗'}, Support: ${nearSupport ? '✓' : '✗'}.`,
      };
    }

    let score = 20;
    const parts: string[] = [];

    if (rsiOversold) {
      const depth = (OVERSOLD - currentRsi) / OVERSOLD;
      score += Math.round(20 + depth * 15);
      parts.push(`RSI ${currentRsi.toFixed(1)}`);
    }
    if (reversalCandle) {
      score += 20;
      parts.push(`${reversalReason} candle`);
    }
    if (nearSupport) {
      const dist = ((currentPrice - nearestSupport) / currentPrice) * 100;
      score += Math.round(15 + (PROXIMITY - dist) * 5);
      parts.push(`support at ${nearestSupport.toFixed(2)}`);
    }

    const bonus = signalCount === 3 ? 15 : 0; // Full confluence bonus

    return {
      signalClass: 'bullish',
      score: Math.min(this.maxScore, score + bonus),
      confidence: 0.5 + signalCount * 0.15,
      reason: `${signalCount}/3 reversal signals: ${parts.join(' + ')}.${bonus > 0 ? ' Full confluence!' : ''}`,
    };
  }
}
