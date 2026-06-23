import { Controller, Get, Post, Delete, Query, Param, Body, Logger } from '@nestjs/common';
import { Trading212ImportService } from './trading212-import.service';

@Controller('portfolio/trading212')
export class Trading212PortfolioController {
  private readonly logger = new Logger(Trading212PortfolioController.name);

  constructor(private readonly importService: Trading212ImportService) {}

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
