import { Module } from '@nestjs/common';
import { RiskService } from './risk.service';
import { RiskController } from './risk.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { DatabaseModule } from '../../database/database.module';
import { TradingGatesModule } from '../trading-gates/trading-gates.module';

@Module({
  imports: [NotificationsModule, DatabaseModule, TradingGatesModule],
  controllers: [RiskController],
  providers: [RiskService],
  exports: [RiskService],
})
export class RiskModule {}
