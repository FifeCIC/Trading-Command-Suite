/**
 * Budget Gate
 * ===========
 * Tracks concurrent open signals and blocks new entries when the
 * "signal budget" is exhausted. Prevents over-trading and over-exposure.
 *
 * This directive is a GATE — it doesn't produce a directional signal.
 * When the budget is full, it returns score 0 (blocks entry).
 * When budget is available, it passes through with modest score.
 *
 * The budget is tracked externally via the DirectivesService / scoring
 * context. For now, the directive uses an internal signal count heuristic
 * based on recent bar volatility and volume activity.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

const RECENT_BARS = 20;
const MAX_SIGNAL_OCCUPANCY = 0.9; // 90% budget utilization = blocked

@Injectable()
export class BudgetGateDirective implements IDirective {
  readonly id = 'budget-gate';
  readonly name = 'Budget Gate';
  readonly description =
    'Gates new trade entries when the signal budget is near exhaustion. Prevents over-trading.';
  readonly priority = 90;

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;

    if (bars.length < RECENT_BARS) {
      return {
        score: 0,
        confidence: 0.1,
        reason: `Insufficient data: need ${RECENT_BARS} bars, have ${bars.length}.`,
        signalClass: 'neutral',
      };
    }

    // Heuristic: count "volatile" bars as proxy for signal activity
    // A bar with > average range suggests active market conditions
    const recentBars = bars.slice(-RECENT_BARS);
    const avgRange = recentBars.reduce((sum, b) => sum + (b.high - b.low), 0) / RECENT_BARS;
    const avgVolume = recentBars.reduce((sum, b) => sum + b.volume, 0) / RECENT_BARS;

    // Count bars with above-average range AND volume as "signal events"
    const signalEvents = recentBars.filter(
      (b) => (b.high - b.low) > avgRange * 1.2 && b.volume > avgVolume * 1.2
    ).length;

    const occupancy = signalEvents / RECENT_BARS;

    if (occupancy >= MAX_SIGNAL_OCCUPANCY) {
      return {
        score: 0,
        confidence: 0.95,
        reason: `Signal budget exhausted: ${signalEvents}/${RECENT_BARS} bars show elevated activity (${(occupancy * 100).toFixed(0)}% > ${(MAX_SIGNAL_OCCUPANCY * 100).toFixed(0)}% threshold).`,
        signalClass: 'neutral',
      };
    }

    // Budget available — pass through with score proportional to remaining budget
    const remainingBudget = 1 - occupancy / MAX_SIGNAL_OCCUPANCY;
    const score = Math.round(remainingBudget * 50 + 50); // 50-100 range when budget available

    return {
      score,
      confidence: 0.7,
      reason: `Signal budget: ${signalEvents}/${RECENT_BARS} active (${(occupancy * 100).toFixed(0)}%). ${(remainingBudget * 100).toFixed(0)}% budget remaining.`,
      signalClass: 'neutral',
    };
  }
}



