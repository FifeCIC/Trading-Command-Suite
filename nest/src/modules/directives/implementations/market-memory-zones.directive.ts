/**
 * Market Memory Zones
 * ====================
 * Identifies price zones created by impulsive moves, structure shifts,
 * and liquidity events. These zones contain "unfilled orders" that
 * create market memory — price is statistically more likely to revisit.
 *
 * Zones are formed at:
 * - Impulsive candle bodies (strong directional moves)
 * - Swing highs/lows (structure shifts)
 * - Volume spikes (liquidity events)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const MIN_BARS = 30;
const ZONE_LOOKBACK = 25;

interface MemoryZone {
  price: number;
  strength: number; // 0-1
  type: 'impulse' | 'swing' | 'volume';
  direction: 'up' | 'down';
}

@Injectable()
export class MarketMemoryZonesDirective implements IDirective {
  readonly id = 'market-memory-zones';
  readonly name = 'Market Memory Zones';
  readonly category = 'pattern' as const;
  readonly description =
    'Identifies unfilled-order zones from impulsive moves, structure shifts, and liquidity events.';
  readonly priority = 62;
  readonly maxScore = 85;
  readonly minScore = 1;
  readonly minBars = { '1d': 30 };
  readonly version = '1.1.0';
  readonly readiness = 'ready' as const;
  readonly directionBias = 'neutral' as const;

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

    const zones = this.findMemoryZones(bars);
    if (zones.length === 0) {
      return {
        score: 0,
        confidence: 0.3,
        reason: 'No memory zones detected.',
        signalClass: 'neutral',
      };
    }

    const currentPrice = bars[bars.length - 1].close;

    // Find nearest zones above and below current price
    const zonesAbove = zones.filter((z) => z.price > currentPrice);
    const zonesBelow = zones.filter((z) => z.price < currentPrice);

    // Calculate distance-weighted zone strength
    const nearestAbove = this.nearestZone(zonesAbove, currentPrice);
    const nearestBelow = this.nearestZone(zonesBelow, currentPrice);

    let score: number;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let reason: string;

    if (nearestBelow && nearestBelow.proximity < 0.02 && nearestBelow.strength > 0.6) {
      // Price near strong support zone — bullish
      score = 45 + nearestBelow.strength * 40;
      signalClass = 'bullish';
      reason = `Price near strong memory support at ${nearestBelow.price.toFixed(4)} (strength ${(nearestBelow.strength * 100).toFixed(0)}%). Zone likely to hold.`;
    } else if (nearestAbove && nearestAbove.proximity < 0.02 && nearestAbove.strength > 0.6) {
      // Price near strong resistance zone — bearish
      score = 45 + nearestAbove.strength * 40;
      signalClass = 'bearish';
      reason = `Price near strong memory resistance at ${nearestAbove.price.toFixed(4)} (strength ${(nearestAbove.strength * 100).toFixed(0)}%). Zone likely to hold.`;
    } else {
      // General zone analysis
      const totalStrength = zones.reduce((s, z) => s + z.strength, 0);
      score = Math.min(50, totalStrength * 10);
      signalClass = 'neutral';
      reason = `${zones.length} memory zones active. Total strength: ${(totalStrength * 10).toFixed(0)}.`;
    }

    return {
      score: Math.round(score),
      confidence: Number(Math.min(0.8, 0.2 + zones.length * 0.05).toFixed(2)),
      reason,
      signalClass,
    };
  }

  private findMemoryZones(bars: DirectiveInput['bars']): MemoryZone[] {
    const zones: MemoryZone[] = [];
    const start = Math.max(0, bars.length - ZONE_LOOKBACK);

    const volumes = bars.slice(start).map((b) => b.volume);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / Math.max(1, volumes.length);

    for (let i = start; i < bars.length; i++) {
      const bar = bars[i];
      const range = bar.high - bar.low;
      const body = Math.abs(bar.close - bar.open);

      // Impulsive move: body > 70% of range
      if (range > 0 && body / range > 0.7 && body > 0) {
        const strength = Math.min(1, body / (bar.close * 0.01));
        zones.push({
          price: (bar.open + bar.close) / 2,
          strength,
          type: 'impulse',
          direction: bar.close > bar.open ? 'up' : 'down',
        });
      }

      // Volume spike: > 2x average
      if (bar.volume > avgVolume * 2) {
        zones.push({
          price: bar.close,
          strength: Math.min(1, bar.volume / (avgVolume * 3)),
          type: 'volume',
          direction: bar.close > bar.open ? 'up' : 'down',
        });
      }
    }

    return zones;
  }

  private nearestZone(
    zones: { price: number; strength: number }[],
    currentPrice: number,
  ): { price: number; strength: number; proximity: number } | null {
    if (zones.length === 0) return null;

    let nearest = zones[0];
    let minDist = Math.abs(nearest.price - currentPrice);

    for (const z of zones) {
      const dist = Math.abs(z.price - currentPrice);
      if (dist < minDist) {
        minDist = dist;
        nearest = z;
      }
    }

    return {
      price: nearest.price,
      strength: nearest.strength,
      proximity: minDist / currentPrice,
    };
  }
}



