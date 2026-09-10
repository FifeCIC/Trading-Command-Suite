/**
 * MarketSessionsService — canonical, DST-aware trading session source of truth.
 * =============================================================================
 * Single source of truth for market session definitions across the app.
 *
 * Sessions are defined by IANA timezone + LOCAL market hours, so DST is handled
 * automatically by the platform (Intl). NO hardcoded UTC offsets — those drift
 * by an hour with daylight saving and caused NY-open to be 30min early.
 *
 * Consumers (timeline events, market tape, session directives, condition
 * detection, market context) should ALL read from this service instead of
 * carrying their own copies of session hours.
 */

import { Injectable, Logger } from '@nestjs/common';
import { zonedWallClockInstant } from '../../common/utils/session-time';

export type SessionScope = 'sydney' | 'tokyo' | 'london' | 'ny';

export interface MarketSession {
  scope: SessionScope;
  name: string;          // display name
  flag: string;          // emoji used in UI
  iana: string;          // IANA timezone (DST-aware)
  open: string;          // "HH:mm" local market-open
  close: string;         // "HH:mm" local market-close
  daysOfWeek: number[];  // 0=Sun ... 6=Sat
  // Quality multiplier (0-1+) used by session-timing filter / risk boost.
  quality: number;
  // Protocols/symbols that favor this session (informational).
  protocols?: string[];
}

export interface SessionState {
  scope: SessionScope;
  name: string;
  flag: string;
  active: boolean;
  openMinutes: number;
  closeMinutes: number;
  nowMinutes: number;
  minutesUntilClose: number | null;
  minutesUntilOpen: number | null;
  closesSoon: boolean;
  opensSoon: boolean;
}

export interface SessionTimelineEvent {
  id: string;
  type: 'SESSION_OPEN' | 'SESSION_OVERLAP';
  scope: 'session';
  session: string;
  action: 'boost' | 'info';
  riskMultiplier: number;
  thresholdAdjust: number;
  label: string;
  description: string;
  icon: string;
  color: string;
  startsAt: string;
  endsAt?: string;
  source: string;
  createdAt: string;
}

/**
 * Canonical session roster.
 * All hours are LOCAL to the session's IANA timezone (DST auto-handled).
 * US NYSE regular session: 09:30–16:00 ET (not 09:00).
 * London forex: 08:00–16:30 (extends past 16:00 for FX liquidity tail).
 * Tokyo: 09:00–15:00 JST  |  Sydney: 10:00–16:00 AEST (approx ASX).
 */
const SESSIONS: MarketSession[] = [
  {
    scope: 'sydney', name: 'Sydney', flag: '🇦🇺', iana: 'Australia/Sydney',
    open: '10:00', close: '16:00', daysOfWeek: [1, 2, 3, 4, 5],
    quality: 0.3,
  },
  {
    scope: 'tokyo', name: 'Tokyo', flag: '🇯🇵', iana: 'Asia/Tokyo',
    open: '09:00', close: '15:00', daysOfWeek: [1, 2, 3, 4, 5],
    quality: 0.4, protocols: ['usdjpy-risk-v1', 'forex-session-v1'],
  },
  {
    scope: 'london', name: 'London', flag: '🇬🇧', iana: 'Europe/London',
    open: '08:00', close: '16:30', daysOfWeek: [1, 2, 3, 4, 5],
    quality: 0.8, protocols: ['xau-speed-v1', 'forex-session-v1', 'eurusd-macro-v1'],
  },
  {
    scope: 'ny', name: 'New York', flag: '🇺🇸', iana: 'America/New_York',
    open: '09:30', close: '16:00', daysOfWeek: [1, 2, 3, 4, 5],
    quality: 0.9, protocols: ['spy-speed-v1', 'spy-day-v1', 'oil-speed-v1'],
  },
];

@Injectable()
export class MarketSessionsService {
  private readonly logger = new Logger(MarketSessionsService.name);

  /** Canonical session list (defensive copy — never mutate internal array). */
  listSessions(): MarketSession[] {
    return SESSIONS.map((s) => ({ ...s }));
  }

  getSession(scope: SessionScope): MarketSession | undefined {
    return SESSIONS.find((s) => s.scope === scope);
  }

  /** Current local wall-clock minutes (0–1439) in a session's timezone. */
  private minutesInZone(date: Date, iana: string): number | null {
    try {
      const parts = date.toLocaleString('en-US', {
        timeZone: iana, hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const [h, m] = parts.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    } catch {
      this.logger.warn(`Failed to resolve tz ${iana}`);
      return null;
    }
  }

  /** Local day-of-week (0=Sun) in a session's timezone. */
  private dowInZone(date: Date, iana: string): number {
    try {
      const s = date.toLocaleString('en-US', { timeZone: iana, weekday: 'short' });
      return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[s] ?? date.getUTCDay());
    } catch {
      return date.getUTCDay();
    }
  }

  /** Is the given session active at `date` (DST-aware)? */
  isActive(scope: SessionScope, date = new Date()): boolean {
    const s = this.getSession(scope);
    if (!s) return false;
    const dow = this.dowInZone(date, s.iana);
    if (!s.daysOfWeek.includes(dow)) return false;
    const now = this.minutesInZone(date, s.iana);
    if (now === null) return false;
    const [oh, om] = s.open.split(':').map(Number);
    const [ch, cm] = s.close.split(':').map(Number);
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    return now >= openMin && now < closeMin;
  }

  /** Which sessions are currently active? */
  getActiveSessions(date = new Date()): MarketSession[] {
    return SESSIONS.filter((s) => this.isActive(s.scope, date));
  }

  /** Full state snapshot for all sessions (powers the market tape). */
  getSessionStates(date = new Date()): SessionState[] {
    return SESSIONS.map((s) => {
      const dow = this.dowInZone(date, s.iana);
      const now = this.minutesInZone(date, s.iana) ?? 0;
      const [oh, om] = s.open.split(':').map(Number);
      const [ch, cm] = s.close.split(':').map(Number);
      const openMin = oh * 60 + om;
      const closeMin = ch * 60 + cm;
      const isMarketDay = s.daysOfWeek.includes(dow);
      const active = isMarketDay && now >= openMin && now < closeMin;
      const opensSoon = isMarketDay && !active && now < openMin && (openMin - now) <= 120;
      const closesSoon = active && (closeMin - now) <= 30;
      return {
        scope: s.scope, name: s.name, flag: s.flag,
        active, openMinutes: openMin, closeMinutes: closeMin,
        nowMinutes: now,
        minutesUntilClose: active ? closeMin - now : null,
        minutesUntilOpen: !active && isMarketDay ? Math.max(0, openMin - now) : null,
        closesSoon, opensSoon,
      };
    });
  }

  /**
   * Build SESSION_OPEN / OVERLAP timeline events between `now` and `lookahead`.
   * Replaces the old hardcoded-UTC logic in TimelineService.
   */
  getTimelineEvents(now = new Date(), lookaheadMinutes = 120): SessionTimelineEvent[] {
    const events: SessionTimelineEvent[] = [];
    const lookahead = new Date(now.getTime() + lookaheadMinutes * 60_000);
    const snapshot = this.getSessionStates(now);

    for (const s of SESSIONS) {
      const st = snapshot.find((x) => x.scope === s.scope)!;
      // Active now → SESSION_OPEN (boost)
      if (st.active) {
        events.push({
          id: `session-${s.scope}-active`,
          type: 'SESSION_OPEN', scope: 'session', session: s.scope,
          action: 'boost', riskMultiplier: s.quality >= 0.7 ? 1.15 : 1.0,
          thresholdAdjust: s.quality >= 0.7 ? -5 : 0,
          label: `${s.name} session active`,
          description: `${s.name} market open — higher liquidity, tighter spreads`,
          icon: '🌅', color: '#22c55e',
          startsAt: this.localOpenTime(s, now).toISOString(),
          endsAt: this.localCloseTime(s, now).toISOString(),
          source: 'system', createdAt: now.toISOString(),
        });
      } else if (st.opensSoon) {
        // Opens within lookahead → "opens soon"
        const openAt = this.localOpenTime(s, now);
        if (openAt <= lookahead) {
          events.push({
            id: `session-${s.scope}-soon`,
            type: 'SESSION_OPEN', scope: 'session', session: s.scope,
            action: 'info', riskMultiplier: 1, thresholdAdjust: 0,
            label: `${s.name} opens soon`,
            description: `${s.name} session opens at ${s.open} ${s.iana}`,
            icon: '⏰', color: '#3b82f6',
            startsAt: openAt.toISOString(),
            source: 'system', createdAt: now.toISOString(),
          });
        }
      }
    }

    // London + NY overlap (both active)
    const londonActive = this.isActive('london', now);
    const nyActive = this.isActive('ny', now);
    if (londonActive && nyActive) {
      events.push({
        id: 'session-london-ny-overlap',
        type: 'SESSION_OVERLAP', scope: 'session', session: 'london-ny',
        action: 'boost', riskMultiplier: 1.25, thresholdAdjust: -8,
        label: 'London + NY overlap',
        description: 'Highest volume period — all protocols boosted',
        icon: '🔥', color: '#f59e0b',
        startsAt: now.toISOString(),
        endsAt: this.localCloseTime(SESSIONS[3], now)?.toISOString() ?? undefined,
        source: 'system', createdAt: now.toISOString(),
      });
    }

    return events;
  }

  /** ISO timestamp of the session's local open on the same calendar day as `onDay`. */
  private localOpenTime(s: MarketSession, onDay: Date): Date {
    // 2026-09-10 (#731): shared DST-aware wall-clock → instant helper. The old
    // inline parse only worked when the machine sat in the session's own zone.
    return zonedWallClockInstant(s.iana, onDay, s.open);
  }
  /** ISO timestamp of the session's local close on the same calendar day as `onDay`. */
  private localCloseTime(s: MarketSession, onDay: Date): Date {
    return zonedWallClockInstant(s.iana, onDay, s.close);
  }
}
