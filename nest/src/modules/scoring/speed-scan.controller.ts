/**
 * SpeedScanController — endpoint for the Speed Trading "Best Symbol" scanner.
 *
 * POST /api/speed/scan
 */
import { Controller, Post, Get, Param, Body, Logger, NotFoundException } from '@nestjs/common';
import { IsOptional, IsArray, IsString } from 'class-validator';
import { SpeedScanService } from './speed-scan.service';
import { Mt5Adapter } from '../providers/adapters/mt5.adapter';
import { TickRecorderService } from './tick-recorder.service';
import { PrismaService } from '../../database/prisma.service';
import { ProtocolDbService } from './protocol-db.service';

class ScanRequestDto {
  @IsOptional() @IsArray() @IsString({ each: true }) symbols?: string[];
  @IsOptional() @IsString() timeframe?: string;
}

@Controller('speed')
export class SpeedScanController {
  private readonly logger = new Logger(SpeedScanController.name);

  constructor(
    private readonly speedScan: SpeedScanService,
    private readonly mt5: Mt5Adapter,
    private readonly recorder: TickRecorderService,
    private readonly prisma: PrismaService,
    private readonly protocolDb: ProtocolDbService,
  ) {}

  @Post('scan')
  async scan(@Body() body: ScanRequestDto) {
    return this.speedScan.scan(body.symbols, body.timeframe);
  }

  /** GET /api/speed/quote/:symbol — live bid/ask from MT5 */
  @Get('quote/:symbol')
  async getQuote(@Param('symbol') symbol: string) {
    try {
      const quote = await this.mt5.getQuote(symbol.toUpperCase());
      if (!quote || quote.bid == null) {
        return { symbol: symbol.toUpperCase(), bid: null, ask: null, mid: null, error: 'No quote available' };
      }
      const bid = quote.bid ?? 0;
      const ask = quote.ask ?? 0;
      return {
        symbol: symbol.toUpperCase(),
        bid,
        ask,
        mid: bid && ask ? +((bid + ask) / 2).toFixed(5) : null,
        spread: bid && ask ? +(ask - bid).toFixed(5) : null,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      this.logger.warn(`Quote failed for ${symbol}: ${err.message}`);
      return { symbol: symbol.toUpperCase(), bid: null, ask: null, mid: null, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════
  //  Tick Recorder — 5S candle capture
  // ═══════════════════════════════════════════════════════

  @Post('record/start')
  async startRecording(@Body() body: { symbol: string }) {
    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: body.symbol.toUpperCase() },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${body.symbol} not found`);
    return this.recorder.startRecording(symbol.id, symbol.ticker);
  }

  @Post('record/stop')
  async stopRecording(@Body() body: { symbol: string }) {
    const symbol = await this.prisma.symbol.findFirst({
      where: { ticker: body.symbol.toUpperCase() },
    });
    if (!symbol) throw new NotFoundException(`Symbol ${body.symbol} not found`);
    return this.recorder.stopRecording(symbol.id) ?? { error: 'No active recording' };
  }

  @Get('record/active')
  getActiveRecordings() {
    return { recordings: this.recorder.getActiveRecordings() };
  }

  @Get('record/sessions/:symbol')
  async getSessions(@Param('symbol') symbol: string) {
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: symbol.toUpperCase() },
    });
    if (!sym) throw new NotFoundException(`Symbol ${symbol} not found`);
    return { sessions: await this.recorder.getSessions(sym.id) };
  }

  // ═══════════════════════════════════════════════════════
  //  Route-to-Trade — scan result → execution
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/speed/trade
   *
   * Unified trade endpoint for Speed Scanner route-to-trade.
   * Mode determines behaviour:
   *   quick-trade — returns order payload for UI confirmation
   *   one-click   — executes immediately
   *   automation  — passes to automation loop
   */
  @Post('trade')
  async executeTrade(@Body() body: {
    symbol: string;
    protocolId?: string;
    mode: 'quick-trade' | 'one-click' | 'automation';
    side?: 'BUY' | 'SELL';
    size?: number;
    slPct?: number;
    tpPct?: number;
    brokerId?: string;
  }) {
    const { symbol, protocolId, mode, side = 'BUY', size, slPct, tpPct } = body;
    const ticker = symbol.toUpperCase();

    // ── Duplicate check ──
    try {
      const existingPosition = await this.prisma.position.findFirst({
        where: { symbol: ticker, provider: 'mt5' },
      });
      if (existingPosition) {
        return {
          success: false,
          status: 'DUPLICATE_BLOCKED',
          reason: `Already have an open position for ${ticker} (${existingPosition.quantity} units at avg ${existingPosition.avgPrice})`,
        };
      }
    } catch { /* Position table may be empty */ }

    // ── Protocol defaults ──
    // Use protocol style to determine sensible defaults
    const STYLE_DEFAULTS: Record<string, { size: number; slPct: number; tpPct: number }> = {
      scalp: { size: 0.01, slPct: 0.3, tpPct: 0.5 },
      'day-trade': { size: 0.02, slPct: 0.5, tpPct: 1.0 },
      speed: { size: 0.01, slPct: 0.2, tpPct: 0.4 },
      swing: { size: 0.05, slPct: 1.5, tpPct: 3.0 },
      position: { size: 0.1, slPct: 3.0, tpPct: 6.0 },
    };

    let defaults = STYLE_DEFAULTS.swing;
    if (protocolId) {
      const config = await this.protocolDb.findBySlug(protocolId);
      const style = config?.tradingStyle?.toLowerCase() || '';
        if (style.includes('scalp') || style.includes('tick')) defaults = STYLE_DEFAULTS.scalp;
        else if (style.includes('speed')) defaults = STYLE_DEFAULTS.speed;
        else if (style.includes('day')) defaults = STYLE_DEFAULTS['day-trade'];
        else if (style.includes('swing')) defaults = STYLE_DEFAULTS.swing;
        else if (style.includes('position')) defaults = STYLE_DEFAULTS.position;
    }

    const finalSize = size ?? defaults.size;
    const finalSlPct = slPct ?? defaults.slPct;
    const finalTpPct = tpPct ?? defaults.tpPct;

    const orderPayload = {
      symbol: ticker,
      type: side,
      volume: finalSize,
      slPct: finalSlPct,
      tpPct: finalTpPct,
      comment: `TCS SpeedScanner — ${protocolId || 'manual'} — ${mode}`,
    };

    // ── Mode dispatch ──
    if (mode === 'quick-trade') {
      // Return payload for UI confirmation
      return {
        success: true,
        status: 'AWAITING_CONFIRMATION',
        order: orderPayload,
        defaults: { size: finalSize, slPct: finalSlPct, tpPct: finalTpPct },
      };
    }

    if (mode === 'one-click') {
      // Execute immediately via MT5
      try {
        const mt5Quote = await this.mt5.getQuote(ticker);
        if (!mt5Quote) {
          return { success: false, status: 'FAILED', reason: `No quote available for ${ticker}` };
        }

        const price = side === 'BUY' ? mt5Quote.ask : mt5Quote.bid;
        if (!price) {
          return { success: false, status: 'FAILED', reason: 'No bid/ask price available' };
        }

        const result = await this.mt5.placeOrder({
          symbol: ticker,
          side,
          quantity: finalSize,
          comment: orderPayload.comment,
        });

        return {
          success: result?.success ?? false,
          status: result?.success ? 'EXECUTED' : 'FAILED',
          ticket: result?.ticket ?? null,
          price: price ?? undefined,
          error: result?.error ?? undefined,
        };
      } catch (err: any) {
        return { success: false, status: 'FAILED', reason: err.message };
      }
    }

    if (mode === 'automation') {
      // Create a quick trading strategy for the automation loop
      try {
        const strategyId = `speed-${ticker}-${Date.now()}`;
        await this.prisma.tradingStrategy.create({
          data: {
            id: strategyId,
            name: `Speed Auto — ${ticker}`,
            protocolId: protocolId || 'dxy-sensitivity-v1',
            symbol: ticker,
            timeframe: '5s',
            mode: 'semi-auto',
            brokerId: body.brokerId || 'mt5',
            baseSize: finalSize,
            slPct: finalSlPct,
            tpPct: finalTpPct,
            minComposite: 60,
            active: true,
            description: 'Auto-created from Speed Scanner route-to-trade',
          },
        });
        return {
          success: true,
          status: 'QUEUED_FOR_AUTOMATION',
          strategyId,
          message: `Created strategy ${strategyId} — will be picked up by automation loop`,
        };
      } catch (err: any) {
        return { success: false, status: 'FAILED', reason: err.message };
      }
    }

    return { success: false, status: 'FAILED', reason: `Unknown mode: ${mode}` };
  }
}
