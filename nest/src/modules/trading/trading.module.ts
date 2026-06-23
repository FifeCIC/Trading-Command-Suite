import { Module } from '@nestjs/common';
import { Mt5TradingService } from './mt5-trading.service';
import { Mt5TradingController } from './mt5-trading.controller';
import { SessionTrackerService } from './session-tracker.service';
import { SessionTrackerController } from './session-tracker.controller';
import { TradingStrategyService } from './trading-strategy.service';
import { TradingStrategyController } from './trading-strategy.controller';
import { DirectivesModule } from '../directives/directives.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DirectivesModule, DatabaseModule],
  controllers: [Mt5TradingController, SessionTrackerController, TradingStrategyController],
  providers: [Mt5TradingService, SessionTrackerService, TradingStrategyService],
  exports: [Mt5TradingService, SessionTrackerService, TradingStrategyService],
})
export class TradingModule {}
