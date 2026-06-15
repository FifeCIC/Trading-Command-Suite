import { Module } from '@nestjs/common';
import { Mt5TradingService } from './mt5-trading.service';
import { Mt5TradingController } from './mt5-trading.controller';
import { SessionTrackerService } from './session-tracker.service';
import { SessionTrackerController } from './session-tracker.controller';

@Module({
  controllers: [Mt5TradingController, SessionTrackerController],
  providers: [Mt5TradingService, SessionTrackerService],
  exports: [Mt5TradingService, SessionTrackerService],
})
export class TradingModule {}
