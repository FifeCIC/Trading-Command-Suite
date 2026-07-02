/**
 * SEES Arena Controller
 * =====================
 * Multi-protocol comparison and strategy-based symbol ranking.
 *
 * GET  /api/scoring/arena         — trading strategy stacks with real protocol scores
 * GET  /api/scoring/arena/filters — available types, portfolios, protocols
 * POST /api/scoring/arena/compare — multi-protocol comparison matrix
 *
 * Architecture:
 *   Protocol (25) → Trading Strategy (grouping) → Ranked Symbols
 *   Each trading strategy uses specific protocols to score + rank symbols.
 *   The Compare tab shows raw protocol-level comparison.
 *   The Stacks tab shows strategy-level opportunity ranking.
 */

import { Controller, Get, Post, Body, Query, Logger } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { StrategyCompetitionService } from './strategy-competition.service';
import { ProtocolGatingService } from './protocol-gating.service';
import { PROTOCOL_REGISTRY } from '../directives/directive-groups';
import { PrismaService } from '../../database/prisma.service';

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
  description?: string;
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

  /**
   * Trading Strategy Definitions
   * =============================
   * Each strategy groups related protocols and describes the trading approach.
   * Only protocols that exist in PROTOCOL_REGISTRY are used.
   * Symbols are scored with each strategy's protocol set and ranked by score.
   */
  private readonly TRADING_STRATEGIES: Array<{
    id: string;
    name: string;
    description: string;
    protocolIds: string[];
    category: string;
  }> = [
    {
      id: 'gold-macro',
      name: 'Gold & Macro',
      description: 'Gold scalping with DXY sensitivity and macro correlation overlay. Best during NY/London overlap.',
      protocolIds: ['xau-speed-v1', 'dxy-sensitivity-v1', 'gold-macro-v1'],
      category: 'forex',
    },
    {
      id: 'btc-monitor',
      name: 'BTC Investment Monitor',
      description: 'Medium-term Bitcoin entries using halving cycle, fear-greed, and technical momentum. Hours to days.',
      protocolIds: ['btc-speed-v1', 'btc-scalp-v1'],
      category: 'crypto',
    },
    {
      id: 'us-indices',
      name: 'US Indices',
      description: 'SPY + QQQ day-trade and swing entries. Combines speed scalping with day-trade protocols.',
      protocolIds: ['spy-speed-v1', 'spy-day-v1', 'qqq-speed-v1', 'qqq-day-v1'],
      category: 'indices',
    },
    {
      id: 'oil-energy',
      name: 'Oil & Energy',
      description: 'Oil speed scalping with supply/demand fundamentals. Reacts to inventory data and geopolitics.',
      protocolIds: ['oil-speed-v1', 'oil-supply-v1'],
      category: 'forex',
    },
    {
      id: 'momentum-stocks',
      name: 'Momentum Stocks',
      description: 'Equity momentum for TSLA and broad market. Uses momentum stock protocol.',
      protocolIds: ['momentum-stock-v1', 'tsla-speed-v1'],
      category: 'stocks',
    },
    {
      id: 'forex-pairs',
      name: 'Forex Pairs',
      description: 'Session-aware forex trading with DXY overlay. CAD, EUR, and major pair protocols.',
      protocolIds: ['forex-session-v1', 'dxy-sensitivity-v1', 'cad-sniper-v1'],
      category: 'forex',
    },
    {
      id: 'volatility',
      name: 'Volatility & Crisis',
      description: 'VIX spike mean reversion and pandemic/health crisis protocols. Defensive positioning.',
      protocolIds: ['vix-spike-v1', 'pandemic-v1'],
      category: 'indices',
    },
    {
      id: 'leveraged',
      name: 'Leveraged Products',
      description: 'Leverage Shares strategy for amplified ETF positions. Higher risk, shorter holds.',
      protocolIds: ['leverage-v2'],
      category: 'stocks',
    },
  ];

  /** Resolve which strategies have valid (registered) protocols */
  private getActiveStrategies() {
    return this.TRADING_STRATEGIES.map((s) => ({
      ...s,
      _validProtocols: s.protocolIds.filter((pid) => PROTOCOL_REGISTRY[pid]),
    })).filter((s) => s._validProtocols.length > 0);
  }

  constructor(
    private readonly scoringService: ScoringService,
    private readonly competitionService: StrategyCompetitionService,
    private readonly protocolGating: ProtocolGatingService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async getArena(
    @Query('type') type?: string,
    @Query('status') status?: string,
  ) {
    const filterType = (type || 'all').toLowerCase();

    const activeStrategies = this.getActiveStrategies().filter((s) =>
      filterType === 'all' || s.category === filterType,
    );

    if (activeStrategies.length === 0) {
      return { stacks: [], unifiedRanking: [] };
    }

    // Load active symbols from DB
    const symbols = await this.prisma.symbol.findMany({
      where: { active: true },
      select: { id: true, ticker: true },
      take: 40,
    });

    if (symbols.length === 0) {
      return { stacks: [], unifiedRanking: [] };
    }

    // For each strategy, score symbols using its protocols
    const stacks: ArenaStack[] = [];
    const allScored = new Map<string, { ticker: string; bestScore: number; bestSignal: string; strategyName: string }>();

    for (let si = 0; si < activeStrategies.length; si++) {
      const strat = activeStrategies[si];
      const strategySymbols: ArenaSymbol[] = [];

      for (const sym of symbols) {
        try {
          // Load bars for this symbol
          const bars = await this.prisma.marketBar.findMany({
            where: { symbolId: sym.id },
            orderBy: { timestamp: 'desc' },
            take: 100,
          });
          if (bars.length < 5) continue;

          const marketBars = bars.map((b) => ({
            timestamp: b.timestamp,
            open: Number(b.open), high: Number(b.high),
            low: Number(b.low), close: Number(b.close),
            volume: Number(b.volume),
          }));

          // Score with each protocol in this strategy, take the best
          let bestScore = 0;
          let bestSignal = 'HOLD';
          for (const pid of strat._validProtocols) {
            try {
              const gated = await this.protocolGating.scoreWithGating(sym.ticker, marketBars, pid);
              if (gated.composite > bestScore && !gated.riskGate?.hardGateTriggered) {
                bestScore = gated.composite;
                bestSignal = gated.signal;
              }
            } catch { /* protocol may not apply to this symbol */ }
          }

          if (bestScore > 0) {
            strategySymbols.push({
              symbol: sym.ticker,
              ticker: sym.ticker,
              score: bestScore,
              normalizedScore: bestScore,
              signal: bestSignal,
              confidence: 0.7,
            });

            // Track best across all strategies for unified ranking
            const existing = allScored.get(sym.ticker);
            if (!existing || bestScore > existing.bestScore) {
              allScored.set(sym.ticker, { ticker: sym.ticker, bestScore, bestSignal, strategyName: strat.name });
            }
          }
        } catch { /* skip symbol */ }
      }

      // Sort by score descending
      strategySymbols.sort((a, b) => b.score - a.score);

      stacks.push({
        strategyId: strat.id,
        strategyName: strat.name,
        category: strat.category,
        description: strat.description,
        color: this.STACK_COLORS[si % this.STACK_COLORS.length],
        winRate: null,
        symbols: strategySymbols, // ALL scored symbols, not just top 5
      });
    }

    // Unified ranking: best score per symbol across all strategies
    const unifiedRanking = [...allScored.values()]
      .sort((a, b) => b.bestScore - a.bestScore)
      .slice(0, 15)
      .map((r, i) => ({
        rank: i + 1,
        symbol: r.ticker,
        score: r.bestScore,
        signal: r.bestSignal,
        strategy: r.strategyName,
        reason: '',
      }));

    return { stacks, unifiedRanking };
  }

  @Get('filters')
  async getFilters() {
    return {
      types: ['all', 'forex', 'stocks', 'crypto', 'indices'],
      portfolios: ['all', 'holdings', 'watchlist'],
      strategies: this.getActiveStrategies().map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        protocolCount: s._validProtocols.length,
      })),
      protocols: Object.entries(PROTOCOL_REGISTRY).map(([id, p]) => ({
        id,
        name: p.name,
        description: p.description,
        tradingStyle: p.tradingStyle,
        recommendedTimeframe: p.recommendedTimeframe,
        idealFor: p.idealFor,
      })),
    };
  }

  /**
   * Multi-protocol comparison — score symbols across multiple protocols.
   *
   * POST /scoring/arena/compare
   * Body: { symbols: string[], protocols?: string[] }
   * Returns per-symbol scores from each protocol + consensus analysis.
   */
  @Post('compare')
  async compareProtocols(
    @Body() body: { symbols?: string[]; protocols?: string[] },
  ) {
    const symbols = (body?.symbols || []).slice(0, 15).map((s) => s.toUpperCase());
    if (symbols.length === 0) {
      return { error: 'No symbols provided', comparison: [] };
    }

    // Resolve protocols — default to all registered
    const protocolIds = body?.protocols?.length
      ? body.protocols.filter((p) => PROTOCOL_REGISTRY[p])
      : Object.keys(PROTOCOL_REGISTRY).filter((p) => p !== 'default');

    if (protocolIds.length === 0) {
      return { error: 'No valid protocols', comparison: [] };
    }

    // Load symbols from DB
    const dbSymbols = await this.prisma.symbol.findMany({
      where: { ticker: { in: symbols }, active: true },
      select: { id: true, ticker: true },
    });
    const tickerToId = new Map(dbSymbols.map((s) => [s.ticker, s.id]));

    const comparison: Array<{
      symbol: string;
      protocolScores: Array<{
        protocolId: string;
        name: string;
        description: string;
        score: number;
        signal: string;
        hardGated: boolean;
        warnings: string[];
        tradingStyle?: string;
        timeframe?: string;
        idealFor?: string;
      }>;
      consensus: 'strong_buy' | 'buy' | 'mixed' | 'sell' | 'strong_sell';
      divergence: number;
      bestProtocol: string | null;
    }> = [];

    for (const ticker of symbols) {
      const symbolId = tickerToId.get(ticker);
      if (!symbolId) continue;

      // Load bars once per symbol
      const bars = await this.prisma.marketBar.findMany({
        where: { symbolId },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
      if (bars.length < 5) continue;

      const marketBars = bars.map((b) => ({
        timestamp: b.timestamp,
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
        volume: Number(b.volume),
      }));

      const protocolScores: typeof comparison[0]['protocolScores'] = [];

      for (const protocolId of protocolIds) {
        const reg = PROTOCOL_REGISTRY[protocolId];
        if (!reg) continue;

        try {
          const gated = await this.protocolGating.scoreWithGating(
            ticker,
            marketBars,
            protocolId,
          );

          protocolScores.push({
            protocolId,
            name: reg.name,
            description: reg.description,
            score: gated.composite,
            signal: gated.signal,
            hardGated: gated.riskGate?.hardGateTriggered || false,
            warnings: gated.riskGate?.warnings || [],
            tradingStyle: reg.tradingStyle,
            timeframe: reg.recommendedTimeframe,
            idealFor: reg.idealFor,
          });
        } catch (err) {
          this.logger.warn(`Protocol ${protocolId} failed for ${ticker}: ${(err as Error).message}`);
          protocolScores.push({
            protocolId,
            name: reg.name,
            description: reg.description,
            score: 0,
            signal: 'HOLD',
            hardGated: true,
            warnings: ['Protocol scoring failed'],
            tradingStyle: reg.tradingStyle,
            timeframe: reg.recommendedTimeframe,
            idealFor: reg.idealFor,
          });
        }
      }

      if (protocolScores.length === 0) continue;

      // Consensus analysis
      const scores = protocolScores.map((p) => p.score).filter((s) => s > 0);
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const variance = scores.length > 1
        ? scores.reduce((sum, s) => sum + (s - avg) ** 2, 0) / scores.length
        : 0;
      const divergence = Math.round(Math.sqrt(variance) * 10) / 10; // standard deviation as divergence

      const buyCount = protocolScores.filter((p) => p.signal === 'BUY').length;
      const sellCount = protocolScores.filter((p) => p.signal === 'SELL').length;
      const total = protocolScores.length;

      let consensus: typeof comparison[0]['consensus'] = 'mixed';
      if (buyCount >= total * 0.75) consensus = 'strong_buy';
      else if (buyCount >= total * 0.5) consensus = 'buy';
      else if (sellCount >= total * 0.75) consensus = 'strong_sell';
      else if (sellCount >= total * 0.5) consensus = 'sell';

      const best = protocolScores.reduce((best, p) => p.score > (best?.score ?? -1) ? p : best, null as any);

      comparison.push({
        symbol: ticker,
        protocolScores,
        consensus,
        divergence,
        bestProtocol: best?.protocolId || null,
      });
    }

    // Sort: highest avg score first
    comparison.sort((a, b) => {
      const aAvg = a.protocolScores.reduce((s, p) => s + p.score, 0) / a.protocolScores.length;
      const bAvg = b.protocolScores.reduce((s, p) => s + p.score, 0) / b.protocolScores.length;
      return bAvg - aAvg;
    });

    return {
      protocols: Object.fromEntries(
        protocolIds.map((id) => [
          id,
          {
            name: PROTOCOL_REGISTRY[id]?.name || id,
            description: PROTOCOL_REGISTRY[id]?.description || '',
            tradingStyle: PROTOCOL_REGISTRY[id]?.tradingStyle,
            recommendedTimeframe: PROTOCOL_REGISTRY[id]?.recommendedTimeframe,
            idealFor: PROTOCOL_REGISTRY[id]?.idealFor,
          },
        ]),
      ),
      comparison,
    };
  }
}
