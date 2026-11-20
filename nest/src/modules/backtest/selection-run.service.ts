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

export interface SelectionRunRequest {
  /** The `backtest_period.name` shared by every symbol in the dataset group. */
  datasetName: string;
  protocolId: string;
  /** How many of the ranked candidates may be traded. Owner decision 2026-11-19: 3. */
  topN?: number;
  /** `HH:MM` UTC. Entries before this are not counted, and the ranking may not see past it. */
  cutoffUtc?: string;
  /** Optional override. It must AGREE with the dataset's own side; a disagreement is refused. */
  side?: MoversSide;
  /**
   * Return the per-bar timeline for each selected symbol — scores, price, move, the trade on that bar,
   * and the step ladder that got there. Costs JSON rather than time: the run scores the bars anyway.
   * See `run-depth.ts` for what is recorded versus derived.
   */
  includeBreakdown?: boolean;
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
  /** Present only when the request asked for `includeBreakdown`. */
  detail?: SelectionSymbolDetail;
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
  caveats: string[];
}

const DEFAULT_TOP_N = 3;
const DEFAULT_CUTOFF_UTC = '15:30';

@Injectable()
export class SelectionRunService {
  private readonly logger = new Logger(SelectionRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly backtest: BacktestService,
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
      entryDate: String(t.entryDate ?? ''),
      exitDate: String(t.exitDate ?? ''),
      entryPrice: Number(t.entryPrice ?? 0),
      exitPrice: Number(t.exitPrice ?? 0),
      direction: t.direction === 'SHORT' ? 'SHORT' : 'LONG',
      pnl: Number(t.pnl ?? 0),
      exitReason: String(t.exitReason ?? ''),
      signal: String(t.signal ?? ''),
      kept: keptSet.has(t),
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

  async runSelection(request: SelectionRunRequest): Promise<SelectionRunResult> {
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
    const rows = await this.prisma.marketBar.findMany({
      where: {
        symbol: { ticker: { in: tickers } },
        timeframe,
        timestamp: { gte: from, lte: to },
      },
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

    // ── run the ENGINE, unchanged, once per symbol the day selected ─────────────────────────────
    const periodByTicker = new Map<string, string>();
    for (const p of periods) {
      const t = tickerById.get(p.symbolId);
      if (t) periodByTicker.set(t, p.id);
    }

    const perSymbol: SelectionSymbolResult[] = [];
    const keptTrades: Array<Record<string, unknown>> = [];
    let engineTradesOutsideSelection = 0;

    for (const ticker of [...picked.day.selected].sort()) {
      const periodId = periodByTicker.get(ticker);
      if (!periodId) continue;
      try {
        const result = await this.backtest.run({
          periodId,
          protocolId: request.protocolId,
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
          ...(request.includeBreakdown ? { detail: this.buildDetail(result, tagged, keptSet, decl.value.answerDate, cutoffUtc, directionMode, picked.day.selected.length, tickers.length) } : {}),
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

    const totalTrades = keptTrades.length;
    const totalWins = keptTrades.filter((t) => Number(t.pnl) > 0).length;

    const caveats: string[] = [
      `Measured on ${decl.value.answerDate} only — the session this dataset is a screen of. Its ` +
        `${priorSessions} earlier session(s) are directive warm-up, not results.`,
      `The candidate list (${tickers.length} symbols) was built from ${decl.value.answerDate}'s ` +
        'close-to-close move, so the LIST already knows how the day ended. The ranking inside it uses ' +
        `bars up to ${cutoffUtc} UTC only, but membership is optimistic: a screen run live at the ` +
        'cutoff would have picked from the whole market (#1321).',
    ];
    if (resolution.source !== 'protocol') {
      caveats.push(
        `Side came from the '${resolution.source}' source rather than the protocol's declared ` +
          'direction — confirm the protocol id is the leg you meant.',
      );
    }
    if (engineTradesOutsideSelection > 0) {
      caveats.push(
        `${engineTradesOutsideSelection} trade(s) the engine produced were excluded by the selection ` +
          `(${perSymbol.reduce((a, s) => a + s.excludedBeforeCutoff, 0)} entered before the ${cutoffUtc} ` +
          'cutoff; the remainder were on warm-up sessions or on symbols this day did not pick).',
      );
    }
    const failed = perSymbol.filter((s) => s.error);
    if (failed.length) {
      caveats.push(
        `${failed.length} symbol(s) could not be run and are listed with their error rather than as zero trades: ` +
          failed.map((f) => f.symbol).join(', '),
      );
    }
    if (picked.day.selected.length === 0) {
      caveats.push(`No candidate could be ranked on ${decl.value.answerDate}.`);
    }

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
      days,
      perSymbol,
      totals: {
        daysRanked: 1,
        selections: picked.day.selected.length,
        trades: totalTrades,
        wins: totalWins,
        netPnl: keptTrades.reduce((a, t) => a + Number(t.pnl ?? 0), 0),
        winRate: totalTrades ? (totalWins / totalTrades) * 100 : 0,
        engineTradesOutsideSelection,
      },
      caveats,
    };
  }
}
