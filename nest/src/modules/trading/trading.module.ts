import { Module, forwardRef } from '@nestjs/common';
import { Mt5TradingService } from './mt5-trading.service';
import { Mt5TradingController } from './mt5-trading.controller';
import { SessionTrackerService } from './session-tracker.service';
import { SessionTrackerController } from './session-tracker.controller';
import { MarketContextService } from './market-context.service';
import { TradingStrategyService } from './trading-strategy.service';
import { TradingStrategyController } from './trading-strategy.controller';
import { BrokerConfigService } from './broker-config.service';
import { BrokerConfigController } from './broker-config.controller';
import { TradeRecorderService } from './trade-recorder.service';
import { DuplicateGuardService } from './duplicate-guard.service';
import { ExecutionFeasibilityService } from './execution-feasibility.service';
import { StopGuardianService } from './stop-guardian.service';
import { TradeHistoryController } from './trade-history.controller';
import { SwapCostService } from './swap-cost.service';
import { WeekendDefenseService } from './weekend-defense.service';
import { DirectivesModule } from '../directives/directives.module';
import { DiversificationModule } from '../diversification/diversification.module';
import { RiskModule } from '../risk/risk.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DatabaseModule } from '../../database/database.module';
import { ProvidersModule } from '../providers/providers.module';
import { AuthModule } from '../auth/auth.module';
import { ScoringModule } from '../scoring/scoring.module';

@Module({
  imports: [DirectivesModule, DiversificationModule, RiskModule, NotificationsModule, DatabaseModule, ProvidersModule, AuthModule, forwardRef(() => ScoringModule)],
  controllers: [Mt5TradingController, SessionTrackerController, TradingStrategyController, TradeHistoryController, BrokerConfigController],
  providers: [Mt5TradingService, SessionTrackerService, MarketContextService, TradingStrategyService, BrokerConfigService, TradeRecorderService, DuplicateGuardService, StopGuardianService, SwapCostService, WeekendDefenseService, ExecutionFeasibilityService],
  exports: [Mt5TradingService, SessionTrackerService, MarketContextService, TradingStrategyService, BrokerConfigService, TradeRecorderService, DuplicateGuardService, StopGuardianService, SwapCostService, WeekendDefenseService, ExecutionFeasibilityService],
})
export class TradingModule {}
