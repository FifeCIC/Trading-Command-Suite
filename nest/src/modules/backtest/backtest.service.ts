import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// #965 item 1 — the sample bar is shared with the live snapshot trial's verdict rather than
// re-declared here. See the module header for the measurement that produced it.
import { assessSamples, MIN_SAMPLES_FOR_VERDICT } from '../../common/trading/verdict-bar';
import { DirectivesService } from '../directives/directives.service';
import { DirectiveInput, DirectiveResult, MarketBar } from '../directives/interfaces/directive.interface';
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';
// #843 — the ONE sizing implementation, shared with the live automation loop.
import { computeSizing } from '../trading/position-sizing';
import { BacktestPeriodService } from './backtest-period.service';
// #1021 — ONE derivation of the trade win rate. This existed in FOUR places in TWO unit
// conventions (three `groupBy` pairs producing a PERCENT, one in-memory producing a FRACTION), and
// one of them returned `0` where the others returned `null` for a run with no trades.
import {
  countTradeWinRatesByRun,
  tradeWinRateFromRows,
  percentOrNull,
  NO_TRADES,
} from './run-metrics';

/**
 * #986 — the most bars a single PERIOD-scoped run will load.
 *
 * ⚠️ Exceeding it is an ERROR, not a silent truncation. `take` returns the FIRST N rows in
 * `timestamp` order, so capping silently would drop the END of the window — the run would report
 * results for a window it only partly read, with nothing in the output saying so. Refusing is the
 * honest failure: the caller can narrow the period or coarsen the timeframe.
 *
 * The cap is generous because it is a guard against a mis-specified window, not a performance
 * budget — but note the engine calls `fullScore()` once per bar, so a very large window is also
 * very slow, and the error message says so.
 */
export const PERIOD_BAR_CAP = 20_000;

/**
 * #819 — how many bars the replay endpoint returns in one call. Capped because a 5m window over
 * a month is ~8,600 bars; the cap is REPORTED in the payload (`barsCap`, and a caveat when it
 * bites) rather than silently shortening the timeline.
 */
export const REPLAY_BAR_CAP = 3000;

/**
 * #819 — the replay payload. `caveats` is not decoration: it carries the things the run cannot
 * answer, so the view never renders "not recorded" as an empty list. See getReplay().
 */
export interface BacktestReplay {
  run: {
    id: string;
    symbol: string;
    protocolId: string;
    timeframe: string;
    botId: string | null;
    botBaseSize: number | null;
    from: string;
    to: string;
    totalDays: number;
    tradesStored: number;
    totalTrades: number;
    totalSignals: number | null;
    winRatePct: number;
    totalPnl: number;
  };
  trades: Array<{
    id: string;
    direction: string;
    signal: string;
    entryScore: number | null;
    entryTime: string;
    entryPrice: number;
    exitTime: string;
    exitPrice: number;
    exitReason: string;
    /** #R14 — null means this run predates level recording. Null is "not recorded", never 0. */
    stopLoss: number | null;
    takeProfit: number | null;
    positionSize: number | null;
    pnl: number;
    pnlPct: number;
  }>;
  bars: Array<{ time: string; open: number; high: number; low: number; close: number }>;
  barsCap: number;
  caveats: string[];
}

/** A trade stamped exactly at 00:00:00.000 UTC predates the #819 timestamp fix. */
function isMidnight(d: Date): boolean {
  return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
}

export interface BacktestRunRequest {
  /**
   * Optional ONLY when `botId` is supplied — a bot-driven run takes the symbol from the bot, so
   * "backtest this bot" is one call rather than a hand-assembled request (#965 item 3).
   */
  symbol?: string;
  /**
   * #965 item 3 — "backtest this bot" as ONE call. When set, the bot's OWN configuration is
   * resolved (protocol, symbol, timeframe, stop, target) so a caller does not hand-assemble a
   * request that quietly differs from the bot it means to test.
   *
   * ⚠️ PRECEDENCE: an explicit field ALWAYS wins over the bot's, so "this bot, but with a tighter
   * stop" stays one call. `drivenBy.overridden` records which fields the caller replaced, because a
   * run must be able to say what it actually measured.
   */
  botId?: string;
  /**
   * #986 — run against a STORED PERIOD (a named, noted window) instead of a bar count.
   *
   * ⚠️ WITHOUT THIS THE ENGINE CANNOT REACH THE PAST. `days` sets `take: days + 120`, a ROW LIMIT
   * that walks backwards from the newest bar — so the only windows expressible were "the most
   * recent N bars". A window that ended months ago (a specific surge, an earnings move, a vol
   * spike) was not reachable at all, which is why the sprint verdict could not be produced.
   *
   * ⚠️ The period is AUTHORITATIVE for the market and the window (symbol, timeframe, from, to) and
   * the request supplies the STRATEGY (protocol, stops, sizing). A period is a statement about
   * WHERE to look; a protocol is a statement about WHAT to do there.
   *
   * ⚠️ An unresolvable `periodId` THROWS. Falling back to a day-range run would measure a different
   * window while reporting the requested one — the same defect `resolveBotDrivenRequest` refuses.
   */
  periodId?: string;
  days?: number;
  timeframe?: string;
  protocolId?: string;
  slPct?: number;
  tpPct?: number;
  /** Weight overrides — keyed by directive ID, overrides default weights */
  weights?: Record<string, number>;
  /** Execution realism */
  slippage?: number;
  spread?: number;
  assetClass?: 'forex' | 'stock' | 'crypto';
  /** News exclusion mode (#105) */
  newsExclusion?: 'none' | 'exclude' | 'only' | 'reduce';
  /** Position sizing + commission (#50, #269, #271) */
  positionModel?: 'fixedPercent' | 'fixedDollar' | 'atrEqualRisk' | 'kellyFull' | 'kellyHalf';
  accountSize?: number;      // starting account balance in USD
  riskPct?: number;          // risk % per trade (for fixedPercent/atrEqualRisk model)
  fixedAmount?: number;      // fixed $ per trade (for fixedDollar model)
  commission?: number;       // flat commission per trade ($)
  /** ATR equal-risk (#271) */
  atrPeriod?: number;         // lookback for ATR calculation (default 14)
  atrMultiplier?: number;     // stop distance = ATR * multiplier (default 1.5)
  /** Kelly criterion (#269) */
  kellyCapPct?: number;       // max position size cap for Kelly (default 25%)
}

export interface TradeRecord {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  direction: 'LONG' | 'SHORT';
  pnl: number;
  pnlPct: number;
  exitReason: 'TP' | 'SL' | 'EOD';  // Take-profit, Stop-loss, End-of-data
  /**
   * #R14 — the stop and target the trade was measured against, or `undefined` for a run made
   * before they were recorded. Optional on purpose: an old run has no levels and must be able to
   * say **"not recorded"** rather than 0.
   */
  stopLoss?: number;
  takeProfit?: number;
  score: number;
  signal: string;
  protocolId: string;
  // Execution realism (#50)
  positionSize?: number;  // number of shares/contracts
  commission?: number;    // commission deducted ($)
}

export interface EntrySignal {
  date: string;
  score: number;
  signal: string;
  return5d: number | null;
  return10d: number | null;
  return20d: number | null;
  wasProfitable: boolean;
}

/**
 * What a bot-driven run resolved (#965 item 3).
 *
 * ⚠️ `baseSize` is the LIVE path's size in LOTS, carried here because it is the number the result's
 * caveat compares against — the run must be able to say "the bot trades N lots, this measured
 * something else" without the reader going to look it up.
 */
export interface BotDriven {
  botId: string;
  botName: string;
  /** The BOT's symbol. The run's `symbol` differs from it when the caller overrode it. */
  symbol: string;
  protocolId: string | null;
  /** LOTS. NULL = unset — the live loop would default it to 0.01. */
  baseSize: number | null;
  mode: string;
  active: boolean;
  /** Fields the caller supplied that differ from the bot's, i.e. what this run ACTUALLY measured. */
  overridden: string[];
}

/** The bot fields this resolution reads — structural, so the logic is testable without Prisma. */
export interface BotForBacktest {
  id: string;
  name: string;
  symbol: string;
  protocolId: string | null;
  timeframe?: string | null;
  slPct?: number | null;
  tpPct?: number | null;
  baseSize?: number | null;
  mode: string;
  active: boolean;
}

/**
 * mergeBotConfig() — the pure half of a bot-driven backtest (#965 item 3).
 *
 * SEPARATE FROM THE LOADING so precedence and the caveats can be tested without a database or the
 * scoring stack. It is the part that decides what the run MEASURES; the caller supplies the bot.
 *
 * ⚠️ PRECEDENCE: an explicit request field ALWAYS wins over the bot's, and every field it replaced
 * is recorded in `overridden` — because a run must be able to say what it actually measured rather
 * than what the caller asked for.
 *
 * ⚠️ THE SIZING CAVEAT IS NOT DECORATION (#843). The live path sizes every trade in lots from
 * `trading_strategy.baseSize` (`automation-loop.service.ts`: `strategy.baseSize ?? 0.01` passed
 * straight into `placeOrder({ quantity })`), while this backtester sizes in per-unit shares from an
 * equity model. They cannot agree today, so a bot-driven run says so, with the bot's own lot size in
 * the sentence. Without it, the numbers read as a forecast of the bot's P&L and they are not.
 */
export function mergeBotConfig(
  request: BacktestRunRequest,
  bot: BotForBacktest,
): { request: BacktestRunRequest; drivenBy: BotDriven; caveats: string[] } {
  const overridden: string[] = [];
  const pick = <T>(
    given: T | undefined,
    fromBot: T | null | undefined,
    label: string,
  ): T | undefined => {
    if (given !== undefined) {
      if (given !== fromBot) overridden.push(label);
      return given;
    }
    return fromBot ?? undefined;
  };

  const merged: BacktestRunRequest = {
    ...request,
    symbol: request.symbol || bot.symbol,
    timeframe: pick(request.timeframe, bot.timeframe, 'timeframe'),
    protocolId: pick(request.protocolId, bot.protocolId, 'protocolId'),
    slPct: pick(request.slPct, bot.slPct, 'slPct'),
    tpPct: pick(request.tpPct, bot.tpPct, 'tpPct'),
  };

  const baseSize = bot.baseSize ?? null;
  const sizing = merged.positionModel ?? 'fixedPercent';
  const caveats: string[] = [
    `⚠️ POSITION SIZING DOES NOT MATCH THE LIVE PATH (#843). This bot trades ` +
      `${
        baseSize === null
          ? 'an UNSET baseSize (the live loop would use its 0.01 default)'
          : `${baseSize} lot(s)`
      } per trade, while this run sizes in per-unit shares via '${sizing}'. A different size means a ` +
      `different risk per trade, so this run's P&L, drawdown and Sharpe do NOT transfer to the live ` +
      'bot — they describe its ENTRY LOGIC at another size. Read it as a study of the signal until ' +
      '#843 lands one shared sizing function.',
    ...(merged.protocolId
      ? []
      : [
          '⚠️ This bot has NO protocolId, so canonical META.Stack scoring cannot be used and the run ' +
            'will be rejected rather than measured against a default.',
        ]),
  ];

  return {
    request: merged,
    drivenBy: {
      botId: bot.id,
      botName: bot.name,
      symbol: bot.symbol,
      protocolId: bot.protocolId ?? null,
      baseSize,
      mode: bot.mode,
      active: bot.active,
      overridden,
    },
    caveats,
  };
}

export interface BacktestResult {
  id: string;
  symbol: string;
  protocolId: string;
  period: string;
  totalDays: number;
  timeframe: string;
  entrySignals: EntrySignal[];
  trades?: TradeRecord[];
  /**
   * Present ONLY on a bot-driven run (#965 item 3): the configuration that was resolved from the
   * bot, and which of its fields the caller overrode.
   */
  drivenBy?: BotDriven;
  /**
   * ⚠️ What this run CANNOT claim, stated with the numbers rather than left to the reader.
   * A bot-driven run carries the sizing-divergence warning (#843) here.
   */
  caveats?: string[];
  /** News exclusion mode used (#105) */
  newsExclusion?: string;
  /**
   * #986 — the STORED PERIOD this run measured, echoed so a result always says which window it
   * describes. Absent on a day-range run.
   *
   * ⚠️ This travels with the result because `period: '2026-03-11 to 2026-03-13'` does not say WHY
   * the window mattered, and a period comparison that reads as a protocol comparison is the defect
   * the column exists to prevent.
   */
  measuredPeriod?: {
    id: string;
    name: string;
    note: string | null;
    from: string;
    to: string;
    /** Bars actually loaded for the window — the sample the run rests on. */
    bars: number;
  };
  /** Number of news dates found for this symbol/period */
  newsDatesCount?: number;
  /** Execution realism applied (#50) */
  execution?: {
    slippage: number;
    spread: number;
    commission: number;
    positionModel: string;
    accountSize: number;
    riskPct: number;
    fixedAmount: number;
    atrPeriod?: number;
    atrMultiplier?: number;
    kellyCapPct?: number;
    kellyFraction?: number;
    kellyEdge?: number;
  };
  stats: {
    /**
     * Entry SIGNALS — the population `winRate` and `sharpeApproximation` rest on.
     * ⚠️ NULL means NOT RECORDED (runs written before `backtestrun.totalSignals` existed).
     * It is never 0, and never the trade count — see #980.
     */
    totalSignals: number | null;
    /**
     * ⚠️ A **SIGNAL** rate — profitable entry signals ÷ entry signals. It is NOT a trade rate.
     * Two different populations have been conflated here before (#980): run `0dd94ddd` stored
     * 100% beside **0 winners of 3 trades**. Use `tradeWinRate` when the question is about trades.
     */
    winRate: number;
    averageReturn10d: number;
    maxReturn10d: number;
    maxDrawdown10d: number;
    profitFactor: number;
    sharpeApproximation: number;
    // bracket trade stats
    totalTrades?: number;
    /**
     * ⚠️ A **TRADE** rate as a FRACTION (0–1), not a percentage — `run()` and `formatRunResult`
     * must agree on the scale, because one field name with two scales is the defect #980 removed.
     * Counted from `backtesttrade`, never borrowed from `winRate`. NULL when the run made no trades.
     */
    tradeWinRate?: number | null;
    avgTradePnl?: number;
    totalPnl?: number;
    maxTradeDrawdown?: number;
    // position sizing stats (#50)
    avgPositionSize?: number;
    totalCommission?: number;
    netPnl?: number;
    grossPnl?: number;
  };
}

@Injectable()
export class BacktestService {
  private readonly logger = new Logger(BacktestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly directivesService: DirectivesService,
    private readonly protocolDb: ProtocolDbService,
    private readonly protocolGating: ProtocolGatingService,
    // #986 — resolves a stored period to the window a run measures. Only touched when
    // `request.periodId` is set, so a day-range run does not depend on the database here.
    private readonly periods?: BacktestPeriodService,
  ) {}

  /**
   * Resolve a bot-driven request (#965 item 3): "backtest this bot" as ONE call.
   *
   * ⚠️ WHY THE CAVEAT TRAVELS WITH THE RESULT. The live path sizes every trade in **lots** from
   * `trading_strategy.baseSize` (`automation-loop.service.ts`: `strategy.baseSize ?? 0.01`, passed
   * straight into `placeOrder({ quantity })`). This backtester sizes in **per-unit shares** from an
   * equity model — `fixedPercent`, `atrEqualRisk`, Kelly — and the two cannot agree today (#843).
   * So the run is honest about what it is: a study of the ENTRY LOGIC at a different size. Without
   * that sentence, a bot-driven backtest reads as a forecast of the bot's P&L, and it is not.
   *
   * ⚠️ An unresolvable `botId` THROWS rather than falling back to an unscoped run: measuring a
   * different configuration while reporting the requested one is the defect this item exists to stop.
   */
  private async resolveBotDrivenRequest(request: BacktestRunRequest): Promise<{
    request: BacktestRunRequest;
    drivenBy: BotDriven | null;
    caveats: string[];
  }> {
    if (!request.botId) return { request, drivenBy: null, caveats: [] };

    if (!this.prisma.isAvailable) {
      throw new Error(
        'A bot-driven backtest must read the bot first, and the database is unavailable. ' +
          'Refusing to run rather than measure an unresolved configuration.',
      );
    }
    const bot = await this.prisma.tradingStrategy.findUnique({ where: { id: request.botId } });
    if (!bot) {
      throw new Error(
        `No bot with id ${request.botId}. Refusing to run: an unresolvable bot id would silently ` +
          'measure a configuration nobody asked for.',
      );
    }

    // The decision itself is a PURE function (`mergeBotConfig`, above) so precedence and the
    // caveats are testable without a database or the scoring stack. This method's job is only to
    // load the bot and to refuse when it cannot be loaded.
    const merged = mergeBotConfig(request, bot);
    this.logger.log(
      `Bot-driven backtest: ${bot.name} (${bot.id}) -> protocol=${merged.request.protocolId ?? 'NONE'} ` +
        `symbol=${merged.request.symbol} tf=${merged.request.timeframe ?? '(default)'} ` +
        `overridden=[${merged.drivenBy.overridden.join(', ') || 'none'}]`,
    );
    return merged;
  }

  /**
   * #986 — resolve a stored period to the window a run measures, or `null` for a day-range run.
   *
   * ⚠️ IT THROWS RATHER THAN DEFAULTING when the id does not resolve. A fallback to a day-range run
   * would measure a DIFFERENT window while reporting the requested one, and in this engine the
   * difference is invisible: both produce a plausible result set. Same refusal as
   * `resolveBotDrivenRequest` makes for an unresolvable `botId`.
   */
  private async resolvePeriod(periodId?: string) {
    if (!periodId) return null;
    if (!this.periods) {
      throw new Error(
        'A period-scoped backtest was requested but the period service is not wired, so the ' +
          'window cannot be resolved. Refusing to run rather than measuring an unspecified range.',
      );
    }
    return this.periods.resolveForRun(periodId);
  }

  async run(request: BacktestRunRequest): Promise<BacktestResult> {
    // ── #965 item 3 — resolve a BOT-DRIVEN request before anything is defaulted ──────────────
    const resolved = await this.resolveBotDrivenRequest(request);

    // ── #986 — a stored PERIOD names the market and the window ───────────────────────────────
    // Resolved BEFORE the destructure so the period can own `symbol`/`timeframe` below, and so an
    // unresolvable id throws before any work is done.
    const period = await this.resolvePeriod(request.periodId);

    const {
      symbol: requestSymbol,
      days = 365,
      timeframe: requestTimeframe = '1d',
      protocolId,
      slPct = 1.0,
      tpPct = 1.0,
      slippage: rawSlippage,
      spread: rawSpread,
      assetClass,
      newsExclusion = 'none',
      // ── Position sizing + commission (#50) ──
      positionModel = 'fixedPercent',
      accountSize = 10000,
      riskPct = 2.0,
      fixedAmount = 100,
      commission: rawCommission,
      // ── ATR equal-risk (#271) ──
      atrPeriod = 14,
      atrMultiplier = 1.5,
      // ── Kelly criterion (#269) ──
      kellyCapPct = 25,
    } = resolved.request;

    // ⚠️ #986 — A PERIOD WINS ON WHERE TO LOOK; THE REQUEST WINS ON WHAT TO DO THERE.
    // A period is a statement about WHICH market and WHICH dates; a protocol or bot is a statement
    // about WHAT to do in them. So the period owns `symbol` and `timeframe`, while everything else
    // (protocol, stops, sizing, news mode) still comes from the request — over which the bot merge
    // has already applied the caller's precedence.
    const symbol = period?.symbol ?? requestSymbol;
    const timeframe = period?.timeframe ?? requestTimeframe;

    // ⚠️ `totalDays` IS TWO DIFFERENT QUANTITIES, and only the period case knows the real one.
    // On a day-range run it stores the REQUEST's `days` — a row limit, not an elapsed duration. On
    // a period run the window's span is known exactly, so the column carries the true duration. A
    // reader comparing a period run against a day-range run must not assume the same meaning; the
    // `measuredPeriod` echo below is what tells them which they have.
    const totalDays = period
      ? Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / 86_400_000))
      : days;

    // ⚠️ A symbol is still required — from the period, the request, or the bot. Stated rather than
    // defaulted, because a defaulted symbol would measure a market nobody asked for.
    if (!symbol) {
      throw new Error('Backtest requires a symbol, or a botId whose bot declares one.');
    }
    // 2026-09-08: unscoped and custom-weight backtests previously fell into a
    // second scoring implementation. Require the canonical protocol identity.
    if (!protocolId) throw new Error('Backtest requires protocolId for canonical META.Stack scoring.');
    if (request.weights && Object.keys(request.weights).length > 0) {
      throw new Error('Backtest weight overrides are disabled until canonical protocol overrides are supported.');
    }

    // ── Execution realism defaults ──
    const isForex = assetClass === 'forex' || (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol));
    const isCrypto = assetClass === 'crypto';
    const slippage = rawSlippage ?? (isForex ? 0.0001 : isCrypto ? 0.002 : 0.01);
    const spread = rawSpread ?? (isForex ? 0.0001 : isCrypto ? 0.001 : 0.01);
    const commission = rawCommission ?? (isForex ? 0 : isCrypto ? 0.1 : 0); // forex=spread only, stocks=$0 (modern brokers), crypto=0.1% maker/taker

    const doBrackets = slPct > 0 && tpPct > 0;
    const sizingLabel = positionModel.startsWith('kelly')
      ? `${positionModel}(cap=${kellyCapPct}%)`
      : positionModel;
    this.logger.log(`Backtest: ${symbol} ${days}d ${timeframe} protocol=${protocolId ?? 'unscoped'} brackets=${doBrackets} slip=${slippage} spread=${spread} commission=${commission} sizing=${sizingLabel} acct=${accountSize} risk=${riskPct}%`);

    // Load all bars
    //
    // ⚠️ #986 — TWO DIFFERENT QUESTIONS, two different queries. A day-range run asks "the most
    // recent N bars" (`take`, walking backwards from the newest). A PERIOD run asks "every bar
    // between these two instants" (`timestamp` range) — and it must NOT be clamped with `take`,
    // because `take` returns the FIRST rows in ascending order and would silently drop the END of
    // the window. The cap below is therefore a refusal, not a truncation.
    const rows = await this.prisma.marketBar.findMany({
      where: {
        symbol: { ticker: symbol.toUpperCase() },
        timeframe,
        ...(period ? { timestamp: { gte: period.from, lte: period.to } } : {}),
      },
      orderBy: { timestamp: 'asc' },
      // +1 over the cap so hitting it can be DETECTED — a query capped at exactly N cannot tell
      // "exactly N" from "more than N".
      ...(period ? { take: PERIOD_BAR_CAP + 1 } : { take: days + 120 }),
    });

    if (period && rows.length > PERIOD_BAR_CAP) {
      throw new Error(
        `Period '${period.name}' contains more than ${PERIOD_BAR_CAP} ${timeframe} bars ` +
          `(${period.from.toISOString()} → ${period.to.toISOString()}). Refusing to run rather than ` +
          'measure a truncated window: the bar load returns rows in ascending order, so capping it ' +
          'would drop the END of the window and the result would describe dates it never read. ' +
          'Narrow the period, or use a coarser timeframe — note each bar costs one full score ' +
          'evaluation, so a window this large would also be very slow.',
      );
    }

    if (rows.length < 100) {
      const scope = period
        ? `for period '${period.name}' (${period.from.toISOString()} → ${period.to.toISOString()})`
        : `for ${symbol}`;
      throw new Error(
        `Not enough data ${scope}: need 100+ ${timeframe} bars, have ${rows.length}. ` +
          (period
            ? 'The window exists but holds no bars — import them first ' +
              `(POST /api/backtest/periods/${period.id}/import).`
            : 'Try importing data first.'),
      );
    }

    const bars: MarketBar[] = rows.map((r) => ({
      timestamp: r.timestamp,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    // ── News exclusion (#105) ──
    let newsDates: Set<string> | null = null;
    let newsData: Array<{ date: string; sentiment: number; impact: string }> = [];
    if (newsExclusion !== 'none' && this.prisma.isAvailable) {
      try {
        const ticker = symbol.toUpperCase();
        const newsRows = await this.prisma.newsArticle.findMany({
          where: {
            symbol: ticker,
            publishedAt: {
              gte: bars[0].timestamp,
              lte: bars[bars.length - 1].timestamp,
            },
          },
          select: { publishedAt: true, sentiment: true, impact: true },
        });
        newsDates = new Set(newsRows.map(n => n.publishedAt.toISOString().split('T')[0]));
        newsData = newsRows.map(n => ({
          date: n.publishedAt.toISOString().split('T')[0],
          sentiment: n.sentiment,
          impact: n.impact,
        }));
        this.logger.log(`News exclusion: ${newsDates.size} news dates found for ${ticker} (mode: ${newsExclusion})`);
      } catch (err) {
        this.logger.warn(`News query failed, running without exclusion: ${(err as Error).message}`);
      }
    }

    const entrySignals: EntrySignal[] = [];
    const trades: TradeRecord[] = [];
    const windowSize = 100;

    for (let day = windowSize; day < bars.length; day++) {
      const window = bars.slice(day - windowSize, day);
      const currentBar = bars[day];
      const barDate = currentBar.timestamp.toISOString().split('T')[0];

      // ── News exclusion gate (#105) ──
      const isNewsDay = newsDates?.has(barDate) ?? false;
      if (newsExclusion === 'exclude' && isNewsDay) continue;           // skip entirely
      if (newsExclusion === 'only' && !isNewsDay) continue;             // only keep news days

      // Canonical historical evaluation: ticker, protocol, and window are all
      // explicit. Never call rankAll here; it reads current DB state.
      const result = await this.fullScore(symbol, window, protocolId);
      const composite = result.composite;
      const signal = result.signal;

      const score = composite;

      const currentClose = currentBar.close;

      // Entry signal
      if (signal === 'BUY' || signal === 'STRONG_BUY') {
        const future5 = bars[day + 5]?.close;
        const future10 = bars[day + 10]?.close;
        const future20 = bars[day + Math.min(20, bars.length - day - 1)]?.close;

        entrySignals.push({
          date: currentBar.timestamp.toISOString().split('T')[0],
          score: Number(score.toFixed(1)),
          signal,
          return5d: future5 ? Number(((future5 - currentClose) / currentClose * 100).toFixed(2)) : null,
          return10d: future10 ? Number(((future10 - currentClose) / currentClose * 100).toFixed(2)) : null,
          return20d: future20 ? Number(((future20 - currentClose) / currentClose * 100).toFixed(2)) : null,
          wasProfitable: (future10 || 0) > currentClose,
        });

        // Bracket order simulation with execution realism (#50)
        if (doBrackets) {
          const slPrice = currentClose * (1 - slPct / 100);
          const tpPrice = currentClose * (1 + tpPct / 100);

          let exitPrice = currentClose;
          let exitReason: TradeRecord['exitReason'] = 'EOD';
          // ⚠️ #819 — this is an INSTANT, not a day bucket. It used to be
          // `...toISOString().split('T')[0]`, which forced EVERY persisted trade to 00:00:00 —
          // measured 2026-09-23: 556 of 556 trades at midnight, and on 5m runs entry == exit
          // (117 of 117). A replay cannot place a marker on a price timeline from a date alone,
          // and a chart that *looks* right while every marker sits at midnight is the
          // plausible-output-no-error defect class this repo keeps paying for.
          let exitDate = currentBar.timestamp.toISOString();

          // Walk forward through remaining bars to check SL/TP
          for (let future = day + 1; future < bars.length; future++) {
            const fb = bars[future];

            // Check intra-bar: did SL or TP get hit?
            if (fb.low <= slPrice) {
              exitPrice = slPrice;
              exitReason = 'SL';
              exitDate = fb.timestamp.toISOString();
              break;
            }
            if (fb.high >= tpPrice) {
              exitPrice = tpPrice;
              exitReason = 'TP';
              exitDate = fb.timestamp.toISOString();
              break;
            }
          }

          // ── Symmetric execution costs (fixed #50) ──
          // Entry: buy at ask = mid + spread/2 + slippage
          // Exit: sell at bid = mid - spread/2 - slippage
          const entryCost = currentClose + (spread / 2) + slippage;
          const exitCost = exitPrice - (spread / 2) - slippage;
          const rawPnlPerShare = exitCost - entryCost;

          // ── Position sizing (#50, #269, #271) — #843: ONE implementation ──
          // The model maths now lives in `trading/position-sizing.ts`, which the LIVE loop also
          // calls. This site keeps what is genuinely its own: ATR is measured HERE (from its own
          // bars), units are SHARES (so it floors to whole units and keeps its historical
          // `min 1` floor), and the Kelly no-edge policy stays `size 1` (the live path refuses
          // instead — each caller owns that policy, see the core's header).
          let positionSize: number;
          if (positionModel === 'atrEqualRisk') {
            // ATR-based equal risk (#271): stop = ATR * multiplier, measured from this run's bars.
            const windowBars = bars.slice(Math.max(0, day - windowSize), day + 1);
            const atrValues = this.computeATR(
              windowBars.map(b => b.high),
              windowBars.map(b => b.low),
              windowBars.map(b => b.close),
              atrPeriod,
            );
            const currentAtr = atrValues[atrValues.length - 1] || 0;
            const atrStopDistance = currentAtr * atrMultiplier;
            const sized = computeSizing({
              model: 'atrEqualRisk',
              equity: accountSize,
              entryPrice: entryCost,
              riskPct,
              atrStopDistance: atrStopDistance > 0 ? atrStopDistance : null,
            });
            positionSize = sized.rawSize != null
              ? Math.floor(sized.rawSize)
              : Math.floor((accountSize * (riskPct / 100)) / currentClose); // kept: no ATR history yet
          } else if (positionModel === 'fixedDollar') {
            const sized = computeSizing({ model: 'fixedDollar', equity: accountSize, entryPrice: entryCost, fixedAmount });
            positionSize = sized.rawSize != null ? Math.floor(sized.rawSize) : 0;
          } else if (positionModel === 'kellyFull' || positionModel === 'kellyHalf') {
            // Kelly criterion (#269). Neutral 50% prior; the no-edge case keeps its historical
            // `size 1` here (documented divergence — the live path refuses visibly instead).
            const sized = computeSizing({
              model: positionModel,
              equity: accountSize,
              entryPrice: entryCost,
              tpPct,
              slPct,
              kellyCapPct,
            });
            positionSize = sized.rawSize != null ? Math.floor(sized.rawSize) : 1;
          } else {
            // fixedPercent: risk accountSize * riskPct% on the stop distance (entry as fallback).
            // ⚠️ The fallback denominator is `currentClose`, NOT `entryCost` — preserved exactly
            // from the pre-#843 extraction; `entryCost` carries half-spread + slippage.
            const stopDistance = currentClose - slPrice;
            const sized = computeSizing({
              model: 'fixedPercent',
              equity: accountSize,
              entryPrice: entryCost,
              riskPct,
              stopDistance: stopDistance > 0 ? stopDistance : currentClose,
            });
            positionSize = sized.rawSize != null ? Math.floor(sized.rawSize) : 0;
          }
          if (positionSize < 1) positionSize = 1;

          // ── Commission (#50) ──
          const totalCommission = commission * positionSize; // per-share commission model

          const grossPnl = rawPnlPerShare * positionSize;
          const netPnl = grossPnl - totalCommission;
          const pnlPct = (netPnl / (entryCost * positionSize)) * 100;

          trades.push({
            // Same instant-not-day-bucket rule as `exitDate` above (#819).
            entryDate: currentBar.timestamp.toISOString(),
            entryPrice: Number(entryCost.toFixed(5)),
            exitDate,
            exitPrice: Number(exitCost.toFixed(5)),
            direction: 'LONG',
            pnl: Number(netPnl.toFixed(4)),
            pnlPct: Number(pnlPct.toFixed(2)),
            exitReason,
            // ⚠️ #R14 — RECORD THE LEVELS WITH THE TRADE. The engine already used them to decide
            // the exit and then threw the numbers away, so every run could say that a stop was hit
            // but not where it was — "not recorded" wearing the face of "not applicable".
            stopLoss: Number(slPrice.toFixed(5)),
            takeProfit: Number(tpPrice.toFixed(5)),
            score: Number(score.toFixed(1)),
            signal,
            protocolId: protocolId ?? 'unscoped',
            positionSize,
            commission: Number(totalCommission.toFixed(4)),
          });
        }
      }
    }

    // Aggregate stats
    const profitable = entrySignals.filter((s) => s.wasProfitable).length;
    const returns10d = entrySignals.filter((s) => s.return10d != null).map((s) => s.return10d!);
    const avgReturn10d = returns10d.length ? returns10d.reduce((a, b) => a + b, 0) / returns10d.length : 0;
    const maxReturn10d = returns10d.length ? Math.max(...returns10d) : 0;
    const maxDrawdown10d = returns10d.length ? Math.min(...returns10d) : 0;
    const grossProfit = returns10d.filter((r) => r > 0).reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(returns10d.filter((r) => r < 0).reduce((a, b) => a + b, 0)) || 1;
    const stdDev = Math.sqrt(returns10d.reduce((s, r) => s + (r - avgReturn10d) ** 2, 0) / (returns10d.length || 1));

    const winRate = entrySignals.length ? profitable / entrySignals.length : 0;
    const sharpeApproximation = stdDev > 0 ? (avgReturn10d / stdDev) * Math.sqrt(252 / 10) : 0;

    // Bracket trade stats
    //
    // ⚠️ #1021 — THE TRADE RATE IS NULL WHEN THERE ARE NO TRADES, AND THIS SITE USED TO SAY `0`.
    // `0` reads as "every trade lost"; `null` says "there was no trade to judge". A run that made
    // no trades was therefore stored as a 0% win rate — a failure — rather than as an absence of
    // information. The shared function returns null, and `tradeWinRate` below is nullable to match.
    const tradeStats = tradeWinRateFromRows(trades);
    const tradeWinRate = tradeStats.fraction;
    const tradeWinners = tradeStats.winners;
    const avgTradePnl = trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0;
    const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
    const grossPnlTotal = trades.reduce((s, t) => s + t.pnl + (t.commission ?? 0), 0);
    const totalCommissionPaid = trades.reduce((s, t) => s + (t.commission ?? 0), 0);
    const tradePnls = trades.map(t => t.pnl);
    const maxTradeDrawdown = tradePnls.length ? Math.min(...tradePnls) : 0;
    const avgPositionSize = trades.length
      ? trades.reduce((s, t) => s + (t.positionSize ?? 1), 0) / trades.length
      : 0;

    const result: BacktestResult = {
      id: `${symbol}-${Date.now()}`,
      symbol: symbol.toUpperCase(),
      protocolId: protocolId ?? 'unscoped',
      // #965 item 3 / #843 — a bot-driven run says WHICH bot it resolved and what this run cannot
      // claim (the sizing divergence). Absent on a hand-assembled request, because then there is
      // no bot to have diverged from.
      drivenBy: resolved.drivenBy ?? undefined,
      caveats: resolved.caveats,
      // #986 — WHICH STORED PERIOD this measured. Echoed with its name and note so the result says
      // why the window mattered, not only which dates it covered.
      measuredPeriod: period
        ? {
            id: period.id,
            name: period.name,
            note: period.note,
            from: period.from.toISOString(),
            to: period.to.toISOString(),
            bars: bars.length,
          }
        : undefined,
      period: `${bars[windowSize].timestamp.toISOString().split('T')[0]} to ${bars[bars.length - 1].timestamp.toISOString().split('T')[0]}`,
      totalDays,
      timeframe,
      entrySignals: entrySignals.slice(-200),
      trades: doBrackets ? trades : undefined,
      execution: {
        slippage: Number(slippage.toFixed(6)),
        spread: Number(spread.toFixed(6)),
        commission: Number(commission.toFixed(4)),
        positionModel,
        accountSize,
        riskPct,
        fixedAmount,
        ...(positionModel === 'atrEqualRisk' ? {
          atrPeriod,
          atrMultiplier,
        } : {}),
        ...(positionModel.startsWith('kelly') ? {
          kellyCapPct,
          kellyFraction: Number((() => {
            const b = tpPct / slPct;
            const p = 0.5;
            const q = 1 - p;
            const kf = (b * p - q) / b;
            return Math.min(kf, kellyCapPct / 100) / (positionModel === 'kellyHalf' ? 2 : 1);
          })().toFixed(4)),
          kellyEdge: Number(((tpPct / slPct * 0.5 - 0.5) / (tpPct / slPct) * 100).toFixed(2)),
        } : {}),
      },
      stats: {
        totalSignals: entrySignals.length,
        winRate: Number(winRate.toFixed(2)),
        averageReturn10d: Number(avgReturn10d.toFixed(2)),
        maxReturn10d: Number(maxReturn10d.toFixed(2)),
        maxDrawdown10d: Number(maxDrawdown10d.toFixed(2)),
        profitFactor: Number((grossProfit / grossLoss).toFixed(2)),
        sharpeApproximation: Number(sharpeApproximation.toFixed(2)),
        ...(doBrackets ? {
          totalTrades: trades.length,
          // ⚠️ #1021 — NULL IS PASSED THROUGH, and this line is why the null case has to be handled
      // rather than type-checked. `strictNullChecks` is OFF in this project, so `number | null`
      // compiles as `number` and `tradeWinRate.toFixed(2)` on a run with NO trades would have thrown
      // at runtime while `tsc` reported success — the compiler cannot catch this one. The absence of
      // information must survive to the caller: `null` here means "no trade to judge", and `0` would
      // claim every trade lost.
      tradeWinRate: tradeWinRate === null ? null : Number(tradeWinRate.toFixed(2)),
          avgTradePnl: Number(avgTradePnl.toFixed(2)),
          totalPnl: Number(totalPnl.toFixed(4)),
          maxTradeDrawdown: Number(maxTradeDrawdown.toFixed(4)),
          grossPnl: Number(grossPnlTotal.toFixed(4)),
          totalCommission: Number(totalCommissionPaid.toFixed(4)),
          netPnl: Number(totalPnl.toFixed(4)),
          avgPositionSize: Number(avgPositionSize.toFixed(1)),
        } : {}),
      },
    };

    // ── Persist to database ──────────────────────────────
    let persistedRunId: string | null = null;
    try {
      const symbolRow = await this.prisma.symbol.findUnique({ where: { ticker: symbol.toUpperCase() } });
      if (symbolRow) {
        const run = await this.prisma.backtestRun.create({
          data: {
            symbolId: symbolRow.id,
            protocolId: protocolId ?? 'unscoped',
            timeframe,
            startDate: bars[windowSize].timestamp,
            endDate: bars[bars.length - 1].timestamp,
            totalDays,
            totalTrades: trades.length,
            // ⚠️ #965 item 1 — the DENOMINATOR of `winRate`, persisted so a verdict can state the
            // sample its own metric rests on. Without it, a comparison could only bar on trades
            // while `winRate`/`sharpeRatio` were computed over an unrecorded signal population.
            totalSignals: entrySignals.length,
            // #965 item 4 — the bot AND its live lot size, so a pair comparison can check whether
            // its two sides were even sized the same before crediting a difference to the protocol.
            botId: resolved.drivenBy?.botId ?? null,
            botBaseSize: resolved.drivenBy?.baseSize ?? null,
            // #986 — WHICH WINDOW this measured. Without it a period comparison and a protocol
            // comparison are indistinguishable in this table, so a difference produced by the
            // DATES could be credited to the PROTOCOL.
            periodId: period?.id ?? null,
            winRate: Number(winRate.toFixed(4)),
            totalPnl: Number(totalPnl.toFixed(4)),
            profitFactor: Number((grossProfit / grossLoss).toFixed(4)),
            sharpeRatio: Number(sharpeApproximation.toFixed(4)),
            maxDrawdown: Number(maxDrawdown10d.toFixed(4)),
            avgTradePnl: Number(avgTradePnl.toFixed(4)),
          },
        });
        persistedRunId = run.id;

        // Persist individual trades
        if (trades.length > 0) {
          await this.prisma.backtestTrade.createMany({
            data: trades.map((t) => ({
              runId: run.id,
              symbolId: symbolRow.id,
              entryDate: new Date(t.entryDate),
              entryPrice: t.entryPrice,
              exitDate: new Date(t.exitDate),
              exitPrice: t.exitPrice,
                // #R14 — null when the engine set no level (an unbracketed run), never 0.
                stopLoss: t.stopLoss ?? null,
                takeProfit: t.takeProfit ?? null,
              direction: t.direction,
              pnl: t.pnl,
              pnlPct: t.pnlPct,
              exitReason: t.exitReason,
              entryScore: t.score,
              signal: t.signal,
              positionSize: t.positionSize,
              commission: t.commission,
            })),
          });
        }
        this.logger.log(`Backtest persisted: run=${run.id}, symbol=${symbol}, trades=${trades.length}`);
      }
    } catch (err) {
      this.logger.error(`Failed to persist backtest for ${symbol}: ${(err as Error).message}`);
    }

    this.logger.log(`Backtest ${symbol}: ${entrySignals.length} signals, winRate=${(winRate*100).toFixed(0)}%${newsExclusion !== 'none' ? ` (news: ${newsExclusion}, ${newsDates?.size ?? 0} news dates)` : ''}`);
    return { ...result, id: persistedRunId || result.id, newsExclusion, newsDatesCount: newsDates?.size ?? 0 };
  }

  async getResult(runId: string): Promise<BacktestResult | null> {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: runId },
      include: { trades: true, symbol: true },
    });
    if (!run) return null;
    return this.formatRunResult(run);
  }

  /**
   * getReplay() — the payload for the replay view (#819).
   *
   * ⚠️ WHAT THIS CANNOT SHOW, AND SAYS SO. Three gaps are real and are returned as `caveats`
   * rather than as empty arrays, because "an empty list and a failed query must never render the
   * same" — and neither must "no trade happened" and "we do not record that":
   *
   *   1. **No per-tick decision stream is persisted.** A run stores its TRADES. The tick grid the
   *      view plays over is the BARS, so a decision that took no trade has no row. The view must
   *      not imply "nothing was decided" from that.
   *   2. **No per-trade stop or target.** The engine uses SL/TP to decide exits (`exitReason` is
   *      `SL` / `TP` / `EOD`) but never persists the levels, so the replay shows the exit REASON
   *      and not the levels. Not zero — not recorded.
   *   3. **Runs made before the timestamp fix cannot be replayed.** Measured 2026-09-23: every
   *      trade written before it sat at `00:00:00`, so a marker cannot be placed on a timeline.
   *      It is detected here per run and stated, instead of drawn at midnight.
   */
  async getReplay(runId: string): Promise<BacktestReplay | null> {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: runId },
      include: { symbol: true },
    });
    if (!run) return null;

    const trades = await this.prisma.backtestTrade.findMany({
      where: { runId },
      orderBy: { entryDate: 'asc' },
    });

    // The tick grid. Capped, and the cap is REPORTED rather than silent.
    const barsRaw = await this.prisma.marketBar.findMany({
      where: {
        symbolId: run.symbolId,
        timeframe: run.timeframe,
        timestamp: { gte: run.startDate, lte: run.endDate },
      },
      orderBy: { timestamp: 'asc' },
      take: REPLAY_BAR_CAP + 1,
    });
    const barsTruncated = barsRaw.length > REPLAY_BAR_CAP;
    const bars = barsTruncated ? barsRaw.slice(0, REPLAY_BAR_CAP) : barsRaw;

    const caveats: string[] = [];
    // #R14 — levels are captured per trade from this change onward, so a run either has them or
    // predates them. Say WHICH: a blanket "not recorded" became false the moment this shipped.
    const levelsRecorded = trades.some((t) => t.stopLoss !== null || t.takeProfit !== null);
    const allAtMidnight = trades.length > 0 && trades.every((t) => isMidnight(t.entryDate));
    if (allAtMidnight) {
      caveats.push(
        'Every trade in this run is stamped 00:00:00 — it predates the #819 timestamp fix, so its ' +
          'markers cannot be placed on the price timeline. Re-run it to replay it.',
      );
    }
    if (trades.length === 0) {
      caveats.push('This run took no trades. That is a result, not a missing query.');
    }
    if (bars.length === 0) {
      caveats.push(
        `No ${run.timeframe} bars are stored for ${run.symbol?.ticker ?? 'this symbol'} in ` +
          `${run.startDate.toISOString()} → ${run.endDate.toISOString()}, so there is no price ` +
          'timeline to replay against. The trade rows are still listed.',
      );
    } else if (barsTruncated) {
      caveats.push(
        `Only the first ${REPLAY_BAR_CAP} bars of the window are returned (the window holds more). ` +
          'Trades after the last returned bar cannot be positioned on the timeline.',
      );
    }
    caveats.push(
      'A backtest run persists TRADES, not a per-tick decision stream: rows below are where a ' +
        'trade was taken, and the tick grid is the bars. A decision that took no trade has no row.',
    );
    caveats.push(
      levelsRecorded
        ? 'Stop and target levels ARE recorded for this run, so the replay draws them.'
        : 'Stop and target levels are NOT recorded for this run (it predates their capture), so ' +
          'only the exit REASON is shown (SL / TP / EOD). Not recorded is not the same as zero.',
    );
    caveats.push(
      'pnlPct is stored rounded to 2 decimal places, so a very small loss can read as 0.00 — ' +
        'pnl (4dp, account currency) is the value that did not get rounded away.',
    );

    return {
      run: {
        id: run.id,
        symbol: run.symbol?.ticker ?? '',
        protocolId: run.protocolId,
        timeframe: run.timeframe,
        botId: run.botId,
        botBaseSize: run.botBaseSize,
        from: run.startDate.toISOString(),
        to: run.endDate.toISOString(),
        totalDays: run.totalDays,
        tradesStored: trades.length,
        totalTrades: run.totalTrades,
        totalSignals: run.totalSignals,
        winRatePct: Number(run.winRate),
        totalPnl: Number(run.totalPnl),
      },
      trades: trades.map((t) => ({
        id: t.id,
        direction: t.direction,
        signal: t.signal,
        entryScore: t.entryScore === null ? null : Number(t.entryScore),
        entryTime: t.entryDate.toISOString(),
        entryPrice: Number(t.entryPrice),
        exitTime: t.exitDate.toISOString(),
        exitPrice: Number(t.exitPrice),
        exitReason: t.exitReason,
        stopLoss: t.stopLoss === null ? null : Number(t.stopLoss),
        takeProfit: t.takeProfit === null ? null : Number(t.takeProfit),
        positionSize: t.positionSize === null ? null : Number(t.positionSize),
        pnl: Number(t.pnl),
        pnlPct: Number(t.pnlPct),
      })),
      bars: bars.map((b) => ({
        time: b.timestamp.toISOString(),
        open: Number(b.open),
        high: Number(b.high),
        low: Number(b.low),
        close: Number(b.close),
      })),
      barsCap: REPLAY_BAR_CAP,
      caveats,
    };
  }

  async getSummary(symbol: string): Promise<{
    symbol: string;
    runs: {
      id: string;
      date: string;
      /** ⚠️ BRACKETED TRADES. This field was once named `signals` while holding a trade count (#980). */
      trades: number;
      /** ⚠️ Entry SIGNALS. NULL = never recorded — never 0, and never substituted with `trades`. */
      signals: number | null;
      /** ⚠️ A SIGNAL rate. Its population is `signals`, NOT `trades`. */
      signalWinRatePct: number;
      /** ⚠️ A TRADE rate, counted from `backtesttrade`. NULL when the run has no trades. */
      tradeWinRatePct: number | null;
    }[];
  }> {
    const symbolRow = await this.prisma.symbol.findUnique({ where: { ticker: symbol.toUpperCase() } });
    if (!symbolRow) return { symbol, runs: [] };
    const runs = await this.prisma.backtestRun.findMany({
      where: { symbolId: symbolRow.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // ⚠️ Count the trades from `backtesttrade`, exactly as `listAllRuns` does. Two populations,
    // two counts, kept separate — the whole point of #980 is that they must not be merged, and
    // this endpoint merged them in the other direction (`signals: r.totalTrades`).
    //
    // ⚠️ #1021 — DERIVED BY THE SHARED FUNCTION, not by a locally-written pair of `groupBy`s. This
    // exact pair existed in THREE read paths and one of them computed a FRACTION while the others
    // computed a PERCENT, so the same rule had two unit conventions under one name.
    const runIds = runs.map((r) => r.id);
    const tradeRates = await countTradeWinRatesByRun(this.prisma, runIds);

    return {
      symbol,
      runs: runs.map((r) => {
        const t = tradeRates.get(r.id) ?? { ...NO_TRADES };
        return {
          id: r.id,
          date: `${r.startDate.toISOString().split('T')[0]} to ${r.endDate.toISOString().split('T')[0]}`,
          trades: r.totalTrades,
          signals: r.totalSignals ?? null,
          signalWinRatePct: Math.round(r.winRate * 10000) / 100,
          tradeWinRatePct: percentOrNull(t.fraction),
        };
      }),
    };
  }

  async listProtocolRuns(protocolId: string, limit = 20) {
    return this.prisma.backtestRun.findMany({
      where: { protocolId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { symbol: { select: { ticker: true } } },
    });
  }

  /**
   * List all backtest runs with optional filters.
   *
   * ⚠️ UNITS ARE IN THE IDENTIFIER DELIBERATELY (#965 item 2). The previous formatter applied one
   * `* 10000 / 100` (a ×100 fraction→percent conversion) to three fields that do NOT share a unit.
   * Measured against the live table 2026-09-23:
   *   • `maxDrawdown` is ALREADY a percent — it is `min(return10d)`, and `return10d` is
   *     `(future10 - currentClose) / currentClose * 100`. A real 0.27% drawdown was served as
   *     **27**, and −14.47% as **−1447**.
   *   • `avgTradePnl` is ALREADY a percent (mean of `pnlPct`) — same 100× error: −0.1767 → −17.67.
   *   • `winRate` IS a fraction (0..1), so ×100 was right for IT — which is how one formatter came
   *     to be applied to three different units.
   *   • `totalPnl` is CURRENCY: 2dp rounding turned a real −0.0009 into **0.00** — a loss rendered
   *     as nothing. It is served at its stored precision (4dp) instead.
   */
  async listAllRuns(opts?: { symbol?: string; protocolId?: string; limit?: number }): Promise<{
    runs: Array<{
      id: string; symbol: string; protocolId: string; timeframe: string;
      period: string;
      /** Bracket TRADE count — the population the P&L metrics are computed over. */
      totalTrades: number;
      /** Entry SIGNAL count — the population `signalWinRatePct` and `sharpeRatio` rest on. NULL = not recorded. */
      totalSignals: number | null;
      /** Percent of entry SIGNALS that were profitable. NOT a trade win rate. */
      signalWinRatePct: number;
      /** Account currency, 4dp (stored precision — never rounded to a misleading 0.00). */
      totalPnl: number;
      sharpeRatio: number;
      /** Percent of the worst rolling 10-day return. NOT currency. */
      maxDrawdownPct: number;
      /** Percent per trade. NOT currency. */
      avgTradePnlPct: number;
      createdAt: string;
    }>;
    total: number;
  }> {
    const where: any = {};
    if (opts?.symbol) {
      const sym = await this.prisma.symbol.findUnique({ where: { ticker: opts.symbol.toUpperCase() } });
      if (sym) where.symbolId = sym.id;
    }
    if (opts?.protocolId) where.protocolId = opts.protocolId;

    const [runs, total] = await Promise.all([
      this.prisma.backtestRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: opts?.limit ?? 50,
        include: { symbol: { select: { ticker: true } } },
      }),
      this.prisma.backtestRun.count({ where }),
    ]);

    return {
      runs: runs.map(r => ({
        id: r.id,
        symbol: (r as any).symbol?.ticker || 'unknown',
        protocolId: r.protocolId,
        timeframe: r.timeframe,
        period: `${r.startDate.toISOString().split('T')[0]} → ${r.endDate.toISOString().split('T')[0]}`,
        totalTrades: r.totalTrades,
        // ⚠️ TYPED access, not `(r as any)`: a stale generated Prisma client must fail the type
        // check rather than throw at runtime — see #976, which is this exact failure class found
        // on a different column.
        totalSignals: r.totalSignals ?? null,
        // ⚠️ `winRate` is a FRACTION and is the only field here that needs ×100. The two percent
        // fields below are served as stored — see the method header.
        signalWinRatePct: Math.round(r.winRate * 10000) / 100,
        totalPnl: Number(r.totalPnl.toFixed(4)),
        sharpeRatio: Math.round(r.sharpeRatio * 100) / 100,
        maxDrawdownPct: Number(r.maxDrawdown.toFixed(4)),
        avgTradePnlPct: Number(r.avgTradePnl.toFixed(4)),
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * Compare multiple backtest runs side-by-side, and refuse to name a winner on a thin sample.
   *
   * ⚠️ #965 ITEM 1 — THE SAMPLE BAR. Measured 2026-09-23, before this change:
   *
   *     xau-speed-m15   totalTrades: 3   winRate: 100   sharpeRatio: 42.31
   *     xau-speed-m5    totalTrades: 0   winRate: 0
   *     best: { id: <m15>, metric: "sharpeRatio", value: 42.31 }
   *
   * A winner on THREE trades was served identically to one from three hundred. The live snapshot
   * trial already had a bar for this (`MIN_SAMPLES_FOR_VERDICT`, shared via `verdict-bar.ts`);
   * this comparison had none. `best` is now null unless EVERY side clears the bar, and the verdict
   * names the counts either way.
   *
   * ⚠️ TWO POPULATIONS, KEPT APART. `winRate` on the stored row is a SIGNAL rate
   * (`profitable / entrySignals`), while `totalTrades` is a TRADE count — and the denominator of
   * the rate was never persisted. Measured: run `0dd94ddd` serves `winRate: 100` beside
   * `totalTrades: 3`, while its own `backtesttrade` rows are **0 winners of 3**. Served side by
   * side and read as ONE record, that is a fabricated-looking result. So:
   *   • `signalWinRatePct` keeps the rate and names its population,
   *   • `tradeWinRatePct` is counted from the trades table — the rate that matches `totalTrades`,
   *   • `totalSignals` is persisted as of this change, so the sample behind `sharpeRatio` can be
   *     STATED rather than assumed (NULL = not recorded on runs made before the column existed).
   *
   * ⚠️ UNITS. The old formatter applied one ×100 (`* 10000 / 100`) to `winRate` (a fraction),
   * `maxDrawdown` (already a percent: `min(return10d)`) and `avgTradePnl` (already a percent), so
   * a 0.27% drawdown was served as **27** and −14.47% as **−1447**. That is item 2 of the sprint,
   * and it is why the compare view disagreed with the run it was comparing. Fields are now named
   * for their unit and served at their stored scale; `totalPnl` keeps its 4dp, because 2dp turned
   * a real −0.0009 into **0.00**.
   */
  async compareRuns(runIds: string[]): Promise<{
    runs: Array<{
      id: string; symbol: string; protocolId: string; timeframe: string;
      /** Bracket TRADE count — the population the P&L metrics are computed over. */
      totalTrades: number;
      /** Trades actually FOUND for this run. A disagreement with `totalTrades` is reported. */
      tradesCounted: number;
      /** Winners / trades counted. NULL when no trades exist — never a fabricated 0%. */
      tradeWinRatePct: number | null;
      /** Entry SIGNALS, the sample `signalWinRatePct` and `sharpeRatio` rest on. NULL = not recorded. */
      totalSignals: number | null;
      /** Percent of entry SIGNALS that were profitable. NOT a trade win rate. */
      signalWinRatePct: number;
      /** Account currency, 4dp. */
      totalPnl: number;
      profitFactor: number;
      sharpeRatio: number;
      /** Percent. NOT currency, and NOT scaled — see the method header. */
      maxDrawdownPct: number;
      /** Percent per trade. NOT currency. */
      avgTradePnlPct: number;
    }>;
    /** Null unless every side cleared the sample bar. `sample` travels with the name. */
    best: { id: string; metric: string; value: number; sample: number } | null;
    verdict: {
      verdict: 'winner' | 'insufficient-data' | 'sample-unknown' | 'no-runs';
      n: Record<string, number | null>;
      requiredPerSide: number;
      /** The comparison method, named whenever a winner is named. Null otherwise. */
      metric: string | null;
      /**
       * #965 item 4 — set when the sides are NOT comparable as a like-for-like pair, so a difference
       * cannot be credited to the protocol. Null means the sizes agree (or no bot was involved).
       */
      sizeWarning: string | null;
      note: string;
    };
  }> {
    const runs = await this.prisma.backtestRun.findMany({
      where: { id: { in: runIds } },
      include: { symbol: { select: { ticker: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // ⚠️ Counted from the TRADES, not taken from the stored column: the P&L metrics are computed
    // over trades, so the sample a verdict rests on must be the rows that exist. If the two
    // disagree, that is a finding and it is surfaced below rather than smoothed over.
    //
    // ⚠️ #1021 — the shared derivation. This pair was a verbatim copy of `getSummary`'s, which is
    // how the two of them could drift apart without anything failing.
    const tradeRates = await countTradeWinRatesByRun(this.prisma, runIds);

    const formatted = runs.map((r) => {
      const t = tradeRates.get(r.id) ?? { ...NO_TRADES };
      const tradesCounted = t.trades;
      // ⚠️ TYPED when a verdict could rest on it (#976): `as any` here would let a stale client
      // silently read `undefined` and the bar would then refuse every comparison for the WRONG
      // reason, blaming the data instead of the build.
      const totalSignals = r.totalSignals ?? null;
      return {
        id: r.id,
        symbol: (r as any).symbol?.ticker || 'unknown',
        protocolId: r.protocolId,
        timeframe: r.timeframe,
        totalTrades: r.totalTrades,
        tradesCounted,
        tradeWinRatePct: percentOrNull(t.fraction),
        totalSignals,
        /** The bot that produced this run. NULL = hand-assembled request. */
        botId: r.botId ?? null,
        /** That bot's LIVE lot size at run time. NULL = NOT RECORDED — never read as equal. */
        botBaseSize: r.botBaseSize ?? null,
        // The ONLY field that needs the fraction→percent conversion.
        signalWinRatePct: Math.round(r.winRate * 10000) / 100,
        totalPnl: Number(r.totalPnl.toFixed(4)),
        profitFactor: Math.round(r.profitFactor * 100) / 100,
        sharpeRatio: Math.round(r.sharpeRatio * 100) / 100,
        // ⚠️ 4dp — the STORED precision, deliberately not 2dp. These are small numbers (a real
        // `avgTradePnl` is −0.1767); rounding them to 2dp would serve −0.18, i.e. formatting
        // would invent a figure the run never produced. Same reason `totalPnl` keeps its 4dp.
        // A UI is free to display 2dp; the API must not discard the value first.
        maxDrawdownPct: Number(r.maxDrawdown.toFixed(4)),
        avgTradePnlPct: Number(r.avgTradePnl.toFixed(4)),
      };
    });

    if (formatted.length === 0) {
      return {
        runs: [],
        best: null,
        verdict: {
          verdict: 'no-runs',
          n: {},
          requiredPerSide: MIN_SAMPLES_FOR_VERDICT,
          metric: null,
          sizeWarning: null,
          note:
            'No runs matched the supplied ids, so there is nothing to compare. This is NOT ' +
            '"the runs are equal" — no data was read.',
        },
      };
    }

    // ── THE BAR ────────────────────────────────────────────────────────────────────────────────
    // Both populations are assessed, because the winner metric (`sharpeRatio`) is computed over
    // entry SIGNALS while the P&L figures are computed over TRADES. A bar on trades alone would
    // still let the verdict's own metric rest on an unstated sample.
    const tradeAssessment = assessSamples(
      formatted.map((f) => ({ label: `${f.protocolId} @${f.timeframe} trades`, n: f.tradesCounted })),
      { what: 'bracketed trades' },
    );
    const signalAssessment = assessSamples(
      formatted.map((f) => ({ label: `${f.protocolId} @${f.timeframe} signals`, n: f.totalSignals })),
      { what: 'entry signals (the sample `sharpeRatio` is computed over)' },
    );

    const refusals: Array<'insufficient-data' | 'sample-unknown'> = [];
    if (tradeAssessment.outcome !== 'ok') refusals.push(tradeAssessment.outcome);
    if (signalAssessment.outcome !== 'ok') refusals.push(signalAssessment.outcome);

    const n = { ...tradeAssessment.n, ...signalAssessment.n };
    const disagreements = formatted
      .filter((f) => f.totalTrades !== f.tradesCounted)
      .map((f) => `${f.protocolId} @${f.timeframe}: stored ${f.totalTrades}, found ${f.tradesCounted}`);

    // ── LIKE-FOR-LIKE (#965 item 4) ────────────────────────────────────────────────────────────
    // Measured on the real XAU pair: the two sides are driven by bots sized 0.01 and 0.02 lots, and
    // this backtester cannot reproduce a lot size (#843). So a comparison across them must say that
    // a difference is not attributable to the protocol alone. An UNKNOWN size is named as unknown —
    // it must not be quietly treated as "equal to the others", which is the same defect class as a
    // null reading as zero.
    const sizeWarning = ((): string | null => {
      const unknown = formatted
        .filter((f) => f.botBaseSize === null)
        .map((f) => `${f.protocolId} @${f.timeframe}`);
      if (unknown.length > 0) {
        return (
          ` ⚠️ NOT LIKE-FOR-LIKE — the bots' LOT SIZE is UNKNOWN for ${unknown.join(', ')} ` +
          '(no bot recorded on the run, or a run made before the size was persisted), so the two ' +
          "sides' sizes cannot be compared. Unknown is not the same as equal."
        );
      }
      const sizes = [...new Set(formatted.map((f) => f.botBaseSize as number))];
      if (sizes.length > 1) {
        return (
          ` ⚠️ NOT LIKE-FOR-LIKE — the sides were driven by bots sized ${sizes.join(' vs ')} lots, ` +
          'while this backtest sizes them in per-unit shares (#843). A difference between these runs ' +
          'cannot be credited to the protocol alone.'
        );
      }
      return null;
    })();

    if (refusals.length > 0) {
      return {
        runs: formatted,
        best: null,
        verdict: {
          verdict: refusals.includes('sample-unknown') ? 'sample-unknown' : 'insufficient-data',
          n,
          requiredPerSide: MIN_SAMPLES_FOR_VERDICT,
          metric: null,
          sizeWarning,
          note:
            `${tradeAssessment.note} ${signalAssessment.note}` +
            (disagreements.length
              ? ` ⚠️ Stored trade counts disagree with the trade rows: ${disagreements.join('; ')}.`
              : '') +
            (sizeWarning ?? ''),
        },
      };
    }

    const bestRow = formatted.reduce((a, b) => (a.sharpeRatio > b.sharpeRatio ? a : b));
    return {
      runs: formatted,
      best: {
        id: bestRow.id,
        metric: 'sharpeRatio',
        value: bestRow.sharpeRatio,
        sample: bestRow.tradesCounted,
      },
      verdict: {
        verdict: 'winner',
        n,
        requiredPerSide: MIN_SAMPLES_FOR_VERDICT,
        metric: 'sharpeRatio',
        sizeWarning,
        note:
          `Winner named by sharpeRatio (${bestRow.protocolId} @${bestRow.timeframe}), over ` +
          `${bestRow.totalSignals} entry signals and ${bestRow.tradesCounted} bracketed trades. ` +
          `Both clear the ≥${MIN_SAMPLES_FOR_VERDICT} bar. ` +
          '⚠️ The bar means "big enough to speak about", NOT "statistically significant" — ' +
          'the winner is the largest of these runs, not a proven difference.' +
          (disagreements.length
            ? ` ⚠️ Stored trade counts disagree with the trade rows: ${disagreements.join('; ')}.`
            : '') +
          (sizeWarning ?? ''),
      },
    };
  }

  /** Delete a backtest run and its trades */
  async deleteRun(runId: string): Promise<{ deleted: boolean }> {
    try {
      await this.prisma.backtestRun.delete({ where: { id: runId } });
      this.logger.log(`Deleted backtest run ${runId}`);
      return { deleted: true };
    } catch {
      return { deleted: false };
    }
  }

  /**
   * Computes the equity curve and drawdown from stored trades.
   * Equity = cumulative PnL from all trades in chronological order.
   * Drawdown = (peak - current) / peak * 100 at each point.
   */
  async getEquityCurve(runId: string): Promise<{
    runId: string;
    symbol: string;
    startingCapital?: number;
    equity: Array<{ time: string; equity: number; drawdownPct: number }>;
    summary: {
      totalTrades: number;
      totalPnl: number;
      finalEquity: number;
      maxDrawdownPct: number;
      maxDrawdownStart: string | null;
      maxDrawdownEnd: string | null;
      peakEquity: number;
      peakDate: string | null;
    };
  } | { error: string }> {
    const run = await this.prisma.backtestRun.findUnique({
      where: { id: runId },
      include: {
        trades: { orderBy: { entryDate: 'asc' } },
        symbol: { select: { ticker: true } },
      },
    });

    if (!run) return { error: 'Run not found' };

    const trades = run.trades || [];
    const startingCapital = 0; // equity curve starts at zero cumulative PnL
    const equity: Array<{ time: string; equity: number; drawdownPct: number }> = [];

    let cumulative = 0;
    let peak = 0;
    let maxDrawdownPct = 0;
    let maxDrawdownStart: string | null = null;
    let maxDrawdownEnd: string | null = null;
    let currentDrawdownStart: string | null = null;
    let peakDate: string | null = null;

    // Add starting point
    equity.push({ time: run.startDate.toISOString(), equity: 0, drawdownPct: 0 });

    for (const trade of trades) {
      cumulative += Number(trade.pnl);

      if (cumulative > peak) {
        peak = cumulative;
        peakDate = trade.exitDate.toISOString();
        currentDrawdownStart = null; // reset drawdown tracking
      } else if (currentDrawdownStart === null) {
        currentDrawdownStart = trade.exitDate.toISOString();
      }

      const drawdown = peak > 0 ? ((peak - cumulative) / Math.abs(peak)) * 100 : 0;
      if (drawdown > maxDrawdownPct) {
        maxDrawdownPct = drawdown;
        maxDrawdownStart = currentDrawdownStart;
        maxDrawdownEnd = trade.exitDate.toISOString();
      }

      equity.push({
        time: trade.exitDate.toISOString(),
        equity: Math.round(cumulative * 100) / 100,
        drawdownPct: Math.round(drawdown * 100) / 100,
      });
    }

    return {
      runId,
      symbol: run.symbol?.ticker || '',
      equity,
      summary: {
        totalTrades: trades.length,
        totalPnl: run.totalPnl,
        finalEquity: equity.length > 0 ? equity[equity.length - 1].equity : 0,
        maxDrawdownPct: Math.round(maxDrawdownPct * 100) / 100,
        maxDrawdownStart,
        maxDrawdownEnd,
        peakEquity: peak,
        peakDate,
      },
    };
  }

  /**
   * #106 — Full Directive Backtest Coverage.
   * Runs each directive individually against historical bars and reports
   * per-directive win rate, average return, and signal distribution.
   */
  async runDirectiveCoverage(body: { symbol: string; days?: number; timeframe?: string }) {
    const { symbol, days = 365, timeframe = '1d' } = body;
    const ticker = symbol.toUpperCase();

    // Load bars
    const bars = await this.prisma.marketBar.findMany({
      where: { symbol: { ticker }, timeframe },
      orderBy: { timestamp: 'asc' },
      take: days + 30,
    });

    if (!bars.length) {
      return { error: `No market bars for ${ticker} (${timeframe})` };
    }

    // Get all registered directives
    const directiveList = this.directivesService.listRegistered();
    const results: Array<{
      directiveId: string;
      name: string;
      signals: number;
      buyCount: number;
      sellCount: number;
      holdCount: number;
      avgScore: number;
      winRate5d: number;
      avgReturn5d: number;
      winRate10d: number;
      avgReturn10d: number;
      error?: string;
    }> = [];

    const WINDOW = 100;

    for (const d of directiveList) {
      try {
        let buyCount = 0;
        let sellCount = 0;
        let holdCount = 0;
        let totalScore = 0;
        let wins5d = 0;
        let total5d = 0;
        let sumReturn5d = 0;
        let wins10d = 0;
        let total10d = 0;
        let sumReturn10d = 0;

        // Slide window across bars, only scoring the last bar in each window
        for (let i = WINDOW - 1; i < bars.length; i += 5) {
          const windowBars = bars.slice(Math.max(0, i - WINDOW + 1), i + 1);
          const currentBar = bars[i];
          if (!currentBar) continue;

          // Build DirectiveInput for this window
          const input = this.buildDirectiveInput(ticker, windowBars, currentBar, timeframe);

          // Run the single directive
          const outcome = await this.directivesService.runSingle(d.id, input);
          if (!outcome) { holdCount++; continue; }

          totalScore += outcome.score ?? 0;

          if (outcome.signalClass === 'bullish') {
            buyCount++;
            // Check 5d forward return
            const bar5d = bars[i + 5];
            if (bar5d) {
              total5d++;
              const ret5d = ((bar5d.close - currentBar.close) / currentBar.close) * 100;
              sumReturn5d += ret5d;
              if (ret5d > 0) wins5d++;
            }
            // Check 10d forward return
            const bar10d = bars[i + 10];
            if (bar10d) {
              total10d++;
              const ret10d = ((bar10d.close - currentBar.close) / currentBar.close) * 100;
              sumReturn10d += ret10d;
              if (ret10d > 0) wins10d++;
            }
          } else if (outcome.signalClass === 'bearish') {
            sellCount++;
          } else {
            holdCount++;
          }
        }

        const signalCount = buyCount + sellCount;
        results.push({
          directiveId: d.id,
          name: d.name,
          signals: signalCount,
          buyCount,
          sellCount,
          holdCount,
          avgScore: signalCount > 0 ? Math.round(totalScore / signalCount) : 0,
          winRate5d: total5d > 0 ? Math.round((wins5d / total5d) * 100) : 0,
          avgReturn5d: total5d > 0 ? Math.round((sumReturn5d / total5d) * 100) / 100 : 0,
          winRate10d: total10d > 0 ? Math.round((wins10d / total10d) * 100) : 0,
          avgReturn10d: total10d > 0 ? Math.round((sumReturn10d / total10d) * 100) / 100 : 0,
        });
      } catch (err: any) {
        results.push({
          directiveId: d.id,
          name: d.name,
          signals: 0,
          buyCount: 0,
          sellCount: 0,
          holdCount: 0,
          avgScore: 0,
          winRate5d: 0,
          avgReturn5d: 0,
          winRate10d: 0,
          avgReturn10d: 0,
          error: err.message,
        });
      }
    }

    // Sort by win rate descending
    results.sort((a, b) => b.winRate10d - a.winRate10d);

    return {
      symbol: ticker,
      timeframe,
      days,
      barsUsed: bars.length,
      directivesTested: results.length,
      passCount: results.filter(r => !r.error).length,
      failCount: results.filter(r => r.error).length,
      results,
    };
  }

  /**
   * Builds a DirectiveInput from a window of bars for per-directive testing.
   */
  private buildDirectiveInput(
    ticker: string,
    windowBars: any[],
    _currentBar: any,
    timeframe: string,
  ) {
    const bars = windowBars.map(b => ({
      timestamp: b.timestamp,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume || 0),
    }));

    return {
      symbol: ticker,
      timeframe,
      bars,
    };
  }

  private formatRunResult(run: any): BacktestResult {
    // ⚠️ #980 — COUNT THE TRADES; NEVER BORROW THE SIGNAL RATE.
    //
    // This adapter used to write `totalSignals: run.totalTrades` — a TRADE count under a SIGNAL
    // name — and `tradeWinRate: run.winRate` — a SIGNAL rate under a TRADE name. Measured
    // 2026-09-23: run `0dd94ddd` stored `winRate 1` (100%) while its own `backtesttrade` rows held
    // **0 winners of 3**, and this adapter served that 100% as the trade win rate. Plausible
    // number, no error, wrong population underneath.
    //
    // The trades are already on the object, so the trade rate is countable here — and when there
    // are none the honest answer is NULL, not a borrowed number from a different population.
    const runTrades = Array.isArray(run.trades) ? run.trades : [];
    // ⚠️ #1021 — the shared pure derivation, so this in-memory path and the three `groupBy` paths
    // cannot drift on either the null case or the unit again.
    const tradeStats = tradeWinRateFromRows(runTrades);

    return {
      id: run.id,
      symbol: run.symbol?.ticker || '',
      protocolId: run.protocolId,
      period: `${run.startDate.toISOString().split('T')[0]} to ${run.endDate.toISOString().split('T')[0]}`,
      totalDays: run.totalDays,
      timeframe: run.timeframe,
      entrySignals: [],
      trades: run.trades?.map((t: any) => ({
        entryDate: t.entryDate.toISOString(),
        entryPrice: Number(t.entryPrice),
        exitDate: t.exitDate.toISOString(),
        exitPrice: Number(t.exitPrice),
        direction: t.direction,
        pnl: Number(t.pnl),
        pnlPct: Number(t.pnlPct),
        exitReason: t.exitReason,
        score: Number(t.entryScore),
        signal: t.signal,
        protocolId: run.protocolId,
        positionSize: t.positionSize ? Number(t.positionSize) : undefined,
        commission: t.commission ? Number(t.commission) : undefined,
      })) || [],
      execution: {
        slippage: Number(run.slippage ?? 0.01),
        spread: Number(run.spread ?? 0.01),
        commission: Number(run.commission ?? 0),
        positionModel: run.positionModel ?? 'fixedPercent',
        accountSize: run.accountSize ?? 10000,
        riskPct: run.riskPct ?? 2,
        fixedAmount: 100,
        ...(run.positionModel?.startsWith?.('kelly') ? {
          kellyCapPct: 25,
        } : {}),
      },
      stats: {
        // ⚠️ `run.totalSignals`, NOT `run.totalTrades` (#980). NULL = never recorded.
        totalSignals: run.totalSignals ?? null,
        winRate: run.winRate,
        averageReturn10d: 0,
        maxReturn10d: 0,
        maxDrawdown10d: run.maxDrawdown,
        profitFactor: run.profitFactor,
        sharpeApproximation: run.sharpeRatio,
        totalTrades: run.totalTrades,
        // ⚠️ A FRACTION (0–1), matching `run()`'s own shape — NOT a percentage.
        //
        // `run()` sets `tradeWinRate = tradeWinners / trades.length`, and BacktestPage renders it
        // as `(tradeWinRate * 100)`. Writing a percentage here would give ONE field name TWO scales
        // depending on whether the result came from a live run or a stored row — which is the same
        // split-unit defect #980 exists to remove, reproduced one level down. Caught before it
        // shipped by reading the consumer.
        //
        // NULL when there are no trades: the SIGNAL rate must never stand in for a trade rate.
        tradeWinRate: tradeStats.fraction,
        avgTradePnl: run.avgTradePnl,
        totalPnl: run.totalPnl,
        maxTradeDrawdown: run.maxDrawdown,
      },
    };
  }

  async getChartData(
    symbol: string,
    timeframe = '1d',
    from?: string,
    to?: string,
    protocolId?: string,
  ): Promise<{
    bars: Array<{ time: string; open: number; high: number; low: number; close: number; volume: number }>;
    signals: Array<{ time: string; type: string; score: number; label: string; price: number; pnl?: number }>;
    indicators: {
      rsi: Array<{ time: string; value: number }>;
      macd: Array<{ time: string; macd: number; signal: number; histogram: number }>;
      ema9: Array<{ time: string; value: number }>;
      ema21: Array<{ time: string; value: number }>;
    };
  }> {
    const where: Record<string, unknown> = {
      symbol: { ticker: symbol.toUpperCase() },
      timeframe,
    };

    if (from) {
      where.timestamp = { ...(where.timestamp as Record<string, unknown> || {}), gte: new Date(from) };
    }
    if (to) {
      where.timestamp = { ...(where.timestamp as Record<string, unknown> || {}), lte: new Date(to) };
    }

    const rows = await this.prisma.marketBar.findMany({
      where,
      orderBy: { timestamp: 'asc' },
      take: 2000,
    });

    const closes = rows.map(r => Number(r.close));
    const highs = rows.map(r => Number(r.high));
    const lows = rows.map(r => Number(r.low));
    const volumes = rows.map(r => Number(r.volume));

    // Compute indicators
    const rsiValues = this.computeRSI(closes, 14);
    const macdData = this.computeMACD(closes);
    const ema9 = this.computeEMA(closes, 9);
    const ema21 = this.computeEMA(closes, 21);

    // Format bars for lightweight-charts
    const bars = rows.map((r, i) => ({
      time: r.timestamp.toISOString().split('T')[0],
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));

    // Generate signals from directive scoring on the full window
    const signals: Array<{ time: string; type: string; score: number; label: string; price: number; pnl?: number }> = [];
    const windowSize = 100;

    for (let day = windowSize; day < rows.length; day++) {
      // Chart bars/indicators remain available without a protocol, but signals
      // must never be fabricated by an unscoped fallback scorer.
      if (!protocolId) break;
      const window = rows.slice(day - windowSize, day).map(r => ({
        timestamp: r.timestamp,
        open: Number(r.open),
        high: Number(r.high),
        low: Number(r.low),
        close: Number(r.close),
        volume: Number(r.volume),
      }));

      // Use inline protocol-gated scoring
      const { composite: score, signal } = await this.fullScore(symbol, window, protocolId);

      const currentClose = window[window.length - 1].close;

      if (signal === 'BUY' || signal === 'STRONG_BUY') {
        const future10 = rows[day + 10]?.close;
        const pnl = future10 ? Number(((Number(future10) - currentClose) / currentClose * 100).toFixed(2)) : undefined;

        signals.push({
          time: window[window.length - 1].timestamp.toISOString().split('T')[0],
          type: 'entry',
          score: Number(score.toFixed(1)),
          label: `Entry: score ${score.toFixed(0)}`,
          price: currentClose,
          pnl,
        });
      }
    }

    return {
      bars,
      signals,
      indicators: {
        rsi: rsiValues.map((v, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', value: v })),
        macd: macdData.map((m, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', ...m })),
        ema9: ema9.map((v, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', value: v })),
        ema21: ema21.map((v, i) => ({ time: rows[i]?.timestamp.toISOString().split('T')[0] ?? '', value: v })),
      },
    };
  }

  // ── Canonical META.Stack scoring adapter ───────────────

  /**
   * Historical scoring must call the same evaluator as live automation.
   * This adapter intentionally contains no fallback maths (2026-09-08).
   *
   * The higher-timeframe bundle is loaded ONCE per (symbol, protocol) and cached,
   * NOT per bar. A backtest loops over thousands of bars, so loading 1d/1h/15m inside
   * the loop would be prohibitive — but omitting it entirely is worse: every MTF
   * directive would silently score from base bars only and the backtest would
   * validate a strategy the live loop never runs (#735, MST-004).
   */
  private async fullScore(
    symbol: string,
    bars: MarketBar[],
    protocolId: string,
  ): Promise<{ composite: number; signal: string; breakdown: Array<{ directiveId: string; score: number; maxScore: number; signalClass: string }> }> {
    const symId = await this.resolveSymbolId(symbol);
    const bundle = symId
      ? await this.loadTfBundle(symId, protocolId)
      : { dayBars: [], hourBars: [], min15Bars: [] };
    const gated = await this.protocolGating.scoreWithGating(symbol, bars, protocolId, bundle);
    return {
      composite: gated.signalPct,
      signal: gated.signal,
      breakdown: Object.values(gated.breakouts)
        .flat()
        .map(d => ({
          directiveId: d.directiveId,
          score: d.score,
          maxScore: d.maxScore,
          signalClass: d.signalClass,
        })),
    };
  }

  // ── Higher-timeframe bundle cache (#735) ───────────────
  //
  // Backtests and replays iterate over thousands of bars, so `loadHigherTfBundle()`
  // cannot be called per bar. The bundle for a (symbol, protocol) pair is STABLE for
  // the whole run — a historical backtest sees the same 1d/1h/15m history regardless
  // of which base bar is being evaluated — so it is loaded once and reused.
  private readonly tfBundleCache = new Map<string, {
    dayBars: MarketBar[]; hourBars: MarketBar[]; min15Bars: MarketBar[];
  }>();
  private readonly symbolIdCache = new Map<string, string | null>();

  private async resolveSymbolId(ticker: string): Promise<string | null> {
    const key = ticker.toUpperCase();
    if (this.symbolIdCache.has(key)) return this.symbolIdCache.get(key) ?? null;
    const sym = await this.prisma.symbol.findFirst({
      where: { ticker: key },
      select: { id: true },
    });
    const id = sym?.id ?? null;
    this.symbolIdCache.set(key, id);
    return id;
  }

  private async loadTfBundle(symbolId: string, protocolId: string) {
    const key = `${symbolId}|${protocolId}`;
    const cached = this.tfBundleCache.get(key);
    if (cached) return cached;
    const bundle = await this.protocolGating.loadHigherTfBundle(symbolId, protocolId);
    this.tfBundleCache.set(key, bundle);
    return bundle;
  }

  // ── Indicator helpers (pure functions) ──

  private computeATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
    const result = Array(closes.length).fill(0);
    if (closes.length < period + 1) return result;

    // True ranges
    const tr: number[] = [highs[0] - lows[0]];
    for (let i = 1; i < closes.length; i++) {
      tr.push(Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1]),
      ));
    }

    // Wilder's smoothed ATR
    let sum = 0;
    for (let i = 0; i < period; i++) sum += tr[i];
    result[period - 1] = sum / period;

    for (let i = period; i < closes.length; i++) {
      result[i] = (result[i - 1] * (period - 1) + tr[i]) / period;
    }
    return result;
  }

  private computeRSI(closes: number[], period: number): number[] {
    const result = Array(closes.length).fill(0);
    if (closes.length < period + 1) return result;

    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
      avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
      result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 1e-10));
    }
    return result;
  }

  private computeMACD(closes: number[]): Array<{ macd: number; signal: number; histogram: number }> {
    const ema12 = this.computeEMA(closes, 12);
    const ema26 = this.computeEMA(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = this.computeEMA(macdLine, 9);
    return macdLine.map((macd, i) => ({
      macd: Number(macd.toFixed(4)),
      signal: Number((signalLine[i] || 0).toFixed(4)),
      histogram: Number((macd - (signalLine[i] || 0)).toFixed(4)),
    }));
  }

  private computeEMA(values: number[], period: number): number[] {
    const result = Array(values.length).fill(0);
    if (values.length < period) return result;

    // SMA seed
    let sum = 0;
    for (let i = 0; i < period; i++) sum += values[i];
    result[period - 1] = sum / period;

    const multiplier = 2 / (period + 1);
    for (let i = period; i < values.length; i++) {
      result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
    }
    return result;
  }

  async getDatasets(): Promise<Array<{ symbol: string; type: string; bars: number; from: string; to: string; source: string }>> {
    const datasets: Array<{ symbol: string; type: string; bars: number; from: string; to: string; source: string }> = [];

    try {
      // Query MarketBar for pre-loaded datasets (200+ bars = notable dataset)
      const symbols = await this.prisma.symbol.findMany({
        select: { id: true, ticker: true, type: true },
      });

      for (const sym of symbols) {
        const count = await this.prisma.marketBar.count({
          where: { symbolId: sym.id, timeframe: '1d' },
        });

        if (count >= 200) {
          const first = await this.prisma.marketBar.findFirst({
            where: { symbolId: sym.id, timeframe: '1d' },
            orderBy: { timestamp: 'asc' },
          });
          const last = await this.prisma.marketBar.findFirst({
            where: { symbolId: sym.id, timeframe: '1d' },
            orderBy: { timestamp: 'desc' },
          });

          datasets.push({
            symbol: sym.ticker,
            type: sym.type || 'stock',
            bars: count,
            from: first ? first.timestamp.toISOString().slice(0, 10) : '—',
            to: last ? last.timestamp.toISOString().slice(0, 10) : '—',
            source: count >= 1000 ? 'pre-loaded' : 'partial',
          });
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to query datasets: ${String(error)}`);
    }

    return datasets;
  }

  // ── Data Inventory ──────────────────────────────────

  async getDataInventory(): Promise<{
    summary: { totalSymbols: number; symbolsWithBars: number; totalBars: number; totalBacktestRuns: number };
    symbols: Array<{
      ticker: string;
      type: string;
      active: boolean;
      barCount: number;
      dateFrom: string | null;
      dateTo: string | null;
      provider: string | null;
      timeframes: string[];
      backtestRuns: number;
      lastBacktest: string | null;
    }>;
  }> {
    const symbols = await this.prisma.symbol.findMany({
      select: { id: true, ticker: true, type: true, active: true },
      orderBy: { ticker: 'asc' },
    });

    // ── ⚠️ THIS WAS AN N+1 LOOP — measured 2026-10-16 ──────────────────────────────────────────
    // For EVERY symbol it ran SIX sequential queries (bar count, first bar, last bar, distinct
    // timeframes, backtest count, last backtest). `symbol` holds **261** rows and `marketbar`
    // **1,238,868**, so that was **1,566 round-trips**, each with a COUNT(*) over the bar table.
    // The endpoint crossed the API's own 30s gateway deadline and returned **HTTP 504**, which is
    // what `/lab/backtest-data` rendered as "Failed to load. Is the backend running?".
    //
    // The page was never broken and the API was never down — the QUERY was unbounded. It had also
    // been degrading with data volume, which is why it "worked an hour ago".
    //
    // Now three aggregate queries plus one bounded per-symbol lookup. `marketbar`'s index
    // `(symbolId, timeframe, timestamp)` covers the first two; `symbol` (261) and `backtestrun`
    // (26) are tiny.
    //
    // ⚠️ `provider` is deliberately NOT in this aggregate. Measured 2026-10-16 on 1,238,868 rows:
    //
    //     GROUP BY symbolId, MIN/MAX(timestamp)                    1,075ms   <- index-covered
    //     ... the same + MIN(provider)                             9,781ms   <- +8.7s
    //
    // `provider` is not in the `(symbolId, timeframe, timestamp)` index, so including it forces a
    // row lookup for EVERY bar. It is fetched below by a per-symbol index lookup instead — for the
    // 48 symbols that have bars, not all 261.
    const barAgg = await this.prisma.marketBar.groupBy({
      by: ['symbolId'],
      _count: { _all: true },
      _min: { timestamp: true },
      _max: { timestamp: true },
    });
    const barsBySymbol = new Map(barAgg.map((r) => [r.symbolId, r]));

    // Timeframes per symbol — index-covered by (symbolId, timeframe), one row per pair.
    const tfAgg = await this.prisma.marketBar.groupBy({
      by: ['symbolId', 'timeframe'],
      _count: { _all: true },
    });
    const tfBySymbol = new Map<string, string[]>();
    for (const r of tfAgg) {
      const list = tfBySymbol.get(r.symbolId) ?? [];
      list.push(r.timeframe);
      tfBySymbol.set(r.symbolId, list);
    }

    const btAgg = await this.prisma.backtestRun.groupBy({
      by: ['symbolId'],
      _count: { _all: true },
      _max: { createdAt: true },
    });
    const btBySymbol = new Map(btAgg.map((r) => [r.symbolId, r]));

    // ⚠️ `provider` is "a provider recorded for this symbol", NOT necessarily the earliest bar's.
    // The old code fetched the earliest bar's provider — one query per symbol, which was part of
    // the reason this endpoint took 30s. Every symbol with bars today (48) has exactly one
    // provider, so the values are unchanged. `LIMIT 1` uses the symbolId index prefix.
    const providerBySymbol = new Map<string, string>();
    await Promise.all(
      [...barsBySymbol.keys()].map(async (symbolId) => {
        const row = await this.prisma.marketBar.findFirst({
          where: { symbolId },
          select: { provider: true },
        });
        if (row?.provider) providerBySymbol.set(symbolId, row.provider);
      }),
    );

    const inventory = symbols.map((sym) => {
      const agg = barsBySymbol.get(sym.id);
      const bt = btBySymbol.get(sym.id);
      const barCount = agg?._count?._all ?? 0;
      const firstTs = agg?._min?.timestamp ?? null;
      const lastTs = agg?._max?.timestamp ?? null;

      return {
        ticker: sym.ticker,
        type: sym.type || 'stock',
        active: sym.active,
        barCount,
        dateFrom: firstTs ? firstTs.toISOString().slice(0, 10) : null,
        dateTo: lastTs ? lastTs.toISOString().slice(0, 10) : null,
        provider: providerBySymbol.get(sym.id) ?? null,
        timeframes: (tfBySymbol.get(sym.id) ?? []).sort(),
        backtestRuns: bt?._count?._all ?? 0,
        lastBacktest: bt?._max?.createdAt ? bt._max.createdAt.toISOString().slice(0, 16) : null,
      };
    });

    const symbolsWithBars = inventory.filter((s) => s.barCount > 0).length;
    const totalBars = inventory.reduce((sum, s) => sum + s.barCount, 0);
    const totalBT = inventory.reduce((sum, s) => sum + s.backtestRuns, 0);

    return {
      summary: {
        totalSymbols: symbols.length,
        symbolsWithBars,
        totalBars,
        totalBacktestRuns: totalBT,
      },
      symbols: inventory,
    };
  }

  // ── Timeframe coverage — which timeframes this symbol can ACTUALLY be scored at ──

  /**
   * How many bars exist for ONE symbol in ONE window, per timeframe.
   *
   * ── Why this exists ──
   * The protocol-backtest page had to offer a timeframe menu without knowing which choices would
   * work, and its own source said so: *"no endpoint exposes a per-(symbol, timeframe) bar count"*.
   * So the menu offered all four, and the user found out afterwards — VIX at `1h` over three days
   * returned `found 10 bars, needs 30+`. A menu that offers an option and then refuses it is a
   * promise the app did not keep.
   *
   * ⚠️ `/api/backtest/data-inventory` cannot answer this: it lists the timeframes a symbol has
   * EVER held, which is a different question. VIX lists `1h` there and still cannot be scored at
   * `1h` across a 3-day window. "Has data" ≠ "has enough data in YOUR window".
   *
   * Cheap by construction: ONE `GROUP BY timeframe` over a `(symbolId, timeframe, timestamp)`
   * index, bounded by the window. Compare with `getDataInventory`, which is 261 symbols wide.
   */
  async getTimeframeCoverage(
    symbol: string,
    from?: string,
    to?: string,
    minBars = 30,
  ): Promise<{
    symbol: string;
    symbolKnown: boolean;
    from: string | null;
    to: string | null;
    requiredBars: number;
    timeframes: Array<{
      timeframe: string;
      bars: number;
      usable: boolean;
      heldBars: number;
      heldFrom: string | null;
      heldTo: string | null;
    }>;
  }> {
    const upper = (symbol || '').toUpperCase();
    // ⚠️ NOT a second constant. The caller passes the SAME `windowSize` it will send to
    // `/api/replay/run` (which itself defaults to 30), so "usable" here and the engine's
    // "needs N+ to score one window" can never disagree — a mismatch would offer a choice and
    // then refuse it, which is the defect this endpoint exists to remove.
    const requiredBars = Number.isFinite(minBars) && minBars > 0 ? Math.floor(minBars) : 30;
    const symbolId = await this.resolveSymbolId(upper);

    if (!symbolId) {
      return { symbol: upper, symbolKnown: false, from: from ?? null, to: to ?? null, requiredBars, timeframes: [] };
    }

    const timestampFilter = from || to
      ? {
          ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
          // ⚠️ `to` is a DATE and the user means "through the end of that day". Comparing against
          // midnight would silently drop the final day — the same half-open-window trap that makes
          // a 10-day run look like 9.
          ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
        }
      : undefined;

    // ⚠️ The `where` is built INLINE, not from a pre-declared variable. Prisma's `groupBy` is
    // generic over the argument; a hoisted variable defeats the inference, TypeScript falls
    // through to the array-argument overload, and the error reads as "missing length/pop/push".
    // Every working call site in this repo inlines it for the same reason.
    const rows: Array<{ timeframe: string; bars: number }> = await (async () => {
      const agg = await this.prisma.marketBar.groupBy({
        by: ['timeframe'],
        where: timestampFilter ? { symbolId, timestamp: timestampFilter } : { symbolId },
        _count: { _all: true },
      });
      return agg.map((r) => ({ timeframe: String(r.timeframe), bars: r._count._all }));
    })().catch((err: any) => {
      // A failed read must not render as "no data" — the two are indistinguishable downstream.
      this.logger.warn(`Timeframe coverage failed for ${upper}: ${err.message}`);
      throw err;
    });

    /**
     * What the store holds for this symbol OUTSIDE the window — the answer to "which dates can I
     * even ask for?". Without it the menu could only report the window the user had already typed,
     * which is circular: you have to guess a date range to learn which date ranges work.
     *
     * ⚠️ This is the FULL series per timeframe, not the window. Index-covered
     * `(symbolId, timeframe, timestamp)`; one row per timeframe.
     */
    const held: Array<{ timeframe: string; heldBars: number; heldFrom: Date | null; heldTo: Date | null }> =
      await (async () => {
        const agg = await this.prisma.marketBar.groupBy({
          by: ['timeframe'],
          where: { symbolId },
          _count: { _all: true },
          _min: { timestamp: true },
          _max: { timestamp: true },
        });
        return agg.map((r) => ({
          timeframe: String(r.timeframe),
          heldBars: r._count._all,
          heldFrom: r._min.timestamp ?? null,
          heldTo: r._max.timestamp ?? null,
        }));
      })().catch((err: any) => {
        this.logger.warn(`Held-range read failed for ${upper}: ${err.message}`);
        throw err;
      });

    const heldByTf = new Map(held.map((h) => [h.timeframe, h]));
    // Union: a timeframe with bars OUTSIDE the window but none inside is exactly the case the UI
    // must be able to show ("we hold 2,431 bars, but none between these dates").
    const allTfs = [...new Set([...rows.map((r) => r.timeframe), ...held.map((h) => h.timeframe)])];

    return {
      symbol: upper,
      symbolKnown: true,
      from: from ?? null,
      to: to ?? null,
      requiredBars,
      timeframes: allTfs
        .map((tf) => {
          const inWindow = rows.find((r) => r.timeframe === tf)?.bars ?? 0;
          const h = heldByTf.get(tf);
          return {
            timeframe: tf,
            bars: inWindow,
            usable: inWindow >= requiredBars,
            heldBars: h?.heldBars ?? 0,
            heldFrom: h?.heldFrom ? h.heldFrom.toISOString().slice(0, 10) : null,
            heldTo: h?.heldTo ? h.heldTo.toISOString().slice(0, 10) : null,
          };
        })
        .sort((a, b) => a.timeframe.localeCompare(b.timeframe)),
    };
  }

  // ── Grid Search Optimization ────────────────────────

  async optimize(params: {
    symbol: string;
    days?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }): Promise<{ best: BacktestResult; runs: number; params: { slPct: number; tpPct: number; tradeWinRatePct: number | null }[] }> {
    const { symbol, days = 365, protocolId, slRange = { min: 1, max: 5, step: 1 }, tpRange = { min: 1, max: 10, step: 2 } } = params;
    this.logger.log(`Grid search: ${symbol} SL=${slRange.min}-${slRange.max} TP=${tpRange.min}-${tpRange.max}`);

    let best: BacktestResult | null = null;
    // ⚠️ #980 — the field is named for its POPULATION. This array used to be typed and sorted on
    // a field called `winRate`, and filled with `result.stats.tradeWinRate ?? result.stats.winRate`.
    // When a candidate produced no trades that fallback silently substituted the SIGNAL rate, so a
    // grid of SL/TP candidates could be ranked on a number from a different population.
    const allRuns: { slPct: number; tpPct: number; tradeWinRatePct: number | null }[] = [];

    for (let sl = slRange.min; sl <= slRange.max; sl += slRange.step) {
      for (let tp = tpRange.min; tp <= tpRange.max; tp += tpRange.step) {
        const result = await this.run({ symbol, days, protocolId, slPct: sl, tpPct: tp });
        allRuns.push({ slPct: sl, tpPct: tp, tradeWinRatePct: result.stats.tradeWinRate ?? null });

        if (!best || (result.stats.totalPnl ?? 0) > (best.stats.totalPnl ?? 0)) {
          best = result;
        }
      }
    }

    // Nulls sort LAST — an unrankable candidate is not a candidate with a win rate of 0.
    return {
      best: best!,
      runs: allRuns.length,
      params: allRuns.sort((a, b) => (b.tradeWinRatePct ?? -1) - (a.tradeWinRatePct ?? -1)),
    };
  }

  // ── Walk-Forward Optimization ───────────────────────

  async walkForward(params: {
    symbol: string;
    trainDays?: number;
    testDays?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }): Promise<{ train: BacktestResult; test: BacktestResult; optimizedParams: { slPct: number; tpPct: number }; outOfSampleWinRate: number | null }> {
    const { symbol, trainDays = 730, testDays = 365, protocolId, slRange = { min: 1, max: 5, step: 1 }, tpRange = { min: 1, max: 10, step: 2 } } = params;
    this.logger.log(`Walk-forward: ${symbol} train=${trainDays}d test=${testDays}d`);

    // Step 1: Optimize on training period
    const opt = await this.optimize({ symbol, days: trainDays, protocolId, slRange, tpRange });
    const bestParams = opt.params[0]; // highest win rate

    // Step 2: Run on test period with optimized params
    const testResult = await this.run({
      symbol,
      days: testDays,
      protocolId,
      slPct: bestParams.slPct,
      tpPct: bestParams.tpPct,
    });

    const trainResult = opt.best;

    return {
      train: trainResult,
      test: testResult,
      optimizedParams: { slPct: bestParams.slPct, tpPct: bestParams.tpPct },
      // ⚠️ #980 — the TRADE rate, and NULL when the run produced no trades. The `?? winRate`
      // fallback that used to sit here served the SIGNAL rate under a name reading "win rate",
      // which is the exact conflation this issue exists to remove.
      outOfSampleWinRate: testResult.stats.tradeWinRate ?? null,
    };
  }
}
