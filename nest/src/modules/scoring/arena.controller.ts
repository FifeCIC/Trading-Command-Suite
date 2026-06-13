/**
 * SEES Arena Controller
 * =====================
 * Provides multi-stack scoring data for the SEES Arena UI.
 *
 * GET /api/scoring/arena?type=forex&status=active
 *   Returns: { stacks: [{ strategy, symbols[], winRate }], unifiedRanking[] }
 *
 * GET /api/scoring/arena/filters
 *   Returns: { types: string[], portfolios: string[], strategies: string[] }
 */

import { Controller, Get, Query, Logger } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { StrategyCompetitionService } from './strategy-competition.service';

interface ArenaSymbol {
  symbol: string;
  ticker: string;
  score: number;
  normalizedScore: number;
  signal: string;
  confidence: number;
}

interface ArenaStack {
  strategyId: string;
  strategyName: string;
  category: string;
  color: string;
  winRate: number | null;
  symbols: ArenaSymbol[];
}

@Controller('scoring/arena')
export class ArenaController {
  private readonly logger = new Logger(ArenaController.name);

  // Color-coded palette for each strategy stack
  private readonly STACK_COLORS = [
    '#0ea5a6', '#8f7dff', '#ff6b6b', '#ffb347',
    '#22c55e', '#ec4899', '#6366f1', '#14b8a6',
    '#f59e0b', '#ef4444', '#3b82f6', '#a855f7',
  ];

  // Strategy definitions for arena stacks
  private readonly STRATEGIES = [
    { id: 'momentum', name: 'Momentum', category: 'momentum', type: 'all' },
    { id: 'trend', name: 'Trend Following', category: 'trend', type: 'all' },
    { id: 'reversal', name: 'Mean Reversion', category: 'volatility', type: 'all' },
    { id: 'volume', name: 'Volume Flow', category: 'volume', type: 'all' },
    { id: 'forex', name: 'Forex Momentum', category: 'momentum', type: 'forex' },
    { id: 'crypto', name: 'Crypto Scalp', category: 'momentum', type: 'crypto' },
  ];

  constructor(
    private readonly scoringService: ScoringService,
    private readonly competitionService: StrategyCompetitionService,
  ) {}

  @Get()
  async getArena(
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const filterType = type || 'all';
    const activeOnly = status !== 'draft';

    // Fetch ranked results from scoring service
    let rankedSymbols: ArenaSymbol[] = [];
    try {
      const ranked = await this.scoringService.rankAll(undefined, 50);
      if (ranked?.ranked) {
        rankedSymbols = ranked.ranked.map((r) => ({
          symbol: r.ticker,
          ticker: r.ticker,
          score: r.score,
          normalizedScore: r.normalizedScore,
          signal: r.signal,
          confidence: r.confidence,
        }));
      }
    } catch (err) {
      this.logger.warn(`Arena: scoring unavailable — ${(err as Error).message}`);
    }

    // Build stacks from strategy definitions
    const stacks: ArenaStack[] = this.STRATEGIES
      .filter((s) => filterType === 'all' || s.type === filterType)
      .filter(() => activeOnly) // all defined strategies are active
      .map((s, i) => {
        // Assign symbols to each stack (partition ranked symbols across strategies)
        const strategySymbols = rankedSymbols.filter((sym, idx) => idx % this.STRATEGIES.length === i % this.STRATEGIES.length);
        return {
          strategyId: s.id,
          strategyName: s.name,
          category: s.category,
          color: this.STACK_COLORS[i % this.STACK_COLORS.length],
          winRate: null, // would come from performance tracking
          symbols: strategySymbols.slice(0, 5), // top 5 per stack
        };
      })
      .filter((s) => s.symbols.length > 0 || filterType !== 'all'); // show empty stacks only with specific filter

    // Build unified ranking across all stacks
    const unifiedRanking = rankedSymbols
      .slice(0, 10)
      .map((sym, i) => {
        const owningStack = stacks.find((s) => s.symbols.some((ss) => ss.ticker === sym.ticker));
        return {
          rank: i + 1,
          symbol: sym.symbol,
          score: sym.score,
          signal: sym.signal,
          strategy: owningStack?.strategyName || 'General',
          reason: sym.score >= 80
            ? `Strong ${sym.signal} signal — multiple directives confirm`
            : sym.score >= 60
              ? `Moderate ${sym.signal} — some directives agree`
              : `Weak signal — needs confirmation`,
        };
      });

    return { stacks, unifiedRanking };
  }

  @Get('filters')
  async getFilters() {
    return {
      types: ['all', 'forex', 'stocks', 'crypto', 'indices'],
      portfolios: ['all', 'holdings', 'watchlist'],
      strategies: this.STRATEGIES.map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        type: s.type,
      })),
    };
  }
}
