import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TradingSchedulerService } from './trading-scheduler.service';
import { SchedulerController } from './scheduler.controller';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule, NotificationsModule],
  controllers: [SchedulerController],
  providers: [TradingSchedulerService],
  exports: [TradingSchedulerService],
})
export class SchedulerModule {}
