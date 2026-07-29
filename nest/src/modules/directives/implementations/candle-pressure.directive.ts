/**
 * Candle Pressure Index (CPI)
 * ============================
 * Close Location Value (CLV) based buy/sell pressure visualization.
 *
 * CPI = (Close - Low) / (High - Low)   for each bar
 * Bullish pressure: CPI > 0.6 (close near high of bar)
 * Bearish pressure: CPI < 0.4 (close near low of bar)
 *
 * Non-repainting, transition-based alerts.
 * Aggregates pressure over multiple bars for signal quality.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 10;
const PRESSURE_LOOKBACK = 12;

@Injectable()
export class CandlePressureDirective implements IDirective {
  readonly id = 'candle-pressure';
  readonly name = 'Candle Pressure Index';
  readonly description =
    'CLV-based buy/sell pressure. CPI > 0.6 = bullish pressure, < 0.4 = bearish.';
  readonly priority = 52;
  readonly maxScore = 100;
  readonly minBars = { '1d': 10 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const recentBars = bars.slice(-PRESSURE_LOOKBACK);

    // Calculate CPI for each bar
    const cpiValues: number[] = [];
    for (const bar of recentBars) {
      const range = bar.high - bar.low;
      if (range > 0) {
        cpiValues.push((bar.close - bar.low) / range);
      } else {
        cpiValues.push(0.5); // Neutral for doji
      }
    }

    // Pressure metrics
    const avgCpi = cpiValues.reduce((a, b) => a + b, 0) / cpiValues.length;
    const bullishCount = cpiValues.filter((c) => c > 0.6).length;
    const bearishCount = cpiValues.filter((c) => c < 0.4).length;
    const neutralCount = cpiValues.length - bullishCount - bearishCount;

    // Pressure trend: compare first half vs second half
    const half = Math.floor(cpiValues.length / 2);
    const firstHalf = cpiValues.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondHalf = cpiValues.slice(half).reduce((a, b) => a + b, 0) / (cpiValues.length - half);
    const pressureDelta = secondHalf - firstHalf;

    // Determine signal
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    const pressureRatio = bullishCount / Math.max(1, bearishCount);

    if (bullishCount >= 8 && pressureRatio > 3) {
      // Strong bullish pressure
      score = 60 + Math.min(40, bullishCount * 4);
      signalClass = 'bullish';
      reason = `Strong bullish pressure: ${bullishCount}/${cpiValues.length} bars with high CPI. Avg CPI: ${avgCpi.toFixed(2)}.`;
    } else if (bearishCount >= 8 && pressureRatio < 0.33) {
      // Strong bearish pressure
      score = 60 + Math.min(40, bearishCount * 4);
      signalClass = 'bearish';
      reason = `Strong bearish pressure: ${bearishCount}/${cpiValues.length} bars with low CPI. Avg CPI: ${avgCpi.toFixed(2)}.`;
    } else if (pressureDelta > 0.15) {
      // Pressure building bullish
      score = 40 + pressureDelta * 100;
      signalClass = 'bullish';
      reason = `Pressure building bullish (CPI ${firstHalf.toFixed(2)} → ${secondHalf.toFixed(2)}).`;
    } else if (pressureDelta < -0.15) {
      // Pressure building bearish
      score = 40 + Math.abs(pressureDelta) * 100;
      signalClass = 'bearish';
      reason = `Pressure building bearish (CPI ${firstHalf.toFixed(2)} → ${secondHalf.toFixed(2)}).`;
    } else {
      score = 25;
      signalClass = 'neutral';
      reason = `Neutral pressure. ${bullishCount}B / ${neutralCount}N / ${bearishCount}S. Avg CPI: ${avgCpi.toFixed(2)}.`;
    }

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.8, 0.3 + Math.abs(avgCpi - 0.5) * 1.2).toFixed(2)),
      reason,
      signalClass,
    };
  }
}



