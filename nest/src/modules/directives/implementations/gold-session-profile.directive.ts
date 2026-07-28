/**
 * Gold Session Profile Directive
 * ===============================
 * Gold (XAUUSD) has a unique intraday session profile distinct from
 * forex majors. This directive rates the quality of the current
 * trading session for gold-specific execution.
 *
 * ── Gold Session Characteristics ─────────────────────────
 * London open (08:00 GMT):       Primary driver — ~40% of daily range
 * NY open (13:30 GMT):           Secondary driver — ~30% of daily range
 * London-NY overlap (13:30-17:00): Peak liquidity, best execution
 * Asian session (00:00-08:00):   Low volatility, range-bound
 * NY afternoon (17:00-22:00):    Thinning, wider spreads
 * Weekend close (Fri 22:00):     Position squaring, erratic
 *
 * ── US Economic Data Windows ─────────────────────────────
 * 08:30 EST (13:30 GMT): CPI, PPI, Retail Sales, GDP
 * 10:00 EST (15:00 GMT): ISM, Consumer Sentiment, Housing
 * These windows produce gold's largest intraday moves.
 *
 * ── Scoring Logic ───────────────────────────────────────
 * Score reflects session quality for gold trading:
 *   Overlap (13:30-17:00 GMT):   85 (best)
 *  London morning (08:00-13:30): 75
 *  NY morning (13:30-17:00):     75
 *  NY afternoon (17:00-22:00):   45
 *  Asian (00:00-08:00):          30 (worst for gold)
 *  Weekend / holiday:            20 (avoid)
 */

import { Injectable } from '@nestjs/common';
import {
  DirectiveInput,
  DirectiveResult,
  IDirective,
} from '../interfaces/directive.interface';

// ── Session Definitions (UTC hours) ──────────────────────

interface SessionWindow {
  name: string;
  startHour: number;  // UTC
  endHour: number;    // UTC
  quality: number;    // 0-100 session quality score
  description: string;
}

const GOLD_SESSIONS: SessionWindow[] = [
  {
    name: 'Asian',
    startHour: 0,
    endHour: 8,
    quality: 30,
    description: 'Low volatility. Gold typically ranges ±0.2% during Asian hours. Suitable for position building, not scalping.',
  },
  {
    name: 'London Morning',
    startHour: 8,
    endHour: 13.5,
    quality: 75,
    description: 'Primary gold driver. London fixes at 10:30 and 15:00 GMT. ~40% of daily range occurs here.',
  },
  {
    name: 'London-NY Overlap',
    startHour: 13.5,
    endHour: 17,
    quality: 85,
    description: 'Peak gold liquidity. Both London and NY desks active. Tightest spreads, cleanest technicals.',
  },
  {
    name: 'NY Afternoon',
    startHour: 17,
    endHour: 22,
    quality: 45,
    description: 'Thinning liquidity. Spreads widen. NY close at 22:00 GMT sees position squaring.',
  },
  {
    name: 'Post-NY / Weekend Eve',
    startHour: 22,
    endHour: 24,
    quality: 20,
    description: 'Overnight drift. Wide spreads. Avoid trading — this is when stop-hunting is most common.',
  },
];

// ── US Data Windows (UTC = EST + 5) ──────────────────────

const DATA_WINDOWS = [
  { label: 'US Pre-Market Data', startUTC: 13.0, endUTC: 14.0, boost: 5, note: 'CPI, PPI, Retail Sales window — elevated gold volatility' },
  { label: 'US Mid-Session Data', startUTC: 14.5, endUTC: 15.5, boost: 3, note: 'ISM, Consumer Sentiment — secondary moves' },
];

// ── Directive ─────────────────────────────────────────────

@Injectable()
export class GoldSessionProfileDirective implements IDirective {
  readonly id = 'gold-session-profile';
  readonly name = 'Gold Session Profile';
  readonly description =
    'Gold-specific session quality rating. Gold moves differently from forex — ' +
    'London fixes and US data windows drive the largest intraday ranges.';
  readonly priority = 60;
  readonly maxScore = 100;
  readonly minBars = { '1d': 1 }; // Session-based — only needs current time
  readonly version = '1.0.0';

  calculate(input: DirectiveInput): DirectiveResult {
    const sym = input.symbol.toUpperCase();
    if (sym !== 'XAUUSD' && sym !== 'XAU' && sym !== 'XAGUSD' && sym !== 'XAG') {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0,
        reason: `${input.symbol} is not a gold/silver symbol — gold session profile only applies to XAUUSD/XAGUSD.`,
      };
    }

    // ── Determine current UTC hour from latest bar ────────
    const bars = input.bars;
    if (!bars || bars.length === 0) {
      return {
        signalClass: 'neutral',
        score: 50,
        confidence: 0.1,
        reason: 'No bar data available for session detection.',
      };
    }
    const currentBar = bars[bars.length - 1];
    const timestamp = currentBar.timestamp;
    const utcHour = timestamp.getUTCHours() + timestamp.getUTCMinutes() / 60;
    const dayOfWeek = timestamp.getUTCDay(); // 0=Sun, 6=Sat

    // ── Weekend check ─────────────────────────────────────
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return {
        signalClass: 'neutral',
        score: 20,
        confidence: 0.8,
        reason: 'Weekend — gold markets closed. No trading.',
      };
    }

    // Friday after 20:00 UTC — weekend approaching
    if (dayOfWeek === 5 && utcHour >= 20) {
      return {
        signalClass: 'neutral',
        score: 20,
        confidence: 0.8,
        reason: 'Friday evening — gold market winding down for weekend. Wide spreads, position squaring.',
      };
    }

    // ── Find current session ──────────────────────────────
    let activeSession: SessionWindow | undefined;
    for (const session of GOLD_SESSIONS) {
      if (utcHour >= session.startHour && utcHour < session.endHour) {
        activeSession = session;
        break;
      }
    }

    // Fallback (shouldn't happen with 0-24 coverage but safety)
    if (!activeSession) {
      activeSession = GOLD_SESSIONS[0]; // Asian
    }

    // ── Data window boost ─────────────────────────────────
    let dataBoost = 0;
    let dataNote = '';
    for (const window of DATA_WINDOWS) {
      if (utcHour >= window.startUTC && utcHour < window.endUTC) {
        // Only boost on weekdays (Mon-Fri)
        if (dayOfWeek >= 1 && dayOfWeek <= 5) {
          dataBoost = window.boost;
          dataNote = ` + ${window.note}`;
        }
        break;
      }
    }

    // ── Compute score ─────────────────────────────────────
    let score = activeSession.quality + dataBoost;
    score = Math.max(10, Math.min(95, score));

    // Signal class: high quality = bullish environment, low quality = caution
    let signalClass: 'bullish' | 'bearish' | 'neutral';
    if (score >= 70) signalClass = 'bullish';
    else if (score <= 35) signalClass = 'bearish';
    else signalClass = 'neutral';

    const confidence = activeSession.quality >= 70 ? 0.65 : activeSession.quality >= 45 ? 0.45 : 0.30;

    return {
      signalClass,
      score,
      confidence,
      reason: `${activeSession.name} session (${activeSession.description})${dataNote} → quality=${score}/100`,
    };
  }
}
