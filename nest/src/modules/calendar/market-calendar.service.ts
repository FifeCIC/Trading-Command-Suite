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
  /**
   * WEEKLY window — for venues with ONE open and ONE close per week rather than per day.
   * When present, `regularOpen`/`regularClose`/`daysOfWeek` are not consulted: the
   * broker's FX week (Sunday-evening open → Friday-evening close) is not expressible as
   * a daily window, and pretending it was is how you get a venue that reports "open"
   * at Sunday breakfast.
   */
  weekly?: { openDay: number; openTime: string; closeDay: number; closeTime: string };
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

/**
 * Broker FX week — the window governing FX, metals, energy and the broker's
 * continuous CFD indices (#850: measured quoting in ~24 distinct UTC hours on
 * weekdays — see market-patterns.ts, which also records why cash-exchange hours
 * were rejected for those instruments).
 *
 * Opens Sunday 22:00 London, closes Friday 22:00 London — the standard "Sunday
 * 17:00 New York" week. Anchored to Europe/London so DST is handled by the same
 * zone maths as every other venue (21:00Z in summer, 22:00Z in winter).
 */
const FX_SESSION: SessionInfo = {
  exchange: 'FX',
  timezone: 'Europe/London',
  regularOpen: '00:00',
  regularClose: '24:00',
  daysOfWeek: [0, 1, 2, 3, 4, 5],
  weekly: { openDay: 0, openTime: '22:00', closeDay: 5, closeTime: '22:00' },
};

const SESSIONS: Record<string, SessionInfo> = {
  US: US_SESSION,
  FX: FX_SESSION,
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

    if (session.weekly) {
      return this.getWeeklyStatus(exchange, session, now);
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
      const d = new Date(from.getTime() + i * 86400000);
      const dateStr = this.formatDate(d, session.timezone);
      const dayOfWeek = this.getDayInZone(d, session.timezone);
      const holiday = this.findHoliday(dateStr, exchange);
      if (session.daysOfWeek.includes(dayOfWeek) && holiday?.status !== 'closed') {
        // Return the open time — as the true INSTANT of that wall clock in the venue's zone.
        const [oh, om] = session.regularOpen.split(':').map(Number);
        const ymd = this.ymdInZone(d, session.timezone);
        return this.instantForWallClock(ymd, session.timezone, oh * 60 + om);
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
      return this.instantForWallClock(this.ymdInZone(date, timezone), timezone, minutesSinceMidnight).toISOString();
    } catch {
      return null;
    }
  }

  /**
   * The instant (UTC) at which a given wall-clock time occurs in an IANA zone.
   *
   * ⚠️ WHY THIS EXISTS (measured 2026-09-19). The old `makeDateTime`/`findNextOpen` pair
   * built the instant by parsing the zone's wall clock back as SERVER-local time:
   * `new Date(date.toLocaleString('en-US', { timeZone: tz }))` then `setHours(...)`. That
   * round-trip bakes the SERVER's UTC offset into the answer — on this machine (UTC+1) a
   * Saturday request for the US market returned `nextOpen` **08:30Z Monday**, when the true
   * Monday open (09:30 America/New_York, EDT) is **13:30Z**. Five hours wrong, plausible
   * looking, no error — the countdown/scheduler text built on it was wrong by the
   * server-vs-venue difference, which silently changes with DST on either side.
   *
   * The fix: build the candidate as UTC, then subtract the zone's offset AT that instant.
   * Two passes, because near a DST edge the offset at the guess can differ from the offset
   * at the answer.
   */
  private instantForWallClock(ymd: { y: number; m: number; d: number }, tz: string, minutes: number): Date {
    const h = Math.floor(minutes / 60);
    const min = minutes % 60;
    const asUTC = Date.UTC(ymd.y, ymd.m - 1, ymd.d, h, min);
    let instant = asUTC - this.zoneOffsetMs(new Date(asUTC), tz);
    instant = asUTC - this.zoneOffsetMs(new Date(instant), tz);
    return new Date(instant);
  }

  /** A zone's UTC offset (ms) at a given instant — negative east of UTC, as JS expects. */
  private zoneOffsetMs(date: Date, tz: string): number {
    try {
      const p: Record<string, string> = {};
      for (const part of new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(date)) {
        p[part.type] = part.value;
      }
      const hour = Number(p.hour === '24' ? '0' : p.hour);
      const asUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
      return asUTC - date.getTime();
    } catch {
      return 0;
    }
  }

  /** Calendar date (y/m/d) of an instant in a zone. */
  private ymdInZone(date: Date, tz: string): { y: number; m: number; d: number } {
    try {
      const p: Record<string, string> = {};
      for (const part of new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date)) {
        p[part.type] = part.value;
      }
      return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
    } catch {
      return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
    }
  }

  /** The instant of `minutes` past midnight, on the day `dayOffset` days after `ref`, in `tz`. */
  private wallClockOnDayOffset(ref: Date, tz: string, dayOffset: number, minutes: number): Date {
    const target = new Date(ref.getTime() + dayOffset * 86400000);
    return this.instantForWallClock(this.ymdInZone(target, tz), tz, minutes);
  }

  /**
   * Status for a WEEKLY venue (see `SessionInfo.weekly`): one open, one close per week.
   * Open from the weekly open until the weekly close; closed otherwise.
   */
  private getWeeklyStatus(exchange: string, session: SessionInfo, now: Date): MarketStatus {
    const tz = session.timezone;
    const w = session.weekly!;
    const [oh, om] = w.openTime.split(':').map(Number);
    const [ch, cm] = w.closeTime.split(':').map(Number);
    const openMinutes = oh * 60 + om;
    const closeMinutes = ch * 60 + cm;

    const dow = this.getDayInZone(now, tz);
    const nowMin = this.localMinutes(now, tz);

    const midWeekOpen = dow > w.openDay && dow < w.closeDay;   // Mon–Thu for the FX week
    const openDayAfterOpen = dow === w.openDay && nowMin >= openMinutes;      // Sun from 22:00
    const closeDayBeforeClose = dow === w.closeDay && nowMin < closeMinutes;  // Fri before 22:00
    const open = midWeekOpen || openDayAfterOpen || closeDayBeforeClose;

    const base = { exchange, holidayName: null, currentSession: null };
    if (open) {
      // Next close is the coming close day at the close time.
      const daysToClose = (w.closeDay - dow + 7) % 7;
      const closeInstant = this.wallClockOnDayOffset(now, tz, daysToClose, closeMinutes);
      return {
        ...base,
        isOpen: true,
        status: 'open' as const,
        nextOpen: null,
        nextClose: closeInstant.toISOString(),
        minutesUntilClose: Math.round((closeInstant.getTime() - now.getTime()) / 60_000),
      };
    }

    // Closed: the weekend, Sunday before the open, or Friday after the close.
    // Next open: Sunday if we are past Friday's close or it is Saturday, else today.
    const daysToOpen = dow === w.closeDay || dow === 6 ? (7 - dow + w.openDay) % 7 : 0;
    const openInstant = this.wallClockOnDayOffset(now, tz, daysToOpen, openMinutes);
    return {
      ...base,
      isOpen: false,
      status: 'closed' as const,
      nextOpen: openInstant.toISOString(),
      nextClose: null,
      minutesUntilClose: null,
    };
  }

  /** Minutes past local midnight in a zone. */
  private localMinutes(date: Date, tz: string): number {
    const [h, m] = this.getLocalTime(date, tz).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
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
