/**
 * Fair Value Gap (FVG)
 * =====================
 * 3-candlestick imbalance detection.
 * A fair value gap exists when price moves so fast that the middle candle's
 * wicks don't overlap with adjacent candles — creating an unfilled zone.
 *
 * Bullish FVG: current low > prior high + 1 gap → gap up (unfilled buy orders)
 * Bearish FVG: current high < prior low - 1 gap → gap down (unfilled sell orders)
 *
 * These gaps often act as magnets — price returns to "fill" them.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 5;
const FVG_LOOKBACK = 20;

interface FairValueGap {
  index: number;
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  size: number;
  mitigated: boolean;
}

@Injectable()
export class FairValueGapDirective implements IDirective {
  readonly id = 'fair-value-gap';
  readonly name = 'Fair Value Gap';
  readonly description =
    '3-candlestick imbalance detection. Identifies unfilled price zones that act as magnets.';
  readonly priority = 65;
  readonly maxScore = 100;
  readonly minBars = { '1d': 7 };
  readonly version = '1.0.0';
  readonly readiness = 'ready' as const;
  readonly suitability = { regimeType:'any' as const, volatilityLevel:'high' as const, instrumentTypes:['stocks','crypto','indices'] as const, minTimeframe:'M15', preferredSessions:['US','London'] as const };

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length < MIN_BARS + 2) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${MIN_BARS + 2} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    const gaps = this.findFVGs(bars);
    if (gaps.length === 0) {
      return {
        score: 0,
        confidence: 0.5,
        reason: 'No Fair Value Gaps detected.',
        signalClass: 'neutral',
      };
    }

    const currentPrice = bars[bars.length - 1].close;
    const unmitigatedGaps = gaps.filter((g) => !g.mitigated);

    // Check proximity to nearest unmitigated gap
    let nearestDistance = Infinity;
    let nearestGap: FairValueGap | null = null;

    for (const gap of unmitigatedGaps) {
      const gapMid = (gap.top + gap.bottom) / 2;
      const distance = Math.abs(currentPrice - gapMid) / Math.abs(gap.size || 0.0001);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestGap = gap;
      }
    }

    // Determine signal
    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (!nearestGap) {
      score = Math.min(30, gaps.length * 10);
      signalClass = 'neutral';
      reason = `${gaps.length} FVG(s) detected but all mitigated.`;
    } else if (nearestDistance < 2) {
      // Price is near an unmitigated gap
      if (nearestGap.type === 'bullish') {
        score = 50 + Math.min(40, (2 - nearestDistance) * 20);
        signalClass = 'bullish';
        reason = `Price near bullish FVG (${nearestGap.bottom.toFixed(4)}–${nearestGap.top.toFixed(4)}). Gap may act as support.`;
      } else {
        score = 50 + Math.min(40, (2 - nearestDistance) * 20);
        signalClass = 'bearish';
        reason = `Price near bearish FVG (${nearestGap.bottom.toFixed(4)}–${nearestGap.top.toFixed(4)}). Gap may act as resistance.`;
      }
    } else {
      const bullishCount = gaps.filter((g) => g.type === 'bullish').length;
      const bearishCount = gaps.filter((g) => g.type === 'bearish').length;
      signalClass = bullishCount > bearishCount ? 'bullish' : 'bearish';
      score = Math.min(40, unmitigatedGaps.length * 12);
      reason = `${unmitigatedGaps.length} unmitigated FVGs. ${bullishCount} bullish, ${bearishCount} bearish.`;
    }

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.8, 0.3 + unmitigatedGaps.length * 0.1).toFixed(2)),
      reason,
      signalClass,
    };
  }

  private findFVGs(bars: DirectiveInput['bars']): FairValueGap[] {
    const gaps: FairValueGap[] = [];
    const start = Math.max(0, bars.length - FVG_LOOKBACK - 2);

    for (let i = start + 1; i < bars.length - 1; i++) {
      const prev = bars[i - 1];
      const curr = bars[i];
      const next = bars[i + 1];

      // Bullish FVG: curr low > prev high (gap between prev and curr)
      if (curr.low > prev.high) {
        const gap = {
          index: i,
          type: 'bullish' as const,
          bottom: prev.high,
          top: curr.low,
          size: curr.low - prev.high,
          mitigated: false,
        };

        // Check if mitigated (price returned to fill)
        for (let j = i + 1; j < bars.length; j++) {
          if (bars[j].low <= gap.top) {
            gap.mitigated = true;
            break;
          }
        }

        gaps.push(gap);
      }

      // Bearish FVG: curr high < prev low (gap between prev and curr)
      if (curr.high < prev.low) {
        const gap = {
          index: i,
          type: 'bearish' as const,
          bottom: curr.high,
          top: prev.low,
          size: prev.low - curr.high,
          mitigated: false,
        };

        for (let j = i + 1; j < bars.length; j++) {
          if (bars[j].high >= gap.bottom) {
            gap.mitigated = true;
            break;
          }
        }

        gaps.push(gap);
      }
    }

    return gaps;
  }
}

