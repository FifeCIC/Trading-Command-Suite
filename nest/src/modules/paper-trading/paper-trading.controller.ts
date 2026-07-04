import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { PaperTradingService } from './paper-trading.service';

@Controller('paper-trading')
export class PaperTradingController {
  constructor(private readonly paper: PaperTradingService) {}

  /** GET /api/paper-trading/account */
  @Get('account')
  getAccount() {
    return this.paper.getAccount();
  }

  /** GET /api/paper-trading/positions */
  @Get('positions')
  getPositions() {
    return this.paper.getOpenPositions();
  }

  /** GET /api/paper-trading/positions/:ticket */
  @Get('positions/:ticket')
  getPosition(@Param('ticket') ticket: string) {
    return this.paper.getPosition(Number(ticket));
  }

  /** POST /api/paper-trading/order */
  @Post('order')
  async placeOrder(@Body() body: {
    symbol: string; type: 'BUY' | 'SELL'; volume: number;
    sl?: number; tp?: number; comment?: string;
  }) {
    return this.paper.placeOrder({
      symbol: body.symbol, type: body.type, volume: body.volume,
      sl: body.sl, tp: body.tp, comment: body.comment, origin: 'user',
    });
  }

  /** DELETE /api/paper-trading/positions/:ticket */
  @Delete('positions/:ticket')
  async closePosition(@Param('ticket') ticket: string) {
    return this.paper.closePosition(Number(ticket));
  }

  /** POST /api/paper-trading/close-all */
  @Post('close-all')
  async closeAll() {
    return this.paper.closeAll();
  }

  /** POST /api/paper-trading/close-profitable */
  @Post('close-profitable')
  async closeProfitable() {
    return this.paper.closeProfitable();
  }

  /** POST /api/paper-trading/modify/:ticket */
  @Post('modify/:ticket')
  async modifyPosition(@Param('ticket') ticket: string, @Body() body: { sl?: number; tp?: number }) {
    return this.paper.modifyPosition(Number(ticket), body.sl, body.tp);
  }

  /** GET /api/paper-trading/history */
  @Get('history')
  async getHistory() {
    return this.paper.getTradeHistory();
  }

  /** POST /api/paper-trading/reset */
  @Post('reset')
  reset(@Body() body?: { balance?: number }) {
    this.paper.reset(body?.balance);
    return this.paper.getAccount();
  }

  /** POST /api/paper-trading/mark-to-market */
  @Post('mark-to-market')
  markToMarket() {
    return this.paper.markToMarket();
  }
}
