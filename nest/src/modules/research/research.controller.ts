import { Controller, Get, Query, Param, Logger, Post, Put, Body } from '@nestjs/common';
import { ProvidersService } from '../providers/providers.service';
import { ResearchOverviewService } from './research-overview.service';
import { AnalystTargetsService } from './analyst-targets.service';
import { NasdaqEarningsService } from './nasdaq-earnings.service';
import { ResearchImportService } from './research-import.service';
import { EarningsImportSettingsService } from './earnings-import-settings.service';
import { EarningsImportSettingsDto } from './dto/earnings-import-settings.dto';
import { PrismaService } from '../../database/prisma.service';

@Controller('research')
export class ResearchController {
  private readonly logger = new Logger(ResearchController.name);

  constructor(
    private readonly providers: ProvidersService,
    private readonly overviewService: ResearchOverviewService,
    private readonly analystTargets: AnalystTargetsService,
    private readonly nasdaqEarnings: NasdaqEarningsService,
    private readonly researchImport: ResearchImportService,
    private readonly earningsImportSettings: EarningsImportSettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('overview')
  async getOverview() {
    return this.overviewService.getOverview();
  }

  /**
   * GET /api/research/earnings/calendar
   *
   * DB-FIRST by design (2026-08-23): the scheduled import stores events in
   * earnings_event, so the page reads STORED data and never depends on a live
   * external call. Live Finnhub → Nasdaq fetches are only a cold-start
   * fallback when the table is empty, and upstream failures can never 500
   * the page — they degrade to an empty list with an `error` field.
   *
   * Considerations:
   *  • earnings_event is populated by the scheduled_job 'earnings-import'
   *    handler (settings-driven) and by manual "Import now".
   *  • Rows can exist for the same (symbol, date) under different sources —
   *    dedupe in JS, preferring Finnhub rows.
   *  • `months` filters the window; DB events older than the horizon are
   *    naturally excluded by the reportDate range.
   */
  @Get('earnings/calendar')
  async getEarningsCalendar(
    @Query('symbol') symbol?: string,
    @Query('months') months?: string,
  ) {
    const horizonMonths = months ? parseInt(months, 10) : 3;
    const horizonDays = Math.ceil(horizonMonths * 31);

    // ── 1. Stored data (primary) ──────────────────────────────────
    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date();
      to.setDate(to.getDate() + horizonDays);
      to.setHours(23, 59, 59, 999);

      const stored = await this.prisma.earningsEvent.findMany({
        where: {
          reportDate: { gte: from, lte: to },
          ...(symbol ? { symbol: symbol.toUpperCase() } : {}),
        },
        orderBy: { reportDate: 'asc' },
      });

      if (stored.length > 0) {
        // Tracked set: symbols in watchlists or portfolio — used by the UI to
        // highlight reports for names the user already trades/watches.
        let tracked = new Set<string>();
        try {
          const wl = await this.earningsImportSettings.loadScopeSymbols('watchlist');
          const pf = await this.earningsImportSettings.loadScopeSymbols('portfolio');
          tracked = new Set<string>([...(wl ?? []), ...(pf ?? [])]);
        } catch { /* non-fatal */ }

        // Dedupe by (symbol, reportDate) — prefer finnhub rows when both exist.
        const seen = new Map<string, any>();
        for (const e of stored) {
          const key = `${e.symbol}|${e.reportDate.toISOString().split('T')[0]}`;
          if (!seen.has(key) || e.source === 'finnhub') seen.set(key, e);
        }
        const events = Array.from(seen.values()).map((e) => ({
          symbol: e.symbol,
          name: e.name ?? null,
          reportDate: e.reportDate.toISOString().split('T')[0],
          timeOfDay: e.timeOfDay ?? null,
          epsEstimate: e.epsEstimate ?? null,
          revenueEstimate: e.revenueEstimate ?? null,
          lastYearEps: e.lastYearEps ?? null,
          lastYearDate: e.lastYearDate ? e.lastYearDate.toISOString().split('T')[0] : null,
          marketCap: e.marketCap ?? null,
          tracked: tracked.has(e.symbol.toUpperCase()),
          source: e.source,
        }));
        return { source: 'db', horizonMonths, count: events.length, events };
      }
    } catch (err) {
      this.logger.warn(`DB earnings read failed: ${(err as Error).message}`);
    }

    // ── 2. Cold-start fallback: live Finnhub → Nasdaq ─────────────
    let liveEvents: any[] = [];
    let source = 'none';
    let liveError: string | null = null;

    const adapter = this.providers.getAdapter('finnhub');
    if (adapter && typeof (adapter as any).getEarningsCalendar === 'function') {
      try {
        liveEvents = await (adapter as any).getEarningsCalendar(symbol, horizonMonths);
        if (Array.isArray(liveEvents) && liveEvents.length > 0) source = 'finnhub';
      } catch (err) {
        liveError = `finnhub: ${(err as Error).message}`;
        this.logger.warn(`Live Finnhub earnings fetch failed: ${(err as Error).message}`);
      }
    }

    if (!Array.isArray(liveEvents) || liveEvents.length === 0) {
      try {
        liveEvents = await this.nasdaqEarnings.getCalendar(horizonMonths, symbol);
        if (liveEvents.length > 0) source = 'nasdaq';
        else if (!liveError) liveError = 'No events from Finnhub or Nasdaq';
      } catch (err) {
        liveError = `${liveError ? liveError + '; ' : ''}nasdaq: ${(err as Error).message}`;
      }
    }

    return {
      source,
      horizonMonths,
      count: Array.isArray(liveEvents) ? liveEvents.length : 0,
      events: Array.isArray(liveEvents) ? liveEvents : [],
      error: liveError,
    };
  }

  /**
   * POST /api/research/earnings/import
   * Trigger the earnings calendar DB import (Finnhub + Nasdaq cross-check).
   * Runs in the background — returns immediately; watch the backend logs or
   * GET /api/research/earnings/status for progress.
   */
  @Post('earnings/import')
  importEarningsCalendar() {
    const started = this.researchImport.triggerEarningsImport();
    return {
      started,
      message: started
        ? 'Earnings import started — it runs in the background.'
        : 'Earnings import already running.',
    };
  }

  /**
   * POST /api/research/earnings/purge
   * Delete stored FUTURE earnings rows that no longer match the current
   * import settings (the "Save & apply" button). Past rows are kept — they
   * are the surprise-history corpus.
   */
  @Post('earnings/purge')
  async purgeEarnings() {
    return this.researchImport.purgeNonMatching();
  }

  /**
   * GET /api/research/earnings/settings
   * Import filters — scope, min market cap, session, auto-import toggle.
   */
  @Get('earnings/settings')
  async getEarningsSettings() {
    return this.earningsImportSettings.getSettings();
  }

  /**
   * PUT /api/research/earnings/settings
   * Patch one or more import settings. Re-schedules the queued import job.
   */
  @Put('earnings/settings')
  async updateEarningsSettings(@Body() dto: EarningsImportSettingsDto) {
    const settings = await this.earningsImportSettings.updateSettings(dto);
    // Schedule fields may have changed — recompute the next run.
    await this.researchImport.scheduleNextImportRun().catch((err) =>
      this.logger.warn(`Rescheduling earnings import failed: ${(err as Error).message}`),
    );
    return settings;
  }

  /**
   * GET /api/research/earnings/status
   * Whether an import is currently running + how many events are stored.
   */
  @Get('earnings/status')
  async getEarningsImportStatus() {
    return this.researchImport.getEarningsImportStatus();
  }

  @Get('analyst/targets')
  async getAnalystTargets(
    @Query('symbols') symbols?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
  ) {
    const symbolList = symbols ? symbols.split(',').map((s) => s.trim().toUpperCase()) : [];

    if (symbolList.length === 0) {
      return { source: 'finnhub+fmp', targets: [], error: 'No symbols provided. Use ?symbols=AAPL,NVDA,MSFT' };
    }

    return this.analystTargets.getTargets(symbolList.slice(0, 14), sort, order);
  }

  @Get('analyst/targets/:symbol')
  async getSymbolTarget(@Param('symbol') symbol: string) {
    const target = await this.analystTargets.getTargetForSymbol(symbol.toUpperCase());
    if (!target) {
      return { source: 'finnhub+fmp', target: null, error: `No analyst coverage for ${symbol.toUpperCase()}` };
    }
    return { source: target.source, target };
  }
}
