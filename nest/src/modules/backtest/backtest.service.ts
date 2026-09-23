import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// #965 item 1 — the sample bar is shared with the live snapshot trial's verdict rather than
// re-declared here. See the module header for the measurement that produced it.
import { assessSamples, MIN_SAMPLES_FOR_VERDICT } from '../../common/trading/verdict-bar';
import { DirectivesService } from '../directives/directives.service';
import { DirectiveInput, DirectiveResult, MarketBar } from '../directives/interfaces/directive.interface';
import { ProtocolDbService } from '../scoring/protocol-db.service';
import { ProtocolGatingService } from '../scoring/protocol-gating.service';

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
    totalSignals: number;
    winRate: number;
    averageReturn10d: number;
    maxReturn10d: number;
    maxDrawdown10d: number;
    profitFactor: number;
    sharpeApproximation: number;
    // bracket trade stats
    totalTrades?: number;
    tradeWinRate?: number;
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

  async run(request: BacktestRunRequest): Promise<BacktestResult> {
    // ── #965 item 3 — resolve a BOT-DRIVEN request before anything is defaulted ──────────────
    const resolved = await this.resolveBotDrivenRequest(request);
    const {
      symbol,
      days = 365,
      timeframe = '1d',
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

    // ⚠️ A symbol is still required — from the request or from the bot. Stated rather than defaulted,
    // because a defaulted symbol would measure a market nobody asked for.
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
    const rows = await this.prisma.marketBar.findMany({
      where: {
        symbol: { ticker: symbol.toUpperCase() },
        timeframe,
      },
      orderBy: { timestamp: 'asc' },
      take: days + 120,
    });

    if (rows.length < 100) {
      throw new Error(`Not enough data for ${symbol}: need 100+ bars, have ${rows.length}. Try importing data first.`);
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

          // ── Position sizing (#50, #269, #271) ──
          let positionSize: number;
          if (positionModel === 'fixedDollar') {
            positionSize = Math.floor(fixedAmount / entryCost);
          } else if (positionModel === 'atrEqualRisk') {
            // ATR-based equal risk (#271): stop = ATR * multiplier
            const windowBars = bars.slice(Math.max(0, day - windowSize), day + 1);
            const atrValues = this.computeATR(
              windowBars.map(b => b.high),
              windowBars.map(b => b.low),
              windowBars.map(b => b.close),
              atrPeriod,
            );
            const currentAtr = atrValues[atrValues.length - 1] || 0;
            const atrStopDistance = currentAtr * atrMultiplier;
            if (currentAtr > 0 && atrStopDistance > 0) {
              positionSize = Math.floor((accountSize * (riskPct / 100)) / atrStopDistance);
            } else {
              positionSize = Math.floor((accountSize * (riskPct / 100)) / currentClose);
            }
          } else if (positionModel === 'kellyFull' || positionModel === 'kellyHalf') {
            // Kelly criterion (#269): f = (bp - q) / b
            // b = tpPct/slPct (reward:risk ratio), p = estimated win rate, q = 1-p
            // Conservative estimate: use tp/sl ratio as b, assume 50% win rate
            // Full Kelly: position = accountEquity * f / price, capped at kellyCapPct%
            const b = tpPct / slPct; // reward:risk ratio from SL/TP params
            const p = 0.5;            // neutral prior — real traders estimate their edge
            const q = 1 - p;
            const kellyFraction = (b * p - q) / b;
            const cappedFraction = Math.min(kellyFraction, kellyCapPct / 100);
            const effectiveFraction = positionModel === 'kellyHalf'
              ? cappedFraction / 2
              : cappedFraction;
            if (effectiveFraction <= 0) {
              // Kelly says don't trade — fall back to minimal position
              positionSize = 1;
            } else {
              positionSize = Math.floor((accountSize * effectiveFraction) / entryCost);
            }
          } else {
            // fixedPercent: risk accountSize * riskPct% on the stop distance
            const stopDistance = currentClose - slPrice;
            if (stopDistance <= 0) {
              positionSize = Math.floor((accountSize * (riskPct / 100)) / currentClose);
            } else {
              positionSize = Math.floor((accountSize * (riskPct / 100)) / stopDistance);
            }
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
    const tradeWinners = trades.filter(t => t.pnl > 0).length;
    const tradeWinRate = trades.length ? tradeWinners / trades.length : 0;
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
      period: `${bars[windowSize].timestamp.toISOString().split('T')[0]} to ${bars[bars.length - 1].timestamp.toISOString().split('T')[0]}`,
      totalDays: days,
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
          tradeWinRate: Number(tradeWinRate.toFixed(2)),
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
            totalDays: days,
            totalTrades: trades.length,
            // ⚠️ #965 item 1 — the DENOMINATOR of `winRate`, persisted so a verdict can state the
            // sample its own metric rests on. Without it, a comparison could only bar on trades
            // while `winRate`/`sharpeRatio` were computed over an unrecorded signal population.
            totalSignals: entrySignals.length,
            // #965 item 4 — the bot AND its live lot size, so a pair comparison can check whether
            // its two sides were even sized the same before crediting a difference to the protocol.
            botId: resolved.drivenBy?.botId ?? null,
            botBaseSize: resolved.drivenBy?.baseSize ?? null,
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
      'Stop and target levels are not persisted per trade, so only the exit REASON is shown ' +
        '(SL / TP / EOD). Not recorded is not the same as zero.',
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

  async getSummary(symbol: string): Promise<{ symbol: string; runs: { id: string; date: string; signals: number; winRate: number }[] }> {
    const symbolRow = await this.prisma.symbol.findUnique({ where: { ticker: symbol.toUpperCase() } });
    if (!symbolRow) return { symbol, runs: [] };
    const runs = await this.prisma.backtestRun.findMany({
      where: { symbolId: symbolRow.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      symbol,
      runs: runs.map((r) => ({
        id: r.id,
        date: `${r.startDate.toISOString().split('T')[0]} to ${r.endDate.toISOString().split('T')[0]}`,
        signals: r.totalTrades,
        winRate: r.winRate,
      })),
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
    const [counted, countedWins] = await Promise.all([
      this.prisma.backtestTrade.groupBy({
        by: ['runId'],
        where: { runId: { in: runIds } },
        _count: { _all: true },
      }),
      this.prisma.backtestTrade.groupBy({
        by: ['runId'],
        where: { runId: { in: runIds }, pnl: { gt: 0 } },
        _count: { _all: true },
      }),
    ]);
    const countedByRun = new Map(counted.map((c) => [c.runId, c._count._all]));
    const winsByRun = new Map(countedWins.map((c) => [c.runId, c._count._all]));

    const formatted = runs.map((r) => {
      const tradesCounted = countedByRun.get(r.id) ?? 0;
      const wins = winsByRun.get(r.id) ?? 0;
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
        tradeWinRatePct:
          tradesCounted > 0 ? Math.round((wins / tradesCounted) * 10000) / 100 : null,
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
        totalSignals: run.totalTrades,
        winRate: run.winRate,
        averageReturn10d: 0,
        maxReturn10d: 0,
        maxDrawdown10d: run.maxDrawdown,
        profitFactor: run.profitFactor,
        sharpeApproximation: run.sharpeRatio,
        totalTrades: run.totalTrades,
        tradeWinRate: run.winRate,
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

    const inventory = [];

    for (const sym of symbols) {
      // Bar stats
      const barCount = await this.prisma.marketBar.count({ where: { symbolId: sym.id } });

      let dateFrom: string | null = null;
      let dateTo: string | null = null;
      let provider: string | null = null;
      let timeframes: string[] = [];

      if (barCount > 0) {
        const first = await this.prisma.marketBar.findFirst({
          where: { symbolId: sym.id },
          orderBy: { timestamp: 'asc' },
          select: { timestamp: true, provider: true },
        });
        const last = await this.prisma.marketBar.findFirst({
          where: { symbolId: sym.id },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        });
        const tfRows = await this.prisma.marketBar.findMany({
          where: { symbolId: sym.id },
          distinct: ['timeframe'],
          select: { timeframe: true },
        });

        dateFrom = first ? first.timestamp.toISOString().slice(0, 10) : null;
        dateTo = last ? last.timestamp.toISOString().slice(0, 10) : null;
        provider = first?.provider || null;
        timeframes = tfRows.map((r) => r.timeframe);
      }

      // Backtest runs
      const btRuns = await this.prisma.backtestRun.count({ where: { symbolId: sym.id } });
      let lastBacktest: string | null = null;
      if (btRuns > 0) {
        const last = await this.prisma.backtestRun.findFirst({
          where: { symbolId: sym.id },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        lastBacktest = last ? last.createdAt.toISOString().slice(0, 16) : null;
      }

      inventory.push({
        ticker: sym.ticker,
        type: sym.type || 'stock',
        active: sym.active,
        barCount,
        dateFrom,
        dateTo,
        provider,
        timeframes,
        backtestRuns: btRuns,
        lastBacktest,
      });
    }

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

  // ── Grid Search Optimization ────────────────────────

  async optimize(params: {
    symbol: string;
    days?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }): Promise<{ best: BacktestResult; runs: number; params: { slPct: number; tpPct: number; winRate: number }[] }> {
    const { symbol, days = 365, protocolId, slRange = { min: 1, max: 5, step: 1 }, tpRange = { min: 1, max: 10, step: 2 } } = params;
    this.logger.log(`Grid search: ${symbol} SL=${slRange.min}-${slRange.max} TP=${tpRange.min}-${tpRange.max}`);

    let best: BacktestResult | null = null;
    const allRuns: { slPct: number; tpPct: number; winRate: number }[] = [];

    for (let sl = slRange.min; sl <= slRange.max; sl += slRange.step) {
      for (let tp = tpRange.min; tp <= tpRange.max; tp += tpRange.step) {
        const result = await this.run({ symbol, days, protocolId, slPct: sl, tpPct: tp });
        const wr = result.stats.tradeWinRate ?? result.stats.winRate;
        allRuns.push({ slPct: sl, tpPct: tp, winRate: wr });

        if (!best || (result.stats.totalPnl ?? 0) > (best.stats.totalPnl ?? 0)) {
          best = result;
        }
      }
    }

    return { best: best!, runs: allRuns.length, params: allRuns.sort((a, b) => b.winRate - a.winRate) };
  }

  // ── Walk-Forward Optimization ───────────────────────

  async walkForward(params: {
    symbol: string;
    trainDays?: number;
    testDays?: number;
    protocolId?: string;
    slRange?: { min: number; max: number; step: number };
    tpRange?: { min: number; max: number; step: number };
  }): Promise<{ train: BacktestResult; test: BacktestResult; optimizedParams: { slPct: number; tpPct: number }; outOfSampleWinRate: number }> {
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
      outOfSampleWinRate: testResult.stats.tradeWinRate ?? testResult.stats.winRate,
    };
  }
}
