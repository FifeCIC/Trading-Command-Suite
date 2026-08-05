import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MarketCalendarService, type MarketStatus, HolidayEntry } from './market-calendar.service';
import type { SessionInfo } from './market-calendar.service';
import { MarketSessionsService, type MarketSession, type SessionState } from './market-sessions.service';

@ApiTags('calendar')
@Controller('calendar')
export class MarketCalendarController {
  constructor(
    private readonly calendar: MarketCalendarService,
    private readonly sessions: MarketSessionsService,
  ) {}

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

  @Get('session-roster')
  @ApiOperation({ summary: 'Canonical DST-aware session definitions (single source of truth)' })
  getSessionRoster(): MarketSession[] {
    return this.sessions.listSessions();
  }

  @Get('sessions/state')
  @ApiOperation({ summary: 'Current live state of all trading sessions (active/opens-soon/closes-soon)' })
  getSessionStates(): {
    sessions: SessionState[];
    active: MarketSession[];
  } {
    return {
      sessions: this.sessions.getSessionStates(),
      active: this.sessions.getActiveSessions(),
    };
  }
}
