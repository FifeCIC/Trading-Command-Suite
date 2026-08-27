import { Controller, Get, Post, Body, Param, Query, Logger } from '@nestjs/common';
import { SignalsService } from './signals.service';
import { SignalEnvelopeService } from './signal-envelope.service';
import { SignalActionsService } from './signal-actions.service';
import { SignalLadderDto } from './dto/signal-ladder.dto';
import { ManualTradeDto } from './dto/manual-trade.dto';
import { DismissSignalDto } from './dto/dismiss-signal.dto';
import { SignalPlanDto } from './dto/signal-plan.dto';

/**
 * Signals Controller — Enriched Signal Envelopes
 * ===============================================
 * CANONICAL ROLE (2026-07-29): Signal quality assessment with
 * confidence rails, conflict detection, and pre-trade readiness.
 *
 * This is a LAYER ON TOP of protocol-gated scoring. It takes the
 * raw scores from the gating pipeline and enriches them with:
 *   - Confidence intervals (score stability over time)
 *   - Conflict detection (bullish vs bearish directive disagreement)
 *   - Pre-trade readiness checks (data freshness, bar sufficiency)
 *
 * Distinct from /api/scoring/gated/batch because it adds the
 * "should I trust this signal?" layer that raw scoring doesn't provide.
 *
 * Use for:
 *   - Signals Workbench (quality assessment)
 *   - Component Lab (envelope visualization)
 *
 * Internally delegates to ProtocolGatingService for base scoring,
 * then wraps results with confidence/conflict metadata.
 *
 * @see docs/handoff/2026-07-29-scoring-paths-audit-497.md
 */

@Controller('signals')
export class SignalsController {
  private readonly logger = new Logger(SignalsController.name);

  constructor(
    private readonly signalsService: SignalsService,
    private readonly envelopeService: SignalEnvelopeService,
    private readonly signalActions: SignalActionsService,
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

  /**
   * GET /api/signals/best (#684)
   *
   * The Signals v1 view — every active protocol scored, one card per symbol
   * per direction (best protocol wins), action-only (no HOLD), dismissed
   * signals filtered, ranked by combined strength (signal + opportunity).
   */
  @Get('best')
  async getBest() {
    return this.envelopeService.buildBestLadder();
  }

  /**
   * GET /api/signals/analytics (#693)
   *
   * Non-executive feedback-loop observability: dismissal analytics, forward
   * outcomes correlated against real trades, and rank validation.
   */
  @Get('analytics')
  async getAnalytics() {
    return this.envelopeService.getAnalytics();
  }

  /**
   * GET /api/signals/dismissals (#684)
   *
   * Active dismissals — powers the "show dismissed" toggle.
   */
  @Get('dismissals')
  async getDismissals() {
    return this.envelopeService.getDismissals();
  }

  /**
   * POST /api/signals/dismiss (#684)
   *
   * Hide a signal for N hours (default 1). Keyed on symbol + protocolId.
   * Strength fields are stored for the #693 feedback loop.
   */
  @Post('dismiss')
  async dismiss(@Body() body: DismissSignalDto) {
    return this.envelopeService.dismissSignal(
      body.symbol,
      body.protocolId,
      body.hours ?? 1,
      {
        combinedStrength: body.combinedStrength,
        signalPct: body.signalPct,
        opportunityPct: body.opportunityPct,
      },
    );
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

  /**
   * GET /api/signals/:id/action
   *
   * Bot-action state for a signal: none | pending | filled.
   * The signal id is the Score row UUID (the runs API exposes it as runId).
   */
  @Get(':id/action')
  async getSignalAction(@Param('id') id: string) {
    return this.signalActions.getBotAction(id);
  }

  /**
   * POST /api/signals/:id/trade
   *
   * Place a MANUAL trade for a signal through the same safety chain the bot
   * uses (duplicate guard, diversification, cooldown, market-status gate).
   */
  @Post(':id/trade')
  async tradeSignal(@Param('id') id: string, @Body() body: ManualTradeDto) {
    return this.signalActions.placeManualTrade(id, body);
  }

  /**
   * POST /api/signals/:id/plan (#702)
   *
   * Signals → Trading handover: queue the signal into the Trading area as a
   * draft trading plan carrying the signal context (direction, protocol,
   * combined strength, top drivers).
   */
  @Post(':id/plan')
  async planSignal(@Param('id') id: string, @Body() body: SignalPlanDto) {
    return this.signalActions.createSignalPlan(id, body);
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
