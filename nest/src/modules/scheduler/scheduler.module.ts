import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DatabaseModule } from '../../database/database.module';
import { TradingSchedulerService } from './trading-scheduler.service';

@Module({
  imports: [ScheduleModule.forRoot(), DatabaseModule],
  providers: [TradingSchedulerService],
  exports: [TradingSchedulerService],
})
export class SchedulerModule {}
