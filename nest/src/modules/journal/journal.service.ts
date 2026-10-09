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

// ── #1100 (2026-10-09) — the STAT SURFACE IS DELETED, not re-implemented ──
//
// `getStats()` computed over an in-memory `entries` array nothing ever populated — measured:
// `totalTrades: 0`, `bySymbol: []` and a `winRate` of literally "NaN%" against 440 closed
// `trade` rows — while RETURNING FOUR HARDCODED FABRICATIONS as facts about the account
// (`bestDay: 'Wednesday (71% win rate)'`, `worstDay: 'Friday (40% win rate)'`, a 78%-accuracy
// 'topStrength' and a £45-per-trade 'topWeakness'). A plausible reading with no data behind
// it — on the PERFORMANCE-REPORTING surface, the worst place for it.
//
// Realised per-symbol P&L already has a canonical, quarantine-aware implementation:
// `PnlReport` via `GET /api/scoring/edge/pnl` (excludes `pnlInvalid`, attaches reliability
// bands). Two implementations drift and only one gets the next fix — so this one is deleted
// and consumers read the canonical endpoint. `@Get('stats')` went with it in the controller,
// and the view-meta declarations were repointed in the same change.

@Injectable()
export class JournalService {
  private readonly logger = new Logger(JournalService.name);
  private entries: TradeJournalEntry[] = [];

  // Start empty — entries come from the database via the trade journal UI
  constructor() {
    this.entries = [];
  }

  getEntries(): TradeJournalEntry[] {
    return this.entries;
  }

  addNote(id: string, notes: string) {
    const entry = this.entries.find((e) => e.id === id);
    if (entry) entry.notes = notes;
    return entry;
  }

  /**
   * analyzeTrade() — STUB, and every path here is honest (#1100).
   *
   * ⚠️ The three guidance branches below used to quote fabricated history as fact
   * ("62% of your losing trades", "78% historical win rate", "60% win rate in your history").
   * Those percentages were removed in the same change that deleted `getStats()`; they are
   * unreachable today anyway (entries is empty, so every id returns "Trade not found.") but
   * would have become reachable the moment a future change wires the entries feed. The
   * note/analysis FEATURES remain parked (they need the entries feed first) — but nothing
   * in them invents a statistic any more.
   */
  analyzeTrade(id: string): { analysis: string } {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return { analysis: 'Trade not found.' };

    const pnlStr = entry.pnl >= 0 ? `+£${entry.pnl}` : `-£${Math.abs(entry.pnl)}`;
    const tags = entry.tags || [];

    let analysis = `**${entry.symbol} ${entry.type.toUpperCase()}** — ${pnlStr} P&L\n\n`;

    if (tags.includes('exited too early') || tags.includes('fear') || tags.includes('panic')) {
      analysis += `This trade shows signs of **premature exit**. The position was closed after ${entry.holdDuration || 'a short time'}. Consider wider stops on high-conviction entries.\n\n`;
    }

    if (tags.includes('good entry') || tags.includes('momentum')) {
      analysis += `**Strong entry timing detected.** The trade was entered during favourable conditions. Continue entering on confirmed momentum signals.\n\n`;
    }

    if (tags.includes('earnings') || tags.includes('session trade')) {
      analysis += `This was an event-driven trade. Consider reducing position size on event trades.\n\n`;
    }

    analysis += `**Suggestions:**\n`;
    analysis += `• Review exit criteria — was the exit based on a signal or emotion?\n`;
    analysis += `• Compare this trade to similar setups in your history\n`;
    analysis += `• Consider logging pre-trade reasoning to detect bias patterns`;

    this.entries.find((e) => e.id === id)!.aiAnalysis = analysis;
    return { analysis };
  }
}
