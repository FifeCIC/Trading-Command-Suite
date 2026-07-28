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

const MIN_BARS = 1; // Only needs the current bar's timestamp

interface SessionInfo {
  name: string;
  quality: number; // 0-1, higher = better trading conditions
  active: boolean;
}

@Injectable()
export class SessionTimingFilterDirective implements IDirective {
  readonly id = 'session-timing-filter';
  readonly name = 'Session Timing Filter';
  readonly description =
    'Session-based quality multiplier. US/London sessions have highest quality. Proven filter.';
  readonly priority = 76;
  readonly maxScore = 120;
  readonly minBars = { '1d': 1 }; // PROVEN filter — session timing > regime > HTF alignment
  readonly version = '1.1.0';

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
    const hour = timestamp.getUTCHours();
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

    // Session detection (UTC hours)
    const sessions: SessionInfo[] = [
      {
        name: 'Asian',
        quality: 0.4,
        active: hour >= 0 && hour < 9,
      },
      {
        name: 'London',
        quality: 0.8,
        active: hour >= 8 && hour < 17,
      },
      {
        name: 'US',
        quality: 0.9,
        active: hour >= 13 && hour < 21,
      },
      {
        name: 'London-US Overlap',
        quality: 1.0,
        active: hour >= 13 && hour < 17,
      },
      {
        name: 'Asian-London Overlap',
        quality: 0.6,
        active: hour >= 8 && hour < 9,
      },
    ];

    // Find active sessions
    const activeSessions = sessions.filter((s) => s.active);

    if (activeSessions.length === 0) {
      // Between sessions (e.g., 21:00-00:00 UTC, 09:00-08:00)
      return {
        score: 20,
        confidence: 0.5,
        reason: `Between sessions (${hour}:00 UTC). Lower liquidity, wider spreads.`,
        signalClass: 'neutral',
      };
    }

    // Highest quality active session
    const bestSession = activeSessions.reduce((best, s) =>
      s.quality > best.quality ? s : best, activeSessions[0]);

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



