import { Module } from '@nestjs/common';
import { Mt5TradingService } from './mt5-trading.service';
import { Mt5TradingController } from './mt5-trading.controller';
import { SessionTrackerService } from './session-tracker.service';
import { SessionTrackerController } from './session-tracker.controller';
import { MarketContextService } from './market-context.service';
import { TradingStrategyService } from './trading-strategy.service';
import { TradingStrategyController } from './trading-strategy.controller';
import { TradeRecorderService } from './trade-recorder.service';
import { DuplicateGuardService } from './duplicate-guard.service';
import { TradeHistoryController } from './trade-history.controller';
import { DirectivesModule } from '../directives/directives.module';
import { RiskModule } from '../risk/risk.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DirectivesModule, RiskModule, NotificationsModule, DatabaseModule],
  controllers: [Mt5TradingController, SessionTrackerController, TradingStrategyController, TradeHistoryController],
  providers: [Mt5TradingService, SessionTrackerService, MarketContextService, TradingStrategyService, TradeRecorderService, DuplicateGuardService],
  exports: [Mt5TradingService, SessionTrackerService, MarketContextService, TradingStrategyService, TradeRecorderService, DuplicateGuardService],
})
export class TradingModule {}
