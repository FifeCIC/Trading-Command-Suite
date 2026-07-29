/**
 * Earnings Proximity Directive
 * ============================
 * Scores based on distance to next earnings date.
 * Mock-first — returns neutral when no earnings calendar data.
 *
 * Pre-earnings (1-3 days before): uncertainty penalty.
 * Post-earnings (1-3 days after): high volatility, moderate score.
 * Outside window: neutral.
 *
 * TradePress source: includes/scoring-system/directives/earnings-proximity.php
 */

import { Injectable } from '@nestjs/common';
import { DirectiveInput, DirectiveResult, IDirective } from '../interfaces/directive.interface';

@Injectable()
export class EarningsProximityDirective implements IDirective {
  readonly id = 'earnings-proximity';
  readonly name = 'Earnings Proximity';
  readonly description = 'Scores based on distance to earnings. Pre-earnings = uncertainty, post-earnings = volatility.';
  readonly priority = 50;
  readonly maxScore = 100;
  readonly minBars = { '1d': 1 };
  readonly version = '1.0.0';
  readonly requiredDataFeeds = ['earnings'];
  readonly readiness = 'bravo' as const;

  calculate(input: DirectiveInput): DirectiveResult {
    // Check for earnings date on the input symbol data
    const meta = (input as any).earningsDate as string | undefined;
    const bars = input.bars;

    if (!meta) {
      // Mock mode — no earnings calendar connected
      return {
        signalClass: 'neutral',
        score: 45,
        confidence: 0.15,
        reason: `No earnings calendar data for ${input.symbol}. Mock-neutral score. Connect Alpha Vantage EARNINGS_CALENDAR for real data.`,
      };
    }

    const earningsDate = new Date(meta);
    const now = new Date();
    const lastBar = bars.length > 0 ? new Date(bars[bars.length - 1].timestamp) : now;
    const daysUntil = Math.ceil((earningsDate.getTime() - lastBar.getTime()) / (1000 * 60 * 60 * 24));
    const daysSince = -daysUntil;

    if (daysUntil >= 1 && daysUntil <= 3) {
      // Pre-earnings: uncertainty — reduce long score
      return {
        signalClass: 'bearish',
        score: Math.round(25 - (3 - daysUntil) * 5),
        confidence: 0.4,
        reason: `${daysUntil} day${daysUntil > 1 ? 's' : ''} before earnings. Elevated uncertainty — reduced long score.`,
      };
    }

    if (daysSince >= 1 && daysSince <= 3) {
      // Post-earnings: volatility settling
      return {
        signalClass: 'neutral',
        score: Math.round(40 + daysSince * 5),
        confidence: 0.3,
        reason: `${daysSince} day${daysSince > 1 ? 's' : ''} after earnings. Post-report volatility — moderate score.`,
      };
    }

    if (daysUntil > 3) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.25,
        reason: `${daysUntil} days until earnings — clear runway. Neutral score.`,
      };
    }

    return {
      signalClass: 'neutral',
      score: 45,
      confidence: 0.25,
      reason: `${daysSince} days since earnings. Earnings volatility absorbed.`,
    };
  }
}
