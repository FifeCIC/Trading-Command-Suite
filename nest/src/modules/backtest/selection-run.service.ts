/**
 * selection-run.service.ts — a backtest of a strategy that CHOOSES its instrument each day.
 *
 * WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT.
 * The per-symbol engine (`BacktestService.run()`) already answers "would the protocol have entered on
 * this bar, and what would that have made?". A selection strategy asks a second question on top of it:
 * "which symbols was it even allowed to trade today?". This service answers only that second question
 * and then REUSES the engine unchanged — it does not re-implement bar loading, scoring, exits, sizing
 * or costs. Those would be a second copy that drifts, and the moment they disagree the selection
 * result and the single-symbol result describe different worlds.
 *
 * ── ONE DATASET = ONE DAY (fixed 2026-11-19, measured on the first version of this page) ─────────
 * A movers dataset (`movers-losers-2026-11-10`) is a screen of ONE session, holding five prior
 * sessions as directive warm-up. The first version ranked every date in that window, so it reported
 * 11-04, 11-05, 11-06, 11-09 and 11-10 — and on the four days before the answer day those ten symbols
 * were not movers at all, so the "top 3 movers" were ordinary names moving ±3%. The candidate list was
 * ALSO chosen using knowledge of how 11-10 ended. Both look-aheads are now impossible: the run reads
 * the day from the dataset's NAME (`movers-dataset.ts`) and ranks that date alone
 * (`selectAnswerDay()`), refusing when the window does not contain it.
 *
 * ⚠️ THE ONE THING TO NEVER "SIMPLIFY": the cutoff. Ranking on a day's full move and then counting
 * trades from the open scores against the answer key. `buildDayRanks` computes each metric from bars
 * at or before `cutoffUtc` only, and `applySelection` drops any entry before it.
 *
 * ⚠️ AND THE RESIDUAL BIAS IS REPORTED, NOT HIDDEN. A dataset's candidate list was still built from
 * that day's CLOSE-TO-CLOSE move, so the list itself knows how the day ended. Ranking inside it is
 * clean; the membership is optimistic. That sentence is in `caveats` on every result, because it is
 * the difference between "this strategy is good" and "this strategy is good at picking from a list of
 * things that already turned out to be movers".
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BacktestService } from './backtest.service';
import {
  buildDayRanks,
  selectAnswerDay,
  applySelection,
  // The SAME cutoff comparison the ranking uses, so the preview's per-symbol count and the ranking's
  // "at or before the cutoff" rule cannot drift apart.
  minuteOfDayUtc,
  parseCutoffUtc,
  type DayRank,
  type RankBar,
} from './selection-ranking';
import {
  parseMoversDatasetName,
  resolveMoversSide,
  type MoversSide,
  type SideSource,
} from './movers-dataset';
import { directionFromProtocol } from './direction-from-protocol';
import {
  buildDepthBars,
  buildStepLadder,
  type DepthBarRow,
  type DepthStep,
  type DepthTrade,
} from './run-depth';
import {
  applyHoldReachability,
  buildTradeConfig,
  tradeConfigSummary,
  type TradeConfigBot,
  type TradeConfigField,
} from './trade-config';
// #1328 — the selection TEST as a named group, and whether two of them may be subtracted.
import {
  compareSelections,
  profileKey as buildProfileKey,
  type Comparison,
  type SelectionProfile,
  type StoredSelection,
} from './selection-profile';
import { EXECUTION_SEMANTICS } from '../../common/trading/execution-semantics';
// ONE definition of the trade profit factor, so a record's factor and its P/L describe one sample.
import { tradeProfitFactor } from './profit-factor';
// #1341 — the best result per test, so a tuning loop cannot "improve" its way below an earlier best.
import { BestRunService, bestProfileKey, type BestRecord } from './best-run.service';
// #1325 — "could the bot have taken this trade?" Applied AFTER the engine has decided every trade, so it
// filters a population rather than deciding one.
import { admitTrades } from './portfolio-admission';
// #1282 — the ranker compares closes ACROSS symbols, so a blend of two publishers' price scales would
// reorder the candidate list. One publisher, chosen and reported.
import { chooseBarProvider } from './bar-provider';
// The pre-run coverage summary. It compares the SAME two bases the run uses, and says so.
import { buildSelectionPreview, type SelectionPreview } from './selection-preview';
import { summariseExitDivergence, type ExitDivergence } from '../../common/trading/exit-guardian/exit-equivalence';
import { summariseFillGap, type FillGapSummary } from '../../common/trading/exit-guardian/stop-fill-gap';
// #1335 — how much of THIS run rode on a mechanism live would not reproduce.
import { parityExposure, type ParityExposure } from '../../common/trading/parity-exposure';
// #1345 — can this run close a trade at all? The answer is arithmetic, not a hunch.
import { viabilityOf, sessionSpanMinutes, type Viability } from '../../common/trading/backtest-viability';
import { APP_VERSION } from '../../version';
import {
  rankBotCandidates,
  type BotCandidate,
  type BotResolution,
  type BotResolutionResult,
} from './bot-resolution';

/**
 * The resolution when there is nothing to resolve — a caller that passed `botId: null` deliberately, or
 * a protocol no bot names. Exported shape rather than an inline literal so the response type and the
 * "why is this empty" sentence cannot drift apart.
 */
const NO_RESOLUTION: BotResolution = {
  candidateCount: 0,
  ambiguous: false,
  reason: 'no bot names this protocol, so the engine literals are what this run measures',
  candidates: [],
};

/** The one numeric coercion this file needs, kept local (a `null` must not read as 0). */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface SelectionRunRequest {
  /** The `backtest_period.name` shared by every symbol in the dataset group. */
  datasetName: string;
  protocolId: string;
  /** How many of the ranked candidates may be traded. Owner decision 2026-11-19: 3. */
  topN?: number;
  /** `HH:MM` UTC. Entries before this are not counted, and the ranking may not see past it. */
  cutoffUtc?: string;
  /**
   * ── PREVIEW ONLY: STOP BEFORE THE ENGINE (owner, 2026-11-25) ──────────────────────────────────
   *
   * Returns the day's coverage — candidate count, per-symbol bar coverage on BOTH bases, the ranking's
   * publisher and the thinnest basis it rests on — and runs nothing.
   *
   * ⚠️ IT GOES THROUGH EVERY ADMISSION CHECK FIRST (dataset name, side conflict, publisher choice,
   * `selectAnswerDay`) and therefore REFUSES exactly as a real run would. A preview with its own copy
   * of those rules is the copy that goes stale, and it would report a thin day as clean.
   */
  dryRun?: boolean;
  /** Optional override. It must AGREE with the dataset's own side; a disagreement is refused. */
  side?: MoversSide;
  /**
   * Return the per-bar timeline for each selected symbol — scores, price, move, the trade on that bar,
   * and the step ladder that got there. Costs JSON rather than time: the run scores the bars anyway.
   * See `run-depth.ts` for what is recorded versus derived.
   */
  includeBreakdown?: boolean;
  /**
   * The bot whose trade-management configuration this run should measure. Omitted means AUTO-RESOLVE:
   * the service picks the bot subscribed to `protocolId` (preferring active), because a run that
   * silently used the engine's own literals produced a wrong conclusion on 2026-11-20 — the result was
   * read as "the strategy's 1%/1% bracket" when the bot was configured 2.5%/6%.
   *
   * `null` explicitly disables the lookup, for a deliberate study of the protocol with no bot.
   */
  botId?: string | null;
  /**
   * ⚠️ WHICH POPULATION TO MEASURE — the one the engine can compute, or the one the bot could act on.
   *
   * `independent` (default, the incumbent): every signal becomes a hypothetical trade walked forward on
   * its own. Correct for measuring SIGNAL quality; it is what every stored run contains.
   *
   * `portfolio`: the same decided trades, then an ADMISSION filter asking whether the bot was free —
   * `cooldownMinutes` between entries and a cap on concurrent positions. Measured 2026-11-20: one
   * movers day produced **53 entries where the bot could have taken 13**.
   *
   * ⚠️ OPT-IN IS REGISTER ROW 23, NOT HEDGING: switching the default would silently change the
   * population of every stored result. With both arms available, the two can be compared on ONE
   * dataset — which is the only way the change can be judged.
   */
  admission?: 'independent' | 'portfolio';
  /**
   * The concurrency cap for `admission: 'portfolio'`. This is the GLOBAL `risk.maxOpenPositions`
   * (default 5, broker-wide) — **not** `trading_strategy.maxPositions`, which `bot-rules.ts` records as
   * `legacy-only` and which the live dispatch path never reads.
   *
   * ⚠️ `null`/absent means NO CAP IS DECLARED, and the run says so rather than inventing 5: the setting
   * is deployment state, and a default here would be a number nothing measured.
   */
  maxConcurrent?: number | null;
  /**
   * WHICH PUBLISHER'S BARS TO READ (#1282). Absent = chosen and reported by `chooseBarProvider()`.
   * A pin with no bars in the window is REFUSED rather than resolved to "whatever is there".
   */
  barProvider?: string;
  // Strategy settings forwarded to the per-symbol engine, unchanged.
  slPct?: number;
  tpPct?: number;
  minComposite?: number;
  accountSize?: number;
  commission?: number;
}

export interface SelectionSymbolResult {
  symbol: string;
  trades: number;
  /** Winning trades. Carried rather than derived from `winRate`, so an aggregate is exact. */
  wins: number;
  winRate: number;
  netPnl: number;
  profitFactor: number | null;
  /** Trades the engine produced that the selection did NOT permit, by reason. */
  excludedNotSelected: number;
  excludedBeforeCutoff: number;
  error?: string;
  /**
   * #1325 — trades this symbol produced that the ADMISSION filter refused (cooldown / cap).
   * Absent in `independent` mode and absent when nothing was refused — 0 and "not measured" are
   * different facts and must not render alike.
   */
  refusedByAdmission?: number;
  /** Present only when the request asked for `includeBreakdown`. */
  detail?: SelectionSymbolDetail;
}

/**
 * #1325 — what the portfolio ADMISSION filter did, and what it deliberately does not model.
 *
 * ⚠️ `refused` is CAPPED AT 50 ROWS and `counts` is not: a page does not need 200 refusal sentences, but
 * a reader must be able to see that 200 were refused. The counts are the claim; the rows are evidence.
 */
export interface SelectionAdmission {
  mode: 'portfolio';
  applied: { maxConcurrent: number | null; cooldownMinutes: number };
  counts: {
    considered: number;
    admitted: number;
    refused: number;
    byCode: { cap: number; cooldown: number };
  };
  refused: Array<{ symbol: string; entryDate: string; code: 'cap' | 'cooldown'; because: string }>;
  /** Listed on every result so nobody infers the population is a portfolio simulation. */
  notModelled: string[];
}

/** One symbol's session, taken apart. Every field is either recorded by the run or labelled from it. */
export interface SelectionSymbolDetail {
  /** The stored run this detail came from, so the reader can open it elsewhere. */
  runId: string | null;
  /** Bars of the answer day only, with the trade (if any) that sits on each one. */
  bars: DepthBarRow[];
  /** The ladder from "on today's list" to "closed a trade", each rung with its count. */
  steps: DepthStep[];
  /** Every trade the engine took on this session, kept or refused, so the gap is visible. */
  trades: DepthTrade[];
  /** The run's own counters, beside the derived ladder, so the two can be read against each other. */
  runCounters: {
    totalSignals: number | null;
    signalsWithoutTrade: number | null;
    tradesRefusedUnaffordable: number | null;
  };
}

export interface SelectionRunResult {
  datasetName: string;
  protocolId: string;
  /** The ONE session this dataset is a screen of. */
  answerDate: string;
  /** The side the DATASET holds (read from its name). */
  datasetSide: MoversSide;
  /** The side this run ranked for. Equal to `datasetSide` or the run was refused. */
  side: MoversSide;
  /** `protocol` is the normal source. Anything else is said out loud in `caveats`. */
  sideSource: SideSource;
  topN: number;
  cutoffUtc: string;
  timeframe: string;
  /** Every symbol in the dataset group — the candidate list the ranking chose from. */
  candidates: string[];
  /** Sessions in the window BEFORE the answer day: warm-up, not measurement. */
  priorSessions: number;
  /**
   * #1282 — which publisher the RANKING read. A candidate order produced from two price scales is not
   * a ranking, so the choice is reported rather than assumed.
   */
  rankingProvider: { provider: string | null; available: string[]; ambiguous: boolean; note: string | null };
  /**
   * WHERE EVERY TRADE-MANAGEMENT NUMBER CAME FROM — bot record, request override, or engine literal.
   * ⚠️ This is not documentation. A run without it was read as "the strategy's 1%/1% bracket" while the
   * bot was configured 2.5%/6%, and every `applied: false` row means the result says nothing about it.
   */
  tradeConfig: {
    /** The bot that supplied the values, or null when none names this protocol. */
    bot: { id: string; name: string; active: boolean; mode: string | null } | null;
    /** `auto` = the service found the bot; `explicit` = the caller named it; `none` = nothing available. */
    resolvedBy: 'auto' | 'explicit' | 'none';
    /**
     * WHICH BOT, AND WHY THAT ONE — every candidate with its facts, plus a sentence naming the level that
     * decided it (register row 299).
     *
     * ⚠️ An unnamed run used to resolve to whichever bot had been EDITED most recently, and report it as
     * `resolvedBy: 'auto'`. On `movers-v1-long` that was a throwaway mechanism probe among five bots, four
     * of which the signal queue has never been able to reach. `ambiguous: true` means the choice came down
     * to edit time — a tiebreak, not a rule — and a reader deciding whether to trust the numbers needs it.
     */
    resolution: BotResolution;
    fields: TradeConfigField[];
    summary: string;
  };
  /** The one ranked day, as an array so a caller renders the same shape as before. */
  days: DayRank[];
  perSymbol: SelectionSymbolResult[];
  totals: {
    daysRanked: number;
    selections: number;
    trades: number;
    /** Winning trades, so a multi-day aggregate can be summed without re-deriving from a percentage. */
    wins: number;
    netPnl: number;
    winRate: number;
    /** Trades the ranker would have permitted but a symbol's own run never produced. */
    engineTradesOutsideSelection: number;
  };
  /**
   * #1328 — the delta against the previous run of THE SAME TEST, or the reason there is not one.
   *
   * ⚠️ ALWAYS PRESENT. A missing field would leave the UI to invent a "no change" state, and a "no
   * change" is exactly the claim a refused comparison must not make. `comparable: false` carries
   * `blockedBy` and a `reason` naming what changed.
   */
  comparison: Comparison;
  /** Whether this test was stored, so the next run has something to compare with. */
  selectionRun: { id: string | null; persisted: boolean; reason: string | null; runsLinked: number };
  /**
   * #1325 — present ONLY in `admission: 'portfolio'` mode. `null` means the run measured the independent
   * population, which is what every stored run before this contains — so a reader is never left to guess
   * which of the two they are looking at.
   */
  admission: SelectionAdmission | null;
  /**
   * What this population could not reproduce in the live account — counted, not re-decided. `note:
   * null` means every exit maps exactly. See `summariseExitDivergence()`.
   */
  exitDivergence: ExitDivergence;
  /** #1335 — how optimistic the stop fills in this population are. `measured: 0` = not recorded. */
  fillGap: FillGapSummary;
  /**
   * #1341 — the BEST result ever recorded for this test, and whether this run replaced it.
   *
   * ⚠️ ALWAYS PRESENT. A missing field would leave the page to render "no record", which is a claim
   * about history the page is not in a position to make.
   */
  /**
   * #1335 — how many of THIS run's trades exited on a mechanism the live account does not reproduce,
   * and how much P/L that carried. ⚠️ Always present: a missing field would leave the page to assume
   * full parity, which is the claim this change exists to stop making.
   */
  parityExposure: ParityExposure;
  /**
   * #1345 — whether this run could produce a CLOSED trade, and why not when it could not.
   * ⚠️ Always present. `mark-only` means every figure on the page is a mark of a position still open
   * when the data ended — the state both movers days were in, at 100%.
   */
  viability: Viability;
  best: BestRecord;
  /**
   * The same statements as `caveats`, as ROWS — one per qualification, naming the figure it touches.
   *
   * ⚠️ ADDED 2026-11-26 BECAUSE THE PAGE COULD ONLY COUNT THEM (owner's audit note: *"the caveats
   * belong in a table — one row each, with the figure it touches"*). A page that prints "4 caveats" and
   * no sentences tells the reader something needs knowing and gives no way to know it.
   *
   * `caveats` is kept as plain strings because it is a shared shape across other endpoints and its own
   * tests join on it; the strings here are DERIVED from these rows, so the two cannot disagree.
   */
  caveatRows: SelectionCaveat[];
  caveats: string[];
}

/**
 * One qualification of the run's numbers, addressed to the figure it changes.
 *
 * ⚠️ `qualifies` is the whole point. "Measured on one session" is trivia in a list of sentences; beside
 * `Totals, day count` it tells a reader which tile to doubt.
 */
export interface SelectionCaveat {
  /** Stable identity, so a surface groups and orders without parsing prose. */
  code:
    | 'single-session'
    | 'trade-config'
    | 'membership'
    | 'side-source'
    | 'admission'
    | 'excluded-trades'
    | 'symbol-failed'
    | 'none-ranked'
    /**
     * The parity register's only remaining `gap`: the bot declares scale-in and the engine models one
     * position per symbol, so trade count and exposure are understated. Register row 300.
     */
    | 'pyramid-not-modelled';
  /** Two or three words, for scanning a column rather than reading sentences. */
  label: string;
  /** WHICH FIGURE this qualifies — the table's second column. */
  qualifies: string;
  /** The full statement. Never shortened here; the table is a presentation, not a summary. */
  text: string;
}

const DEFAULT_TOP_N = 3;
const DEFAULT_CUTOFF_UTC = '15:30';

@Injectable()
export class SelectionRunService {
  private readonly logger = new Logger(SelectionRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backtest: BacktestService,
    private readonly bestRun: BestRunService,
  ) {}

  /** The protocol's own declared direction, or null when it cannot be read (reported, not guessed). */
  private async protocolDirection(protocolId: string): Promise<string | null> {
    try {
      const protocol = await this.prisma.protocol.findUnique({
        where: { slug: protocolId },
        select: { directionMode: true },
      });
      return protocol?.directionMode ?? null;
    } catch (err) {
      // Not fatal: `resolveMoversSide()` falls back to the dataset name, and the result says so.
      this.logger.warn(
        `Could not read the direction of protocol ${protocolId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Find the bot whose configuration this run should measure.
   *
   * ── DECISION (2026-11-20, primary) ──
   * WHAT:      Auto-resolve the bot for this protocol unless `botId: null` is passed deliberately, and
   *            return a per-field provenance table (`trade-config.ts`).
   * WHY:       The run that produced "a 1%/1% bracket is the problem" had no bot, so it measured the
   *            engine's literals (1%/1%, entry bar 0, no hold) against a bot configured 2.5%/6%, entry
   *            bar 30, hold 4h. Same dataset, same cutoff: −1,538.47 without the bot, +767.64 with it.
   *            A conclusion drawn from the first number was a conclusion about nothing.
   * INSTEAD OF: Reporting "engine default" and leaving the reader to notice. Accurate and useless: the
   *            measurement still would not describe a configuration any bot runs.
   * REVERSE BY: Returning `{ bot: null }` from this method unconditionally and dropping `botId` from the
   *            request it forwards. Nothing is stored.
   * REGISTER:  docs/SETTLED-DECISIONS.md row 233
   * GUARD:     nest/src/modules/backtest/trade-config.spec.ts
   *
   * ⚠️ `mergeBotConfig()` is what supplies slPct/tpPct/minComposite/maxHoldHours/stopPlan from the
   * record, and an explicit request field still wins over it.
   * ⚠️ PREFERENCE ORDER IS STATED, NOT IMPLIED: a bot naming this protocol as its PRIMARY leg beats one
   * that names it as `shortProtocolId`, and an active bot beats an inactive one. The chosen id is
   * returned and echoed, so "which bot produced these numbers?" is answerable from the result.
   */
  private async resolveBotForRun(
    protocolId: string,
    explicit: string | null | undefined,
  ): Promise<BotResolutionResult<TradeConfigBot>> {
    const select = {
      id: true,
      name: true,
      protocolId: true,
      active: true,
      mode: true,
      slPct: true,
      tpPct: true,
      minComposite: true,
      maxHoldHours: true,
      cooldownMinutes: true,
      maxPositions: true,
      sessionWindow: true,
      baseSize: true,
      maxPyramidTiers: true,
      exitBeforeUtc: true,
      exhaustionObserveEnabled: true,
      takeProfitAmount: true,
      brokerId: true,
      simTslEnabled: true,
      /**
       * ⚠️ BOTH TRAIL PERCENTAGES ARE REQUIRED (measured 2026-11-25). They were absent from this
       * projection, so `trade-config.ts` read them as `undefined`, decided the trail was NOT configured
       * for every bot, and told the reader *"NO trailing stop is applied"* — including for a bot with
       * `simTslActivationPct: 2` / `simTslDistancePct: 1` whose run then produced **18 `TRAIL` exits of
       * 22**. The engine was right (it fetches the bot by id separately); only this table lied, and it
       * lied about the one mechanism the reader opens the table to check.
       * ⇒ A column missing HERE is a column the config table cannot read. Add a bot field to
       * `TradeConfigBot` and it must be added here in the same change.
       */
      simTslActivationPct: true,
      simTslDistancePct: true,
    } as const;

    if (explicit === null) return { bot: null, resolvedBy: 'none', resolution: NO_RESOLUTION };

    if (typeof explicit === 'string' && explicit.trim()) {
      const found = await this.prisma.tradingStrategy.findUnique({
        where: { id: explicit.trim() },
        select,
      });
      if (!found) {
        throw new BadRequestException(`No trading_strategy is stored under id '${explicit}'.`);
      }
      return {
        bot: found as unknown as TradeConfigBot,
        resolvedBy: 'explicit',
        resolution: {
          candidateCount: 1,
          ambiguous: false,
          reason: 'the caller named this bot, so nothing was chosen on its behalf',
          candidates: [
            {
              id: found.id,
              name: found.name,
              active: found.active === true,
              subscribed: true,
              primary: found.protocolId === protocolId,
              chosen: true,
            },
          ],
        },
      };
    }

    const candidates = await this.prisma.tradingStrategy.findMany({
      where: { OR: [{ protocolId }, { shortProtocolId: protocolId }] },
      select: { ...select, shortProtocolId: true, updatedAt: true },
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
    });
    if (!candidates.length) return { bot: null, resolvedBy: 'none', resolution: NO_RESOLUTION };

    /**
     * ⚠️ THE SUBSCRIPTION IS THE RANKING FACT THAT WAS MISSING (measured 2026-11-26). Five bots name
     * `movers-v1-long`, four with no `strategy_protocol` row at all — and `active desc, updatedAt desc`
     * resolved an unnamed run to a throwaway mechanism probe whose config nothing has ever traded.
     * `SignalQueueService` routes by subscription, so a bot without one is a CONFIGURATION, not a bot.
     * Ranking and the reported reason both live in `bot-resolution.ts`; this method only supplies facts.
     */
    const subscribed = await this.prisma.strategyProtocol.findMany({
      where: { strategyId: { in: candidates.map((c) => c.id) }, protocolId },
      select: { strategyId: true },
    });

    return rankBotCandidates(candidates as unknown as BotCandidate[], {
      protocolId,
      subscribedIds: new Set(subscribed.map((s) => s.strategyId)),
    }) as unknown as BotResolutionResult<TradeConfigBot>;
  }

  /**
   * Turn one symbol's run into the timeline the depth view renders.
   *
   * ⚠️ EVERYTHING HERE IS LABELLED FROM RECORDED FACTS. The bars, scores, signals, gates, entries and
   * exits come from the run; this method only puts them on one axis and names each bar's state. It does
   * not re-score anything and it does not assert a reason the engine did not record — see `run-depth.ts`.
   */
  private buildDetail(
    result: unknown,
    tagged: Array<Record<string, unknown>>,
    keptSet: Set<unknown>,
    /** Trade object → why the selection dropped it. Object identity: the same instances `tagged` holds. */
    dropCode: Map<unknown, string> | null,
    answerDate: string,
    cutoffUtc: string,
    directionMode: 'long' | 'short',
    selectedCount: number,
    candidateCount: number,
  ): SelectionSymbolDetail {
    const r = result as {
      id?: string | null;
      scoreSeries?: Array<Parameters<typeof buildDepthBars>[0]['series'][number]>;
      stats?: Record<string, unknown>;
    };

    const series = Array.isArray(r.scoreSeries) ? r.scoreSeries : [];
    const trades: DepthTrade[] = tagged.map((t) => ({
      symbol: String(t.symbol ?? ''),
      entryDate: String(t.entryDate ?? ''),
      exitDate: String(t.exitDate ?? ''),
      entryPrice: Number(t.entryPrice ?? 0),
      exitPrice: Number(t.exitPrice ?? 0),
      direction: t.direction === 'SHORT' ? 'SHORT' : 'LONG',
      pnl: Number(t.pnl ?? 0),
      exitReason: String(t.exitReason ?? ''),
      closeReason: typeof t.closeReason === 'string' ? t.closeReason : null,
      signal: String(t.signal ?? ''),
      kept: keptSet.has(t),
      // ⚠️ THE REASON, so a table can say WHICH refusal rather than "refused" (2026-11-23).
      selectionReason: keptSet.has(t)
        ? null
        : ((dropCode?.get(t) as 'not-selected' | 'before-cutoff' | undefined) ?? 'not-selected'),
    }));

    const bars = buildDepthBars({ series, trades, answerDate, cutoffUtc, directionMode });
    const steps = buildStepLadder({
      candidates: candidateCount,
      selected: selectedCount,
      bars,
      trades,
    });

    const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
    return {
      runId: r.id ?? null,
      bars,
      steps,
      trades,
      runCounters: {
        totalSignals: num(r.stats?.totalSignals),
        signalsWithoutTrade: num(r.stats?.signalsWithoutTrade),
        tradesRefusedUnaffordable: num(r.stats?.tradesRefusedUnaffordable),
      },
    };
  }

  /**
   * windowBarsPerCandidate() — the bar count the ENGINE will judge each candidate on.
   *
   * ── WHY THIS IS NOT THE RANKING'S COUNT ──────────────────────────────────────────────────────────
   * `backtest.run()` chooses a publisher PER SYMBOL inside that symbol's own period window, and throws
   * `< 100 bars` against what it loaded. The ranking chooses ONE publisher for the whole group and
   * reads the group window. Two different queries answering two different questions — so the floor
   * test must use this one, or the preview clears days the engine then refuses.
   *
   * One `groupBy` over `[symbolId, provider]` with each symbol's own window in the `OR`, then
   * `chooseBarProvider()` — the SAME decision function the engine calls. ⚠️ No `barProvider` pin is
   * passed: the selection run does not forward the caller's pin to the engine, so honouring it here
   * would predict a choice the engine will not make.
   */
  private async windowBarsPerCandidate(
    periods: Array<{ symbolId: string; fromDate: Date; toDate: Date }>,
    timeframe: string,
    tickerById: Map<string, string>,
  ): Promise<Record<string, { bars: number; provider: string | null }>> {
    const out: Record<string, { bars: number; provider: string | null }> = {};
    if (!periods.length) return out;

    const groups = await this.prisma.marketBar.groupBy({
      by: ['symbolId', 'provider'],
      where: {
        timeframe,
        OR: periods.map((p) => ({
          symbolId: p.symbolId,
          timestamp: { gte: p.fromDate, lte: p.toDate },
        })),
      } as never,
      _count: { _all: true },
    });

    const countsBySymbol = new Map<string, Record<string, number>>();
    for (const g of groups) {
      const bucket = countsBySymbol.get(g.symbolId) ?? {};
      bucket[g.provider] = Number((g._count as { _all: number })._all);
      countsBySymbol.set(g.symbolId, bucket);
    }

    for (const p of periods) {
      const ticker = tickerById.get(p.symbolId);
      if (!ticker) continue;
      const counts = countsBySymbol.get(p.symbolId) ?? {};
      const choice = chooseBarProvider(counts);
      out[ticker] = {
        bars: choice.provider ? Number(counts[choice.provider] ?? 0) : 0,
        provider: choice.provider,
      };
    }
    return out;
  }

  async runSelection(request: SelectionRunRequest): Promise<SelectionRunResult | SelectionPreview> {
    const datasetName = (request.datasetName ?? '').trim();
    if (!datasetName) throw new BadRequestException('datasetName is required.');
    if (!request.protocolId) throw new BadRequestException('protocolId is required.');

    // ── which day is this list a screen of, and which end of the market does it hold? ────────────
    const decl = parseMoversDatasetName(datasetName);
    if (!decl.value) throw new BadRequestException(decl.reason);

    const protocolDirection = await this.protocolDirection(request.protocolId);
    const resolution = resolveMoversSide({
      explicit: request.side,
      protocolDirection,
      datasetSide: decl.value.side,
    });
    if (resolution.conflict || !resolution.side) {
      throw new BadRequestException(resolution.conflict ?? 'The side of this run could not be decided.');
    }
    // The side the BUY/SELL classes are judged against, from the protocol's own declaration — the same
    // function the engine uses, so the timeline cannot disagree with what the engine actually did.
    const directionMode = directionFromProtocol(undefined, protocolDirection) as 'long' | 'short';

    const topN = Math.max(1, Math.floor(request.topN ?? DEFAULT_TOP_N));
    const cutoffUtc = request.cutoffUtc ?? DEFAULT_CUTOFF_UTC;

    // ── WHICH CONFIGURATION THIS RUN MEASURES ───────────────────────────────────────────────────
    // ⚠️ BEFORE the bars are loaded, because a bot decides the entry bar (`minComposite`) and a run
    // that scored first and applied the bar afterwards would have been a different measurement.
    // ⚠️ Named `botResolution`, not `resolution` — `resolution` is already the SIDE of the run, decided
    // three lines above by `resolveMoversSide()`. Two different answers to two different questions.
    const { bot, resolvedBy, resolution: botResolution } = await this.resolveBotForRun(request.protocolId, request.botId);
    const tradeFields = buildTradeConfig(bot, {
      slPct: request.slPct,
      tpPct: request.tpPct,
      minComposite: request.minComposite,
      accountSize: request.accountSize,
    });
    const tradeConfig = {
      bot: bot
        ? {
          id: bot.id,
          name: bot.name,
          active: Boolean(bot.active),
          mode: (bot.mode as string | null) ?? null,
        }
        : null,
      resolvedBy,
      resolution: botResolution,
      fields: tradeFields,
      summary: tradeConfigSummary(bot, tradeFields),
    };

    // ── the dataset group: every period sharing the name ─────────────────────────────────────────
    const periods = await this.prisma.backtestPeriod.findMany({ where: { name: datasetName } });
    if (periods.length === 0) {
      throw new NotFoundException(`No backtest periods are stored under the name '${datasetName}'.`);
    }
    const timeframes = [...new Set(periods.map((p) => p.timeframe))];
    if (timeframes.length > 1) {
      // Refused rather than guessed: a ranking across two timeframes compares unlike windows.
      throw new BadRequestException(
        `Dataset '${datasetName}' mixes timeframes (${timeframes.join(', ')}). A ranking needs one.`,
      );
    }
    const timeframe = timeframes[0];

    const symbols = await this.prisma.symbol.findMany({
      where: { id: { in: periods.map((p) => p.symbolId) } },
      select: { id: true, ticker: true },
    });
    const tickerById = new Map(symbols.map((s) => [s.id, s.ticker]));
    const tickers = periods.map((p) => tickerById.get(p.symbolId)).filter((t): t is string => !!t);
    if (tickers.length === 0) {
      throw new NotFoundException(`Dataset '${datasetName}' resolves to no symbols.`);
    }

    // ── bars for RANKING (all candidates, one read) ─────────────────────────────────────────────
    const from = new Date(Math.min(...periods.map((p) => p.fromDate.getTime())));
    const to = new Date(Math.max(...periods.map((p) => p.toDate.getTime())));
    /**
     * ⚠️ ONE PUBLISHER FOR THE RANKING TOO (#1282). The ranker compares closes across symbols, so a blend
     * of two publishers' scales is worse here than anywhere: it would reorder the candidates.
     */
    const rankingScope = {
      symbol: { ticker: { in: tickers } },
      timeframe,
      timestamp: { gte: from, lte: to },
    };
    const providerRows = await this.prisma.marketBar.groupBy({
      by: ['provider'],
      where: rankingScope as never,
      _count: { _all: true },
    });
    const rankingProvider = chooseBarProvider(
      Object.fromEntries(providerRows.map((r) => [r.provider, Number((r._count as { _all: number })._all)])),
      request.barProvider,
    );
    if (rankingProvider.refused) throw new BadRequestException(rankingProvider.refused);

    const rows = await this.prisma.marketBar.findMany({
      where: {
        ...rankingScope,
        ...(rankingProvider.provider ? { provider: rankingProvider.provider } : {}),
      } as never,
      select: { timestamp: true, close: true, symbol: { select: { ticker: true } } },
      orderBy: { timestamp: 'asc' },
    });

    const barsBySymbol = new Map<string, RankBar[]>();
    const allDates = new Set<string>();
    for (const r of rows) {
      const ticker = r.symbol?.ticker;
      if (!ticker) continue;
      const iso = r.timestamp.toISOString();
      allDates.add(iso.slice(0, 10));
      if (!barsBySymbol.has(ticker)) barsBySymbol.set(ticker, []);
      barsBySymbol.get(ticker)!.push({ timestamp: iso, close: Number(r.close) });
    }

    // Rank every date the window holds, then KEEP ONLY the day this list describes. The other days
    // cost nothing (same bars, already in memory) and their presence is what lets the refusal below
    // name the span that was actually covered instead of the one that was expected.
    const allDays = buildDayRanks(barsBySymbol, resolution.side, topN, cutoffUtc);
    const picked = selectAnswerDay(allDays, decl.value.answerDate);
    if (!picked.day) {
      throw new BadRequestException(`'${datasetName}' cannot be measured: ${picked.reason}.`);
    }
    const days: DayRank[] = [picked.day];

    const priorSessions = [...allDates].filter((d) => d < decl.value.answerDate).length;

    /**
     * ── PREVIEW: THE SAME DAY, STOPPED BEFORE THE ENGINE (owner, 2026-11-25) ─────────────────────
     *
     * Everything above this line is ADMISSION — dataset name, side conflict, publisher choice and
     * `selectAnswerDay`. A dry run returns here, so the preview cannot disagree with a real run about a
     * refusal: it IS the same code. Below this line is the engine loop, which is the cost being
     * previewed.
     *
     * ⚠️ TWO COUNTS, TWO BASES — see `selection-preview.ts`. `cutoffBars` is the RANKING's basis
     * (ranking publisher, group window, at or before the cutoff). `windowBars` is the ENGINE's basis
     * (that symbol's own period window, the publisher `backtest.run()` will choose), which is what the
     * 100-bar refusal is thrown against. Judging the floor on the ranking count would clear days the
     * engine then refuses.
     */
    if (request.dryRun) {
      const cutoffMinute = parseCutoffUtc(cutoffUtc);
      const cutoffBarsBySymbol: Record<string, number> = {};
      for (const [ticker, bars] of barsBySymbol) {
        cutoffBarsBySymbol[ticker] = bars.filter((b) => (
          b.timestamp.slice(0, 10) === decl.value.answerDate && minuteOfDayUtc(b.timestamp) <= cutoffMinute
        )).length;
      }

      return buildSelectionPreview({
        datasetName,
        protocolId: request.protocolId,
        answerDate: decl.value.answerDate,
        side: resolution.side,
        sideSource: resolution.source,
        timeframe,
        topN,
        cutoffUtc,
        candidates: tickers,
        selected: picked.day.selected,
        rankingProvider: {
          provider: rankingProvider.provider,
          available: rankingProvider.available,
          ambiguous: rankingProvider.ambiguous,
          note: rankingProvider.note,
        },
        cutoffBarsBySymbol,
        windowBarsBySymbol: await this.windowBarsPerCandidate(periods, timeframe, tickerById),
      });
    }

    // ── run the ENGINE, unchanged, once per symbol the day selected ─────────────────────────────
    const periodByTicker = new Map<string, string>();
    for (const p of periods) {
      const t = tickerById.get(p.symbolId);
      if (t) periodByTicker.set(t, p.id);
    }

    const perSymbol: SelectionSymbolResult[] = [];
    const keptTrades: Array<Record<string, unknown>> = [];
    /** #1328 — the per-symbol runs THIS test created, so the group can be stamped onto them. */
    const runIds: string[] = [];
    let engineTradesOutsideSelection = 0;

    for (const ticker of [...picked.day.selected].sort()) {
      const periodId = periodByTicker.get(ticker);
      if (!periodId) continue;
      try {
        const result = await this.backtest.run({
          periodId,
          protocolId: request.protocolId,
          // ⚠️ `botId` MAKES THE ENGINE USE THE BOT'S OWN NUMBERS (`mergeBotConfig`): slPct, tpPct,
          // minComposite, maxHoldHours, stopPlan. Without it every one of those is an engine literal —
          // measured 2026-11-20, that turned a 2.5%/6% bot into a "1%/1%" result which was then read as
          // the strategy's configuration. An explicit request field still wins, and the run says so.
          ...(bot ? { botId: bot.id } : {}),
          slPct: request.slPct,
          tpPct: request.tpPct,
          minComposite: request.minComposite,
          accountSize: request.accountSize,
          commission: request.commission,
          // Bar-level evidence for the depth view, on request only.
          includeBreakdown: request.includeBreakdown,
          fullScoreSeries: request.includeBreakdown,
        } as never);

        // The trade rows carry no symbol; tag them so the selection filter can read it. Doing this
        // here rather than adding a column to every trade keeps ONE engine output shape.
        const tagged = (result.trades ?? []).map((t) => ({ ...t, symbol: ticker }));
        // #1328 — only a run the engine actually stored can belong to the group. A computed-but-unstored
        // run has no row to stamp, and `persistOutcome()` inside the engine already reported it.
        const storedRunId = (result as { id?: string; persisted?: boolean });
        if (storedRunId.persisted && storedRunId.id) runIds.push(storedRunId.id);
        const { kept, dropped } = applySelection(tagged, days, cutoffUtc);
        const keptSet = new Set(kept);
        const notSelected = dropped.filter((d) => d.code === 'not-selected').length;
        const beforeCutoff = dropped.filter((d) => d.code === 'before-cutoff').length;
        engineTradesOutsideSelection += dropped.length;
        keptTrades.push(...kept);

        const wins = kept.filter((t) => Number(t.pnl) > 0).length;
        perSymbol.push({
          symbol: ticker,
          trades: kept.length,
          wins,
          winRate: kept.length ? (wins / kept.length) * 100 : 0,
          netPnl: kept.reduce((a, t) => a + Number(t.pnl ?? 0), 0),
          profitFactor: result.stats?.profitFactor ?? null,
          excludedNotSelected: notSelected,
          excludedBeforeCutoff: beforeCutoff,
          ...(request.includeBreakdown ? { detail: this.buildDetail(result, tagged, keptSet, new Map(dropped.map((d) => [d.trade, d.code])), decl.value.answerDate, cutoffUtc, directionMode, picked.day.selected.length, tickers.length) } : {}),
        });
      } catch (err) {
        // ONE symbol failing must not discard the whole day — and it is REPORTED, never rendered as
        // a zero-trade symbol (the "plausible output, no error" shape).
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Selection run: ${ticker} failed — ${message}`);
        perSymbol.push({
          symbol: ticker,
          trades: 0,
          wins: 0,
          winRate: 0,
          netPnl: 0,
          profitFactor: null,
          excludedNotSelected: 0,
          excludedBeforeCutoff: 0,
          error: message,
        });
      }
    }

    /**
     * ── COULD THE BOT HAVE TAKEN THESE TRADES? (#1325) ─────────────────────────────────────────────
     * Applied AFTER the per-symbol loop, because both rules are properties of the PORTFOLIO — a cooldown
     * is measured against the previous entry wherever it was, and a cap counts positions open at an
     * instant, across every symbol. `keptTrades` already carries `symbol`, and the filter only removes.
     *
     * ⚠️ THE ENTRIES AND EXITS ARE UNCHANGED. Each trade was decided by the shared scoring/gating/exit
     * core; this asks only "was the bot free?". That is why it can be an opt-in filter rather than a
     * second engine — and why the refused trades can be NAMED rather than silently vanishing.
     */
    const admissionMode = request.admission === 'portfolio' ? 'portfolio' : 'independent';
    let admittedTrades: Array<Record<string, unknown>> = keptTrades;
    let admission: SelectionAdmission | null = null;
    if (admissionMode === 'portfolio') {
      // Each trade carries its own instants so the filter never re-parses a date per comparison.
      const timed = keptTrades.map((t) => ({
        raw: t,
        symbol: String(t.symbol ?? ''),
        entryDate: String(t.entryDate ?? ''),
        entryMs: Date.parse(String(t.entryDate)),
        exitMs: Date.parse(String(t.exitDate)),
      }));
      const result = admitTrades(timed, {
        maxConcurrent: request.maxConcurrent ?? null,
        // Live reads `cooldownMinutes || 5`, and so does `admitTrades()` — the bot's own value when it
        // has one, five minutes when it does not.
        cooldownMinutes: num(bot?.cooldownMinutes ?? null),
      });
      admittedTrades = result.admitted.map((x) => x.raw);
      admission = {
        mode: 'portfolio',
        applied: result.applied,
        counts: {
          considered: keptTrades.length,
          admitted: result.admitted.length,
          refused: result.refused.length,
          byCode: {
            cap: result.refused.filter((r) => r.code === 'cap').length,
            cooldown: result.refused.filter((r) => r.code === 'cooldown').length,
          },
        },
        refused: result.refused.slice(0, 50).map((r) => ({
          symbol: r.trade.symbol,
          entryDate: r.trade.entryDate,
          code: r.code,
          because: r.because,
        })),
        notModelled: [
          'pyramiding / averaging into an open position (`maxPyramidTiers`) — it changes size and exits, which a filter cannot see',
          'the equity effect of the refused trades — in `compound` mode the admitted subset would have sized later trades differently',
          'margin — a cap of N positions says nothing about whether N were affordable',
        ],
      };
    }

    const totalTrades = admittedTrades.length;
    const totalWins = admittedTrades.filter((t) => Number(t.pnl) > 0).length;
    const netPnl = admittedTrades.reduce((a, t) => a + Number(t.pnl ?? 0), 0);
    const winRate = totalTrades ? (totalWins / totalTrades) * 100 : 0;

    /**
     * ⚠️ THE PER-SYMBOL FIGURES ARE RECOMPUTED FROM WHAT SURVIVED, not left at the pre-admission counts
     * the loop pushed. A panel whose rows sum to more than the total is the "plausible output" this repo
     * keeps paying for — the reader would see 53 trades in the table and 13 in the tile.
     */
    if (admissionMode === 'portfolio') {
      for (const row of perSymbol) {
        const mine = admittedTrades.filter((t) => t.symbol === row.symbol);
        const wins = mine.filter((t) => Number(t.pnl) > 0).length;
        row.trades = mine.length;
        row.wins = wins;
        row.winRate = mine.length ? (wins / mine.length) * 100 : 0;
        row.netPnl = mine.reduce((a, t) => a + Number(t.pnl ?? 0), 0);
        const refusedHere = admission!.refused.filter((r) => r.symbol === row.symbol).length;
        if (refusedHere) row.refusedByAdmission = refusedHere;
      }
    }

    /**
     * ── THE TEST, AS A NAMED GROUP (#1328) ────────────────────────────────────────────────────────
     * The per-symbol engine runs already persist into `backtestrun`. They carry no record that they
     * were ONE test, and the numbers on the page's tiles are computed over KEPT trades after the
     * selection filter — so they cannot be read off any single per-symbol row either. This block
     * stores the group and its aggregate, then asks whether the PREVIOUS run of the same test may be
     * subtracted from it.
     *
     * ⚠️ THE PREVIOUS RUN IS READ BEFORE THIS ONE IS WRITTEN, or the comparison would find itself.
     */
    const profile: SelectionProfile = {
      datasetName,
      answerDate: decl.value.answerDate,
      side: decl.value.side,
      directionMode,
      protocolId: request.protocolId,
      botId: bot?.id ?? null,
      topN,
      cutoffUtc,
    };
    const profileKey = buildProfileKey(profile);
    const appliedConfig = tradeConfig.fields.map((f) => ({ id: f.id, value: f.value, applied: f.applied }));

    let previous: StoredSelection | null = null;
    try {
      const row = await this.prisma.backtestSelection.findFirst({
        where: { profileKey },
        orderBy: { createdAt: 'desc' },
      });
      previous = row
        ? {
            id: row.id,
            createdAt: row.createdAt.toISOString(),
            engineVersion: row.engineVersion,
            semanticsVersion: row.semanticsVersion,
            totals: { trades: row.trades, wins: row.wins, winRate: row.winRate, netPnl: row.netPnl },
            config: parseConfigJson(row.configJson),
          }
        : null;
    } catch (err) {
      // A history that cannot be read is REPORTED, never rendered as "no previous run" — those two
      // states mean opposite things to a reader deciding whether a delta is missing or absent.
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Selection history read failed for profile ${profileKey.slice(0, 12)} — ${message}`);
    }

    const comparison = compareSelections(
      { totals: { trades: totalTrades, wins: totalWins, winRate, netPnl }, config: appliedConfig },
      previous,
      profile,
    );

    const stored = await this.persistSelection({
      profile,
      profileKey,
      botName: bot?.name ?? null,
      symbols: picked.day.selected,
      config: appliedConfig,
      totals: { trades: totalTrades, wins: totalWins, winRate, netPnl },
      engineTradesOutsideSelection,
      runIds,
    });

    /**
     * ── THE BEST RESULT FOR THIS TEST, KEPT (#1341) ──────────────────────────────────────────────
     *
     * ⚠️ THE KEY EXCLUDES THE DAY ON PURPOSE. `profileKey` above identifies ONE TEST OF ONE DAY, which
     * is what a delta needs. The record needs the opposite: "these settings, this leg, over however
     * many days were measured" — so many days accumulate onto one record instead of one record per day.
     * That is precisely why the record is decided on net P/L PER DAY: a five-day run must not beat a
     * one-day run merely for measuring more days.
     */
    const best = await this.bestRun.consider({
      scope: 'movers-selection',
      profileKey: bestProfileKey([
        profile.protocolId,
        profile.botId,
        profile.directionMode,
        profile.side,
        `top${profile.topN}`,
        profile.cutoffUtc,
      ]),
      label: `${bot?.name ?? profile.protocolId} · ${profile.directionMode} · top ${profile.topN} · ${profile.cutoffUtc}`,
      netPnl,
      days: 1,
      trades: totalTrades,
      wins: totalWins,
      winRate,
      // The TRADE-based factor, over the same admitted population as `netPnl` and `trades`, so a
      // record's factor can never describe a different sample from its P/L (`profit-factor.ts`).
      profitFactor: tradeProfitFactor(admittedTrades as Array<{ pnl: number | null | undefined }>),
      config: appliedConfig,
      runId: stored.id,
      engineVersion: APP_VERSION,
    });

    /**
     * ── THE CAVEATS, AS ROWS ADDRESSED TO A FIGURE (2026-11-26) ────────────────────────────────────
     * Each row names the number it qualifies. `caveats` is then DERIVED from these, so the sentence list
     * and the table cannot say different things.
     */
    const caveatRows: SelectionCaveat[] = [
      {
        code: 'single-session',
        label: 'One session',
        qualifies: 'Totals, day count',
        text:
          `Measured on ${decl.value.answerDate} only — the session this dataset is a screen of. Its ` +
          `${priorSessions} earlier session(s) are directive warm-up, not results.`,
      },
      {
        code: 'trade-config',
        label: tradeConfig.bot ? 'Trade management' : 'No bot — engine literals',
        qualifies: 'P/L, stop, target, hold',
        text: tradeConfig.bot
          ? `Trade management came from ${tradeConfig.bot.name}${tradeConfig.bot.active ? '' : ` (INACTIVE, ${tradeConfig.bot.mode ?? 'unknown'} mode)`}`
            + ' — stop, target, entry bar and max hold are that record\'s own values.'
          : 'NO BOT names this protocol, so stop, target and entry bar are the ENGINE\'S LITERALS. '
            + 'The result describes the protocol\'s signals at a bracket nobody chose, not a deployed strategy.',
      },
      {
        code: 'membership',
        label: 'Candidate list',
        qualifies: 'Top N selection',
        text:
          `The candidate list (${tickers.length} symbols) was built from ${decl.value.answerDate}'s ` +
          'close-to-close move, so the LIST already knows how the day ended. The ranking inside it uses ' +
          `bars up to ${cutoffUtc} UTC only, but membership is optimistic: a screen run live at the ` +
          'cutoff would have picked from the whole market (#1321).',
      },
    ];
    if (resolution.source !== 'protocol') {
      caveatRows.push({
        code: 'side-source',
        label: 'Direction source',
        qualifies: 'Long/Short leg',
        text:
          `Side came from the '${resolution.source}' source rather than the protocol's declared ` +
          'direction — confirm the protocol id is the leg you meant.',
      });
    }
    if (admission) {
      caveatRows.push({
        code: 'admission',
        label: 'Admitted population',
        qualifies: 'Every total',
        text:
          `ADMISSION: portfolio — ${admission.counts.refused} of ${admission.counts.considered} trade(s) the engine ` +
          `decided were refused because the bot could not have taken them (${admission.counts.byCode.cooldown} inside the ` +
          `${admission.applied.cooldownMinutes}-minute cooldown, ${admission.counts.byCode.cap} while ` +
          `${admission.applied.maxConcurrent ?? 'no'}-position cap was full). Every figure above describes the ADMITTED ` +
          'population; the independent population is what every run stored before #1325 contains, so the two are not ' +
          'comparable with each other without saying so.',
      });
    }
    if (engineTradesOutsideSelection > 0) {
      caveatRows.push({
        code: 'excluded-trades',
        label: 'Excluded trades',
        qualifies: 'Trades, win rate',
        text:
          `${engineTradesOutsideSelection} trade(s) the engine produced were excluded by the selection ` +
          `(${perSymbol.reduce((a, s) => a + s.excludedBeforeCutoff, 0)} entered before the ${cutoffUtc} ` +
          'cutoff; the remainder were on warm-up sessions or on symbols this day did not pick).',
      });
    }
    const failed = perSymbol.filter((s) => s.error);
    if (failed.length) {
      caveatRows.push({
        code: 'symbol-failed',
        label: 'Symbol failed',
        qualifies: 'Per-symbol result',
        text:
          `${failed.length} symbol(s) could not be run and are listed with their error rather than as zero trades: ` +
          failed.map((f) => f.symbol).join(', '),
      });
    }
    if (picked.day.selected.length === 0) {
      caveatRows.push({
        code: 'none-ranked',
        label: 'Nothing ranked',
        qualifies: 'The whole run',
        text: `No candidate could be ranked on ${decl.value.answerDate}.`,
      });
    }
    /**
     * ⚠️ PYRAMIDING IS THE PARITY REGISTER'S ONLY REMAINING `gap`, AND THIS IS WHAT MAKES IT VISIBLE
     * (2026-11-26). The engine models ONE position per symbol: `backtest.service.ts` opens a trade and
     * walks forward to its exit. `PyramidPolicyService` in the live path may open a SECOND position on
     * the same symbol when the bot declares `maxPyramidTiers > 1` and the existing one is green with its
     * stop at breakeven-or-better. So a run against a bot that declares scale-in understates both its
     * exposure and its trade count — silently, because nothing in the result said the mechanism was
     * missing. Register row 300.
     *
     * The modelling itself is NOT landed here: it changes the trade population (concurrent positions
     * instead of one at a time), which is a maths change and needs a copied configuration and a
     * side-by-side run. Until then the run states which mechanism it could not model.
     */
    const botTiers = Number((bot as unknown as { maxPyramidTiers?: number | null } | null)?.maxPyramidTiers ?? 1);
    if (Number.isFinite(botTiers) && botTiers > 1) {
      caveatRows.push({
        code: 'pyramid-not-modelled',
        label: 'Scale-in not modelled',
        qualifies: 'Trades, exposure, P/L',
        text:
          `${tradeConfig.bot?.name ?? 'This bot'} declares scale-in up to ${botTiers} tiers ` +
          '(`maxPyramidTiers`), and the ENGINE MODELS ONE POSITION PER SYMBOL. When the live path would ' +
          'have added a second position to a profitable, stop-locked one, this run recorded no such ' +
          'trade — so its trade count and exposure are UNDERSTATED, and the gap widens the more often ' +
          'the first position went green before the signal faded. Parity register row `pyramid`.',
      });
    }
    const caveats = caveatRows.map((r) => r.text);

    /**
     * ⚠️ THE SPAN IS MEASURED FROM THE DATABASE, NOT FROM THE BREAKDOWN. `perSymbol[].detail.bars` only
     * exists when `includeBreakdown` is set, so the first version reported `timeStopReachable: true`
     * ("cannot judge") on a run that is provably un-closeable — a silent "fine" where the truth was the
     * opposite, which is the failure this repo designs against. One aggregate over the selected symbols'
     * own 5m bars costs a single query, and it comes from the SAME `tradeConfig.fields` the result
     * reports rather than a literal.
     */
    const spanMinutes = await this.sessionSpanFor(picked.day.selected, decl.value.answerDate);

    /**
     * ⚠️ THE HOLD ROW'S REACHABILITY CAN ONLY BE JUDGED NOW (2026-11-24). The table is built before the
     * bars are loaded, so it could not know the dataset's span or how far the exit boundary is from the
     * cutoff — and without that it reported *"closed after 10 hours"* on a run whose exits were 100%
     * boundary. `applied` stays true (the rule IS armed); the sentence is what changes.
     */
    tradeConfig.fields = applyHoldReachability(tradeConfig.fields, {
      sessionSpanMinutes: spanMinutes,
      exitBeforeUtc: bot?.exitBeforeUtc ?? null,
      cutoffUtc,
    });

    return {
      datasetName,
      protocolId: request.protocolId,
      answerDate: decl.value.answerDate,
      datasetSide: decl.value.side,
      side: resolution.side,
      sideSource: resolution.source,
      topN,
      cutoffUtc,
      timeframe,
      candidates: tickers,
      priorSessions,
      /**
       * #1282 — which publisher the RANKING read, and whether that was a decision or an avoided
       * refusal. A candidate order produced from two price scales is not a ranking.
       */
      rankingProvider: {
        provider: rankingProvider.provider,
        available: rankingProvider.available,
        ambiguous: rankingProvider.ambiguous,
        note: rankingProvider.note,
      },
      tradeConfig,
      days,
      perSymbol,
      totals: {
        daysRanked: 1,
        selections: picked.day.selected.length,
        trades: totalTrades,
        wins: totalWins,
        netPnl,
        winRate,
        engineTradesOutsideSelection,
      },
      /**
       * #1328 — the delta the tiles need, and the reason there is not one when there is not. Always
       * present: a missing `comparison` would force the UI to invent a "no change" state, which is the
       * one thing it must never show.
       */
      comparison,
      /**
       * #1328 — whether the group row was stored. A run that computed numbers but stored nothing must
       * say so (the #1210 rule): otherwise the NEXT run reports "no previous run" and the operator
       * concludes the feature is broken rather than the write.
       */
      selectionRun: stored,
      admission,
      /**
       * ── WHAT THIS POPULATION COULD NOT REPRODUCE LIVE (2026-11-23) ──
       * The same aggregate the single-symbol run reports, over the ADMITTED trades — i.e. exactly the
       * population `totals` and `perSymbol` describe, so the count cannot disagree with the tile beside
       * it. A movers run is where the trail matters most (the owner tuned toward letting the move run),
       * and before this a per-day result gave no way to see that part of it was trail-dependent.
       */
      exitDivergence: summariseExitDivergence(admittedTrades),
      /** #1335 — the same fill-assumption report, over the same population. */
      fillGap: summariseFillGap(admittedTrades),
      /** #1341 — the best ever for this test, and whether this run is the new one. */
      /**
       * #1335 — how many of THIS run's trades exited on a mechanism the live account does not
       * reproduce, and how much P/L that carried. Same population as `totals` and `exitDivergence`,
       * so the three cannot describe different sets of trades.
       */
      parityExposure: parityExposure(admittedTrades as Array<{ exitReason?: string; pnl?: number }>),
      viability: viabilityOf({
        trades: admittedTrades.length,
        endOfDataTrades: admittedTrades.filter((t) => (t as { exitReason?: string }).exitReason === 'EOD').length,
        maxHoldHours: Number(appliedConfig.find((f) => f.id === 'maxHoldHours')?.value ?? NaN),
        exitBeforeUtc: (appliedConfig.find((f) => f.id === 'exitBeforeUtc')?.value as string | null) ?? null,
        sessionSpanMinutes: spanMinutes,
        // The earliest instant an entry can occur — the boundary only pre-empts the hold by the distance
        // from here, so without it the arithmetic cannot be done and no "unreachable" claim may be made.
        cutoffUtc: cutoffUtc ?? null,
      }),
      best,
      caveatRows,
      caveats,
    };
  }

  /**
   * history() — the previous runs of a selection test, newest first (#1328).
   *
   * ⚠️ `profileKey` is the precise question ("what else is THIS test"), while `protocolId` and
   * `datasetName` are the browse question ("what has this protocol done on this list"). Both are
   * offered because the page needs the first and a reader needs the second, and neither is guessed
   * from the other: a key built from a different bot or rank time is a DIFFERENT test.
   */
  async history(input: {
    profileKey?: string;
    protocolId?: string;
    datasetName?: string;
    limit?: number;
  }): Promise<{ selections: Array<Record<string, unknown>>; profiles: number }> {
    const limit = Math.min(Math.max(1, Math.floor(input.limit ?? 20)), 100);
    if (!input.profileKey && !input.protocolId && !input.datasetName) {
      throw new BadRequestException(
        'one of profileKey, protocolId or datasetName is required — "all history" is not a profile, and returning the last 20 unrelated tests would read as this test\'s history.',
      );
    }
    const where: Record<string, unknown> = {};
    if (input.profileKey) where.profileKey = input.profileKey;
    if (input.protocolId) where.protocolId = input.protocolId;
    if (input.datasetName) where.datasetName = input.datasetName;

    const rows = await this.prisma.backtestSelection.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return {
      profiles: new Set(rows.map((r) => r.profileKey)).size,
      selections: rows.map((r) => ({
        id: r.id,
        profileKey: r.profileKey,
        datasetName: r.datasetName,
        answerDate: r.answerDate instanceof Date ? r.answerDate.toISOString().slice(0, 10) : String(r.answerDate),
        side: r.side,
        directionMode: r.directionMode,
        protocolId: r.protocolId,
        botId: r.botId,
        botName: r.botName,
        topN: r.topN,
        cutoffUtc: r.cutoffUtc,
        totals: { trades: r.trades, wins: r.wins, winRate: r.winRate, netPnl: r.netPnl },
        engineTradesOutsideSelection: r.engineTradesOutsideSelection,
        semanticsVersion: r.semanticsVersion,
        engineVersion: r.engineVersion,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  /**
   * #1345 — how long the day's own bars run, in minutes, for the symbols this run selected.
   *
   * ⚠️ RETURNS `null` WHEN IT CANNOT MEASURE, AND THE CALLER MUST TREAT THAT AS "cannot judge". A
   * zero or a guess here would let a 10-hour hold look fine against a 6.5-hour session — the exact
   * arithmetic that made both movers days 100% end-of-data exits.
   *
   * ⚠️ `5m` is the movers datasets' own cadence; a different timeframe would measure a different span,
   * so the timeframe is the run's, not a constant.
   */
  private async sessionSpanFor(symbols: readonly string[], answerDate: string): Promise<number | null> {
    try {
      const ids = await this.prisma.symbol.findMany({
        where: { ticker: { in: symbols.map((s) => s.toUpperCase()) } },
        select: { id: true },
      });
      if (ids.length === 0) return null;
      const dayStart = new Date(`${answerDate}T00:00:00Z`);
      const dayEnd = new Date(`${answerDate}T23:59:59.999Z`);
      const agg = await this.prisma.marketBar.aggregate({
        where: {
          symbolId: { in: ids.map((s) => s.id) },
          timeframe: '5m',
          timestamp: { gte: dayStart, lte: dayEnd },
        } as any,
        _min: { timestamp: true },
        _max: { timestamp: true },
      } as any);
      const first = agg?._min?.timestamp;
      const last = agg?._max?.timestamp;
      if (!first || !last) return null;
      const minutes = (new Date(last).getTime() - new Date(first).getTime()) / 60000;
      return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
    } catch (err) {
      // A span that cannot be read is REPORTED and then treated as unknown — never as "fine".
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Session span unreadable for ${answerDate}: ${message}`);
      return null;
    }
  }

  /**
   * persistSelection() — store the TEST, then stamp the group onto its per-symbol runs (#1328).
   *
   * ⚠️ A FAILURE HERE IS REPORTED, NEVER THROWN. The run's numbers are already computed and are the
   * reason the caller asked; discarding them because a history row could not be written would be the
   * tail wagging the dog. `persisted: false` with the reason is the honest answer, and the next run's
   * `no-previous` will then be explained by this field rather than looking like an empty history.
   */
  private async persistSelection(input: {
    profile: SelectionProfile;
    profileKey: string;
    /** The bot's name as it read at run time — see the note on the write below. */
    botName: string | null;
    symbols: readonly string[];
    config: Array<{ id: string; value: number | string | null; applied: boolean }>;
    totals: { trades: number; wins: number; winRate: number; netPnl: number };
    engineTradesOutsideSelection: number;
    runIds: readonly string[];
  }): Promise<{ id: string | null; persisted: boolean; reason: string | null; runsLinked: number }> {
    try {
      const created = await this.prisma.backtestSelection.create({
        data: {
          profileKey: input.profileKey,
          datasetName: input.profile.datasetName,
          // A DATE column: the calendar day the screen is of, with no time component to drift.
          answerDate: new Date(`${input.profile.answerDate}T00:00:00Z`),
          side: input.profile.side,
          directionMode: input.profile.directionMode,
          protocolId: input.profile.protocolId,
          botId: input.profile.botId,
          /**
           * ⚠️ THE NAME AT RUN TIME, not a join at read time. `trading_strategy.name` is editable, so a
           * rename would otherwise rewrite what every past test says it measured — and a comparison's
           * whole job is to state what was compared. NULL only when no bot supplied the values.
           */
          botName: input.botName,
          topN: input.profile.topN,
          cutoffUtc: input.profile.cutoffUtc,
          symbolsJson: JSON.stringify(input.symbols),
          configJson: JSON.stringify(input.config),
          trades: input.totals.trades,
          wins: input.totals.wins,
          winRate: input.totals.winRate,
          netPnl: input.totals.netPnl,
          profitFactor: null,
          engineTradesOutsideSelection: input.engineTradesOutsideSelection,
          semanticsVersion: EXECUTION_SEMANTICS,
          engineVersion: APP_VERSION,
        },
        select: { id: true },
      });

      let runsLinked = 0;
      if (input.runIds.length) {
        const linked = await this.prisma.backtestRun.updateMany({
          where: { id: { in: [...input.runIds] } },
          data: { selectionId: created.id },
        });
        runsLinked = linked.count;
      }
      return { id: created.id, persisted: true, reason: null, runsLinked };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Selection run stored NOT persisted — ${message}`);
      return { id: null, persisted: false, reason: message, runsLinked: 0 };
    }
  }
}

/**
 * Read a stored config JSON back into applied values.
 *
 * ⚠️ A MALFORMED OR ABSENT BLOB IS AN EMPTY LIST, which makes `configChanges` report nothing — and
 * that is the safe direction: inventing a change the reader cannot check is worse than reporting none,
 * and the comparison itself still refuses on semantics.
 */
function parseConfigJson(raw: string | null): Array<{ id: string; value: number | string | null; applied: boolean }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((f): f is { id: string; value: number | string | null; applied: boolean } => !!f && typeof f.id === 'string')
      .map((f) => ({ id: f.id, value: f.value ?? null, applied: f.applied === true }));
  } catch {
    return [];
  }
}
