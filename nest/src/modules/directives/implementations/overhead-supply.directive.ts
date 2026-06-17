/**
 * Overhead Supply Pressure Directive
 * ==================================
 * Quantifies trapped overhead supply from a recent top.
 * Rewards reclaim/hold progress through supply zones.
 *
 * High pressure when:
 * - Price is below a recent swing high (trapped sellers)
 * - Volume declining as price approaches resistance (weak buying)
 *
 * Scores lower when overhead supply is significant.
 *
 * TradePress source: includes/scoring-system/directives/overhead-supply-pressure.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';
import { sma } from '../utils/indicators';

const LOOKBACK = 50;
const PIVOT_WINDOW = 3;
const SUPPLY_PROXIMITY = 3; // Within 3% of overhead = supply pressure zone
const MIN_BARS = LOOKBACK + PIVOT_WINDOW + 3;

@Injectable()
export class OverheadSupplyPressureDirective implements IDirective {
  readonly id = 'overhead-supply-pressure';
  readonly name = 'Overhead Supply Pressure';
  readonly description = 'Quantifies trapped overhead supply from recent top. Rewards reclaim progress.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS) {
      return { signalClass: 'neutral', score: 0, confidence: 0.1, reason: `Insufficient data: need ${MIN_BARS} bars, have ${bars.length}.` };
    }

    // Find the highest high in the lookback (supply ceiling)
    const lookbackBars = bars.slice(-LOOKBACK);
    const highestHigh = Math.max(...lookbackBars.map(b => b.high));
    const highestBar = lookbackBars.find(b => b.high === highestHigh);
    const currentPrice = bars[bars.length - 1].close;

    const distanceFromHigh = ((highestHigh - currentPrice) / currentPrice) * 100;

    // Volume trend: declining volume = weak buying pressure
    const volumes = bars.map(b => b.volume);
    const recentVolAvg = sma(volumes.slice(-5), 5);
    const priorVolAvg = sma(volumes.slice(-15, -5), 10);
    const volumeDeclining = priorVolAvg > 0 && recentVolAvg < priorVolAvg * 0.9;

    // Price reclaim progress: how much of the drop from the high has been recovered
    const lowAfterHigh = Math.min(...lookbackBars.filter(b => b.timestamp >= (highestBar?.timestamp ?? 0)).map(b => b.low));
    const dropMagnitude = highestHigh - lowAfterHigh;
    const reclaimProgress = dropMagnitude > 0 ? (currentPrice - lowAfterHigh) / dropMagnitude : 1;

    if (distanceFromHigh <= SUPPLY_PROXIMITY) {
      // Near the supply ceiling
      if (volumeDeclining) {
        return {
          signalClass: 'bearish',
          score: 15,
          confidence: 0.5,
          reason: `Strong overhead supply: price ${distanceFromHigh.toFixed(1)}% below high ${highestHigh.toFixed(2)} with declining volume. Weak buying at resistance.`,
        };
      }
      return {
        signalClass: 'bearish',
        score: 25,
        confidence: 0.4,
        reason: `Overhead supply present: price ${distanceFromHigh.toFixed(1)}% below recent high ${highestHigh.toFixed(2)}. Testing resistance zone.`,
      };
    }

    if (reclaimProgress > 0.7) {
      // Most of the drop has been recovered — supply absorbed
      const score = Math.round(55 + reclaimProgress * 25);
      return {
        signalClass: 'bullish',
        score,
        confidence: 0.45 + reclaimProgress * 0.15,
        reason: `Supply absorbing: ${(reclaimProgress * 100).toFixed(0)}% of drop from ${highestHigh.toFixed(2)} reclaimed. Overhead supply clearing.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 35,
      confidence: 0.3,
      reason: `Supply zone: ${distanceFromHigh.toFixed(1)}% below high ${highestHigh.toFixed(2)}. ${(reclaimProgress * 100).toFixed(0)}% reclaimed. Moderate overhead risk.`,
    };
  }
}
