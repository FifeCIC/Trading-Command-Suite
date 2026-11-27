import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MarketCalendarService, type MarketStatus, HolidayEntry } from './market-calendar.service';
import type { SessionInfo } from './market-calendar.service';
import { MarketSessionsService, type MarketSession, type SessionState } from './market-sessions.service';
import { assessTickerExtendedHours, type ExtendedHoursAssessment } from './extended-hours';

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
  getMarketStatus(@Query('exchange') exchange?: string, @Query('at') at?: string): MarketStatus {
    // #1088 — `at` exists so a FUTURE date can be evaluated rather than waited for: the issue's
    // acceptance asks for a check at 25 Dec 2026 (a Friday), and "verify it when Christmas comes"
    // is not verification. An unparseable value is REFUSED rather than silently treated as "now",
    // because that would answer a different question than the one asked.
    let referenceDate: Date | undefined;
    if (at !== undefined) {
      referenceDate = new Date(at);
      if (Number.isNaN(referenceDate.getTime())) {
        throw new BadRequestException(`at: '${at}' is not a parseable date`);
      }
    }
    return this.calendar.getMarketStatus(exchange || 'US', referenceDate);
  }

  /**
   * Trading-window assessment for ONE instrument (#1359).
   *
   * The order modal asks this before confirming, so the extended-hours risks are shown to the
   * person placing the order rather than discovered after a thin-liquidity fill. It is on the
   * calendar route because the answer belongs to the VENUE axis — the T212 order client calls it
   * from there rather than duplicating the symbol→venue map in the frontend.
   */
  @Get('order-hours')
  @ApiOperation({
    summary: 'Trading-window assessment for one instrument — regular session live, or extended-hours risk',
  })
  @ApiOkResponse({ description: 'Whether the regular session is live, plus the risks that apply outside it' })
  getOrderHours(@Query('ticker') ticker?: string): ExtendedHoursAssessment {
    if (!ticker || !ticker.trim()) {
      throw new BadRequestException("ticker: required, e.g. 'AAPL'");
    }
    return assessTickerExtendedHours(ticker.trim(), (exchange) => this.calendar.getMarketStatus(exchange));
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
