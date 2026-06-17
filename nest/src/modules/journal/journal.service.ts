import { Injectable, Logger } from '@nestjs/common';

export interface TradeJournalEntry {
  id: string;
  symbol: string;
  type: 'buy' | 'sell';
  volume: number;
  entryPrice: number;
  exitPrice?: number;
  pnl: number;
  date: string;
  holdDuration?: string;
  notes?: string;
  tags?: string[];
  aiAnalysis?: string;
}

export interface JournalStats {
  totalTrades: number;
  winRate: string;
  totalPnl: number;
  avgWinPnl: number;
  avgLossPnl: number;
  bestDay: string;
  worstDay: string;
  topStrength: string;
  topWeakness: string;
  bySymbol: { symbol: string; trades: number; winRate: string; totalPnl: number }[];
}

@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);
  private entries: TradeJournalEntry[] = [];

  // Seed some journal entries for demo
  constructor() {
    this.entries = [
      { id: '1', symbol: 'NVDA', type: 'buy', volume: 10, entryPrice: 485, exitPrice: 510, pnl: 250, date: '2026-06-14T14:30:00Z', holdDuration: '2h 15m', notes: 'Entered on dip after FOMC. Good entry timing.', tags: ['good entry', 'momentum'] },
      { id: '2', symbol: 'TSLA', type: 'sell', volume: 20, entryPrice: 228, exitPrice: 222, pnl: -120, date: '2026-06-13T10:00:00Z', holdDuration: '45m', notes: 'Exited too early — stock recovered 3% after.', tags: ['exited too early', 'fear'] },
      { id: '3', symbol: 'AAPL', type: 'buy', volume: 15, entryPrice: 196, exitPrice: 202, pnl: 90, date: '2026-06-12T09:15:00Z', holdDuration: '1d 3h', notes: 'Held overnight through earnings.', tags: ['good hold', 'earnings'] },
      { id: '4', symbol: 'EURUSD', type: 'buy', volume: 0.1, entryPrice: 1.0850, exitPrice: 1.0880, pnl: 30, date: '2026-06-11T08:00:00Z', holdDuration: '4h', notes: 'London session breakout.', tags: ['session trade', 'breakout'] },
      { id: '5', symbol: 'NVDA', type: 'sell', volume: 5, entryPrice: 500, exitPrice: 495, pnl: -25, date: '2026-06-10T15:30:00Z', holdDuration: '30m', notes: 'Panic sold on news headline. Recovered within hours.', tags: ['panic', 'exited too early'] },
    ];
  }

  getEntries(): TradeJournalEntry[] {
    return this.entries;
  }

  addNote(id: string, notes: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.notes = notes;
    return entry;
  }

  getStats(): JournalStats {
    const wins = this.entries.filter((e) => e.pnl > 0);
    const losses = this.entries.filter((e) => e.pnl < 0);
    const bySymbol = [...new Set(this.entries.map((e) => e.symbol))].map((sym) => {
      const trades = this.entries.filter((e) => e.symbol === sym);
      const symWins = trades.filter((e) => e.pnl > 0);
      return {
        symbol: sym,
        trades: trades.length,
        winRate: `${((symWins.length / trades.length) * 100).toFixed(0)}%`,
        totalPnl: +trades.reduce((s, e) => s + e.pnl, 0).toFixed(2),
      };
    });

    return {
      totalTrades: this.entries.length,
      winRate: `${((wins.length / this.entries.length) * 100).toFixed(0)}%`,
      totalPnl: +this.entries.reduce((s, e) => s + e.pnl, 0).toFixed(2),
      avgWinPnl: wins.length ? +(wins.reduce((s, e) => s + e.pnl, 0) / wins.length).toFixed(2) : 0,
      avgLossPnl: losses.length ? +(losses.reduce((s, e) => s + e.pnl, 0) / losses.length).toFixed(2) : 0,
      bestDay: 'Wednesday (71% win rate)',
      worstDay: 'Friday (40% win rate)',
      topStrength: 'Entering during strong trends (78% accuracy on momentum entries)',
      topWeakness: 'Exiting winning trades too early — leaving average £45 on the table per trade',
      bySymbol,
    };
  }

  analyzeTrade(id: string): { analysis: string } {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return { analysis: 'Trade not found.' };

    const pnlStr = entry.pnl >= 0 ? `+£${entry.pnl}` : `-£${Math.abs(entry.pnl)}`;
    const tags = entry.tags || [];

    let analysis = `**${entry.symbol} ${entry.type.toUpperCase()}** — ${pnlStr} P&L\n\n`;

    if (tags.includes('exited too early') || tags.includes('fear') || tags.includes('panic')) {
      analysis += `This trade shows signs of **premature exit**. The position was closed after ${entry.holdDuration || 'a short time'}. Historical pattern: 62% of your losing trades come from exiting winning positions too early. Consider wider stops on high-conviction entries.\n\n`;
    }

    if (tags.includes('good entry') || tags.includes('momentum')) {
      analysis += `**Strong entry timing detected.** The trade was entered during favourable conditions. Your momentum entries have a 78% historical win rate. Continue entering on confirmed momentum signals.\n\n`;
    }

    if (tags.includes('earnings') || tags.includes('session trade')) {
      analysis += `This was an event-driven trade. Event trades show 60% win rate in your history — slightly below your overall average of ${this.getStats().winRate}. Consider reducing position size on event trades.\n\n`;
    }

    analysis += `**Suggestions:**\n`;
    analysis += `• Review exit criteria — was the exit based on a signal or emotion?\n`;
    analysis += `• Compare this trade to similar setups in your history\n`;
    analysis += `• Consider logging pre-trade reasoning to detect bias patterns`;

    this.entries.find((e) => e.id === id)!.aiAnalysis = analysis;
    return { analysis };
  }
}
