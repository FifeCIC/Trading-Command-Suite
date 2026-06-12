import { Module } from '@nestjs/common';
import { TradingGatesService } from './trading-gates.service';
import { TradingGatesController } from './trading-gates.controller';

@Module({
  controllers: [TradingGatesController],
  providers: [TradingGatesService],
  exports: [TradingGatesService],
})
export class TradingGatesModule {}
