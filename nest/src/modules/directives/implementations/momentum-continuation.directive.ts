/**
 * Momentum Continuation Combo Directive
 * =====================================
 * Composite directive combining trend, momentum, and volume confirmation.
 *
 * 35 pts — Trend: price above EMA(20)
 * 35 pts — Momentum: MACD histogram positive + rising
 * 30 pts — Volume: recent volume > 20-period average
 *
 * Only fires when at least 2 of 3 conditions are met.
 *
 * TradePress source: includes/scoring-system/directives/momentum-continuation-combo.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { ema, macd, sma } from '../utils/indicators';

const TREND_PERIOD = 20;
const MIN_BARS = 40;

@Injectable()
export class MomentumContinuationComboDirective implements IDirective {
  readonly id = 'momentum-continuation-combo';
  readonly name = 'Momentum Continuation Combo';
  readonly description = 'Composite: trend alignment (EMA20) + momentum (MACD histogram) + volume confirmation.';
  readonly priority = 50;

  calculate(input: DirectiveInput): DirectiveResult {
    const closes = input.bars.map(b => b.close);
    const volumes = input.bars.map(b => b.volume);

    if (closes.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${closes.length}.` };
    }

    // 1. Trend alignment
    const ema20 = ema(closes, TREND_PERIOD);
    const currentPrice = closes[closes.length - 1];
    const trendEma = ema20[ema20.length - 1];
    const trendAligned = currentPrice > trendEma;
    const trendDist = trendEma > 0 ? ((currentPrice - trendEma) / trendEma) * 100 : 0;

    // 2. Momentum (MACD histogram)
    const { histogram } = macd(closes);
    const histNow = histogram[histogram.length - 1];
    const histPrev = histogram[histogram.length - 2];
    const momentumPositive = histNow > 0;
    const momentumRising = histNow > histPrev;
    const momentumAligned = momentumPositive && momentumRising;

    // 3. Volume confirmation
    const recentVol = volumes[volumes.length - 1];
    const avgVol = sma(volumes.slice(0, -1), TREND_PERIOD);
    const volumeAligned = avgVol > 0 && recentVol > avgVol;

    const conditionsMet = [trendAligned, momentumAligned, volumeAligned].filter(Boolean).length;

    if (conditionsMet < 2) {
      return {
        signalClass: 'neutral',
        score: 20,
        confidence: 0.25,
        reason: `Only ${conditionsMet}/3 continuation signals aligned. Trend: ${trendAligned ? '✓' : '✗'}, Momentum: ${momentumAligned ? '✓' : '✗'}, Volume: ${volumeAligned ? '✓' : '✗'}.`,
      };
    }

    let score = 25; // base
    const details: string[] = [];

    if (trendAligned) {
      const strength = Math.min(1, trendDist / 5);
      score += 20 + strength * 15;
      details.push(`trend aligned (+${trendDist.toFixed(1)}%)`);
    }
    if (momentumAligned) {
      score += 20 + Math.min(15, histNow * 500);
      details.push('momentum rising');
    }
    if (volumeAligned) {
      const volRatio = recentVol / avgVol;
      score += Math.min(30, volRatio * 15);
      details.push(`volume ${volRatio.toFixed(1)}x avg`);
    }

    return {
      signalClass: 'bullish',
      score: Math.min(100, Math.round(score)),
      confidence: 0.4 + conditionsMet * 0.15,
      reason: `${conditionsMet}/3 continuation signals: ${details.join(', ')}.`,
    };
  }
}
