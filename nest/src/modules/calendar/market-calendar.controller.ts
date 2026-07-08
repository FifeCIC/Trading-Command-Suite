import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MarketCalendarService, type MarketStatus, HolidayEntry, SessionInfo } from './market-calendar.service';

@ApiTags('calendar')
@Controller('calendar')
export class MarketCalendarController {
  constructor(private readonly calendar: MarketCalendarService) {}

  @Get('market-status')
  @ApiOperation({ summary: 'Get current market status — open/closed/early-close/pre-market/after-hours' })
  @ApiOkResponse({ description: 'Market status with next open/close times' })
  getMarketStatus(@Query('exchange') exchange?: string): MarketStatus {
    return this.calendar.getMarketStatus(exchange || 'US');
  }

  @Get('holidays')
  @ApiOperation({ summary: 'List all known holidays for an exchange' })
  listHolidays(@Query('exchange') exchange?: string): HolidayEntry[] {
    return this.calendar.listHolidays(exchange || 'US');
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Get session info for an exchange' })
  getSession(@Query('exchange') exchange?: string): SessionInfo | null {
    return this.calendar.getSession(exchange || 'US');
  }

  @Get('is-open')
  @ApiOperation({ summary: 'Quick check: is the US market open?' })
  isOpen(): { isOpen: boolean } {
    return { isOpen: this.calendar.isUSMarketOpen() };
  }
}
