/**
 * ⚠️ AXIS: this is the VENUE axis — "is this exchange/market open?".
 * It is NOT the FX-session axis (`calendar/market-sessions.service.ts`, which answers "which
 * liquidity block are we in?") and NOT the bot-policy axis (`trading/session-window.ts`, which
 * answers "when may this bot act?"). Those are different questions with different owners; see
 * #851. This service is authoritative for the venue axis ONLY — do not read it for the others, and
 * do not let it grow a second axis.
 *
 * ⚠️ `SESSIONS` CONTAINS ONLY `US`, and an unknown exchange FAILS CLOSED. That was the #850 defect:
 * the gate passed a hardcoded `'US'` for every instrument, so UK100/FRA40/GER40 were blocked with
 * "US market after-hours". Which pattern governs an instrument is now decided in
 * `market-patterns.ts` — add exchanges THERE and here together, not just here.
 *
 * MarketCalendarService — #39
 * ============================
 * Holiday database, DST-aware session boundaries, early-close detection,
 * and "is market open?" queries. Replaces hardcoded UTC hour checks
 * across FreshnessService, session directives, and trading gates.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface SessionInfo {
  exchange: string;
  timezone: string;           // IANA timezone
  regularOpen: string;        // HH:mm in local time
  regularClose: string;       // HH:mm in local time
  earlyClose?: string;        // HH:mm on early-close days
  daysOfWeek: number[];       // 0=Sun, 1=Mon…
}

export interface HolidayEntry {
  date: string;               // YYYY-MM-DD
  exchange: string;
  status: 'closed' | 'early-close';
  name: string;
  closeTime?: string;         // HH:mm local (early-close only)
}

export interface MarketStatus {
  isOpen: boolean;
  status: 'open' | 'closed' | 'early-close' | 'pre-market' | 'after-hours';
  exchange: string;
  nextOpen: string | null;    // ISO timestamp
  nextClose: string | null;   // ISO timestamp
  minutesUntilClose: number | null;
  holidayName: string | null;
  currentSession: string | null; // 'US' | 'London' | 'Asian' | null
}

/** US NYSE/NASDAQ holidays 2025-2027 — easily extendable */
const US_HOLIDAYS: HolidayEntry[] = [
  // 2025
  { date: '2025-01-01', exchange: 'US', status: 'closed', name: "New Year's Day" },
  { date: '2025-01-20', exchange: 'US', status: 'closed', name: 'Martin Luther King Jr. Day' },
  { date: '2025-02-17', exchange: 'US', status: 'closed', name: "Presidents' Day" },
  { date: '2025-04-18', exchange: 'US', status: 'closed', name: 'Good Friday' },
  { date: '2025-05-26', exchange: 'US', status: 'closed', name: 'Memorial Day' },
  { date: '2025-06-19', exchange: 'US', status: 'closed', name: 'Juneteenth' },
  { date: '2025-07-03', exchange: 'US', status: 'early-close', name: 'Independence Day Eve', closeTime: '13:00' },
  { date: '2025-07-04', exchange: 'US', status: 'closed', name: 'Independence Day' },
  { date: '2025-09-01', exchange: 'US', status: 'closed', name: 'Labor Day' },
  { date: '2025-11-27', exchange: 'US', status: 'closed', name: 'Thanksgiving Day' },
  { date: '2025-11-28', exchange: 'US', status: 'early-close', name: 'Black Friday', closeTime: '13:00' },
  { date: '2025-12-24', exchange: 'US', status: 'early-close', name: 'Christmas Eve', closeTime: '13:00' },
  { date: '2025-12-25', exchange: 'US', status: 'closed', name: 'Christmas Day' },
  // 2026
  { date: '2026-01-01', exchange: 'US', status: 'closed', name: "New Year's Day" },
  { date: '2026-01-19', exchange: 'US', status: 'closed', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', exchange: 'US', status: 'closed', name: "Presidents' Day" },
  { date: '2026-04-03', exchange: 'US', status: 'closed', name: 'Good Friday' },
  { date: '2026-05-25', exchange: 'US', status: 'closed', name: 'Memorial Day' },
  { date: '2026-06-19', exchange: 'US', status: 'closed', name: 'Juneteenth' },
  { date: '2026-07-03', exchange: 'US', status: 'early-close', name: 'Independence Day (observed)', closeTime: '13:00' },
  { date: '2026-09-07', exchange: 'US', status: 'closed', name: 'Labor Day' },
  { date: '2026-11-26', exchange: 'US', status: 'closed', name: 'Thanksgiving Day' },
  { date: '2026-11-27', exchange: 'US', status: 'early-close', name: 'Black Friday', closeTime: '13:00' },
  { date: '2026-12-24', exchange: 'US', status: 'early-close', name: 'Christmas Eve', closeTime: '13:00' },
  { date: '2026-12-25', exchange: 'US', status: 'closed', name: 'Christmas Day' },
  // 2027
  { date: '2027-01-01', exchange: 'US', status: 'closed', name: "New Year's Day" },
  { date: '2027-01-18', exchange: 'US', status: 'closed', name: 'Martin Luther King Jr. Day' },
  { date: '2027-02-15', exchange: 'US', status: 'closed', name: "Presidents' Day" },
  { date: '2027-03-26', exchange: 'US', status: 'closed', name: 'Good Friday' },
  { date: '2027-05-31', exchange: 'US', status: 'closed', name: 'Memorial Day' },
  { date: '2027-06-18', exchange: 'US', status: 'early-close', name: 'Juneteenth (observed)', closeTime: '13:00' },
  { date: '2027-07-05', exchange: 'US', status: 'closed', name: 'Independence Day (observed)' },
  { date: '2027-09-06', exchange: 'US', status: 'closed', name: 'Labor Day' },
  { date: '2027-11-25', exchange: 'US', status: 'closed', name: 'Thanksgiving Day' },
  { date: '2027-11-26', exchange: 'US', status: 'early-close', name: 'Black Friday', closeTime: '13:00' },
  { date: '2027-12-24', exchange: 'US', status: 'early-close', name: 'Christmas Eve', closeTime: '13:00' },
];

const US_SESSION: SessionInfo = {
  exchange: 'US',
  timezone: 'America/New_York',
  regularOpen: '09:30',
  regularClose: '16:00',
  daysOfWeek: [1, 2, 3, 4, 5],
};

const SESSIONS: Record<string, SessionInfo> = {
  US: US_SESSION,
};

@Injectable()
export class MarketCalendarService {
  private readonly logger = new Logger(MarketCalendarService.name);

  /**
   * Get the current market status for an exchange.
   */
  getMarketStatus(exchange = 'US', referenceDate?: Date): MarketStatus {
    const now = referenceDate ?? new Date();
    const session = SESSIONS[exchange];
    if (!session) {
      return {
        isOpen: false, status: 'closed' as const, exchange,
        nextOpen: null, nextClose: null, minutesUntilClose: null,
        holidayName: null, currentSession: null,
      };
    }

    // Check holidays
    const dateStr = this.formatDate(now, session.timezone);
    const holiday = this.findHoliday(dateStr, exchange);

    // Get local time in the exchange timezone
    const localTime = this.getLocalTime(now, session.timezone);
    const [lh, lm] = localTime.split(':').map(Number);
    const localMinutes = lh * 60 + lm;

    const [oh, om] = session.regularOpen.split(':').map(Number);
    const openMinutes = oh * 60 + om;

    const closeTime = holiday?.status === 'early-close' && holiday.closeTime
      ? holiday.closeTime
      : session.regularClose;
    const [ch, cm] = closeTime.split(':').map(Number);
    const closeMinutes = ch * 60 + cm;

    const dayOfWeek = this.getDayInZone(now, session.timezone);

    // Market closed: holiday OR weekend
    if (holiday?.status === 'closed') {
      const next = this.findNextOpen(exchange, now, session, dateStr);
      return {
        isOpen: false,
        status: 'closed',
        exchange,
        nextOpen: next?.toISOString() ?? null,
        nextClose: null,
        minutesUntilClose: null,
        holidayName: holiday.name,
        currentSession: null,
      };
    }

    if (!session.daysOfWeek.includes(dayOfWeek)) {
      const next = this.findNextOpen(exchange, now, session, dateStr);
      return {
        isOpen: false,
        status: 'closed',
        exchange,
        nextOpen: next?.toISOString() ?? null,
        nextClose: null,
        minutesUntilClose: null,
        holidayName: null,
        currentSession: null,
      };
    }

    // Pre-market (before open)
    if (localMinutes < openMinutes) {
      return {
        isOpen: false,
        status: 'pre-market',
        exchange,
        nextOpen: this.makeDateTime(now, session.timezone, openMinutes),
        nextClose: this.makeDateTime(now, session.timezone, closeMinutes),
        minutesUntilClose: null,
        holidayName: holiday?.name ?? null,
        currentSession: null,
      };
    }

    // After-hours (after close)
    if (localMinutes >= closeMinutes) {
      const next = this.findNextOpen(exchange, now, session, dateStr);
      return {
        isOpen: false,
        status: 'after-hours',
        exchange,
        nextOpen: next?.toISOString() ?? null,
        nextClose: null,
        minutesUntilClose: null,
        holidayName: null,
        currentSession: null,
      };
    }

    // Market is OPEN
    const minutesUntilClose = closeMinutes - localMinutes;
    const currentSession = holiday?.status === 'early-close' ? 'US' : this.detectSession(now);

    return {
      isOpen: true,
      status: holiday?.status === 'early-close' ? 'early-close' : 'open',
      exchange,
      nextOpen: null,
      nextClose: this.makeDateTime(now, session.timezone, closeMinutes),
      minutesUntilClose,
      holidayName: holiday?.name ?? null,
      currentSession,
    };
  }

  /** Quick check: is the US market open right now? */
  isUSMarketOpen(referenceDate?: Date): boolean {
    return this.getMarketStatus('US', referenceDate).isOpen;
  }

  /** Get the holiday for a given date, if any */
  getHoliday(dateStr: string, exchange = 'US'): HolidayEntry | null {
    return this.findHoliday(dateStr, exchange);
  }

  /** List all holidays for an exchange */
  listHolidays(exchange = 'US'): HolidayEntry[] {
    return US_HOLIDAYS.filter(h => h.exchange === exchange);
  }

  /** Get session info */
  getSession(exchange: string): SessionInfo | null {
    return SESSIONS[exchange] || null;
  }

  // ── Private helpers ──

  private findHoliday(dateStr: string, exchange: string): HolidayEntry | null {
    return US_HOLIDAYS.find(h => h.date === dateStr && h.exchange === exchange) ?? null;
  }

  private findNextOpen(exchange: string, from: Date, session: SessionInfo, todayStr: string): Date | null {
    const maxDays = 14;
    for (let i = 1; i <= maxDays; i++) {
      const d = new Date(from);
      d.setDate(d.getDate() + i);
      const dateStr = this.formatDate(d, session.timezone);
      const dayOfWeek = this.getDayInZone(d, session.timezone);
      const holiday = this.findHoliday(dateStr, exchange);
      if (session.daysOfWeek.includes(dayOfWeek) && holiday?.status !== 'closed') {
        // Return the open time
        const [oh, om] = session.regularOpen.split(':').map(Number);
        const local = new Date(d.toLocaleString('en-US', { timeZone: session.timezone }));
        local.setHours(oh, om, 0, 0);
        return local;
      }
    }
    return null;
  }

  private getLocalTime(date: Date, timezone: string): string {
    try {
      return date.toLocaleString('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch {
      // Fallback: UTC
      return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}`;
    }
  }

  private formatDate(date: Date, timezone: string): string {
    try {
      const parts = date.toLocaleString('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      return parts; // en-CA gives YYYY-MM-DD
    } catch {
      return date.toISOString().split('T')[0];
    }
  }

  private getDayInZone(date: Date, timezone: string): number {
    try {
      const str = date.toLocaleString('en-US', {
        timeZone: timezone,
        weekday: 'short',
      });
      const map: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      return map[str] ?? date.getUTCDay();
    } catch {
      return date.getUTCDay();
    }
  }

  private makeDateTime(date: Date, timezone: string, minutesSinceMidnight: number): string | null {
    try {
      const h = Math.floor(minutesSinceMidnight / 60);
      const m = minutesSinceMidnight % 60;
      const local = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
      local.setHours(h, m, 0, 0);
      return local.toISOString();
    } catch {
      return null;
    }
  }

  private detectSession(date: Date): string | null {
    const utcHour = date.getUTCHours();
    if (utcHour >= 13 && utcHour < 17) return 'US+London'; // overlap
    if (utcHour >= 13 && utcHour < 21) return 'US';
    if (utcHour >= 8 && utcHour < 17) return 'London';
    if (utcHour >= 0 && utcHour < 9) return 'Asian';
    return null;
  }
}
