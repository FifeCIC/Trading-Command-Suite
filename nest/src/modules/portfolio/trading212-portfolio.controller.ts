import { Controller, Get, Post, Delete, Query, Param, Body, Logger } from '@nestjs/common';
import { Trading212ImportService } from './trading212-import.service';
import { Trading212Adapter } from '../providers/adapters/trading212.adapter';

@Controller('portfolio/trading212')
export class Trading212PortfolioController {
  private readonly logger = new Logger(Trading212PortfolioController.name);

  constructor(
    private readonly importService: Trading212ImportService,
    private readonly t212Adapter: Trading212Adapter,
  ) {}

  /** Returns the current Trading212 mode and available modes */
  @Get('mode')
  getMode() {
    return {
      current: this.t212Adapter.mode,
      available: ['demo', 'live'],
      hasDemoKey: !!(process.env.TRADING212_DEMO_API_KEY || process.env.TRADING212_API_KEY),
      hasLiveKey: !!(process.env.TRADING212_LIVE_API_KEY || process.env.TRADING212_API_KEY),
    };
  }

  @Get('validate')
  validate() {
    return this.importService.validateConnection();
  }

  @Post('import')
  importPortfolio() {
    return this.importService.importPortfolio();
  }

  @Get('history')
  async getHistory(@Query('days') days?: string) {
    const daysNum = days ? parseInt(days, 10) : undefined;
    const result = await this.importService.getTradeHistory(daysNum);
    return result;
  }

  // ── Order Execution ───────────────────────────────────────

  @Post('orders/sell')
  async sellPosition(@Body() body: {
    ticker: string;
    quantity: number;
    accountType?: 'investment' | 'isa';
  }) {
    this.logger.log(`SELL order requested: ${body.ticker} ×${body.quantity} (${body.accountType || 'investment'})`);
    return this.importService.placeOrder({ ...body, side: 'sell' });
  }

  @Post('orders/buy')
  async buyPosition(@Body() body: {
    ticker: string;
    quantity: number;
    accountType?: 'investment' | 'isa';
  }) {
    this.logger.log(`BUY order requested: ${body.ticker} ×${body.quantity} (${body.accountType || 'investment'})`);
    return this.importService.placeOrder({ ...body, side: 'buy' });
  }

  @Get('orders')
  async listOrders() {
    return this.importService.getOpenOrders();
  }

  @Get('orders/:id')
  async getOrderStatus(@Param('id') id: string) {
    return this.importService.getOrderStatus(id);
  }

  @Delete('orders/:id')
  async cancelOrder(@Param('id') id: string) {
    return this.importService.cancelOrder(id);
  }

  @Post('close-profitable')
  async closeProfitable() {
    this.logger.log('SELL ALL PROFITABLE requested');
    return this.importService.sellAllProfitable();
  }
}
