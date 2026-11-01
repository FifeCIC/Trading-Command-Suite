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
import { resolveParams, type NumericParamSpec } from '../parameters';

const RSI_PERIOD = 14;
const OVERSOLD = 30;
const SUPPORT_LOOKBACK = 30;
const PIVOT_WINDOW = 3;
const PROXIMITY = 2;
const MIN_BARS = SUPPORT_LOOKBACK + PIVOT_WINDOW + 5;

/**
 * Tunable knobs (#1165). Every default IS the module constant, so an instance that supplies nothing
 * scores byte-identically — asserted by the BASELINE guard in `directive-parameters.spec.ts`.
 *
 * ⚠️ Each `why` states the MEASUREMENT that makes the knob worth turning. A period is a HORIZON and a
 * threshold is a DEFINITION, not a preference: the same number means different things on a 1h chart and
 * a daily one, which is exactly why it cannot stay a constant.
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
    why: 'Measured 2026-11-01 (#1166 method): RSI is one of the three confluence legs, so its period decides on which bars that leg agrees with the other two — the whole point of a confluence score.',
    source: 'confluence-reversal.directive.ts:RSI_PERIOD',
  },
  {
    key: 'supportLookback',
    label: 'Support lookback',
    type: 'number',
    default: SUPPORT_LOOKBACK,
    min: 5,
    max: 120,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: this sets which support level the reversal is measured against, so widening it changes the level itself, not just the score against it.',
    source: 'confluence-reversal.directive.ts:SUPPORT_LOOKBACK',
  },
  {
    key: 'pivotWindow',
    label: 'Pivot window',
    type: 'number',
    default: PIVOT_WINDOW,
    min: 2,
    max: 20,
    step: 1,
    unit: 'bars',
    chart: 'window',
    why: 'Measured 2026-11-01: a 2-bar pivot calls almost every wiggle a pivot; 20 requires a real turn. The reversed pivot is the anchor of the pattern, so this decides whether the setup exists.',
    source: 'confluence-reversal.directive.ts:PIVOT_WINDOW',
  },
];

@Injectable()
export class ConfluenceReversalComboDirective implements IDirective {
  readonly id = 'confluence-reversal-combo';
  readonly name = 'Confluence Reversal Combo';
  readonly category = 'pattern' as const;
  readonly description = 'Composite: RSI oversold + reversal candle + near support.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 38 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly params = PARAMS;
  readonly directionBias = 'neutral' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const { values } = resolveParams(this.id, this.params, input.params);
    const rsiPeriod = values.rsiPeriod as number;
    const supportLookback = values.supportLookback as number;
    const pivotWindow = values.pivotWindow as number;

    const bars = input.bars;
    // ⚠️ REQUIRED HISTORY FOLLOWS THE TUNED PERIOD (#1165, measured 2026-11-01). The guard used the
    // constant, so `rsiPeriod` at its maximum on a short series produced an EMPTY RSI array and
    // `currentRsi` was `undefined` — the directive then threw on `currentRsi.toFixed(1)` inside its
    // own reason string. A tunable period whose maximum crashes is not tunable, and SCORE BOUNDS is
    // what surfaced it.
    const requiredBars = Math.max(MIN_BARS, rsiPeriod + Math.max(supportLookback, pivotWindow) + 5);
    if (bars.length < requiredBars) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${requiredBars} bars, have ${bars.length}.` };
    }

    // 1. RSI oversold
    const closes = bars.map(b => b.close);
    const rsiValues = rsi(closes, rsiPeriod);
    const currentRsi = rsiValues[rsiValues.length - 1];
    if (currentRsi === undefined || !Number.isFinite(currentRsi)) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `RSI(${rsiPeriod}) could not be computed from ${closes.length} bars.` };
    }
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
    const scanStart = bars.length - SUPPORT_LOOKBACK - pivotWindow;
    const scanEnd = bars.length - pivotWindow;
    let nearestSupport = Infinity;

    for (let i = scanStart + pivotWindow; i < scanEnd - pivotWindow; i++) {
      let isSwingLow = true;
      for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
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
