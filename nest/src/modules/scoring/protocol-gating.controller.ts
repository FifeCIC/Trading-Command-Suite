import { Controller, Get, Param, Logger, Query } from '@nestjs/common';
import { ProtocolGatingService, GatedScore } from './protocol-gating.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';
import { PROTOCOL_REGISTRY } from '../directives/directive-groups';

@Controller('scoring/gated')
export class ProtocolGatingController {
  private readonly logger = new Logger(ProtocolGatingController.name);

  constructor(
    private readonly protocolGating: ProtocolGatingService,
    private readonly marketData: MarketDataService,
    private readonly portfolio: PortfolioService,
    private readonly prisma: PrismaService,
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
      avgHoldTime?: string;
      winRateTarget?: string;
      idealFor?: string;
    }> = [];

    // Code-registered protocols (from directive-groups.ts)
    for (const [id, proto] of Object.entries(PROTOCOL_REGISTRY)) {
      const groups = proto.groups.map((g) => ({
        id: g.id,
        name: g.name,
        isRiskGate: g.isRiskGate,
        weight: g.weight,
        minMultiplier: g.isRiskGate ? g.minMultiplier : undefined,
        maxMultiplier: g.isRiskGate ? g.maxMultiplier : undefined,
        directives: g.directiveIds.map((did) => ({
          id: did,
          maxScore: (g as any).directiveMaxScores?.[did] ?? 100,
        })),
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
    } catch {
      // DB might not be available — skip
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
        riskMultiplier: 0.5,
        breakouts: {},
        gatingActive: false,
        meta: {
          additiveEquivalent: 50,
          gatingDelta: 0,
          directiveCount: 0,
          gatedCount: 0,
          riskDirectiveCount: 0,
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
        const bars = sym
          ? await this.marketData.getBars(sym.id, '1d', 100)
          : [];
        return { symbol: p.symbol, bars: bars || [] };
      }),
    );

    return this.protocolGating.scorePortfolio(holdings);
  }
}
