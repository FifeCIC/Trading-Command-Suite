import { Controller, Get, Query } from '@nestjs/common';
import { IsaService } from './isa.service';
import type { IsaTradeSide } from './isa.service';

@Controller('isa')
export class IsaController {
  constructor(private readonly isaService: IsaService) {}

  @Get('dashboard')
  async getDashboard() {
    return this.isaService.getDashboard();
  }

  @Get('fx-warning')
  async getFxWarning(
    @Query('symbol') symbol?: string,
    @Query('side') side?: IsaTradeSide,
    @Query('amountGbp') amountGbp?: string,
    @Query('exchange') exchange?: string,
  ) {
    return this.isaService.getFxWarning({
      symbol: symbol || '',
      side: side === 'sell' ? 'sell' : 'buy',
      amountGbp: amountGbp ? Number(amountGbp) : undefined,
      exchange,
    });
  }
}
