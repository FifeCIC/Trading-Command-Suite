import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { IsString, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { Mt5TradingService } from './mt5-trading.service';
import { RequireAuthGuard } from '../auth/guards/require-auth.guard';

class OrderDto {
  @IsString() symbol!: string;
  @IsIn(['BUY', 'SELL']) type!: 'BUY'|'SELL';
  @IsNumber() @Min(0.001) volume!: number;
  @IsOptional() @IsNumber() sl?: number;
  @IsOptional() @IsNumber() tp?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsIn(['user', 'agent', 'strategy', 'system']) origin?: string;
  @IsOptional() @IsString() clientOrderId?: string;
}
class PartialDto { @IsNumber() @Min(0.001) volume!: number; }
class ModifyDto { @IsOptional() @IsNumber() sl?: number; @IsOptional() @IsNumber() tp?: number; }

@Controller('trading/mt5')
@UseGuards(RequireAuthGuard)
export class Mt5TradingController {
  constructor(private readonly mt5: Mt5TradingService) {}

  @Get('account')
  getAccount() { return this.mt5.getAccount(); }

  @Get('positions')
  getPositions() { return this.mt5.getPositions(); }

  /**
   * GET /api/trading/mt5/positions/managed — EVERY open position on EVERY bridge (#1037).
   *
   * ⚠️ Distinct from `GET positions` above, which reads the PRIMARY bridge only (#1033). This one
   * is the read path for the Positions Monitor and is ADDITIVE: `getPositions()` keeps its meaning
   * because `closeAll()` / `closePosition()` / `modifyPosition()` depend on it, and those decide
   * WHICH BRIDGE to send an order to. A read-only page must not change order routing.
   */
  @Get('positions/managed')
  getPositionsManaged() { return this.mt5.getPositionsManaged(); }

  @Get('history')
  getHistory() { return this.mt5.getHistory(); }

  @Get('candles')
  async getCandles(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe = '1m',
    @Query('limit') limit = '100',
  ) {
    // Clamp the limit before proxying to the bridge — the raw query string was
    // passed straight through, bypassing the service-level Math.min(limit, 1000).
    const cappedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 1000));
    const url = `${(this.mt5 as any).bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${cappedLimit}`;
    const res = await fetch(url);
    return res.json();
  }

  @Post('order')
  placeOrder(@Body() body: OrderDto) { return this.mt5.placeOrder(body); }

  @Delete('close/:ticket')
  closePosition(@Param('ticket') ticket: string) { return this.mt5.closePosition(parseInt(ticket, 10)); }

  @Post('close/:ticket/partial')
  closePartial(@Param('ticket') ticket: string, @Body() body: PartialDto) { return this.mt5.closePartial(parseInt(ticket, 10), body.volume); }

  @Post('modify/:ticket')
  modifyPosition(@Param('ticket') ticket: string, @Body() body: ModifyDto) { return this.mt5.modifyPosition(parseInt(ticket, 10), body.sl, body.tp); }

  @Post('close-all')
  closeAll() { return this.mt5.closeAll(); }

  @Post('close-profitable')
  closeProfitable() { return this.mt5.closeProfitable(); }
}
