/**
 * Bitcoin Halving Cycle
 * =====================
 * Scores Bitcoin's position in its 4-year halving cycle.
 * Halving events create predictable supply shocks that drive
 * multi-year price cycles.
 *
 * maxScore: 200 — the highest individual directive weight.
 * When this fires (post-halving rally phase), it dominates
 * the protocol and pushes scores into "cyclical" rarity territory.
 *
 * Last halving: 2024-04-20
 * Current date at implementation: 2026-06-23 (~26 months post)
 * Phase: Late-Cycle (540–900 days).
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

// Halving dates (UTC midnight)
const HALVING_DATES: Date[] = [
  new Date('2012-11-28T00:00:00Z'),
  new Date('2016-07-09T00:00:00Z'),
  new Date('2020-05-11T00:00:00Z'),
  new Date('2024-04-20T00:00:00Z'),
];

// Expected next halving (~4 years / 210,000 blocks)
const AVG_HALVING_DAYS = 1460; // ~4 years

@Injectable()
export class BtcHalvingCycleDirective implements IDirective {
  readonly id = 'btc-halving-cycle';
  readonly name = 'Bitcoin Halving Cycle';
  readonly description =
    'Scores BTC position in its 4-year halving cycle. Post-halving supply shock (0-180 days) = strongest signal. Late-cycle euphoria (540-900 days) = elevated. Pre-halving bear (900+ days) = suppressed.';
  readonly priority = 90;
  readonly maxScore = 200;
  readonly version = '2.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const now = input.bars?.length ? new Date(input.bars[input.bars.length - 1].timestamp) : new Date();

    // Find the most recent halving
    let lastHalving = HALVING_DATES[0];
    for (const h of HALVING_DATES) {
      if (h <= now) {
        lastHalving = h;
      }
    }

    const daysSinceHalving = Math.floor(
      (now.getTime() - lastHalving.getTime()) / 86400000,
    );

    let score: number;
    let phase: string;
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    let confidence: number;

    if (daysSinceHalving < 0) {
      // Before any known halving (shouldn't happen)
      score = 0;
      phase = 'Pre-history';
      signalClass = 'neutral';
      confidence = 0.1;
    } else if (daysSinceHalving <= 180) {
      // Phase 1: Post-Halving Rally (0–6 months)
      // Strongest signal — supply shock meets narrative
      const progress = daysSinceHalving / 180;
      score = 80 + progress * 120; // 80 → 200 over 180 days
      phase = 'Post-Halving Rally';
      signalClass = 'bullish';
      confidence = 0.7 + progress * 0.25;
    } else if (daysSinceHalving <= 540) {
      // Phase 2: Mid-Cycle (6–18 months)
      // Consolidation, range-bound accumulation
      const progress = (daysSinceHalving - 180) / 360;
      score = 40 - Math.abs(progress - 0.5) * 80; // Bell curve 0–80
      phase = 'Mid-Cycle Accumulation';
      signalClass = 'neutral';
      confidence = 0.4;
    } else if (daysSinceHalving <= 900) {
      // Phase 3: Late-Cycle (18–30 months)
      // Euphoria potential, blow-off top risk
      const progress = (daysSinceHalving - 540) / 360;
      score = 20 + progress * 40; // 20 → 60
      phase = 'Late-Cycle';
      signalClass = 'bullish';
      confidence = 0.5 + progress * 0.2;
    } else {
      // Phase 4: Pre-Halving Bear (30+ months)
      // Bear market, accumulation, miner capitulation risk
      const progress = Math.min(1, (daysSinceHalving - 900) / (AVG_HALVING_DAYS - 900));
      score = Math.round(20 - progress * 40); // 20 → -20, floor 0
      score = Math.max(0, score);
      phase = 'Pre-Halving Bear';
      signalClass = 'bearish';
      confidence = 0.3 + progress * 0.3;
    }

    const halvingDate = lastHalving.toISOString().split('T')[0];
    const nextHalvingEst = new Date(lastHalving.getTime() + AVG_HALVING_DAYS * 86400000)
      .toISOString()
      .split('T')[0];

    return {
      score: Math.round(Math.min(this.maxScore, score)),
      confidence: Number(confidence.toFixed(2)),
      reason: `Day ${daysSinceHalving} post-halving (${halvingDate}). Phase: ${phase}. Next halving est: ${nextHalvingEst}. Score: ${Math.round(score)}/${this.maxScore}.`,
      signalClass,
    };
  }
}
