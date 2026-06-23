import { Controller, Get, Param, Logger, Query } from '@nestjs/common';
import { ProtocolGatingService, GatedScore } from './protocol-gating.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketDataService } from '../market-data/market-data.service';
import { PortfolioService } from '../portfolio/portfolio.service';

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
   * GET /api/scoring/gated/:symbol
   *
   * Returns a multiplicatively-gated score for a single symbol.
   * Risk directives multiplicatively gate Technical + Sentiment scores.
   *
   * Query params:
   *   ?timeframe=1d   (default: 1d)
   *   ?bars=100        (default: 100)
   */
  @Get(':symbol')
  async getGatedScore(
    @Param('symbol') symbol: string,
    @Query('timeframe') timeframe = '1d',
    @Query('bars') bars = '100',
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

    return this.protocolGating.scoreWithGating(ticker, marketBars);
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
