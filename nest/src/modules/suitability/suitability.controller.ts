import { Body, Controller, Get, Logger, Param, Post, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EvaluateSuitabilityDto } from './dto/evaluate-suitability.dto';
import { SuitabilityService, SuitabilityVerdict } from './suitability.service';
// #1051 — the ONE reader of DIRECTIVE_SUITABILITY. The registry declared instrumentTypes for 109
// directives and was imported by NOTHING; this makes the declaration live as a REPORT, deliberately
// not as a gate (that is a maths change and needs a copied configuration).
import { auditSuitability, registryCoverage } from '../directives/directive-suitability';

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

  /**
   * GET /api/suitability/directive-instrument-audit
   *
   * The blast radius of turning `DIRECTIVE_SUITABILITY.instrumentTypes` into a gate (#1051).
   *
   * ⚠️ WHY THIS IS READ-ONLY. The registry declared `instrumentTypes` for 109 directives and its own
   * header said activation gates used it — measured 2026-10-01, **it was imported by nothing**. Making
   * it fire CHANGES WHAT A SCORED SYMBOL SCORES, so it is a maths change: the owner's rule requires a
   * COPIED configuration and a comparison, never an in-place edit. Measured blast radius: **111**
   * pairs, of which **75 are `forex-session-v1`** — four directive slots would leave the flagship
   * forex protocol. The rule reads correctly and could over-reject catastrophically; only measurement
   * tells the two apart.
   *
   * ⚠️ DECLARED BEFORE `@Get(':ticker')` deliberately — a catch-all registered first shadows this
   * route, and the failure is a silent 200 with a ticker-shaped body, not a 404.
   */
  @Get('directive-instrument-audit')
  async directiveInstrumentAudit() {
    try {
      const placements = await (this.prisma as any).$queryRawUnsafe(`
        SELECT p.slug AS protocolSlug, p.id AS protocolId, e.directiveId AS directiveId
        FROM protocol p
        JOIN protocol_directive_group g ON g.protocolId = p.id
        JOIN protocol_directive_entry e ON e.groupId = g.id
        WHERE p.active = 1`);
      const symbols = await (this.prisma as any).$queryRawUnsafe(`
        SELECT p.id AS protocolId, s.ticker AS ticker, s.type AS sType
        FROM protocol p
        JOIN symbol_protocol_assignment a ON a.protocolId = p.id
        JOIN symbol s ON s.ticker = a.symbol
        WHERE p.active = 1`);

      const audit = auditSuitability(
        placements.map((r: any) => ({ protocolSlug: r.protocolSlug, protocolId: r.protocolId, directiveId: r.directiveId })),
        symbols.map((r: any) => ({ protocolId: r.protocolId, ticker: r.ticker, type: r.sType })),
      );

      return {
        generatedAt: new Date().toISOString(),
        enforced: false,
        enforcementNote:
          'READ-ONLY. Wiring instrumentTypes into a gate changes what a scored symbol scores, so it ' +
          'needs a COPIED configuration and a comparison (maths-change-requires-ab). This endpoint ' +
          'reports the blast radius that decision rests on; it does not apply it.',
        registry: registryCoverage(),
        ...audit,
      };
    } catch (err) {
      // ⚠️ ERROR is not "nothing to report". An empty audit and a failed query must never look alike.
      this.logger.warn(`directive-instrument-audit failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        `Could not read the protocol/directive/symbol tables: ${(err as Error).message}. ` +
        'This is a FAILED READ, not an empty result.',
      );
    }
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
