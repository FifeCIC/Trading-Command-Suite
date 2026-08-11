/**
 * Kelly Position Sizing Directive (Q302)
 * =======================================
 * Scores how well the current position size matches the Kelly Criterion optimal.
 *
 * Kelly formula: f* = (p × b - (1-p)) / b
 *   p = win rate, b = avgWin/avgLoss ratio, f* = optimal fraction
 *
 * Half-Kelly (50% of optimal) is the standard recommendation.
 * Score: 0-100 based on how close current allocation is to half-Kelly optimal.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

@Injectable()
export class PositionSizeKellyDirective implements IDirective {
  readonly id = 'position-size-kelly';
  readonly name = 'Kelly Position Sizing';
  readonly category = 'structural' as const;
  readonly description =
    'Scores position size against Kelly Criterion optimal allocation. Half-Kelly is the recommended standard.';
  readonly maxScore = 100;
  readonly minScore = 1;
  readonly minBars = { '1d': 20 };
  readonly version = '1.1.0';
  readonly readiness = 'alpha' as const;
  readonly directionBias = 'neutral' as const;
  readonly priority = 55;
  readonly suitability = {
    regimeType: 'any' as const,
    volatilityLevel: 'normal' as const,
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices'] as const,
    minTimeframe: 'D1',
    preferredSessions: ['US', 'London'] as const,
  };

  calculate(input: DirectiveInput): DirectiveResult {
    // This directive is informational — it depends on portfolio-level data
    // not available in standard DirectiveInput. It returns a moderate neutral
    // score that gets boosted when a strategy has sizing config.
    return {
      score: 30,
      confidence: 0.6,
      reason: 'Kelly sizing requires portfolio-level win rate and W/L ratio. Set in strategy config.',
      signalClass: 'neutral',
    };
  }
}
