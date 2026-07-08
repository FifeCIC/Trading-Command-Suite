import { Module } from '@nestjs/common';
import { MarketCalendarService } from './market-calendar.service';
import { MarketCalendarController } from './market-calendar.controller';

@Module({
  providers: [MarketCalendarService],
  controllers: [MarketCalendarController],
  exports: [MarketCalendarService],
})
export class CalendarModule {}
