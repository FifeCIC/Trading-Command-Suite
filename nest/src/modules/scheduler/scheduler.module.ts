import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ScoringModule } from '../scoring/scoring.module';
import { AutomationModule } from '../automation/automation.module';
import { TradingSchedulerService } from './trading-scheduler.service';
import { SchedulerController } from './scheduler.controller';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, NotificationsModule, ScoringModule, forwardRef(() => AutomationModule)],
  controllers: [SchedulerController],
  providers: [TradingSchedulerService],
  exports: [TradingSchedulerService],
})
export class SchedulerModule {}
