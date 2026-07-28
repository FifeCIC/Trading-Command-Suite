/**
 * Confidence-Weighted Position Sizing Directive (Q302)
 * =====================================================
 * Scales position size based on protocol confidence.
 *
 * Linear: size = baseSize × (confidence / 100)
 * Aggressive: size = baseSize × (confidence / 100)²  (overweights high confidence)
 * Conservative: size = baseSize × √(confidence / 100) (underweights differences)
 *
 * Score: 0-100 — rewards high-confidence setups with appropriate sizing.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

@Injectable()
export class PositionSizeConfidenceDirective implements IDirective {
  readonly id = 'position-size-confidence';
  readonly name = 'Confidence-Weighted Sizing';
  readonly description =
    'Rewards high-confidence protocol scores with proportionally larger position sizes.';
  readonly maxScore = 100;
  readonly minBars = { '1d': 5 };
  readonly version = '1.0.0';
  readonly priority = 60;
  readonly suitability = {
    regimeType: 'any' as const,
    volatilityLevel: 'any' as const,
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'] as const,
    minTimeframe: 'D1',
    preferredSessions: ['US', 'London', 'Asian'] as const,
  };

  calculate(input: DirectiveInput): DirectiveResult {
    if (input.bars.length < 5) {
      return { score: 0, confidence: 0.1, reason: 'Insufficient data.', signalClass: 'neutral' };
    }

    // Derive a proxy confidence from recent bar consistency
    // More consistent closes = higher "sizing confidence"
    const closes = input.bars.slice(-10).map((b) => b.close);
    const changes = closes.slice(1).map((c, i) => Math.abs((c - closes[i]) / closes[i]));
    const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;

    // Lower volatility → higher confidence for sizing
    const consistencyScore = Math.max(0, Math.min(1, 1 - avgChange * 50));
    const sizeMultiplier = 0.5 + consistencyScore * 0.5; // 0.5–1.0
    const score = Math.round(sizeMultiplier * 60);

    return {
      score,
      confidence: consistencyScore,
      reason: `Confidence-weighted sizing: ${(sizeMultiplier * 100).toFixed(0)}% of base size (avg bar movement ${(avgChange * 100).toFixed(2)}%)`,
      signalClass: 'neutral',
    };
  }
}
