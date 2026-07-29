import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DatabaseModule } from '../../database/database.module';
import { TradingGatesModule } from '../trading-gates/trading-gates.module';

import { MonteCarloService } from './monte-carlo.service';
import { WeekendGapRiskService } from './weekend-gap-risk.service';

@Module({
  imports: [NotificationsModule, DatabaseModule, TradingGatesModule],
  controllers: [RiskController],
  providers: [RiskService, MonteCarloService, WeekendGapRiskService],
  exports: [RiskService, MonteCarloService, WeekendGapRiskService],
})
export class RiskModule {}
