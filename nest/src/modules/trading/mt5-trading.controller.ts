import { Controller, Get, Post, Delete, Body, Param } from '@nestjs/common';
import { Mt5TradingService } from './mt5-trading.service';

class OrderDto { symbol!: string; type!: 'BUY'|'SELL'; volume!: number; sl?: number; tp?: number; comment?: string; }
class PartialDto { volume!: number; }
class ModifyDto { sl?: number; tp?: number; }

@Controller('api/trading/mt5')
export class Mt5TradingController {
  constructor(private readonly mt5: Mt5TradingService) {}

  @Get('account')
  getAccount() { return this.mt5.getAccount(); }

  @Get('positions')
  getPositions() { return this.mt5.getPositions(); }

  @Get('history')
  getHistory() { return this.mt5.getHistory(); }

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
}
