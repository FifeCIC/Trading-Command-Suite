/**
 * Volatility Envelope
 * ====================
 * Computes historical range distributions and projects percentile bands.
 * Answers: "Is this bar's range normal, unusual, or extreme?"
 *
 * Bands:
 *   50th percentile — median range (typical)
 *   85th percentile — unusual (attention suggested)
 *   95th percentile — extreme (likely event-driven)
 *   99th percentile — anomaly (news, whale, or error)
 *
 * Output includes expectedHigh/expectedLow based on current close ± percentile range.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const LOOKBACK = 50;
const MIN_BARS = 20;

interface EnvelopeResult extends DirectiveResult {
  currentPercentile: number;
  expectedHigh: number;
  expectedLow: number;
  isAnomalous: boolean;
  percentileBands: { p50: number; p85: number; p95: number; p99: number };
}

@Injectable()
export class VolatilityEnvelopeDirective implements IDirective {
  readonly id = 'volatility-envelope';
  readonly name = 'Volatility Envelope';
  readonly description =
    'Percentile-based range bands. Shows whether current volatility is normal, unusual, or extreme.';
  readonly priority = 55;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;

    if (bars.length < MIN_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      } as DirectiveResult;
    }

    const recent = bars.slice(-Math.min(LOOKBACK, bars.length));
    const ranges = recent.map((b) => (b.high - b.low) / b.close); // Normalize as % of price

    const currentBar = bars[bars.length - 1];
    const currentRange = (currentBar.high - currentBar.low) / currentBar.close;

    // Sort ranges to compute percentiles
    const sorted = [...ranges].sort((a, b) => a - b);
    const percentile = (arr: number[], p: number) => {
      const idx = Math.ceil((p / 100) * arr.length) - 1;
      return arr[Math.max(0, Math.min(arr.length - 1, idx))];
    };

    const p50 = percentile(sorted, 50);
    const p85 = percentile(sorted, 85);
    const p95 = percentile(sorted, 95);
    const p99 = percentile(sorted, 99);

    // Where does current range sit?
    let currentPercentile = 50;
    const n = sorted.length;
    for (let i = 0; i < n; i++) {
      if (currentRange <= sorted[i]) {
        currentPercentile = Math.round((i / n) * 100);
        break;
      }
      if (i === n - 1) currentPercentile = 100;
    }

    const isAnomalous = currentPercentile >= 95;
    const currentPrice = currentBar.close;

    // Expected high/low based on 85th percentile range
    const expectedHigh = currentPrice * (1 + p85);
    const expectedLow = currentPrice * (1 - p85);

    let score: number;
    let reason: string;

    if (isAnomalous) {
      score = 70 + Math.min(30, (currentPercentile - 95) * 5);
      reason = `Extreme volatility: current range in ${currentPercentile}th percentile (p95=${(p95 * 100).toFixed(2)}%). Event likely in progress.`;
    } else if (currentPercentile >= 85) {
      score = 45 + ((currentPercentile - 85) / 10) * 20;
      reason = `Unusual volatility: current range in ${currentPercentile}th percentile (p85=${(p85 * 100).toFixed(2)}%). Attention suggested.`;
    } else if (currentPercentile >= 50) {
      score = 20;
      reason = `Normal range: ${currentPercentile}th percentile (median=${(p50 * 100).toFixed(2)}%). Typical conditions.`;
    } else {
      score = 25;
      reason = `Low volatility: ${currentPercentile}th percentile. Market unusually quiet — potential coiled spring.`;
    }

    const result: any = {
      score: Math.min(100, Math.round(score)),
      confidence: isAnomalous ? 0.85 : currentPercentile >= 85 ? 0.7 : 0.5,
      reason,
      signalClass: 'neutral',
      currentPercentile,
      expectedHigh: Number(expectedHigh.toFixed(5)),
      expectedLow: Number(expectedLow.toFixed(5)),
      isAnomalous,
      percentileBands: {
        p50: Number(p50.toFixed(6)),
        p85: Number(p85.toFixed(6)),
        p95: Number(p95.toFixed(6)),
        p99: Number(p99.toFixed(6)),
      },
    };

    return result;
  }
}
