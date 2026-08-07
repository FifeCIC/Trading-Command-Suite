import { Controller, Get, Post, Patch, Param, Body, Logger, Query } from '@nestjs/common';
import { ProtocolGatingService, GatedScore } from './protocol-gating.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { ProtocolDbService } from './protocol-db.service';
import { DirectivesService } from '../directives/directives.service';

/**
 * Protocol Gating Controller — META.Stack Canonical Scoring
 * ==========================================================
 * CANONICAL ROLE (2026-07-29): The authoritative scoring path for
 * trading decisions. This is the META.Stack pipeline:
 *
 *   Market Data → Protocol → Directives → Group Scores → Risk Gate → Composite
 *
 * Unlike /api/scoring/ranked (which runs ALL 104 directives flat),
 * this pipeline:
 *   1. Scopes to a single protocol (~8-16 directives instead of 104)
 *   2. Applies risk-gate chains (max score multipliers)
 *   3. Computes rarity-weighted composites
 *   4. Excludes ALPHA-tier (mock) directives
 *   5. Returns full directive breakouts with gate reasoning
 *
 * Use for:
 *   - Ladder page (strategy comparison)
 *   - A/B Testing (protocol comparison)
 *   - META.Stack Explorer (pipeline visualization)
 *   - Speed Trading (protocol-scoped quick decisions)
 *   - Automation loop (tick scoring)
 *
 * ~7× cheaper than unfiltered rankAll due to protocol scoping.
 *
 * @see docs/handoff/2026-07-29-scoring-paths-audit-497.md
 */

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
      derivedFrom?: string | null;
      directionMode?: string;
      avgHoldTime?: string;
      winRateTarget?: string;
      idealFor?: string;
    }> = [];

    // Code-registered protocols (from DB-backed ProtocolDbService)
    const allProtocols = this.protocolDb.getAllCached();
    for (const [id, proto] of Object.entries(allProtocols)) {
      // Skip protocols with no directive groups — these are ghost entries
      // from legacy seed data (e.g. "Signals Workbench", "Conviction Dip Accumulation")
      if (!proto.groups?.length) continue;

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
        source: 'database',
        directiveCount: proto.groups.reduce((s, g) => s + g.directiveIds.length, 0),
        maxScore,
        active: proto.active !== false, // Respect DB value set by toggle endpoint
        groups,
        tradingStyle: (proto as any).tradingStyle,
        recommendedTimeframe: (proto as any).recommendedTimeframe,
        derivedFrom: (proto as any).derivedFrom ?? null,
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
          // Overlay: mark code-registry protocol as having a DB presence.
          // Do NOT create new protocol entries from strategy records —
          // strategies are not protocols and the code registry is the
          // single source of truth for protocol definitions.
          existing.source = 'database';
        }
        // else: this DB strategy has no matching code-registry protocol.
        // Skip it — strategies ≠ protocols. These are legacy entries from
        // the WordPress plugin era (names like "Signals Workbench → xau-speed-v1").
      }
    } catch {
      // DB might not be available — skip
    }

    // ── Enrich with linkage data ──
    try {
      const scoringStrategies = await this.prisma.scoringStrategy.findMany({
        where: { enabled: true },
        select: { id: true, name: true, protocolId: true, shortProtocolId: true, watchlistName: true, tradingEnabled: true },
      });

      // Build lookup maps
      const protocolsById = new Map(protocols.map(p => [p.id, p]));
      const strategiesByProtocol: Record<string, Array<{ id: string; name: string; watchlist: string; trading: boolean; shortProtocolId?: string; shortProtocolName?: string }>> = {};
      const watchlistsByProtocol: Record<string, Set<string>> = {};

      for (const ss of scoringStrategies) {
        const pid = ss.protocolId;
        if (!strategiesByProtocol[pid]) strategiesByProtocol[pid] = [];
        strategiesByProtocol[pid].push({
          id: ss.id,
          name: ss.name,
          watchlist: ss.watchlistName,
          trading: ss.tradingEnabled,
          shortProtocolId: ss.shortProtocolId || undefined,
          shortProtocolName: ss.shortProtocolId ? protocolsById.get(ss.shortProtocolId)?.name || ss.shortProtocolId : undefined,
        });

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
          readinessBreakdown: { ready: 0, beta: 0, alpha: 0, alphaExcluded: 0 },
        },
        excludedBreakdown: [],
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

  /**
   * PATCH /api/scoring/gated/protocols/:id/toggle
   * Toggle a protocol's active status. Updates DB if protocol exists there,
   * otherwise stores an in-memory override. Returns the new active state.
   */
  @Patch('protocols/:id/toggle')
  async toggleProtocol(@Param('id') id: string): Promise<{ id: string; active: boolean }> {
    let newActive = false;
    try {
      // Use raw SQL — Prisma client may not have 'active' field yet (added via SQL migration)
      const existing: any[] = await (this.prisma as any).$queryRawUnsafe(
        `SELECT active FROM protocol WHERE slug = ? LIMIT 1`, id,
      );
      if (existing?.length > 0) {
        newActive = !existing[0].active;
        await (this.prisma as any).$executeRawUnsafe(
          `UPDATE protocol SET active = ? WHERE slug = ?`, newActive ? 1 : 0, id,
        );
      } else {
        // Try strategy table
        const strat = await this.prisma.strategy.findUnique({ where: { id } });
        if (strat) {
          newActive = !strat.active;
          await this.prisma.strategy.update({ where: { id }, data: { active: newActive } });
        }
      }
      // Reload protocol cache
      await this.protocolDb.preloadAll();
      this.logger.log(`Protocol ${id} toggled to ${newActive ? 'active' : 'inactive'}`);
    } catch (err) {
      this.logger.error(`Failed to toggle protocol ${id}: ${(err as Error).message}`);
      throw err;
    }
    return { id, active: newActive };
  }

  /**
   * GET /api/scoring/gated/protocols/:id/symbols
   * Returns the symbols a protocol scores (single-symbol or watchlist-derived).
   */
  @Get('protocols/:id/symbols')
  async getProtocolSymbols(@Param('id') id: string): Promise<{ protocolId: string; symbols: string[]; resolution: string }> {
    const symbols = await this.protocolDb.resolveSymbols(id);
    // Determine which path resolved
    let resolution = 'derived';
    try {
      const assignments = await (this.prisma as any).symbolProtocolAssignment.findMany({ where: { protocolId: id } });
      if (assignments?.length > 0) resolution = 'db:assignment';
      else {
        const wl = await (this.prisma as any).watchlist.findFirst({ where: { protocolId: id } });
        if (wl) resolution = 'db:watchlist';
      }
    } catch { /* table may not exist */ }
    return { protocolId: id, symbols, resolution };
  }
}
