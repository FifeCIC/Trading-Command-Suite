import { Injectable } from '@nestjs/common';

export interface TimelineEvent {
  id: string;
  type: 'session-open' | 'economic' | 'earnings' | 'prediction' | 'note';
  title: string;
  description: string;
  time: string;       // ISO string
  symbol?: string;
  prediction?: string; // e.g. "▲ Bullish", "▼ Bearish"
  predictionScore?: number;
  importance: 'high' | 'medium' | 'low';
  session?: 'london' | 'ny' | 'asia' | 'tokyo';
}

export interface TimelineDay {
  date: string;
  dayOfWeek: string;
  events: TimelineEvent[];
  prioritySymbols: {
    symbol: string;
    currentScore: number;
    predictedScore: number;
    direction: 'up' | 'down' | 'stable';
  }[];
}

// Session open times in GMT
const SESSIONS = [
  { name: 'London Open', time: '08:00', session: 'london', icon: '🇬🇧', currency: 'GBP' },
  { name: 'New York Open', time: '13:30', session: 'ny', icon: '🇺🇸', currency: 'USD' },
  { name: 'London Close', time: '16:30', session: 'london', icon: '🇬🇧', currency: 'GBP' },
  { name: 'Asia Open', time: '00:00', session: 'asia', icon: '🇯🇵', currency: 'JPY' },
];

// NOTE: Hardcoded demo economic/earnings events were removed (2026-08-16) — fake
// FOMC/NVIDIA/CPI entries presented as real are misleading. Session-open events
// below are computed live from real session times. Economic/earnings events should
// come from the earningsEvent table or a real calendar feed.

@Injectable()
export class TimelineService {
  getTimeline(from: string, to: string, view: string = 'day'): { days: TimelineDay[] } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days: TimelineDay[] = [];

    const current = new Date(fromDate);
    while (current <= toDate) {
      const dateStr = current.toISOString().split('T')[0];
      const events: TimelineEvent[] = [];

      // Add session open events if missing
      const hasSession = (session: string) => events.some((e) => e.session === session && e.type === 'session-open');
      for (const s of SESSIONS) {
        if (!hasSession(s.session)) {
          events.push({
            id: `auto-${s.session}-${dateStr}`,
            type: 'session-open',
            title: s.name,
            description: `${s.session} session`,
            time: `${dateStr}T${s.time}:00Z`,
            importance: 'medium',
            session: s.session as any,
          });
        }
      }

      events.sort((a, b) => a.time.localeCompare(b.time));

      const dayOfWeek = current.toLocaleDateString('en-US', { weekday: 'long' });

      // No fabricated priority scores — live scoring isn't wired into the timeline yet.
      const prioritySymbols: TimelineDay['prioritySymbols'] = [];

      days.push({ date: dateStr, dayOfWeek, events, prioritySymbols });
      current.setDate(current.getDate() + 1);
    }

    return { days };
  }

}
