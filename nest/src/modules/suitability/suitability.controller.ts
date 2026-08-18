import { Body, Controller, Get, Logger, Param, Post } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvaluateSuitabilityDto } from './dto/evaluate-suitability.dto';
import { SuitabilityService, SuitabilityVerdict } from './suitability.service';

/**
 * SuitabilityController — static protocol/symbol metadata join (#646).
 * Routes:
 *   GET  /api/suitability/:ticker       — evaluate one ticker against all active protocols
 *   POST /api/suitability/evaluate      — evaluate with explicit type/shortable overrides
 */
@Controller('suitability')
export class SuitabilityController {
  private readonly logger = new Logger(SuitabilityController.name);

  constructor(
    private readonly suitability: SuitabilityService,
    private readonly prisma: PrismaService,
  ) {}

  /** Load active protocols' metadata — only static fields, no directives. */
  private async loadProtocols(): Promise<any[]> {
    try {
      return await (this.prisma as any).protocol.findMany({
        where: { active: true },
        select: { slug: true, name: true, directionMode: true, tradingStyle: true, recommendedTimeframe: true },
      });
    } catch (err) {
      this.logger.warn(`Failed to load protocols: ${(err as Error).message}`);
      return [];
    }
  }

  /** Build a symbol descriptor: DB metadata when present, overrides take precedence. */
  private async buildSymbolDescriptor(
    ticker: string,
    override?: { type?: string; shortable?: boolean },
  ): Promise<{ ticker: string; type?: string; shortable?: boolean }> {
    const upper = ticker.trim().toUpperCase();
    let dbType: string | undefined;
    let tags: unknown;
    try {
      const s = await (this.prisma as any).symbol.findFirst({
        where: { ticker: upper },
        select: { type: true, tags: true },
      });
      if (s) {
        dbType = s.type;
        tags = s.tags;
      }
    } catch {
      /* DB unavailable — symbol metadata stays unknown */
    }

    const type = override?.type ?? dbType;
    const shortable = override?.shortable ?? this.suitability.deriveShortable(type, tags);
    return { ticker: upper, type, shortable };
  }

  private async run(symbol: { ticker: string; type?: string; shortable?: boolean }) {
    const protocols = await this.loadProtocols();
    const descriptors = protocols.map((p) => ({
      slug: p.slug,
      name: p.name,
      directionMode: p.directionMode,
      tradingStyle: p.tradingStyle,
      recommendedTimeframe: p.recommendedTimeframe,
      symbolTypes: this.suitability.inferProtocolSymbolTypes({
        slug: p.slug,
        name: p.name,
        tradingStyle: p.tradingStyle,
      }),
    }));

    const verdicts: SuitabilityVerdict[] = this.suitability.evaluateAll(symbol, descriptors);

    return {
      ticker: symbol.ticker,
      symbol: { type: symbol.type ?? null, shortable: symbol.shortable ?? null },
      fitsCount: verdicts.filter((v) => v.fits).length,
      total: verdicts.length,
      protocols: verdicts,
    };
  }

  @Get(':ticker')
  async evaluateTicker(@Param('ticker') ticker: string) {
    const symbol = await this.buildSymbolDescriptor(ticker);
    return this.run(symbol);
  }

  @Post('evaluate')
  async evaluate(@Body() body: EvaluateSuitabilityDto) {
    const symbol = await this.buildSymbolDescriptor(body.ticker, {
      type: body.type,
      shortable: body.shortable,
    });
    return this.run(symbol);
  }
}
