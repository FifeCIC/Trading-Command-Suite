/**
 * Micro Support & Resistance Levels
 * ==================================
 * Identifies key short-timeframe S/R levels for speed trading:
 *   - Previous day high/low
 *   - Current day open
 *   - Session highs/lows (Asian, London, US)
 *   - VWAP as dynamic S/R
 *   - Round number levels (500/1000 for BTC-like assets)
 *   - Prior 1H swing points
 *   - 3-day pivot point
 *
 * Scores proximity to these levels and detects bounce/rejection patterns.
 *
 * maxScore: 100 — strong S/R proximity with bounce confirmation.
 *
 * @see docs/theories/multi-timeframe-speed-trading.md
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
  MarketBar,
} from '../interfaces/directive.interface';

const PROXIMITY_THRESHOLD = 0.003; // 0.3% — price within this % of level = "active"
const BOUNCE_THRESHOLD = 0.001; // 0.1% — min move away from level to count as bounce
const CONFLUENCE_BONUS = 1.3; // 30% bonus when 2+ levels at same price zone

@Injectable()
export class MicroSrLevelsDirective implements IDirective {
  readonly id = 'micro-sr-levels';
  readonly name = 'Micro Support & Resistance Levels';
  readonly description =
    'Identifies key short-timeframe S/R levels from prior day extremes, session ranges, VWAP, round numbers, and swing pivots. Scores proximity and bounce/rejection patterns for speed trading.';
  readonly priority = 75;
  readonly maxScore = 100;
  readonly minBars = { '1d': 2, '1h': 10, '15m': 10, '5m': 5 };
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const { bars, dayBars, hourBars, min15Bars } = input;

    if (!bars || bars.length < 5) {
      return {
        score: 0,
        confidence: 0,
        reason: `Insufficient bars: need >= 5, have ${bars?.length ?? 0}.`,
        signalClass: 'neutral',
      };
    }

    const currentPrice = bars[bars.length - 1].close;

    // ── Collect all S/R levels ──────────────────────────
    const levels: SrLevel[] = [];

    // 1. Previous day high/low from dayBars
    if (dayBars && dayBars.length >= 2) {
      const prevDay = dayBars[dayBars.length - 2];
      if (prevDay) {
        levels.push({
          price: prevDay.high,
          type: 'resistance',
          label: `Prev Day High (${prevDay.high.toFixed(1)})`,
          source: 'day',
          weight: 0.9,
        });
        levels.push({
          price: prevDay.low,
          type: 'support',
          label: `Prev Day Low (${prevDay.low.toFixed(1)})`,
          source: 'day',
          weight: 0.9,
        });
      }
    }

    // 2. Current day open from dayBars
    if (dayBars && dayBars.length >= 1) {
      const today = dayBars[dayBars.length - 1];
      if (today) {
        levels.push({
          price: today.open,
          type: 'pivot',
          label: `Today Open (${today.open.toFixed(1)})`,
          source: 'day',
          weight: 0.7,
        });
      }
    }

    // 3. VWAP from hourBars
    if (hourBars && hourBars.length >= 5) {
      const vwap = this.computeVwap(hourBars);
      if (vwap > 0) {
        levels.push({
          price: vwap,
          type: currentPrice > vwap ? 'support' : 'resistance',
          label: `VWAP (${vwap.toFixed(1)})`,
          source: 'vwap',
          weight: 0.85,
        });
      }
    }

    // 4. Session highs/lows from hourBars (last 8 bars ≈ 8 hours)
    if (hourBars && hourBars.length >= 8) {
      const sessionBars = hourBars.slice(-8);
      const sessionHigh = Math.max(...sessionBars.map((b) => b.high));
      const sessionLow = Math.min(...sessionBars.map((b) => b.low));
      levels.push({
        price: sessionHigh,
        type: 'resistance',
        label: `Session High (${sessionHigh.toFixed(1)})`,
        source: 'hour',
        weight: 0.75,
      });
      levels.push({
        price: sessionLow,
        type: 'support',
        label: `Session Low (${sessionLow.toFixed(1)})`,
        source: 'hour',
        weight: 0.75,
      });
    }

    // 5. Prior 1H swing points from hourBars (3-bar pivot window)
    if (hourBars && hourBars.length >= 10) {
      const pivots = this.findPivots(hourBars, 3);
      for (const p of pivots) {
        levels.push({
          price: p.price,
          type: p.type,
          label: `1H ${p.type === 'resistance' ? 'Swing High' : 'Swing Low'} (${p.price.toFixed(1)})`,
          source: 'hour',
          weight: 0.6,
        });
      }
    }

    // 6. 15M swing points
    if (min15Bars && min15Bars.length >= 10) {
      const pivots15 = this.findPivots(min15Bars, 3);
      for (const p of pivots15.slice(0, 3)) {
        // Top 3 to avoid noise
        levels.push({
          price: p.price,
          type: p.type,
          label: `15M ${p.type === 'resistance' ? 'Swing High' : 'Swing Low'} (${p.price.toFixed(1)})`,
          source: 'min15',
          weight: 0.5,
        });
      }
    }

    // 7. Round numbers (step based on price magnitude)
    const step = this.roundStep(currentPrice);
    const roundUp = Math.ceil(currentPrice / step) * step;
    const roundDown = Math.floor(currentPrice / step) * step;
    if (roundUp !== roundDown) {
      if (roundUp !== currentPrice) {
        levels.push({
          price: roundUp,
          type: 'resistance',
          label: `Round ${roundUp}`,
          source: 'round',
          weight: 0.55,
        });
      }
      if (roundDown !== currentPrice) {
        levels.push({
          price: roundDown,
          type: 'support',
          label: `Round ${roundDown}`,
          source: 'round',
          weight: 0.55,
        });
      }
    }

    // ── Deduplicate & merge nearby levels (within 0.1%) ──
    const merged = this.mergeNearbyLevels(levels, currentPrice);

    // ── Score proximity ─────────────────────────────────
    const nearestSupport = merged
      .filter((l) => l.type === 'support' && l.price < currentPrice)
      .sort((a, b) => b.price - a.price)[0];
    const nearestResistance = merged
      .filter((l) => l.type === 'resistance' && l.price > currentPrice)
      .sort((a, b) => a.price - b.price)[0];

    let score = 0;
    let signalClass: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    const reasons: string[] = [];

    // Check support proximity
    if (nearestSupport) {
      const distPct =
        (currentPrice - nearestSupport.price) / nearestSupport.price;
      const proxScore = this.proximityScore(Math.abs(distPct));
      const confluenceMultiplier =
        nearestSupport.confluenceCount >= 2 ? CONFLUENCE_BONUS : 1.0;

      // Bounce detection: price above support with upward momentum
      const recentBars = bars.slice(-3);
      const momentum =
        bars.length >= 4
          ? recentBars[recentBars.length - 1].close - bars[bars.length - 4].close
          : 0;

      if (Math.abs(distPct) <= PROXIMITY_THRESHOLD && momentum > 0) {
        // Bounce off support = bullish
        score += Math.round(proxScore * confluenceMultiplier);
        signalClass = 'bullish';
        reasons.push(
          `Near support ${nearestSupport.labels.join(' / ')} (${(distPct * 100).toFixed(2)}%) with bullish momentum`,
        );
      } else if (Math.abs(distPct) <= PROXIMITY_THRESHOLD * 2) {
        // Near support but no momentum yet — neutral-positive
        score += Math.round(proxScore * 0.5 * confluenceMultiplier);
        reasons.push(
          `Approaching support ${nearestSupport.labels.join(' / ')} (${(distPct * 100).toFixed(2)}%)`,
        );
      }
    }

    // Check resistance proximity
    if (nearestResistance) {
      const distPct =
        (nearestResistance.price - currentPrice) / currentPrice;
      const proxScore = this.proximityScore(Math.abs(distPct));
      const confluenceMultiplier =
        nearestResistance.confluenceCount >= 2 ? CONFLUENCE_BONUS : 1.0;

      if (Math.abs(distPct) <= PROXIMITY_THRESHOLD && signalClass !== 'bullish') {
        // Near resistance = bearish (unless already bouncing off support)
        score += Math.round(proxScore * confluenceMultiplier);
        if (signalClass === 'neutral') signalClass = 'bearish';
        reasons.push(
          `Near resistance ${nearestResistance.labels.join(' / ')} (${(distPct * 100).toFixed(2)}%)`,
        );
      } else if (Math.abs(distPct) <= PROXIMITY_THRESHOLD * 2) {
        reasons.push(
          `Approaching resistance ${nearestResistance.labels.join(' / ')} (${(distPct * 100).toFixed(2)}%)`,
        );
      }
    }

    // ── Confluence detection ────────────────────────────
    const confluentZones = merged.filter((l) => l.confluenceCount >= 3);
    if (confluentZones.length > 0) {
      const zone = confluentZones[0];
      const distPct = Math.abs(currentPrice - zone.price) / zone.price;
      if (distPct <= PROXIMITY_THRESHOLD * 3) {
        reasons.push(
          `Confluence zone at ${zone.price.toFixed(1)} (${zone.confluenceCount} levels)`,
        );
      }
    }

    // Clamp score
    const clampedScore = Math.min(this.maxScore, Math.max(0, score));

    // Confidence based on level quality and proximity clarity
    const confidence = Math.min(
      0.95,
      (nearestSupport ? 0.3 : 0) +
        (nearestResistance ? 0.3 : 0) +
        (clampedScore / this.maxScore) * 0.35,
    );

    const nearestInfo = [
      nearestSupport
        ? `S: ${nearestSupport.labels[0]}`
        : 'S: none',
      nearestResistance
        ? `R: ${nearestResistance.labels[0]}`
        : 'R: none',
    ].join(' | ');

    return {
      score: clampedScore,
      confidence: Number(confidence.toFixed(2)),
      reason:
        reasons.length > 0
          ? `${reasons.join('. ')}. ${nearestInfo}`
          : `No clear S/R proximity. ${nearestInfo}`,
      signalClass,
    };
  }

  // ── Helpers ───────────────────────────────────────────

  private computeVwap(bars: MarketBar[]): number {
    let cumPv = 0;
    let cumV = 0;
    for (const b of bars) {
      const tp = (b.high + b.low + b.close) / 3;
      cumPv += tp * (b.volume || 0);
      cumV += b.volume || 0;
    }
    return cumV > 0 ? cumPv / cumV : 0;
  }

  private findPivots(
    bars: MarketBar[],
    window: number,
  ): { price: number; type: 'support' | 'resistance' }[] {
    const pivots: { price: number; type: 'support' | 'resistance' }[] = [];
    if (bars.length < window * 2 + 1) return pivots;

    for (let i = window; i < bars.length - window; i++) {
      const bar = bars[i];
      let isHigh = true;
      let isLow = true;

      for (let j = i - window; j <= i + window; j++) {
        if (j === i) continue;
        if (bars[j].high >= bar.high) isHigh = false;
        if (bars[j].low <= bar.low) isLow = false;
      }

      if (isHigh) {
        pivots.push({ price: bar.high, type: 'resistance' });
      }
      if (isLow) {
        pivots.push({ price: bar.low, type: 'support' });
      }
    }

    return pivots;
  }

  /**
   * Proximity score: 100 when exactly at level, decaying to 0 at PROXIMITY_THRESHOLD.
   */
  private proximityScore(distPct: number): number {
    if (distPct >= PROXIMITY_THRESHOLD) return 0;
    return Math.round(100 * (1 - distPct / PROXIMITY_THRESHOLD));
  }

  /**
   * Compute round number step based on price magnitude.
   * BTC at 87000 → step = 500
   * Gold at 2650 → step = 50
   * EURUSD at 1.05 → step = 0.01
   */
  private roundStep(price: number): number {
    if (price >= 10000) return 500;
    if (price >= 1000) return 50;
    if (price >= 100) return 5;
    if (price >= 10) return 0.5;
    return 0.01;
  }

  /**
   * Merge levels within 0.1% of each other. Merged levels get a confluence count.
   */
  private mergeNearbyLevels(
    levels: SrLevel[],
    currentPrice: number,
  ): MergedLevel[] {
    const MERGE_THRESHOLD = 0.001; // 0.1%
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const merged: MergedLevel[] = [];

    for (const level of sorted) {
      const matched = merged.find(
        (m) =>
          Math.abs(m.price - level.price) / currentPrice < MERGE_THRESHOLD,
      );
      if (matched) {
        matched.labels.push(level.label);
        matched.confluenceCount++;
        // Weight: keep the higher-weighted type
        if (level.weight > matched.weight) {
          matched.weight = level.weight;
          matched.type = level.type;
        }
        // Average the price
        matched.price =
          (matched.price * (matched.confluenceCount - 1) + level.price) /
          matched.confluenceCount;
      } else {
        merged.push({
          price: level.price,
          type: level.type,
          labels: [level.label],
          confluenceCount: 1,
          weight: level.weight,
        });
      }
    }

    return merged;
  }
}

// ── Internal types ───────────────────────────────────────

interface SrLevel {
  price: number;
  type: 'support' | 'resistance' | 'pivot';
  label: string;
  source: string;
  weight: number;
}

interface MergedLevel {
  price: number;
  type: 'support' | 'resistance' | 'pivot';
  labels: string[];
  confluenceCount: number;
  weight: number;
}
