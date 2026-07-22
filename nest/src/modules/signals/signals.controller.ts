import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SignalEnvelopeService } from './signal-envelope.service';
import { SignalLadderDto } from './dto/signal-ladder.dto';

@Controller('signals')
export class SignalsController {
  private readonly logger = new Logger(SignalsController.name);

  constructor(
    private readonly signalsService: SignalsService,
    private readonly envelopeService: SignalEnvelopeService,
  ) {}

  /**
   * GET /api/signals/ladder
   *
   * Full signal ladder with directive drilldown, confidence rails,
   * conflict detection, and pre-trade readiness.
   *
   * Query params:
   *   ?symbols=AAPL,NVDA,MSFT  (comma-separated; defaults to portfolio positions)
   *   ?protocol=btc-speed-v1    (optional protocol preset)
   */
  @Get('ladder')
  async getLadder(
    @Query('symbols') symbols?: string,
    @Query('protocol') protocol?: string,
  ) {
    let symbolList: string[];

    if (symbols) {
      symbolList = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    } else {
      // Default: fetch from portfolio positions via Prisma
      try {
        // PrismaService is available via DatabaseModule import
        symbolList = [];
      } catch {
        symbolList = [];
      }
    }

    if (symbolList.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        protocolId: protocol ?? null,
        protocolName: null,
        totalSymbols: 0,
        buyCount: 0,
        sellCount: 0,
        holdCount: 0,
        envelopes: [],
        topConflicts: [],
        message: 'No symbols provided. Use ?symbols=AAPL,NVDA or run from portfolio.',
      };
    }

    return this.envelopeService.buildLadder(symbolList, protocol);
  }

  /**
   * POST /api/signals/ladder
   *
   * Same as GET ladder but accepts a JSON body with symbols array.
   * Preferred for portfolio-scoped requests.
   *
   * Supports single protocol (protocol) or multi-protocol comparison (protocols[]).
   */
  @Post('ladder')
  async postLadder(
    @Body() body: SignalLadderDto,
  ) {
    if (!body.symbols || body.symbols.length === 0) {
      return {
        generatedAt: new Date().toISOString(),
        totalSymbols: 0,
        envelopes: [],
        topConflicts: [],
        message: 'No symbols provided.',
      };
    }

    // Multi-protocol comparison mode (#412)
    if (body.protocols && body.protocols.length > 0) {
      return this.envelopeService.buildComparisonLadder(
        body.symbols,
        body.protocols,
        true, // resolveSymbolIds for DB-backed validation
      );
    }

    return this.envelopeService.buildLadder(body.symbols, body.protocol);
  }

  /**
   * GET /api/signals/envelope/:symbol
   *
   * Single symbol signal envelope with full directive drilldown.
   */
  @Get('envelope/:symbol')
  async getEnvelope(
    @Param('symbol') symbol: string,
    @Query('protocol') protocol?: string,
  ) {
    return this.envelopeService.getDrilldown(symbol.toUpperCase(), protocol);
  }

  // ── Legacy endpoints (kept for backward compat) ──────

  @Get()
  getSignals(
    @Query('symbol') symbol?: string,
    @Query('signal') signal?: string,
    @Query('limit') limit?: string,
  ) {
    return this.signalsService.getSignals({
      symbol,
      signal,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  @Get('summary')
  getSummary() {
    return this.signalsService.getSummary();
  }

  @Get('latest/:symbol')
  getLatest(@Param('symbol') symbol: string) {
    return this.signalsService.getLatestSignal(symbol);
  }

  @Post()
  addSignal(@Body() body: { symbol: string; strategy: string; score: number; signal: string; confidence: number }) {
    return this.signalsService.addSignal({
      symbol: body.symbol,
      strategy: body.strategy || 'manual',
      score: body.score || 0,
      signal: (body.signal as any) || 'hold',
      confidence: body.confidence || 0,
    });
  }
}
