import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { devTestPeriodName } from './dev-test-window';
import { PrismaService } from '../../database/prisma.service';
import { AdapterFactory } from '../providers/adapter-factory';
import { SettingsResolverService } from '../../common/settings/settings-resolver.service';
import { sessionAwareGapProfile, periodHealth, PeriodHealth, PeriodStandard, timeframeMinutes } from './score-maths';

/**
 * BacktestPeriodService — a WINDOW a human remembers by its story, not its dates. (#986)
 * ======================================================================================
 *
 * Owner's own requirement, verbatim:
 *
 *   "I want to import bars, general market time is fine for some symbols, but I want the ability to
 *    input specific time date for the purpose of backtesting a specific period. When I do that — I
 *    want to be able to name the request and add a note reminder of what the period involves i.e.
 *    the 300% surge of Greenland Mining when Trump signed a deal, over just 2 days. I will use the
 *    manual tool to capture that period and store it for many tests."
 *
 * ⚠️ WHY THIS EXISTS AT ALL — the measured gap it closes.
 * `BacktestRun` already stores `startDate`/`endDate`, and `run()` loads bars with
 * `take: days + 120` — a ROW LIMIT walking backwards from the newest bar. So the engine could only
 * ever measure "the most recent N bars". A window that ended months ago (the Greenland Mining
 * surge, a specific earnings move, a vol spike) was **not expressible**, which is why the sprint
 * verdict could not be produced: the sample was missing, not the logic.
 *
 * ⚠️ THIS IS NOT A SECOND BAR STORE. Bars stay in `MarketBar` — the table the backtest and the
 * #819 replay both read. A `BacktestPeriod` row only NAMES A RANGE of it. Adding a second series
 * would mean two copies drifting and only one getting the next fix.
 *
 * ── Pipeline position ────────────────────────────────────────────────────────────────────────
 *   capture:  POST /api/backtest/periods            → create the named window (no network)
 *             POST /api/backtest/periods/:id/import → fetch bars into MarketBar, idempotently
 *   measure:  POST /api/backtest/run { periodId }   → run() loads ONLY that window
 *   replay:   POST /api/replay/period/:id           → #819 replays the same window
 *   inspect:  GET  /api/backtest/periods            → the list the owner picks from
 */

/** Where a captured window's bars come from, in preference order. */
const RANGE_PROVIDER_ORDER = ['yahoo', 'mt5', 'alphavantage', 'trading212'];

export interface CreatePeriodInput {
  name: string;
  note?: string | null;
  /** Ticker (e.g. `GML`, `XAUUSD`) — not a symbolId, because a human types a ticker. */
  symbol: string;
  timeframe: string;
  from: string;
  to: string;
  /**
   * Register the `symbol` row when the ticker is unknown. Default TRUE for the capture tool —
   * a window for a symbol the app has never seen is the whole point (stocks and indices are the
   * measured gap). Structural callers (a seeder, a test) set false to get a refusal instead.
   */
  registerSymbol?: boolean;
  /** Name for a symbol being registered (falls back to the ticker). */
  symbolName?: string;
  /** `stock` | `etf` | `index` | `forex` | `crypto` — defaults to `stock` for a fresh ticker. */
  symbolType?: string;
}

export interface ImportBarsResult {
  /**
   * ⚠️ THREE OUTCOMES, and `no-bars` must never look like `imported`.
   * `imported`            — the provider returned bars and they are now in MarketBar
   * `no-bars`             — the provider answered, and the window is EMPTY (a finding)
   * `provider-unavailable`— no provider could answer; we do NOT know whether bars exist
   */
  outcome: 'imported' | 'no-bars' | 'provider-unavailable';
  periodId: string;
  symbol: string;
  timeframe: string;
  requestedFrom: string;
  requestedTo: string;
  provider: string | null;
  /** Bars the provider returned for the requested window. */
  fetched: number;
  /** Rows ADDED to MarketBar by this call. 0 on a re-run — that is the idempotency proof. */
  inserted: number;
  /** Bars the provider returned that MarketBar already held (not overwritten — see below). */
  alreadyPresent: number;
  /** Rows in MarketBar over the fetched span, before and after. The criterion's raw evidence. */
  barsBefore: number;
  barsAfter: number;
  /** First and last bar now present — so a TRUNCATED window is visible, not assumed complete. */
  coveredFrom: string | null;
  coveredTo: string | null;
  /** Providers that were tried and could not answer, with the reason. */
  attempted: Array<{ provider: string; reason: string }>;
  /** Human-readable findings. Empty means nothing surprising happened. */
  findings: string[];
}

export interface PeriodCoverage {
  periodId: string;
  name: string;
  symbol: string;
  timeframe: string;
  requestedFrom: string;
  requestedTo: string;
  /** Bars present in MarketBar for this window RIGHT NOW. 0 is a real answer. */
  barCount: number;
  coveredFrom: string | null;
  coveredTo: string | null;
  /**
   * Distinct providers that supplied the bars present — more than one is a mixture, and is said.
   *
   * ⚠️ THIS is where "who supplied these bars" is answered, NOT `BacktestPeriod.provider`. That
   * column records what an IMPORT supplied; this records what the TABLE holds. Measured
   * 2026-09-29: a window with 289 mt5 bars had `provider: null` after an import that fetched
   * nothing, which is correct about the import and misleading about the bars.
   */
  providers: string[];
  /** True when `barCount > 0` and the window's own ends are not covered. */
  truncatedStart: boolean;
  truncatedEnd: boolean;
  /**
   * The VERDICT (2026-10-29). A bar COUNT cannot say whether a window is measurable — the VIX dev
   * window held 7,662 bars while covering 63.9% of its span with a 111-hour hole in the middle.
   * `status: 'unusable'` is a REFUSAL, and `BacktestService.run()` enforces it.
   */
  health: PeriodHealth;
}

/**
 * Pure arithmetic for one import, so the idempotency claim is testable without a database.
 *
 * ⚠️ `before`/`after` MUST be counted over the same span the insert covered, or the subtraction is
 * meaningless. Callers pass counts over the FETCHED span (min..max of the returned bars), never
 * over the requested window — the two differ whenever a provider returns a bucket that starts
 * slightly before `from`, and the window-scoped count would then undercount the insert and make a
 * working import look like it lost rows.
 */
export function summariseImport(input: {
  fetched: number;
  barsBefore: number;
  barsAfter: number;
}): { inserted: number; alreadyPresent: number; lostRows: number } {
  const inserted = input.barsAfter - input.barsBefore;
  return {
    inserted,
    alreadyPresent: input.fetched - inserted,
    // A negative delta means rows DISAPPEARED between the two counts. Nothing in this service
    // deletes, so this can only be a concurrent prune or a bug — it is reported, never smoothed.
    lostRows: inserted < 0 ? -inserted : 0,
  };
}

@Injectable()
export class BacktestPeriodService {
  private readonly logger = new Logger(BacktestPeriodService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly adapters: AdapterFactory,
    private readonly settings: SettingsResolverService,
  ) {}

  // ── Create ────────────────────────────────────────────────────────────────────────────────

  /**
   * Create a named window. Does NOT touch the network — creating a period and filling it are two
   * separate acts, so a period can be defined now and captured when the provider is reachable.
   */
  async create(input: CreatePeriodInput) {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('A period needs a name — it is how you find it again.');

    const ticker = (input.symbol ?? '').trim().toUpperCase();
    if (!ticker) throw new BadRequestException('A period needs a symbol.');

    const timeframe = (input.timeframe ?? '').trim();
    if (!timeframe) throw new BadRequestException('A period needs a timeframe.');

    const from = parseInstant(input.from, 'from');
    const to = parseInstant(input.to, 'to');
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException(
        `'from' (${from.toISOString()}) must be BEFORE 'to' (${to.toISOString()}).`,
      );
    }

    const { symbol, registered } = await this.resolveSymbol(ticker, input);

    const row = await this.prisma.backtestPeriod.create({
      data: {
        name,
        note: input.note?.trim() || null,
        symbolId: symbol.id,
        timeframe,
        fromDate: from,
        toDate: to,
      },
    });

    this.logger.log(
      `Period created: '${name}' ${ticker} ${timeframe} ${from.toISOString()} → ${to.toISOString()}` +
        `${registered ? ' (symbol registered)' : ''}`,
    );

    return {
      ...row,
      symbol: symbol.ticker,
      // ⚠️ Stated, not implied: a symbol registered here is a DATABASE-ONLY row. Re-seeding cannot
      // recreate it, because there is no seeder for a ticker a human invented — the same position a
      // watchlist entry or a trade occupies. See the note on `resolveSymbol`.
      symbolRegistered: registered,
      barCount: await this.countBars(symbol.id, timeframe, from, to),
    };
  }

  /**
   * Find the `symbol` row for a ticker, creating it when allowed.
   *
   * ⚠️ SEED DISCIPLINE, APPLIED DELIBERATELY. `database-seed-discipline.instructions.md` says a
   * configuration change written only to the database is lost on reinstall. A captured PERIOD and a
   * newly-seen SYMBOL are not configuration — they are user data, in the same class as a trade or a
   * watchlist entry, and there is no seeder for either because the values are chosen by a human at
   * runtime rather than by the repo. So the rule's INTENT does not apply; what DOES apply is that
   * this must be visible, which is why `symbolRegistered` is returned rather than quietly true.
   */
  private async resolveSymbol(
    ticker: string,
    input: Pick<CreatePeriodInput, 'registerSymbol' | 'symbolName' | 'symbolType'>,
  ): Promise<{ symbol: { id: string; ticker: string }; registered: boolean }> {
    const existing = await this.prisma.symbol.findUnique({ where: { ticker } });
    if (existing) return { symbol: existing, registered: false };

    if (input.registerSymbol === false) {
      throw new NotFoundException(
        `No symbol '${ticker}'. Refusing to create one: this path was told not to register.`,
      );
    }

    const created = await this.prisma.symbol.create({
      data: {
        ticker,
        name: input.symbolName?.trim() || ticker,
        // `type` drives import-provider choice and asset-class defaults downstream.
        type: input.symbolType?.trim() || 'stock',
        active: true,
      },
    });
    return { symbol: created, registered: true };
  }

  // ── Import bars ───────────────────────────────────────────────────────────────────────────

  /**
   * Fetch the window's bars into `MarketBar`, idempotently.
   *
   * ⚠️ AN EXISTING BAR IS NOT OVERWRITTEN, on purpose. The unique key is
   * (symbolId, timeframe, timestamp) — it does NOT include `provider`. So an overwrite can silently
   * replace a bar recorded from one feed with a bar from another, leaving `provider` describing a
   * source that no longer supplied the row. Measured hazard, not hypothetical: XAUUSD 5m in this
   * database is MT5 data, and Yahoo's gold series is a different instrument at a different price.
   * Mixing them inside one series would corrupt a backtest while every row still looked valid.
   * Overlap is therefore REPORTED (`alreadyPresent`, and `providers` on the coverage read) rather
   * than resolved by a guess about which feed is right.
   */
  async importBars(periodId: string): Promise<ImportBarsResult> {
    const period = await this.prisma.backtestPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`No backtest period ${periodId}.`);

    const symbol = await this.prisma.symbol.findUnique({ where: { id: period.symbolId } });
    if (!symbol) {
      throw new NotFoundException(
        `Period ${periodId} points at symbol ${period.symbolId}, which does not exist. ` +
          'The tables here are MyISAM, so this has no foreign key to enforce it.',
      );
    }

    const from = period.fromDate;
    const to = period.toDate;
    const attempted: Array<{ provider: string; reason: string }> = [];
    const aliases = (symbol.aliases as Record<string, string>) ?? {};

    let fetchedBars: Array<{ timestamp: Date; open: number; high: number; low: number; close: number; volume: number }> | null = null;
    let usedProvider: string | null = null;
    let sawEmptyAnswer = false;

    for (const providerId of RANGE_PROVIDER_ORDER) {
      const adapter = this.adapters.create(providerId);
      // ⚠️ A provider with no `getCandlesRange` is SKIPPED, not asked with the limit-based method.
      // Using `getCandles` here would return the most recent N bars instead of the requested window
      // and the result would look like a successful capture of the wrong dates.
      if (!adapter?.getCandlesRange) {
        attempted.push({ provider: providerId, reason: 'no range fetch — cannot target a past window' });
        continue;
      }
      try {
        const tickerForProvider = aliases[providerId] || symbol.ticker;
        const bars = await adapter.getCandlesRange(tickerForProvider, period.timeframe, from, to);
        if (bars === null) {
          attempted.push({ provider: providerId, reason: 'provider did not answer (unknown, not empty)' });
          continue;
        }
        if (bars.length === 0) {
          sawEmptyAnswer = true;
          attempted.push({ provider: providerId, reason: 'answered, but this window is empty' });
          continue;
        }
        fetchedBars = bars;
        usedProvider = providerId;
        break;
      } catch (err) {
        attempted.push({ provider: providerId, reason: (err as Error).message });
      }
    }

    // ── No provider supplied bars. ⚠️ THAT IS NOT THE SAME AS AN EMPTY WINDOW ────────────────
    //
    // ⚠️ MEASURED DEFECT, 2026-09-29 — this branch used to write `barCount: 0` WITHOUT LOOKING AT
    // `MarketBar`, and that made the stored figure contradict the table it summarises. Observed on a
    // real period (XAUUSD 5m, 2026-09-15 → 2026-09-16):
    //
    //   import outcome : provider-unavailable  (Yahoo cannot serve XAUUSD 5m; the other three
    //                                            adapters implement no range fetch)
    //   stored barCount: 0                      <- "this window holds nothing"
    //   coverage       : 289, providers=[mt5]   <- the window holds 289 bars
    //
    // The LIST is what the owner picks from, so it would have offered a window labelled EMPTY that
    // can be measured perfectly well. Two different questions had been given one answer:
    //   "did a provider supply bars?"      -> no        (this import's answer)
    //   "does the window hold bars?"       -> yes, 289  (the table's answer)
    //
    // So `barCount` now ALWAYS comes from `MarketBar` — it is the column's stated meaning — while
    // `provider` records only what THIS import supplied (null when it supplied nothing). A window
    // that already holds bars explains the null in `findings[]` rather than leaving it ambiguous.
    if (!fetchedBars) {
      const existing = await this.coverage(periodId);
      const findings: string[] = [
        sawEmptyAnswer
          ? `No provider returned bars for ${symbol.ticker} ${period.timeframe} ` +
            `${from.toISOString()} → ${to.toISOString()}. The window is EMPTY as far as the ` +
            'providers are concerned — check the ticker, the date range, and whether the exchange ' +
            'traded over it (a weekend or a holiday window is legitimately empty).'
          : `No provider could answer for ${symbol.ticker} ${period.timeframe}. This is NOT the ` +
            'same as an empty window: nothing established whether bars exist. See `attempted`.',
      ];
      if (existing.barCount > 0) {
        findings.push(
          `⚠️ This window ALREADY HOLDS ${existing.barCount} bar(s) from ` +
            `[${existing.providers.join(', ')}]. This import supplied none, so 'provider' is null — ` +
            'that is the IMPORT having no provider, NOT the window being empty. Run a backtest ' +
            'against it as normal; the bars are there.',
        );
      }
      await this.prisma.backtestPeriod.update({
        where: { id: periodId },
        data: { barCount: existing.barCount, provider: null },
      });
      return {
        outcome: sawEmptyAnswer ? 'no-bars' : 'provider-unavailable',
        periodId,
        symbol: symbol.ticker,
        timeframe: period.timeframe,
        requestedFrom: from.toISOString(),
        requestedTo: to.toISOString(),
        provider: null,
        fetched: 0,
        inserted: 0,
        alreadyPresent: 0,
        barsBefore: existing.barCount,
        barsAfter: existing.barCount,
        coveredFrom: existing.coveredFrom,
        coveredTo: existing.coveredTo,
        attempted,
        findings,
      };
    }

    // ── Count BEFORE, over the FETCHED span (see `summariseImport` for why not the window) ──
    const stamps = fetchedBars.map((b) => b.timestamp.getTime());
    const spanFrom = new Date(Math.min(...stamps));
    const spanTo = new Date(Math.max(...stamps));
    const span = { gte: spanFrom, lte: spanTo };

    const barsBefore = await this.prisma.marketBar.count({
      where: { symbolId: symbol.id, timeframe: period.timeframe, timestamp: span },
    });

    // `INSERT IGNORE` semantics: rows already present (same symbol+timeframe+timestamp) are skipped,
    // so a re-run adds nothing and the count is stable. MyISAM honours the unique key for this.
    await this.prisma.marketBar.createMany({
      data: fetchedBars.map((b) => ({
        symbolId: symbol.id,
        provider: usedProvider as string,
        timeframe: period.timeframe,
        timestamp: b.timestamp,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume ?? 0,
      })),
      skipDuplicates: true,
    });

    const barsAfter = await this.prisma.marketBar.count({
      where: { symbolId: symbol.id, timeframe: period.timeframe, timestamp: span },
    });
    const sums = summariseImport({ fetched: fetchedBars.length, barsBefore, barsAfter });

    const coverage = await this.coverage(periodId);
    const findings: string[] = [];
    if (sums.lostRows > 0) {
      findings.push(
        `⚠️ ${sums.lostRows} row(s) DISAPPEARED between the before/after counts. Nothing in this ` +
          'service deletes — suspect a concurrent prune or a bug, not a quiet success.',
      );
    }
    if (sums.alreadyPresent > 0) {
      findings.push(
        `${sums.alreadyPresent} of ${fetchedBars.length} returned bars were ALREADY in MarketBar ` +
          'and were left untouched (this import never overwrites — see importBars). If those bars ' +
          `came from a different feed than '${usedProvider}', the series now MIXES sources; the ` +
          'coverage read names them.',
      );
    }
    // ⚠️ TRUNCATION IS THE SILENT ONE. Yahoo caps intraday history, so a request for a window older
    // than the cap returns only the servable part — with no error. Without this, a 2-day capture that
    // became a 1-day capture reads as a complete result.
    if (coverage.truncatedStart || coverage.truncatedEnd) {
      const missing = [
        coverage.truncatedStart ? 'start' : null,
        coverage.truncatedEnd ? 'end' : null,
      ].filter(Boolean).join(' and ');
      findings.push(
        `⚠️ The window is TRUNCATED at the ${missing}. Requested ` +
          `${from.toISOString()} → ${to.toISOString()}, got ` +
          `${coverage.coveredFrom ?? 'nothing'} → ${coverage.coveredTo ?? 'nothing'}. Providers ` +
          'cap intraday history (roughly 30 days at 1m, 60 days at 5m–30m, 730 at 1h), and a ' +
          'request past the cap returns the servable part WITHOUT an error.',
      );
    }

    await this.prisma.backtestPeriod.update({
      where: { id: periodId },
      data: { barCount: coverage.barCount, provider: usedProvider },
    });

    this.logger.log(
      `Period import '${period.name}': ${fetchedBars.length} fetched from ${usedProvider}, ` +
        `${sums.inserted} inserted, ${sums.alreadyPresent} already present ` +
        `(${coverage.barCount} bars now in window)`,
    );

    return {
      outcome: 'imported',
      periodId,
      symbol: symbol.ticker,
      timeframe: period.timeframe,
      requestedFrom: from.toISOString(),
      requestedTo: to.toISOString(),
      provider: usedProvider,
      fetched: fetchedBars.length,
      inserted: sums.inserted,
      alreadyPresent: sums.alreadyPresent,
      barsBefore,
      barsAfter,
      coveredFrom: coverage.coveredFrom,
      coveredTo: coverage.coveredTo,
      attempted,
      findings,
    };
  }

  // ── Read ──────────────────────────────────────────────────────────────────────────────────

  async list(opts?: { symbol?: string; limit?: number }) {
    const rows = await this.prisma.backtestPeriod.findMany({
      where: opts?.symbol ? { symbol: { ticker: opts.symbol.toUpperCase() } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: opts?.limit ?? 100,
      include: { symbol: { select: { ticker: true, name: true, type: true } } },
    });

    // Which runs measured each period, so the list shows what has already been studied rather than
    // inviting the same window to be measured again by accident.
    const runCounts = await this.prisma.backtestRun.groupBy({
      by: ['periodId'],
      where: { periodId: { in: rows.map((r) => r.id) } },
      _count: { _all: true },
    });
    const runsByPeriod = new Map(
      runCounts.map((r) => [r.periodId as string, r._count._all]),
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      note: r.note,
      symbol: r.symbol.ticker,
      symbolName: r.symbol.name,
      timeframe: r.timeframe,
      from: r.fromDate.toISOString(),
      to: r.toDate.toISOString(),
      /**
       * ⚠️ ALWAYS read from `MarketBar`, never from what an import fetched — see the long note in
       * `importBars`. `null` = never imported; `0` = imported and the window genuinely holds
       * nothing. A window that holds bars from an earlier import reads its true count even when
       * THIS import supplied none.
       */
      barCount: r.barCount,
      /** What an IMPORT supplied. NULL = the last import supplied nothing — which does NOT mean the
       *  window is empty. Use `coverage().providers` for who actually supplied the bars. */
      provider: r.provider,
      runs: runsByPeriod.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async get(id: string) {
    const period = await this.prisma.backtestPeriod.findUnique({
      where: { id },
      include: { symbol: { select: { ticker: true, name: true, type: true } } },
    });
    if (!period) throw new NotFoundException(`No backtest period ${id}.`);

    const runs = await this.prisma.backtestRun.findMany({
      where: { periodId: id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, protocolId: true, timeframe: true,
        startDate: true, endDate: true, totalTrades: true, totalSignals: true,
        winRate: true, totalPnl: true, createdAt: true,
      },
    });

    return {
      ...period,
      symbol: period.symbol.ticker,
      symbolName: period.symbol.name,
      coverage: await this.coverage(id),
      runs,
    };
  }

  /**
   * What is ACTUALLY in `MarketBar` for this window right now, AND whether that makes it usable.
   *
   * ⚠️ Read from the bars, not from the stored `barCount`. The stored figure is a claim made by a
   * previous import; this is what the table holds. When they disagree, that disagreement is the
   * finding — and it is surfaced rather than overwritten.
   *
   * ⚠️ `health` (2026-10-29) IS THE POINT OF THE CALL, not a decoration. Owner direction: *"we should
   * consider some standard requirements to deem a period healthy/complete enough to use at all …
   * until then we should be strict."* A bar count alone cannot say whether the window is measurable —
   * the VIX dev window held a plausible 7,662 bars while covering 63.9% of its span with a 111-hour
   * hole in the middle. `health.status === 'unusable'` is a REFUSAL, and `run()` enforces it.
   */
  async coverage(periodId: string): Promise<PeriodCoverage> {
    const period = await this.prisma.backtestPeriod.findUnique({ where: { id: periodId } });
    if (!period) throw new NotFoundException(`No backtest period ${periodId}.`);
    const symbol = await this.prisma.symbol.findUnique({ where: { id: period.symbolId } });

    const where = {
      symbolId: period.symbolId,
      timeframe: period.timeframe,
      timestamp: { gte: period.fromDate, lte: period.toDate },
    };

    const [barCount, timestamps, first, last, providerRows] = await Promise.all([
      // ⚠️ KEPT AS A COUNT, SEPARATE FROM THE TIMESTAMP READ, because `barCount` has a stated meaning —
      // "bars present in MarketBar for this window" — and a spec already depends on that meaning. The
      // timestamp list below is for the GAP PROFILE only; deriving `barCount` from its length would
      // make the two answers one, and the moment a caller's mock or a capped read returns fewer rows the
      // count would silently shrink.
      this.prisma.marketBar.count({ where }),
      // Whole-row timestamps rather than a count: the gap profile needs the ORDER, and a count cannot
      // say where the holes are. 5m over a few months is ~10-20k rows, which is a cheap read.
      this.prisma.marketBar.findMany({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
      this.prisma.marketBar.findFirst({ where, orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
      this.prisma.marketBar.findFirst({ where, orderBy: { timestamp: 'desc' }, select: { timestamp: true } }),
      this.prisma.marketBar.findMany({ where, distinct: ['provider'], select: { provider: true } }),
    ]);

    const profile = sessionAwareGapProfile(
      timestamps.map((t) => t.timestamp),
      timeframeMinutes(period.timeframe),
    );

    return {
      periodId,
      name: period.name,
      symbol: symbol?.ticker ?? '(missing symbol)',
      timeframe: period.timeframe,
      requestedFrom: period.fromDate.toISOString(),
      requestedTo: period.toDate.toISOString(),
      barCount,
      coveredFrom: first?.timestamp.toISOString() ?? null,
      coveredTo: last?.timestamp.toISOString() ?? null,
      providers: providerRows.map((p) => p.provider).sort(),
      // ⚠️ THE SUBTRACTION DIRECTION IS THE WHOLE CHECK. "Truncated at the start" means the first
      // bar is LATER than the window's start — so it is `first - from`, not `from - first`. The
      // first version of this line had it inverted, which made the flag `false` for every real
      // truncation (a negative number is never > an hour) and `true` for none. The test caught it.
      //
      // A gap of more than an hour at either end is a real shortfall rather than an alignment
      // artefact — bar timestamps are bucket STARTS, so the first bar can begin slightly after
      // `from` without anything being missing.
      truncatedStart:
        barCount > 0 &&
        (first?.timestamp.getTime() ?? 0) - period.fromDate.getTime() > 3_600_000,
      truncatedEnd:
        barCount > 0 &&
        period.toDate.getTime() - (last?.timestamp.getTime() ?? 0) > 3_600_000,
      health: periodHealth(profile, await this.periodStandard()),
    };
  }

  /**
   * The health standard IN FORCE, read from settings so the rule that produced a verdict is never a
   * constant buried in a service. See `backtest.periodMinCoveragePct` / `.periodMaxHoleMinutes`.
   */
  async periodStandard(): Promise<PeriodStandard> {
    const [minCoveragePct, maxHoleMinutes] = await Promise.all([
      this.settings.get<number>('backtest.periodMinCoveragePct'),
      this.settings.get<number>('backtest.periodMaxHoleMinutes'),
    ]);
    return { minCoveragePct: Number(minCoveragePct), maxHoleMinutes: Number(maxHoleMinutes) };
  }

  // ── Update / delete ───────────────────────────────────────────────────────────────────────

  /** Rename or re-note. The WINDOW is deliberately not editable — see the throw below. */
  async update(id: string, patch: { name?: string; note?: string | null }) {
    const period = await this.prisma.backtestPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException(`No backtest period ${id}.`);

    if (patch.name !== undefined && !patch.name.trim()) {
      throw new BadRequestException('A period name cannot be blank — it is how you find it again.');
    }

    return this.prisma.backtestPeriod.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
        ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
      },
    });
  }

  /**
   * ⚠️ A window that has been measured is NOT deleted by default.
   * `backtestrun.periodId` would be left pointing at nothing, and the runs made against it would
   * then look like protocol-scoped runs — silently, because the tables are MyISAM and there is no
   * foreign key to stop it. So the caller must say `cascade: true`, having been told the run count.
   */
  async remove(id: string, opts?: { cascade?: boolean }) {
    const period = await this.prisma.backtestPeriod.findUnique({ where: { id } });
    if (!period) throw new NotFoundException(`No backtest period ${id}.`);

    const runs = await this.prisma.backtestRun.count({ where: { periodId: id } });
    if (runs > 0 && !opts?.cascade) {
      throw new BadRequestException(
        `${runs} backtest run(s) used this period. Deleting it would leave them unlabelled, and a ` +
          'period comparison would then read as a protocol comparison. Re-send with `cascade: true` ' +
          'to unlink them on purpose.',
      );
    }

    if (runs > 0) {
      // Unlink, never delete the runs: the RUNS are the measurement, and losing them to tidy up a
      // label would destroy evidence. `periodId` goes back to NULL = "not period-scoped".
      await this.prisma.backtestRun.updateMany({ where: { periodId: id }, data: { periodId: null } });
    }
    await this.prisma.backtestPeriod.delete({ where: { id } });

    // ⚠️ The BARS are left alone, on purpose. `MarketBar` rows are not owned by the period — the
    // same window may be named by another period, and a symbol's bars are shared by every consumer
    // (backtest, replay, charting). Deleting them here would be a destructive surprise from a
    // metadata action.
    return { deleted: true, unlinkedRuns: runs, barsRetained: true };
  }

  // ── Consumer support ──────────────────────────────────────────────────────────────────────

  /**
   * The window, resolved for a consumer (backtest run, #819 replay).
   *
   * ⚠️ THROWS when the id does not resolve, rather than falling back to an unscoped range. A silent
   * fallback would measure a different window while reporting the requested one — the exact defect
   * `resolveBotDrivenRequest` refuses for `botId`.
   */
  /**
   * The FROZEN DEVELOPMENT WINDOW for one symbol+timeframe (#1132 option A).
   *
   * ⚠️ WHY A LOOKUP BY NAME RATHER THAN A HARD-CODED DATE RANGE. `backtest_period` is per-symbol and
   * per-timeframe (`symbolId`/`timeframe` NOT NULL), so a global window cannot be one row — the seeder
   * writes one row per pair. Reading the rows keeps the seeded window and the windows a run actually
   * measured as ONE mechanism; hard-coding the dates here would be a second source that drifts from
   * `dev-test-window.ts`.
   *
   * ⚠️ THROWS when the window is not seeded, and names the command that seeds it. The alternative —
   * falling back to `days` — is exactly the defect this whole change removes: `days` is a ROW LIMIT
   * (`take: days + 120`) that walks back from the newest bar, so the window it measures is invisible
   * and timeframe-dependent. A run must never silently measure one thing while the caller asked for a
   * frozen window.
   */
  async resolveDevWindow(symbol: string, timeframe: string) {
    const name = devTestPeriodName();
    const row = await this.prisma.backtestPeriod.findFirst({
      where: { name, symbol: { ticker: symbol.toUpperCase() }, timeframe },
      include: { symbol: { select: { ticker: true } } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new BadRequestException(
        `The frozen development window (${name}) is not seeded for ${symbol} ${timeframe}. `
        + `Seed it with: npm --prefix nest run seed:dev-window (then --apply) — and re-run. `
        + `Refusing to fall back to a bar count: that would measure an invisible, `
        + `timeframe-dependent window while reporting a frozen one.`,
      );
    }
    return {
      id: row.id,
      name: row.name,
      symbol: row.symbol.ticker,
      timeframe: row.timeframe,
      from: row.fromDate,
      to: row.toDate,
      note: row.note ?? null,
      /** How the window was chosen — travels with the run so a comparison can state its basis. */
      source: `period:${row.name}` as const,
    };
  }

  async resolveForRun(periodId: string) {
    const period = await this.prisma.backtestPeriod.findUnique({
      where: { id: periodId },
      include: { symbol: { select: { ticker: true } } },
    });
    if (!period) {
      throw new BadRequestException(
        `No backtest period '${periodId}'. Refusing to run: an unresolvable period would silently ` +
          'measure a different window than the one requested.',
      );
    }
    return {
      id: period.id,
      name: period.name,
      note: period.note,
      symbol: period.symbol.ticker,
      timeframe: period.timeframe,
      from: period.fromDate,
      to: period.toDate,
    };
  }

  private async countBars(symbolId: string, timeframe: string, from: Date, to: Date): Promise<number> {
    return this.prisma.marketBar.count({
      where: { symbolId, timeframe, timestamp: { gte: from, lte: to } },
    });
  }
}

/** Parse an ISO instant, refusing anything ambiguous rather than letting `new Date` guess. */
function parseInstant(value: string, field: string): Date {
  if (!value) throw new BadRequestException(`A period needs '${field}'.`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`'${field}' is not a valid date: ${value}`);
  }
  return d;
}
