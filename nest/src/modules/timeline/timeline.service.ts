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

const SEED_EVENTS: Record<string, TimelineEvent[]> = {
  '2026-06-16': [
    { id: 's-london', type: 'session-open', title: 'London Open', description: 'European session begins — high liquidity', time: '2026-06-16T08:00:00Z', prediction: '▲ EURUSD (mild bull)', importance: 'high', session: 'london' },
    { id: 's-ny', type: 'session-open', title: 'New York Open', description: 'US session begins — peak volatility', time: '2026-06-16T13:30:00Z', prediction: '▼ BTC (58% reversal prob)', importance: 'high', session: 'ny' },
    { id: 'econ-fomc', type: 'economic', title: 'FOMC Rate Decision', description: 'Expected to hold at 5.25-5.50%. Hawkish tone possible.', time: '2026-06-18T18:00:00Z', importance: 'high' },
    { id: 'earn-nvda', type: 'earnings', title: 'NVIDIA Earnings', description: 'Q2 results — AI chip demand focus', time: '2026-06-19T20:00:00Z', symbol: 'NVDA', importance: 'high' },
    { id: 'econ-cpi', type: 'economic', title: 'US CPI (Inflation)', description: 'Expected to moderate to 3.1% YoY', time: '2026-06-20T12:30:00Z', importance: 'high' },
  ],
  '2026-06-17': [
    { id: 's-london-2', type: 'session-open', title: 'London Open', description: 'European session', time: '2026-06-17T08:00:00Z', prediction: '▲ GBPUSD (continuation)', importance: 'high', session: 'london' },
    { id: 's-ny-2', type: 'session-open', title: 'New York Open', description: 'US session', time: '2026-06-17T13:30:00Z', prediction: '→ SPY (flat open expected)', importance: 'high', session: 'ny' },
    { id: 'econ-uk', type: 'economic', title: 'UK CPI', description: 'Expected 2.0% YoY — services inflation sticky', time: '2026-06-17T06:00:00Z', importance: 'high' },
    { id: 'earn-tsla', type: 'earnings', title: 'Tesla Deliveries Preview', description: 'Q2 delivery estimates ahead of July report', time: '2026-06-17T14:00:00Z', symbol: 'TSLA', importance: 'medium' },
  ],
  '2026-06-18': [
    { id: 's-ny-3', type: 'session-open', title: 'New York Open', description: 'FOMC day — expect volatility', time: '2026-06-18T13:30:00Z', prediction: '▼ Indices (pre-FOMC caution)', importance: 'high', session: 'ny' },
    { id: 'fomc', type: 'economic', title: 'FOMC Decision + Press Conference', description: 'Rate decision at 18:00 GMT, presser at 18:30', time: '2026-06-18T18:00:00Z', importance: 'high' },
  ],
  '2026-06-19': [
    { id: 'nvda-earn', type: 'earnings', title: 'NVIDIA Q2 Earnings', description: 'After close. AI chip demand, guidance key.', time: '2026-06-19T20:00:00Z', symbol: 'NVDA', prediction: '▲ Expected beat on AI demand', importance: 'high' },
  ],
  '2026-06-20': [
    { id: 'cpi', type: 'economic', title: 'US CPI Release', description: 'May inflation data — market moving', time: '2026-06-20T12:30:00Z', importance: 'high' },
    { id: 'aapl-div', type: 'earnings', title: 'Apple Dividend', description: 'Quarterly dividend payment', time: '2026-06-20T00:00:00Z', symbol: 'AAPL', importance: 'low' },
  ],
};

const PRIORITY_SYMBOLS = ['BTCUSD', 'NVDA', 'AAPL', 'EURUSD', 'TSLA', 'SPY'];

@Injectable()
export class TimelineService {
  getTimeline(from: string, to: string, view: string = 'day'): { days: TimelineDay[] } {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days: TimelineDay[] = [];

    const current = new Date(fromDate);
    while (current <= toDate) {
      const dateStr = current.toISOString().split('T')[0];
      const events = SEED_EVENTS[dateStr] || [];

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
            prediction: this.randomSessionBias(s.currency),
            importance: 'medium',
            session: s.session as any,
          });
        }
      }

      events.sort((a, b) => a.time.localeCompare(b.time));

      const dayOfWeek = current.toLocaleDateString('en-US', { weekday: 'long' });

      const prioritySymbols = PRIORITY_SYMBOLS.map((symbol) => {
        const baseScore = this.getBaseScore(symbol);
        const variation = Math.round((Math.random() - 0.45) * 15);
        const predictedScore = Math.max(0, Math.min(100, baseScore + variation));
        return {
          symbol,
          currentScore: baseScore,
          predictedScore,
          direction: predictedScore > baseScore + 3 ? 'up' : predictedScore < baseScore - 3 ? 'down' : 'stable',
        } as TimelineDay['prioritySymbols'][0];
      });

      days.push({ date: dateStr, dayOfWeek, events, prioritySymbols });
      current.setDate(current.getDate() + 1);
    }

    return { days };
  }

  private getBaseScore(symbol: string): number {
    const scores: Record<string, number> = {
      BTCUSD: 72, NVDA: 78, AAPL: 65, EURUSD: 58, TSLA: 52, SPY: 68,
    };
    return scores[symbol] || 50;
  }

  private randomSessionBias(currency: string): string {
    const biases: Record<string, string[]> = {
      GBP: ['▲ GBPUSD (mild bull)', '→ GBPUSD (neutral open)', '▼ GBPUSD (pullback likely)'],
      USD: ['▼ BTC (reversal prob)', '▲ SPY (gap up)', '→ Indices (flat open)'],
      JPY: ['▲ USDJPY (carry trade)', '→ USDJPY (range bound)', '▼ USDJPY (JPY strength)'],
    };
    const opts = biases[currency] || ['→ Neutral open'];
    return opts[Math.floor(Math.random() * opts.length)];
  }
}
