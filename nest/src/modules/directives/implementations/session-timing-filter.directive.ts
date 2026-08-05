/**
 * Session Timing Filter
 * ======================
 * PROVEN most impactful filter — session timing > regime > HTF alignment.
 *
 * Assigns quality multipliers based on trading session:
 * - US session (13:30-21:00 UTC): highest volume, best execution
 * - London session (08:00-16:30 UTC): major forex volume
 * - Asian session (00:00-09:00 UTC): quieter, wider spreads
 * - Overlap periods have unique characteristics
 *
 * This directive acts as a MULTIPLIER/FILTER, not a standalone signal.
 * It passes through its score contribution based on how "good" the
 * current trading session is for execution.
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';
import { MarketSessionsService } from '../../calendar/market-sessions.service';

const MIN_BARS = 1; // Only needs the current bar's timestamp

// Session-based quality scores. Order = check for best first (overlap handled
// by checking all active sessions and taking the highest quality).
const SESSION_QUALITY: Record<string, number> = {
  ny: 0.9,       // US regular session
  london: 0.8,   // London forex session
  tokyo: 0.4,    // Asian/Tokyo
  sydney: 0.3,   // Sydney early
};

@Injectable()
export class SessionTimingFilterDirective implements IDirective {
  readonly id = 'session-timing-filter';
  readonly name = 'Session Timing Filter';
  readonly description =
    'Session-based quality multiplier. US/London sessions have highest quality. Proven filter.';
  readonly priority = 76;
  readonly maxScore = 120;
  readonly minBars = { '1d': 1 }; // PROVEN filter — session timing > regime > HTF alignment
  readonly version = '2.0.0';
  readonly readiness = 'ready' as const;

  constructor(private readonly marketSessions: MarketSessionsService) {}

  calculate(input: DirectiveInput): DirectiveResult {
    const bars = input.bars;
    if (bars.length === 0) {
      return {
        score: 0,
        confidence: 0.1,
        reason: 'No data available for session timing.',
        signalClass: 'neutral',
      };
    }

    // Get current bar's timestamp
    const currentBar = bars[bars.length - 1];
    const timestamp = currentBar.timestamp;
    const dayOfWeek = timestamp.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    // Weekend check
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        score: 0,
        confidence: 0.95,
        reason: 'Weekend — markets closed. No trading.',
        signalClass: 'neutral',
      };
    }

    // Session detection — DST-aware via canonical MarketSessionsService.
    // Active sessions are derived from each session's own IANA timezone,
    // so boundaries (e.g. NY 09:30 ET → 13:30/14:30 UTC) stay correct all year.
    const activeScopes = this.marketSessions.getActiveSessions(timestamp)
      .map((s) => s.scope);
    const hour = timestamp.getUTCHours();

    // Find active sessions with their quality (take the highest quality active).
    const activeSessions = activeScopes
      .map((scope) => ({ name: scope, quality: SESSION_QUALITY[scope] ?? 0.5, active: true }))
      .sort((a, b) => b.quality - a.quality);

    if (activeSessions.length === 0) {
      // Between sessions
      return {
        score: 20,
        confidence: 0.5,
        reason: `Between sessions (${hour}:00 UTC). Lower liquidity, wider spreads.`,
        signalClass: 'neutral',
      };
    }

    // Highest quality active session
    const bestSession = activeSessions[0];

    // Score based on session quality
    const score = Math.round(bestSession.quality * 80 + 20);

    // Monday/Friday adjustments
    let dayAdjustment = 1.0;
    if (dayOfWeek === 1 && hour < 8) {
      dayAdjustment = 0.7; // Monday early — liquidity building
    } else if (dayOfWeek === 5 && hour >= 20) {
      dayAdjustment = 0.7; // Friday late — positions being closed
    }

    const adjustedScore = Math.round(score * dayAdjustment);

    return {
      score: Math.min(this.maxScore, adjustedScore),
      confidence: Number((0.7 * dayAdjustment).toFixed(2)),
      reason: `${bestSession.name} session active (${hour}:00 UTC). Quality: ${(bestSession.quality * 100).toFixed(0)}%. ${activeSessions.length > 1 ? 'Overlap period.' : ''}${dayAdjustment < 1 ? ' Day adjustment applied.' : ''}`,
      signalClass: 'neutral',
    };
  }
}



