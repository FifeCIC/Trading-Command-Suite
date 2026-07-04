import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DatabaseModule } from '../../database/database.module';
import { TradingGatesModule } from '../trading-gates/trading-gates.module';

import { MonteCarloService } from './monte-carlo.service';

@Module({
  imports: [NotificationsModule, DatabaseModule, TradingGatesModule],
  controllers: [RiskController],
  providers: [RiskService, MonteCarloService],
  exports: [RiskService, MonteCarloService],
})
export class RiskModule {}
