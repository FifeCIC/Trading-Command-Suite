import { Controller, Post, Get, Delete, Param, Body, Query, BadRequestException, NotFoundException, Patch } from '@nestjs/common';
import {
  ScoreBar,
  RepeatWindowResult,
  RepeatVerdict,
  measureWindow,
  multiWindowVerdict,
} from './score-maths';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BacktestService } from './backtest.service';
import { BacktestPeriodService } from './backtest-period.service';
import type { CreatePeriodInput } from './backtest-period.service';
import { buildSettingsInventory } from './settings-inventory';
import { PrismaService } from '../../database/prisma.service';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import type { BacktestRunRequest } from './backtest.service';
import { LongRunning } from '../../common/decorators/long-running.decorator';

/**
 * Backtest Controller — Historical Strategy Validation
 * ======================================================
 * CANONICAL ROLE (2026-07-29): Analytics, not scoring. Compares
 * strategy performance against benchmarks using historical data.
 *
 * NOT a scoring pipeline — does not evaluate directives or produce
 * trade signals. Reads from MarketBar 1d data and TradeRecord tables.
 *
 * Endpoints:
 *   GET  /api/backtest/datasets    — available pre-loaded datasets
 *   POST /api/backtest/run         — run a backtest
 *   GET  /api/backtest/runs        — list past runs
 *   GET  /api/backtest/benchmark   — compare strategy vs buy-and-hold
 *
 * @see #497 — handoff 2026-07-29-scoring-paths-audit-497.md (central docs store)
 */

@ApiTags('backtest')
@Controller('backtest')
export class BacktestController {
  constructor(
    private readonly backtestService: BacktestService,
    private readonly periods: BacktestPeriodService,
    private readonly prisma: PrismaService,
    private readonly settingsResolver: SettingsResolverService,
  ) {}

  @Get('datasets')
  @ApiOperation({ summary: 'List available pre-loaded backtest datasets' })
  @ApiOkResponse({ description: 'Array of dataset metadata' })
  async getDatasets() {
    return this.backtestService.getDatasets();
  }

  // ⚠️ A backtest scores ONE BAR AT A TIME and legitimately takes minutes (#1139). The global 30 s
  // request deadline returned 504 mid-run, so a real window could never produce a result — measured
  // 2026-10-26. 600 s matches the page's own client timeout, and covers the measured 298 s frozen-window run with headroom; if a run exceeds it, the client already
  // tells the reader the run may still be stored (see the page's timed-out guard).
  @LongRunning(600_000)
  @Post('run')
  @ApiOperation({ summary: 'Run backtest for a symbol over N days' })
  @ApiOkResponse({ description: 'Backtest result with entry signals and stats' })
  async run(@Body() body: BacktestRunRequest) {
    try {
      return await this.backtestService.run(body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // ⚠️ A FAILURE MUST BE A FAILURE. This used to `return { error: true, message }`, which Nest
      // sends as **HTTP 201 Created** — so the browser saw SUCCESS, read `data.id` as undefined and
      // rendered nothing, while the API had answered correctly. Measured 2026-09-23: clicking “Run
      // Backtest” posted a valid request, received
      // `201 {"error":true,"message":"Backtest requires protocolId for canonical META.Stack scoring."}`
      // and the page showed NO error, because there was no HTTP error to show. The owner reported it
      // as “the button does not work”, which is exactly what it looked like from outside.
      throw new BadRequestException(
        message || 'Backtest failed — check symbol, days range, or data availability',
      );
    }
  }

  @Get('results/:runId')
  async getResult(@Param('runId') runId: string) {
    const result = await this.backtestService.getResult(runId);
    /**
     * ⚠️ A MISSING RUN IS 404, NOT `200 { error }`. Measured 2026-10-27: the old shape returned HTTP
     * 200 with `{error: 'Run not found'}`, so every reader that branches on the HTTP result saw
     * SUCCESS and rendered a run whose every field was `undefined` — and the deleted-baseline path
     * then showed "Accepted baseline — undefine" instead of "this run no longer exists".
     * A 200 carrying an error is the "plausible output, no error" defect at the transport layer.
     *
     * ── DECISION (2026-10-27, primary) ──
     * WHAT:      a missing run answers 404 on results/equity/replay — asserted by backtest.controller.spec.ts.
     * WHY:      the service was honest and only the controller lied, so a service test could not see it.
     * INSTEAD OF: keeping `200 { error }` and branching on the body — that convention is what made a
     *            deleted run render as a fabricated table of dashes.
     * REVERSE BY: returning the `{ error }` sentinel again and updating the three frontend readers
     *            (`RunComparisonPanels.useRun`, `BacktestPage.resultQuery`, `ReplayPlayer`).
     * REGISTER:  docs/SETTLED-DECISIONS.md row 94
     * GUARD:     nest/src/modules/backtest/backtest.controller.spec.ts
     */
    if (!result) throw new NotFoundException(`no stored backtest run "${runId}"`);
    return result;
  }

  /**
   * POST /api/backtest/repeat-check — "does this change repeat on other windows?"
   *
   * WHY THIS ENDPOINT EXISTS (owner direction, 2026-10-27): *"I see huge potential for agentic AI to use
   * it … Agentic AI will be able to make adjustments. Re-test, and keep doing that over and over again
   * for a set period or target a significant level of improvement."*
   *
   * A tuning loop is adjust → re-test → DECIDE, and the decision maths used to live only in the browser.
   * An agent would have had to re-derive totals, deltas and "did it repeat" from 399 KB payloads — a
   * second implementation that would drift from the UI's. The maths is now `score-maths.ts`, this route
   * serves it, and the A/B tab CALLS IT rather than computing.
   *
   * Body: `{ windows: [{ aId, bId, label? }] }` — one entry per window. **One window is accepted** so a
   * caller can obtain the measurement for a single A→B pair (that is what the A/B tab's diff table
   * reads); the verdict for a single window is `cannot-judge` with the reason "a repeat needs at least
   * two windows", which is honest rather than a request rejection. Two or more windows is what actually
   * answers "did it repeat".
   * Returns per-window measurements (bars, Δ Σ signal %, capacity per side, up/down/same) plus one
   * verdict with the counts. A window that cannot be measured comes back with `blocked` + `reason`,
   * never silently dropped: "cannot judge" is a result and "we looked at fewer windows than you think"
   * must be visible.
   *
   * ⚠️ REJECTING ONE WINDOW WAS A DEFECT (measured 2026-10-27, on the running app). The client's A/B tab
   * always includes its own pair as window 1, and it did not post at all until a second window existed —
   * so the diff table rendered `A total —`, `Δ —`, `…` as though nothing had been measured. The request
   * shape was also wrong (a bare array), so every call that DID fire returned 400. Both failures were
   * silent placeholders on screen. A caller should be able to ask for one window's measurement.
   */
  @Post('repeat-check')
  @ApiOperation({ summary: 'Measure an A→B change on one or more windows, and say whether it repeats' })
  async repeatCheck(
    @Body() body: { windows?: Array<{ aId?: string; bId?: string; label?: string }> },
  ) {
    const asked = Array.isArray(body?.windows) ? body.windows : [];
    if (!asked.length) {
      throw new BadRequestException(
        'body must be { windows: [{ aId, bId }] } — a bare array is not a body, and at least one window is required',
      );
    }
    if (asked.length > 10) {
      throw new BadRequestException('at most 10 windows per check');
    }

    const measured: RepeatWindowResult[] = [];
    for (const [i, w] of asked.entries()) {
      if (!w?.aId || !w?.bId) {
        measured.push({
          label: w?.label ?? `window ${i + 1}`,
          aId: w?.aId ?? '',
          bId: w?.bId ?? '',
          blocked: 'no-scores',
          reason: 'both run ids are required',
        });
        continue;
      }
      const [a, b] = await Promise.all([
        this.backtestService.getResult(w.aId),
        this.backtestService.getResult(w.bId),
      ]);
      const aSeries = (a as { scoreSeries?: ScoreBar[] } | null)?.scoreSeries ?? null;
      const bSeries = (b as { scoreSeries?: ScoreBar[] } | null)?.scoreSeries ?? null;
      const missingRun = !a || !b;
      measured.push(
        missingRun
          ? {
              label: w.label ?? `window ${i + 1}`,
              aId: w.aId,
              bId: w.bId,
              blocked: 'no-scores',
              reason: `${!a ? w.aId : w.bId} is not a stored run`,
            }
          : measureWindow({
              aId: w.aId,
              bId: w.bId,
              label: w.label ?? (a?.measuredPeriod?.name ?? a?.period ?? `window ${i + 1}`),
              aSeries,
              bSeries,
            }),
      );
    }

    const verdict: RepeatVerdict = multiWindowVerdict(measured);
    return {
      verdict: verdict.verdict,
      reason: verdict.reason,
      counted: verdict.counted,
      windows: measured,
      /** What `deltaSignalSum` is the difference OF, so a caller cannot read it as anything else. */
      signal: 'sum of signalPct across the bars both runs share, per window',
    };
  }

  @Get('summary/:symbol')
  async getSummary(@Param('symbol') symbol: string) {
    return this.backtestService.getSummary(symbol);
  }

  @Get('protocol/:protocolId')
  async listProtocolRuns(@Param('protocolId') protocolId: string, @Query('limit') limit?: string) {
    return this.backtestService.listProtocolRuns(protocolId, limit ? parseInt(limit, 10) : 20);
  }

  @Get('chart-data')
  @ApiOperation({ summary: 'Get chart-ready data with bars, signals, and indicators' })
  async getChartData(
    @Query('symbol') symbol: string,
    @Query('timeframe') timeframe?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('protocolId') protocolId?: string,
  ) {
    return this.backtestService.getChartData(symbol, timeframe || '1d', from, to, protocolId);
  }

  @Post('optimize')
  @ApiOperation({ summary: 'Grid search — optimize SL/TP parameters across a range' })
  async optimize(@Body() body: {
    symbol: string;
    days?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }) {
    return this.backtestService.optimize(body);
  }

  @Post('walk-forward')
  @ApiOperation({ summary: 'Walk-forward — optimize on train period, validate on test period' })
  async walkForward(@Body() body: {
    symbol: string;
    trainDays?: number;
    testDays?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }) {
    return this.backtestService.walkForward(body);
  }

  @Get('data-inventory')
  @ApiOperation({ summary: 'Comprehensive market bar inventory — all symbols with bar counts, date ranges, providers, and backtest run stats' })
  async dataInventory(@Query('fresh') fresh?: string) {
    // `?fresh=1` bypasses the 60-second memo (see `getDataInventory`) — for a caller that has just
    // imported bars and wants the new rows now.
    return this.backtestService.getDataInventory({ fresh: fresh === '1' || fresh === 'true' });
  }

  /**
   * GET /api/backtest/settings-inventory — EVERY knob an operator could change, and whether a RUN
   * honours it (#1136).
   *
   * ⚠️ WHY THIS IS AN ENDPOINT AND NOT A HARDCODED LIST IN THE PAGE. `applied` is a claim about the
   * engine, and a claim in a JSX file cannot be checked. Here it comes from
   * `settings-inventory.ts`, whose declared maps are driven by `settings-inventory.spec.ts` against
   * the real `mergeBotConfig()` and against `backtest.service.ts` itself — so if the engine stops
   * reading `slPct`, or starts reading `minComposite`, the build goes red instead of the page going
   * quietly wrong.
   *
   * Read-only by design: this lists and judges, it edits nothing. Editing from the Lab is #1133.
   */
  @Get('settings-inventory')
  @ApiOperation({ summary: 'Every configurable knob, with whether a backtest run honours it (#1136)' })
  async settingsInventory(
    @Query('protocolId') protocolId?: string,
    @Query('botId') botId?: string,
  ) {
    const [settings, bot, protocolRow] = await Promise.all([
      this.settingsResolver.getAll().catch(() => []),
      botId
        ? this.prisma.tradingStrategy.findUnique({ where: { id: botId } }).catch(() => null)
        : Promise.resolve(null),
      // ⚠️ `protocol` BY SLUG, not `scoring_strategy`. Verified 2026-10-22 with `db-schema.cjs`:
      // `scoring_strategy` has NO `slug` column (it keys on `protocolId`), so a `findFirst({ where:
      // { slug } })` against it would have thrown on every request. `protocol.slug` is unique, and
      // it is what the Lab holds as `protocolId`.
      protocolId
        ? this.prisma.protocol.findUnique({ where: { slug: protocolId } }).catch(() => null)
        : Promise.resolve(null),
    ]);

    // Truthiness for `active`: it is a `tinyint(1)` and arrives as 0/1. Everything else is passed
    // through as stored — no derived fields are invented here.
    const protocol = protocolRow
      ? {
        ...(protocolRow as Record<string, unknown>),
        active: Boolean((protocolRow as Record<string, unknown>).active),
      }
      : null;

    // `getAll()` returns declared settings with { key, label, value, source, ... } — the registry is
    // the canonical list, so its rows are passed through rather than re-declared here.
    const inventory = buildSettingsInventory({
      settings: (settings as Array<Record<string, unknown>>) ?? [],
      bot: (bot as Record<string, unknown> | null) ?? null,
      protocol: protocol as Record<string, unknown> | null,
    });

    return {
      note:
        'applied: "honoured" = a backtest run reads it. "reported-only" = echoed into the result so a '
        + 'run can say which configuration it measured, but it decides nothing. "ignored" = it exists '
        + 'and does nothing inside a run, whatever the surface implies.',
      ...inventory,
    };
  }

  /**
   * GET /api/backtest/timeframe-coverage — which timeframes a symbol can ACTUALLY be scored at
   * inside a window. Answers "is this choice usable?" BEFORE the run rather than after it fails.
   * `minBars` should be the same `windowSize` the client will send to `/api/replay/run`.
   */
  @Get('timeframe-coverage')
  @ApiOperation({ summary: 'Bar counts per timeframe for one symbol in a window — marks each usable/not (#1128)' })
  async timeframeCoverage(
    @Query('symbol') symbol: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('minBars') minBars?: string,
  ) {
    if (!symbol) {
      throw new BadRequestException('symbol is required — coverage is meaningless without one');
    }
    return this.backtestService.getTimeframeCoverage(
      symbol,
      from,
      to,
      minBars ? parseInt(minBars, 10) : undefined,
    );
  }

  /** List all persisted backtest runs */
  @Get('runs')
  async listRuns(
    @Query('symbol') symbol?: string,
    @Query('protocolId') protocolId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.backtestService.listAllRuns({
      symbol,
      protocolId,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  /** Compare multiple runs side-by-side */
  @Post('runs/compare')
  async compareRuns(@Body() body: { runIds: string[] }) {
    if (!body.runIds?.length) return { error: 'runIds array is required' };
    return this.backtestService.compareRuns(body.runIds);
  }

  /** Delete a backtest run */
  @Delete('runs/:runId')
  async deleteRun(@Param('runId') runId: string) {
    return this.backtestService.deleteRun(runId);
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Backtest PERIODS (#986) — a named, noted window you capture once and reuse.
  //
  // ⚠️ ROUTE ORDER MATTERS: 'periods/import' and 'periods/:id/import' are declared BEFORE the
  // bare 'periods/:id' GET so Nest cannot match the literal segment 'import' as an id. The repo has
  // a route-order guard for this class (`nest/src/common/route-order.spec.ts`) because a shadowed
  // literal route answers 404 with no clue why.
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * The list to pick from. ⚠️ `barCount: null` means NEVER IMPORTED; `0` means the window is
   * EMPTY. `runs` says how many backtests already measured this period.
   */
  @Get('periods')
  @ApiOperation({ summary: 'List stored backtest periods (named windows) for reuse (#986)' })
  async listPeriods(@Query('symbol') symbol?: string, @Query('limit') limit?: string) {
    return this.periods.list({ symbol, limit: limit ? parseInt(limit, 10) : undefined });
  }

  /**
   * Capture a window as an object: name + note + from/to (+ symbol/timeframe).
   * Does not fetch anything — defining a period and filling it are separate acts.
   */
  @Post('periods')
  @ApiOperation({ summary: 'Create a named, noted backtest period (#986)' })
  async createPeriod(@Body() body: CreatePeriodInput) {
    return this.periods.create(body);
  }

  /**
   * Create AND import in one call — the manual capture tool's single action.
   *
   * ⚠️ Returns `outcome`, and `no-bars` / `provider-unavailable` are NOT successes. HTTP 200 is
   * correct because the query genuinely succeeded, but `inserted` is 0 and `findings[]` say why.
   * Callers MUST branch on `outcome`, never on the status code alone.
   */
  @Post('periods/import')
  @ApiOperation({ summary: 'Create a period AND import its bars in one call (#986)' })
  async createAndImport(@Body() body: CreatePeriodInput & { import?: boolean }) {
    const period = await this.periods.create(body);
    // `import` defaults to TRUE here: this endpoint exists so the manual capture is one action, and
    // a default of false would let a capture look complete while holding no bars at all.
    if (body.import === false) return { period, import: null };
    return { period, import: await this.periods.importBars(period.id) };
  }

  /** Re-run the import for an existing period. A second run MUST report `inserted: 0`. */
  @Post('periods/:id/import')
  @ApiOperation({ summary: 'Import (or re-import) the bars for a stored period — idempotent (#986)' })
  async importPeriodBars(@Param('id') id: string) {
    return this.periods.importBars(id);
  }

  /** What `MarketBar` ACTUALLY holds for this window now, versus what was requested. */
  @Get('periods/:id/coverage')
  @ApiOperation({ summary: 'Bar coverage for a period — present rows, actual span, providers (#986)' })
  async periodCoverage(@Param('id') id: string) {
    return this.periods.coverage(id);
  }

  @Get('periods/:id')
  @ApiOperation({ summary: 'One stored period with its coverage and the runs that used it (#986)' })
  async getPeriod(@Param('id') id: string) {
    return this.periods.get(id);
  }

  /** Rename or re-note. The WINDOW is not editable — a measured window is evidence, not a draft. */
  @Patch('periods/:id')
  @ApiOperation({ summary: 'Rename or re-note a period (#986)' })
  async updatePeriod(@Param('id') id: string, @Body() body: { name?: string; note?: string | null }) {
    return this.periods.update(id, body);
  }

  /**
   * Delete a period. Refused while runs reference it unless `cascade: true` — see the service.
   * ⚠️ The BARS are retained: they belong to the symbol, not to this label.
   */
  @Delete('periods/:id')
  @ApiOperation({ summary: 'Delete a period (bars retained; runs must be unlinked on purpose) (#986)' })
  async deletePeriod(@Param('id') id: string, @Query('cascade') cascade?: string) {
    return this.periods.remove(id, { cascade: cascade === 'true' });
  }

  /** Equity curve + drawdown for a run */
  @Get('equity/:runId')
  @ApiOperation({ summary: 'Get equity curve and drawdown data for a backtest run' })
  async getEquityCurve(@Param('runId') runId: string) {
    const curve = await this.backtestService.getEquityCurve(runId);
    // `getEquityCurve` signals absence in the payload (`{ error }`); the HTTP status must agree with
    // it, or a caller that checks only the response status renders an empty curve as a real one.
    if (curve && typeof curve === 'object' && 'error' in curve) {
      throw new NotFoundException(`no stored backtest run "${runId}"`);
    }
    return curve;
  }

  /**
   * #819 — the replay payload: the run's trades in order, the bars they sit on, and an explicit
   * `caveats[]` naming what the run cannot show (no per-tick decision stream, no stored SL/TP,
   * pre-fix runs whose timestamps are all midnight). Read-only.
   */
  @Get('replay/:runId')
  @ApiOperation({ summary: 'Get a backtest run as a replayable trade list + bar timeline (#819)' })
  async getReplay(@Param('runId') runId: string) {
    const replay = await this.backtestService.getReplay(runId);
    // Same rule as results/:runId — a deleted run must not answer 200 (see the note there).
    if (!replay) throw new NotFoundException(`no stored backtest run "${runId}"`);
    return replay;
  }

  /** Per-directive coverage: backtest every directive individually */
  @Post('coverage')
  @ApiOperation({ summary: 'Run every directive individually against historical data and report per-directive performance' })
  async directiveCoverage(@Body() body: { symbol: string; days?: number; timeframe?: string }) {
    return this.backtestService.runDirectiveCoverage(body);
  }

  /**
   * GET /api/backtest/directive-audit — full directive performance audit.
   * Supports single symbol (?symbol=XAUUSD) or cross-symbol (?symbols=XAUUSD,EURUSD).
   * Includes protocol impact analysis and saves to trend storage.
   */
  @Get('directive-audit')
  async directiveAudit(
    @Query('symbol') symbol?: string,
    @Query('symbols') symbols?: string,
    @Query('days') days?: string,
  ) {
    const lookback = days ? parseInt(days, 10) : 365;
    const tickers = symbols
      ? symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : [(symbol || 'XAUUSD').toUpperCase()];

    // ── Build protocol→directive map for impact analysis ──
    const protocolImpact = new Map<string, string[]>(); // directiveId → protocol slugs
    try {
      if (this.prisma.isAvailable) {
        const entries = await (this.prisma as any).protocolDirectiveEntry.findMany({
          include: { group: { include: { protocol: { select: { slug: true } } } } },
        });
        for (const e of entries) {
          const slug = e.group?.protocol?.slug;
          if (!slug) continue;
          if (!protocolImpact.has(e.directiveId)) protocolImpact.set(e.directiveId, []);
          if (!protocolImpact.get(e.directiveId)!.includes(slug)) {
            protocolImpact.get(e.directiveId)!.push(slug);
          }
        }
      }
    } catch { /* DB may not have protocol tables */ }

    // ── Run audit per symbol ──
    const perSymbol: any[] = [];
    for (const ticker of tickers) {
      const raw = await this.backtestService.runDirectiveCoverage({
        symbol: ticker, days: lookback, timeframe: '1d',
      });
      if ((raw as any).error) { perSymbol.push({ symbol: ticker, error: (raw as any).error }); continue; }

      const results = (raw as any).results || [];
      const withSignals = results.filter((r: any) => !r.error && r.signals >= 3);
      const top = withSignals.filter((r: any) => r.winRate10d > 55).sort((a: any, b: any) => b.winRate10d - a.winRate10d);
      const refine = withSignals.filter((r: any) => r.winRate10d >= 45 && r.winRate10d <= 55);
      const stub = withSignals.filter((r: any) => r.winRate10d < 45);
      const noSignals = results.filter((r: any) => !r.error && r.signals < 3);

      const mapResult = (r: any) => ({
        directiveId: r.directiveId, name: r.name, signals: r.signals,
        winRate5d: r.winRate5d, avgReturn5d: r.avgReturn5d,
        winRate10d: r.winRate10d, avgReturn10d: r.avgReturn10d,
        protocols: protocolImpact.get(r.directiveId) || [],
      });

      perSymbol.push({
        symbol: ticker,
        days: lookback,
        summary: { totalDirectives: results.length, withSignals: withSignals.length, top: top.length, refine: refine.length, stub: stub.length, noSignals: noSignals.length },
        top: top.map(mapResult),
        refine: refine.map(mapResult),
        stub: stub.map(mapResult),
        noSignals: noSignals.map((r: any) => ({ directiveId: r.directiveId, name: r.name, protocols: protocolImpact.get(r.directiveId) || [] })),
      });
    }

    // ── Save to trend storage ──
    try {
      if (this.prisma.isAvailable && perSymbol.length > 0 && !perSymbol[0].error) {
        const s = perSymbol[0].summary;
        await (this.prisma as any).directiveAuditRun.create({
          data: {
            symbol: tickers.join(','),
            days: lookback,
            topCount: s.top,
            refineCount: s.refine,
            stubCount: s.stub,
            noDataCount: s.noSignals,
            results: perSymbol,
          },
        });
      }
    } catch { /* non-critical */ }

    return {
      symbols: tickers,
      days: lookback,
      generatedAt: new Date().toISOString(),
      perSymbol,
    };
  }

  /**
   * GET /api/backtest/directive-audit/history — past audit runs for trend analysis.
   */
  @Get('directive-audit/history')
  async auditHistory(@Query('symbol') symbol?: string, @Query('limit') limit?: string) {
    if (!this.prisma.isAvailable) return { runs: [] };
    const take = Math.min(parseInt(limit || '10', 10) || 10, 50);
    try {
      const where: any = {};
      if (symbol) where.symbol = { contains: symbol.toUpperCase() };
      const runs = await (this.prisma as any).directiveAuditRun.findMany({
        where, orderBy: { runAt: 'desc' }, take,
      });
      return {
        runs: runs.map((r: any) => ({
          id: r.id, symbol: r.symbol, days: r.days,
          topCount: r.topCount, refineCount: r.refineCount, stubCount: r.stubCount, noDataCount: r.noDataCount,
          runAt: r.runAt,
        })),
      };
    } catch { return { runs: [] }; }
  }

  // ── Benchmark Comparison ──────────────────────────────

  @Get('benchmark')
  @ApiOperation({ summary: 'Compare strategy returns against buy-and-hold benchmark' })
  async benchmark(
    @Query('symbol') symbol: string,
    @Query('days') days?: string,
  ) {
    const lookbackDays = days ? parseInt(days, 10) : 90;
    if (!symbol) return { error: 'symbol query parameter is required' };

    if (!this.prisma.isAvailable) {
      return { error: 'Database unavailable for benchmark comparison' };
    }

    try {
      // Fetch 1d bars for the lookback period
      const bars = await (this.prisma as any).marketBar.findMany({
        where: {
          symbol: { ticker: symbol.toUpperCase() },
          timeframe: '1d',
        },
        orderBy: { timestamp: 'desc' },
        take: lookbackDays + 5,
      });

      if (!bars || bars.length < 5) {
        return { error: `Insufficient daily bar data for ${symbol} (need 5+, have ${bars?.length || 0})` };
      }

      bars.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const firstBar = bars[0];
      const lastBar = bars[bars.length - 1];
      const firstPrice = firstBar.close;
      const lastPrice = lastBar.close;

      // Buy-and-hold return
      const bhReturnPct = ((lastPrice - firstPrice) / firstPrice) * 100;
      const bhReturn = bhReturnPct;

      // Max drawdown for buy-and-hold
      let peak = firstPrice;
      let maxDrawdownPct = 0;
      for (const bar of bars) {
        if (bar.close > peak) peak = bar.close;
        const dd = ((bar.close - peak) / peak) * 100;
        if (dd < maxDrawdownPct) maxDrawdownPct = dd;
      }

      // Get strategy trades for this symbol
      let strategyReturn = 0;
      let strategyWinRate = 0;
      let strategyTrades = 0;
      try {
        const trades = await (this.prisma as any).trade.findMany({
          where: { symbol: symbol.toUpperCase(), status: 'closed' },
          orderBy: { openedAt: 'asc' },
          take: 200,
        });
        if (trades && trades.length > 0) {
          strategyTrades = trades.length;
          const wins = trades.filter((t: any) => (t.pnl || 0) > 0).length;
          strategyWinRate = Math.round((wins / trades.length) * 10000) / 100;
          strategyReturn = trades.reduce((sum: number, t: any) => sum + (t.pnl || 0), 0);
        }
      } catch { /* no trades yet */ }

      const alpha = strategyReturn - bhReturnPct;
      const outperformed = strategyReturn > bhReturnPct;

      return {
        symbol: symbol.toUpperCase(),
        period: `${bars.length} trading days (${firstBar.timestamp} → ${lastBar.timestamp})`,
        benchmark: {
          name: 'Buy & Hold',
          startPrice: Math.round(firstPrice * 100) / 100,
          endPrice: Math.round(lastPrice * 100) / 100,
          returnPct: Math.round(bhReturn * 100) / 100,
          maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
        },
        strategy: {
          trades: strategyTrades,
          winRate: strategyWinRate,
          totalPnl: Math.round(strategyReturn * 100) / 100,
        },
        comparison: {
          alpha: Math.round(alpha * 100) / 100,
          outperformed,
          verdict: outperformed
            ? `Strategy beat buy-and-hold by ${Math.abs(alpha).toFixed(2)}%`
            : `Buy-and-hold beat strategy by ${Math.abs(alpha).toFixed(2)}%`,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      return { error: `Benchmark comparison failed: ${(err as Error).message}` };
    }
  }
}

