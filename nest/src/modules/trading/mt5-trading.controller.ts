import { Controller, Get, Post, Delete, Body, Param, Query } from '@nestjs/common';
import { IsString, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
import { Mt5TradingService } from './mt5-trading.service';

class OrderDto {
  @IsString() symbol!: string;
  @IsIn(['BUY', 'SELL']) type!: 'BUY'|'SELL';
  @IsNumber() @Min(0.001) volume!: number;
  @IsOptional() @IsNumber() sl?: number;
  @IsOptional() @IsNumber() tp?: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsIn(['user', 'agent', 'strategy', 'system']) origin?: string;
}
class PartialDto { @IsNumber() @Min(0.001) volume!: number; }
class ModifyDto { @IsOptional() @IsNumber() sl?: number; @IsOptional() @IsNumber() tp?: number; }

@Controller('trading/mt5')
export class Mt5TradingController {
  constructor(private readonly mt5: Mt5TradingService) {}

  @Get('account')
  getAccount() { return this.mt5.getAccount(); }

  @Get('positions')
  getPositions() { return this.mt5.getPositions(); }

  @Get('history')
  getHistory() { return this.mt5.getHistory(); }

  @Get('candles')
  async getCandles(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe = '1m',
    @Query('limit') limit = '100',
  ) {
    const url = `${(this.mt5 as any).bridgeUrl}/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`;
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
