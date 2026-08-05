import { Module } from '@nestjs/common';
import { MarketCalendarService } from './market-calendar.service';
import { MarketSessionsService } from './market-sessions.service';
import { MarketCalendarController } from './market-calendar.controller';

@Module({
  providers: [MarketCalendarService, MarketSessionsService],
  controllers: [MarketCalendarController],
  exports: [MarketCalendarService, MarketSessionsService],
})
export class CalendarModule {}
