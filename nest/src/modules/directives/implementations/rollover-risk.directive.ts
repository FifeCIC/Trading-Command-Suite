/**
 * Rollover Risk Directive
 * ========================
 * Detects broker rollover windows (typically 22:00-23:00 UTC) where
 * spreads widen dramatically and execution quality degrades.
 * During this window, scores 0 to heavily gate trading decisions.
 *
 * Many brokers widen spreads to 2-5x normal during rollover,
 * making scalping and short-term trades unprofitable.
 * This directive acts as a RISK GATE — when active, it pulls the
 * risk multiplier toward the floor.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const ROLLOVER_START_UTC = 22; // 22:00 UTC
const ROLLOVER_END_UTC = 23;   // 23:00 UTC

@Injectable()
export class RolloverRiskDirective implements IDirective {
  readonly id = 'rollover-risk';
  readonly name = 'Rollover Risk';
  readonly description =
    'Detects broker rollover window (22:00–23:00 UTC) where spreads widen 2–5× normal. Scores 0 during this period to gate trades.';
  readonly priority = 90;
  readonly maxScore = 100;
  readonly minBars = { '1d': 20 };
  readonly version = '1.0.0';

  readonly suitability = {
    regimeType: 'any' as const,
    volatilityLevel: 'any' as const,
    instrumentTypes: ['stocks', 'crypto', 'forex', 'indices', 'commodities'] as const,
    minTimeframe: 'M1',
    preferredSessions: ['US', 'London', 'Asian', 'off-hours'] as const,
  };

  calculate(_input: DirectiveInput): DirectiveResult {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const day = now.getUTCDay();

    // Skip weekends
    if (day === 0 || day === 6) {
      return {
        score: this.maxScore,
        confidence: 1.0,
        reason: 'Weekend — no rollover risk.',
        signalClass: 'neutral',
      };
    }

    const inRollover = hour >= ROLLOVER_START_UTC && hour < ROLLOVER_END_UTC;

    if (!inRollover) {
      return {
        score: this.maxScore,
        confidence: 1.0,
        reason: 'Outside rollover window — normal spreads.',
        signalClass: 'neutral',
      };
    }

    // Inside rollover — score 0 to gate trades
    const progress = minute / 60;
    const severity = progress < 0.33 ? 'entering' : progress > 0.66 ? 'exiting' : 'peak';

    return {
      score: 0,
      confidence: 0.95,
      reason: `Rollover active (${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC, ${severity}) — spreads widen 2-5× normal.`,
      signalClass: 'neutral',
    };
  }
}
