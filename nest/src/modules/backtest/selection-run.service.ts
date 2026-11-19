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
 * The generic rules (ranking, no look-ahead, trade filtering) live in `selection-ranking.ts`, so a
 * future snapshot/portfolio strategy can reuse them without touching the movers feature.
 *
 * ⚠️ THE ONE THING TO NEVER "SIMPLIFY": the cutoff. Ranking on a day's full move and then counting
 * trades from the open scores against the answer key. `buildDayRanks` computes each metric from bars
 * at or before `cutoffUtc` only, and `applySelection` drops any entry before it.
 */
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { BacktestService } from './backtest.service';
import {
  buildDayRanks,
  applySelection,
  type DayRank,
  type RankBar,
  type SelectionSide,
} from './selection-ranking';

export interface SelectionRunRequest {
  /** The `backtest_period.name` shared by every symbol in the dataset group. */
  datasetName: string;
  protocolId: string;
  /** How many of the ranked candidates may be traded. Owner decision 2026-11-19: 3. */
  topN?: number;
  /** `HH:MM` UTC. Entries before this are not counted, and the ranking may not see past it. */
  cutoffUtc?: string;
  side?: SelectionSide;
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
  winRate: number;
  netPnl: number;
  profitFactor: number | null;
  /** Trades the engine produced that the selection did NOT permit, by reason. */
  excludedNotSelected: number;
  excludedBeforeCutoff: number;
  error?: string;
}

export interface SelectionRunResult {
  datasetName: string;
  protocolId: string;
  side: SelectionSide;
  /** How the side was decided. `dataset-name` means it was inferred, and is said out loud. */
  sideSource: 'explicit' | 'dataset-name';
  topN: number;
  cutoffUtc: string;
  timeframe: string;
  symbols: string[];
  days: DayRank[];
  perSymbol: SelectionSymbolResult[];
  totals: {
    daysRanked: number;
    daysUnrankable: number;
    selections: number;
    trades: number;
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

  async runSelection(request: SelectionRunRequest): Promise<SelectionRunResult> {
    const datasetName = (request.datasetName ?? '').trim();
    if (!datasetName) throw new BadRequestException('datasetName is required.');
    if (!request.protocolId) throw new BadRequestException('protocolId is required.');

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

    // Side: explicit wins; otherwise the dataset's own name decides — and SAY SO.
    let side: SelectionSide;
    let sideSource: 'explicit' | 'dataset-name';
    if (request.side) {
      side = request.side;
      sideSource = 'explicit';
    } else if (/loser/i.test(datasetName)) {
      side = 'losers';
      sideSource = 'dataset-name';
    } else {
      side = 'winners';
      sideSource = 'dataset-name';
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
    for (const r of rows) {
      const ticker = r.symbol?.ticker;
      if (!ticker) continue;
      if (!barsBySymbol.has(ticker)) barsBySymbol.set(ticker, []);
      barsBySymbol.get(ticker)!.push({ timestamp: r.timestamp.toISOString(), close: Number(r.close) });
    }

    const days = buildDayRanks(barsBySymbol, side, topN, cutoffUtc);

    // ── run the ENGINE, unchanged, once per symbol that was ever selected ───────────────────────
    const everSelected = new Set<string>();
    for (const d of days) for (const s of d.selected) everSelected.add(s);

    const periodByTicker = new Map<string, string>();
    for (const p of periods) {
      const t = tickerById.get(p.symbolId);
      if (t) periodByTicker.set(t, p.id);
    }

    const perSymbol: SelectionSymbolResult[] = [];
    const keptTrades: Array<Record<string, unknown>> = [];
    let engineTradesOutsideSelection = 0;

    for (const ticker of [...everSelected].sort()) {
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
        } as never);

        // The trade rows carry no symbol; tag them so the selection filter can read it. Doing this
        // here rather than adding a column to every trade keeps ONE engine output shape.
        const tagged = (result.trades ?? []).map((t) => ({ ...t, symbol: ticker }));
        const { kept, dropped } = applySelection(tagged, days, cutoffUtc);
        const notSelected = dropped.filter((d) => d.code === 'not-selected').length;
        const beforeCutoff = dropped.filter((d) => d.code === 'before-cutoff').length;
        engineTradesOutsideSelection += dropped.length;
        keptTrades.push(...kept);

        const wins = kept.filter((t) => Number(t.pnl) > 0).length;
        perSymbol.push({
          symbol: ticker,
          trades: kept.length,
          winRate: kept.length ? (wins / kept.length) * 100 : 0,
          netPnl: kept.reduce((a, t) => a + Number(t.pnl ?? 0), 0),
          profitFactor: result.stats?.profitFactor ?? null,
          excludedNotSelected: notSelected,
          excludedBeforeCutoff: beforeCutoff,
        });
      } catch (err) {
        // ONE symbol failing must not discard the whole selection — and it is REPORTED, never
        // rendered as a zero-trade symbol (the "plausible output, no error" shape).
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Selection run: ${ticker} failed — ${message}`);
        perSymbol.push({
          symbol: ticker,
          trades: 0,
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
    const daysRanked = days.filter((d) => d.rankable).length;

    const caveats: string[] = [];
    if (sideSource === 'dataset-name') {
      caveats.push(
        `Side was read from the dataset name ('${datasetName}'), not supplied — pass \`side\` to be explicit.`,
      );
    }
    if (days.length && !days[0].rankable) {
      caveats.push(
        `The first day (${days[0].date}) is unrankable: ${days[0].reason ?? 'no earlier close in the window'}.`,
      );
    }
    if (engineTradesOutsideSelection > 0) {
      caveats.push(
        `${engineTradesOutsideSelection} trade(s) the engine produced were excluded by the selection ` +
          `(${perSymbol.reduce((a, s) => a + s.excludedBeforeCutoff, 0)} entered before the ${cutoffUtc} cutoff).`,
      );
    }
    const failed = perSymbol.filter((s) => s.error);
    if (failed.length) {
      caveats.push(
        `${failed.length} symbol(s) could not be run and are listed with their error rather than as zero trades: ` +
          failed.map((f) => f.symbol).join(', '),
      );
    }
    if (daysRanked < days.length) {
      caveats.push(`${days.length - daysRanked} day(s) produced no usable ranking.`);
    }

    return {
      datasetName,
      protocolId: request.protocolId,
      side,
      sideSource,
      topN,
      cutoffUtc,
      timeframe,
      symbols: tickers,
      days,
      perSymbol,
      totals: {
        daysRanked,
        daysUnrankable: days.length - daysRanked,
        selections: days.reduce((a, d) => a + d.selected.length, 0),
        trades: totalTrades,
        netPnl: keptTrades.reduce((a, t) => a + Number(t.pnl ?? 0), 0),
        winRate: totalTrades ? (totalWins / totalTrades) * 100 : 0,
        engineTradesOutsideSelection,
      },
      caveats,
    };
  }
}
