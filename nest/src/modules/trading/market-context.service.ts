/**
 * MarketContextService — 7-Day Market Awareness
 * =============================================
 * Provides day-of-week trading context: session timing, upcoming events,
 * swap risk, gap exposure, and pre-flight checklist for the trading agent.
 *
 * Friday EOW checklist, Monday gap fill, Wednesday triple swap.
 * Designed as a pre-flight check before automated trading runs.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// Canonical session definitions live in session-window.ts — the same module the
// execution-side session gate uses. Never re-declare them here.
import { SESSION_DEFS } from './session-window';

export interface DayContext {
  dayOfWeek: string;
  dayIndex: number; // 0=Sun, 6=Sat
  isWeekend: boolean;
  isFriday: boolean;
  isMonday: boolean;
  isWednesday: boolean;
  label: string;
  mood: 'caution' | 'normal' | 'watchful' | 'prep';
  checklist: string[];
  swapRisk: 'none' | 'normal' | 'triple';
  gapExposure: 'none' | 'moderate' | 'high';
  sessionNote: string;
}

export interface UpcomingEvent {
  type: 'earnings' | 'economic' | 'fed' | 'holiday' | 'expiry';
  label: string;
  symbol?: string;
  date: string;
  daysUntil: number;
  impact: 'low' | 'medium' | 'high';
}

export interface MarketSession {
  name: string;
  active: boolean;
  opensIn: number | null; // minutes until open, null if already open
  closesIn: number | null; // minutes until close, null if not active
  timeRange: string;
}

export interface MarketContext {
  timestamp: string;
  currentDay: DayContext;
  sessions: MarketSession[];
  upcomingEvents: UpcomingEvent[];
  warnings: string[];
  preflightOk: boolean;
}

// Session definitions are sourced from session-window.ts (SESSION_DEFS).

// Day-of-week profiles
const DAY_PROFILES: Record<number, Omit<DayContext, 'dayIndex'>> = {
  0: { // Sunday
    dayOfWeek: 'Sunday', isWeekend: true, isFriday: false, isMonday: false, isWednesday: false,
    label: 'Weekend — Prepare', mood: 'prep',
    checklist: ['Review last week P&L', 'Plan Monday watchlist', 'Check for weekend news catalysts', 'Review open positions for gap risk'],
    swapRisk: 'none', gapExposure: 'high', sessionNote: 'Asian opens at 7pm ET. Prepare for the week ahead.',
  },
  1: { // Monday
    dayOfWeek: 'Monday', isWeekend: false, isFriday: false, isMonday: true, isWednesday: false,
    label: 'Monday Gap Fill', mood: 'caution',
    checklist: ['Check weekend gap fills', 'Review Friday close vs Monday open', 'Scan for overnight breakouts', 'Confirm Asian/London sentiment'],
    swapRisk: 'normal', gapExposure: 'high', sessionNote: 'Monday gaps fill ~60% of the time within first 2 hours. Watch for false breakouts.',
  },
  2: { // Tuesday
    dayOfWeek: 'Tuesday', isWeekend: false, isFriday: false, isMonday: false, isWednesday: false,
    label: 'Turnaround Tuesday', mood: 'normal',
    checklist: ['Watch for Monday trend reversal', 'Institutional flow begins', 'Volume normalises after Monday'],
    swapRisk: 'normal', gapExposure: 'moderate', sessionNote: 'Tuesday often reverses Monday moves. Strongest trending day historically.',
  },
  3: { // Wednesday
    dayOfWeek: 'Wednesday', isWeekend: false, isFriday: false, isMonday: false, isWednesday: true,
    label: 'Triple Swap Day', mood: 'watchful',
    checklist: ['⚠️ TRIPLE SWAP — holding costs spike tonight', 'Check open forex positions for rollover cost', 'Midweek momentum check', 'Review position sizing for overnight'],
    swapRisk: 'triple', gapExposure: 'moderate', sessionNote: 'Forex triple swap day — overnight holding costs are 3× normal. Consider closing before 5pm ET if swap-sensitive.',
  },
  4: { // Thursday
    dayOfWeek: 'Thursday', isWeekend: false, isFriday: false, isMonday: false, isWednesday: false,
    label: 'Pre-Friday Positioning', mood: 'normal',
    checklist: ['Check Friday expiration events', 'Review weekly P&L', 'Prepare for EOW position adjustments'],
    swapRisk: 'normal', gapExposure: 'moderate', sessionNote: 'Thursday afternoon often sees position squaring ahead of Friday. Watch for late-session reversals.',
  },
  5: { // Friday
    dayOfWeek: 'Friday', isWeekend: false, isFriday: true, isMonday: false, isWednesday: false,
    label: 'EOW — Close & Review', mood: 'caution',
    checklist: ['⚠️ Close positions before weekend gap risk', 'Review all open positions — carry through weekend?', 'Complete EOW checklist', 'Export weekly P&L report', 'Check for Monday economic events'],
    swapRisk: 'normal', gapExposure: 'high', sessionNote: 'Friday closes often drift lower after 2pm ET. Weekend gap risk is highest on Fridays. Triple swap if holding forex through weekend.',
  },
  6: { // Saturday
    dayOfWeek: 'Saturday', isWeekend: true, isFriday: false, isMonday: false, isWednesday: false,
    label: 'Weekend — Review', mood: 'prep',
    checklist: ['Weekly performance review', 'Update trading journal', 'Research watchlist for next week', 'Check economic calendar for the week ahead'],
    swapRisk: 'none', gapExposure: 'none', sessionNote: 'Markets closed. Review and prepare for the week ahead.',
  },
};

@Injectable()
export class MarketContextService {
  private readonly logger = new Logger(MarketContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getContext(): Promise<MarketContext> {
    const now = new Date();
    const dayIndex = now.getUTCDay(); // Using UTC day — server runs UTC

    // ── Day context ──
    const profile = DAY_PROFILES[dayIndex];
    const currentDay: DayContext = { ...profile, dayIndex };

    // ── Active sessions ──
    const etHour = this.getETHour(now);
    const etMinute = now.getUTCMinutes();
    const etMinutes = etHour * 60 + etMinute;

    const sessions: MarketSession[] = SESSION_DEFS.map((s) => {
      const sessionStart = s.startH * 60 + s.startM;
      let sessionEnd = s.endH * 60 + s.endM;
      if (sessionEnd <= sessionStart) sessionEnd += 24 * 60; // wraps past midnight
      const active = etMinutes >= sessionStart && etMinutes < sessionEnd;

      let opensIn: number | null = null;
      let closesIn: number | null = null;

      if (!active) {
        opensIn = sessionStart - etMinutes;
        if (opensIn < 0) opensIn += 24 * 60;
      } else {
        closesIn = sessionEnd - etMinutes;
      }

      return { name: s.name, active, opensIn, closesIn, timeRange: s.timeRange };
    });

    // ── Upcoming events (next 7 days) ──
    const upcomingEvents: UpcomingEvent[] = [];

    // Earnings events
    try {
      const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const earningsEvents = await this.prisma.earningsEvent.findMany({
        where: {
          reportDate: { gte: now, lte: sevenDays },
          epsActual: null, // not yet reported
        },
        select: { symbol: true, name: true, reportDate: true },
        orderBy: { reportDate: 'asc' },
        take: 10,
      });
      for (const e of earningsEvents) {
        const daysUntil = Math.ceil((e.reportDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        upcomingEvents.push({
          type: 'earnings',
          label: `${e.symbol}${e.name ? ` — ${e.name}` : ''} Earnings`,
          symbol: e.symbol,
          date: e.reportDate.toISOString(),
          daysUntil,
          impact: daysUntil <= 1 ? 'high' : daysUntil <= 3 ? 'medium' : 'low',
        });
      }
    } catch (err) {
      this.logger.debug(`Earnings event fetch skipped: ${(err as Error).message}`);
    }

    // Fed / FOMC check (simple — just check if this is FOMC week)
    const fomcDate = this.getNextFOMCDate(now);
    if (fomcDate) {
      const daysUntil = Math.ceil((fomcDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
      if (daysUntil <= 7) {
        upcomingEvents.push({
          type: 'fed',
          label: 'FOMC Meeting',
          date: fomcDate.toISOString(),
          daysUntil,
          impact: daysUntil <= 3 ? 'high' : 'medium',
        });
      }
    }

    // OpEx Friday check
    if (currentDay.isFriday) {
      const opexFriday = this.isOpExFriday(now);
      if (opexFriday) {
        upcomingEvents.push({
          type: 'expiry',
          label: 'Monthly Options Expiration (OpEx)',
          date: now.toISOString(),
          daysUntil: 0,
          impact: 'high',
        });
      }
    }

    // ── Warnings ──
    const warnings: string[] = [];

    if (currentDay.isFriday && currentDay.gapExposure === 'high') {
      warnings.push('Friday close — consider reducing exposure before weekend gap risk');
    }
    if (currentDay.swapRisk === 'triple') {
      warnings.push('⚠️ TRIPLE SWAP DAY — forex holding costs are 3× normal tonight. Review open positions.');
    }
    if (currentDay.isMonday && currentDay.gapExposure === 'high') {
      warnings.push('Monday gap fill — watch for weekend gap reversals in first 2 hours');
    }

    const anySessionActive = sessions.some((s) => s.active);
    if (!anySessionActive) {
      warnings.push('No major session currently active — liquidity may be thin');
    }

    // ── Preflight check ──
    const preflightOk = warnings.filter((w) => w.startsWith('⚠️')).length === 0;

    return {
      timestamp: now.toISOString(),
      currentDay,
      sessions,
      upcomingEvents: upcomingEvents.slice(0, 8),
      warnings,
      preflightOk,
    };
  }

  /** Convert UTC to approximate ET hour (ET = UTC - 4 during EDT, -5 during EST) */
  private getETHour(utc: Date): number {
    // Simplified: July = EDT (UTC-4). In production, use a timezone library.
    const month = utc.getUTCMonth(); // 0=Jan
    const isDST = month >= 2 && month <= 10; // Mar–Nov approximate DST
    let etHour = utc.getUTCHours() - (isDST ? 4 : 5);
    if (etHour < 0) etHour += 24;
    return etHour;
  }

  /** Check if today is the 3rd Friday of the month (OpEx) */
  private isOpExFriday(date: Date): boolean {
    const day = date.getUTCDate();
    return day >= 15 && day <= 21; // 3rd Friday always falls in this range
  }

  /** Estimate next FOMC date (rough 6-week cycle from known dates) */
  private getNextFOMCDate(now: Date): Date | null {
    // Known 2026 FOMC dates (approximate, Wednesdays)
    const fomcDates = [
      new Date('2026-06-17T14:00:00Z'),
      new Date('2026-07-29T14:00:00Z'),
      new Date('2026-09-16T14:00:00Z'),
      new Date('2026-11-04T14:00:00Z'),
      new Date('2026-12-16T14:00:00Z'),
    ];

    for (const d of fomcDates) {
      if (d > now) return d;
    }
    return null;
  }
}
