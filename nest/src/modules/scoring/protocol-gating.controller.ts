import { Controller, Get, Post, Param, Body, Logger, Query } from '@nestjs/common';
import { ProtocolGatingService, GatedScore } from './protocol-gating.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ProtocolDbService } from './protocol-db.service';
import { DirectivesService } from '../directives/directives.service';

@Controller('scoring/gated')
export class ProtocolGatingController {
  private readonly logger = new Logger(ProtocolGatingController.name);

  constructor(
    private readonly protocolGating: ProtocolGatingService,
    private readonly marketData: MarketDataService,
    private readonly portfolio: PortfolioService,
    private readonly prisma: PrismaService,
    private readonly protocolDb: ProtocolDbService,
    private readonly directivesService: DirectivesService,
  ) {}

  /**
   * GET /api/scoring/gated/protocols
   *
   * Lists all available protocols from code registry + DB strategies.
   */
  @Get('protocols')
  async listProtocols() {
    const protocols: Array<{
      id: string;
      name: string;
      description: string;
      source: 'code' | 'database';
      directiveCount: number;
      maxScore: number;
      active: boolean;
      groups?: Array<{
        id: string;
        name: string;
        isRiskGate: boolean;
        weight: number;
        directives: Array<{ id: string; maxScore: number }>;
      }>;
      tradingStyle?: string;
      recommendedTimeframe?: string;
      directionMode?: string;
      avgHoldTime?: string;
      winRateTarget?: string;
      idealFor?: string;
    }> = [];

    // Code-registered protocols (from DB-backed ProtocolDbService)
    const allProtocols = this.protocolDb.getAllCached();
    for (const [id, proto] of Object.entries(allProtocols)) {
      const groups = proto.groups.map((g) => ({
        id: g.id,
        name: g.name,
        isRiskGate: g.isRiskGate,
        weight: g.weight,
        minMultiplier: g.isRiskGate ? g.minMultiplier : undefined,
        maxMultiplier: g.isRiskGate ? g.maxMultiplier : undefined,
        directives: g.directiveIds.map((did) => {
          const reg = this.directivesService.get(did);
          return {
            id: did,
            name: reg?.name ?? did,
            description: reg?.description ?? '',
            maxScore: (g as any).directiveMaxScores?.[did] ?? 100,
          };
        }),
      }));

      const maxScore = proto.groups.reduce(
        (sum, g) => sum + g.directiveIds.reduce(
          (s, did) => s + ((g as any).directiveMaxScores?.[did] ?? 100), 0,
        ), 0,
      );

      protocols.push({
        id,
        name: proto.name,
        description: proto.description,
        source: 'code',
        directiveCount: proto.groups.reduce((s, g) => s + g.directiveIds.length, 0),
        maxScore,
        active: true,
        groups,
        tradingStyle: (proto as any).tradingStyle,
        recommendedTimeframe: (proto as any).recommendedTimeframe,
        directionMode: (proto as any).directionMode || 'LONG_ONLY',
        avgHoldTime: (proto as any).avgHoldTime,
        winRateTarget: (proto as any).winRateTarget,
        idealFor: (proto as any).idealFor,
      });
    }

    // DB strategies (from Strategy table)
    try {
      const dbStrategies = await this.prisma.strategy.findMany({
        where: { active: true },
        include: { directives: { where: { active: true }, select: { id: true, weight: true } } },
      });
      for (const s of dbStrategies) {
        /**
         * IMPORTANT: Merge, don't push. The same protocol appears in both the
         * code registry (via ProtocolDbService.getAllCached()) and the DB
         * (strategy table). Before this fix, DB entries were pushed as
         * duplicates, causing duplicate React keys and double-counted
         * protocols in the frontend (ProtocolsPage, CreateStrategyPage).
         *
         * Merge strategy: if the DB row has the same id as a code-registry
         * entry, overlay `active` and mark `source: 'database'`. Otherwise,
         * it's a truly new DB-only strategy — push normally.
         *
         * See 2026-07-25-console-warnings-fixed.md handoff for full context.
         */
        const existing = protocols.find(p => p.id === s.id);
        if (existing) {
          // DB row overrides active status; keep richer code metadata
          existing.active = s.active;
          existing.source = 'database';
        } else {
          protocols.push({
            id: s.id,
            name: s.name,
            description: s.description ?? '',
            source: 'database',
            directiveCount: s.directives.length,
            maxScore: s.directives.reduce((sum, d) => sum + (d.weight * 100), 0),
            active: s.active,
          });
        }
      }
    } catch {
      // DB might not be available — skip
    }

    // ── Enrich with linkage data ──
    try {
      const scoringStrategies = await this.prisma.scoringStrategy.findMany({
        where: { enabled: true },
        select: { id: true, name: true, protocolId: true, watchlistName: true, tradingEnabled: true },
      });

      // Build lookup maps
      const strategiesByProtocol: Record<string, Array<{ id: string; name: string; watchlist: string; trading: boolean }>> = {};
      const watchlistsByProtocol: Record<string, Set<string>> = {};

      for (const ss of scoringStrategies) {
        const pid = ss.protocolId;
        if (!strategiesByProtocol[pid]) strategiesByProtocol[pid] = [];
        strategiesByProtocol[pid].push({ id: ss.id, name: ss.name, watchlist: ss.watchlistName, trading: ss.tradingEnabled });

        if (!watchlistsByProtocol[pid]) watchlistsByProtocol[pid] = new Set();
        if (ss.watchlistName) watchlistsByProtocol[pid].add(ss.watchlistName);
      }

      // Attach to each protocol
      for (const proto of protocols) {
        const linkedStrategies = strategiesByProtocol[proto.id] || [];
        const linkedWatchlists = watchlistsByProtocol[proto.id]
          ? [...watchlistsByProtocol[proto.id]]
          : [];

        (proto as any).linkedWatchlists = linkedWatchlists;
        (proto as any).linkedStrategies = linkedStrategies;
        (proto as any).connectionCount = linkedStrategies.length;
        (proto as any).isFullyConnected = linkedStrategies.length > 0 && linkedStrategies.some(s => s.trading);
      }
    } catch {
      // Enrichment is best-effort
    }

    return { protocols, count: protocols.length };
  }

  /**
   * GET /api/scoring/gated/:symbol
   *
   * Returns a multiplicatively-gated score for a single symbol.
   * Risk directives multiplicatively gate Technical + Sentiment scores.
   *
   * Query params:
   *   ?timeframe=1d   (default: 1d)
   *   ?bars=100        (default: 100)
   *   ?protocol=btc-speed-v1  (optional — selects protocol groups)
   */
  @Get(':symbol')
  async getGatedScore(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe = '1d',
    @Query('bars') bars = '100',
    @Query('protocol') protocol?: string,
  ): Promise<GatedScore> {
    const ticker = symbol.toUpperCase();

    // Look up symbol in DB to get the internal ID
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker },
    });

    const marketBars = sym
      ? await this.marketData.getBars(sym.id, timeframe, parseInt(bars, 10))
      : [];

    if (!marketBars || marketBars.length === 0) {
      this.logger.warn(`No market data for ${ticker}`);
      return {
        symbol: ticker,
        composite: 50,
        signal: 'HOLD',
        subScores: { technical: 50, sentiment: 50, risk: 50 },
        subRawTotals: {},
        subMaxTotals: {},
        riskMultiplier: 0.5,
        breakouts: {},
        gatingActive: false,
        meta: {
          additiveEquivalent: 50,
          gatingDelta: 0,
          directiveCount: 0,
          gatedCount: 0,
          riskDirectiveCount: 0,
          weightStrategy: 'group-weighted' as const,
        },
      };
    }

    return this.protocolGating.scoreWithGating(ticker, marketBars, protocol);
  }

  /**
   * GET /api/scoring/gated/portfolio
   *
   * Returns multiplicatively-gated scores for all portfolio positions.
   */
  @Get('portfolio')
  async getPortfolioGated(): Promise<GatedScore[]> {
    const portfolioData = await this.portfolio.getPortfolio();
    const positions = portfolioData?.positions ?? [];
    if (positions.length === 0) {
      return [];
    }

    const holdings = await Promise.all(
      positions.map(async (p) => {
        const sym = await this.prisma.symbol.findFirst({
          where: { ticker: p.symbol },
        });
        // Use built-in-default protocol's bar requirements for portfolio scoring
        const requiredBars = this.protocolDb.getRequiredBars('built-in-default');
        const bars = sym
          ? await this.marketData.getBars(sym.id, '1d', requiredBars['1d'] || 200)
          : [];
        return { symbol: p.symbol, bars: bars || [] };
      }),
    );

    return this.protocolGating.scorePortfolio(holdings);
  }

  /**
   * POST /api/scoring/gated/protocols/seed
   * Seed all hardcoded protocols into the DB. Idempotent.
   * Epic #510 Phase 3 — DB-Driven Architecture.
   */
  @Post('protocols/seed')
  async seedProtocols() {
    return this.protocolDb.seedProtocolsToDatabase();
  }

  /**
   * POST /api/scoring/gated/batch
   *
   * Score a list of tickers through the gated scoring pipeline (with rarity).
   * Body: { tickers: string[], protocolId?: string }
   */
  @Post('batch')
  async getBatchGated(@Body() body: { tickers: string[]; protocolId?: string }): Promise<GatedScore[]> {
    if (!body.tickers?.length) return [];

    const protocolBars = body.protocolId
      ? this.protocolDb.getRequiredBars(body.protocolId)
      : { '1d': 200 };
    const holdings = await Promise.all(
      body.tickers.map(async (ticker) => {
        const sym = await this.prisma.symbol.findFirst({
          where: { ticker: ticker.toUpperCase() },
        });
        const bars = sym
          ? await this.marketData.getBars(sym.id, '1d', protocolBars['1d'] || 200)
          : [];
        return { symbol: ticker.toUpperCase(), bars: bars || [] };
      }),
    );

    return this.protocolGating.scorePortfolio(holdings, body.protocolId);
  }
}
