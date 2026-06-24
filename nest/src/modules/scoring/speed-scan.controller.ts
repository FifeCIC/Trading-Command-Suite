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
}
