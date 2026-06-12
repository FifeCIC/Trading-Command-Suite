import { Module } from '@nestjs/common';
import { TradingGatesService } from './trading-gates.service';

@Module({
  providers: [TradingGatesService],
  exports: [TradingGatesService],
})
export class TradingGatesModule {}
