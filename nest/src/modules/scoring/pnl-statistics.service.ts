/**
 * PnlStatisticsService — the bridge from "was the direction right?" to "did we make money?"
 * ==========================================================================================
 *
 * WHY THIS IS SEPARATE FROM EdgeStatisticsService (2026-09-12)
 * -----------------------------------------------------------
 * `EdgeStatisticsService` measures DIRECTIONAL accuracy: did price move the way the signal
 * pointed. That is a property of the scoring logic.
 *
 * This measures MONEY. The two are not the same and must never be conflated:
 *
 *   - Directional accuracy excludes spread, slippage, commission, position sizing,
 *     stop distance and holding period.
 *   - A 55% hit rate with 1:0.5 reward:risk is a LOSING strategy.
 *   - A 45% hit rate with 1:2.5 reward:risk is a winning one.
 *
 * The owner's condition for continuing development is *"will it positively impact profitable
 * trade"* — which is a question about THIS file's output, not about hit rate. Reporting only
 * hit rate would answer a different, easier question and look like progress.
 *
 * ⚠️ THE STATISTIC THAT MATTERS IS EXPECTANCY, NOT WIN RATE
 * -------------------------------------------------------
 * `expectancy = (winRate x avgWin) - (lossRate x avgLoss)`
 *
 * This is the single number that determines whether a system compounds. A high win rate with
 * poor expectancy is the most common way a trading system looks successful while losing money.
 * It is reported per bucket and must be the headline, with win rate as supporting detail.
 *
 * ⚠️ SMALL-SAMPLE WARNING
 * -----------------------
 * PnL distributions are heavy-tailed: a handful of large wins or losses dominate the mean.
 * With the sample sizes this project has, `expectancy` is reported WITH its standard error and
 * a `reliability` band, so a 5-trade +£400 does not read as a proven edge. Where the standard
 * error exceeds the estimate, the reliability is 'noise'.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export type PnlReliability = 'noise' | 'weak' | 'moderate' | 'strong';

export interface PnlBucket {
  /** What this bucket groups by — e.g. a strategy name, a side, or 'ALL'. */
  label: string;
  trades: number;
  wins: number;
  losses: number;
  /** Wins / trades, 0-1. Supporting detail — NOT the headline. */
  winRate: number;
  avgWin: number;
  avgLoss: number;
  /** (winRate x avgWin) - (lossRate x |avgLoss|). The headline number. */
  expectancy: number;
  /** Standard error of per-trade PnL / sqrt(n) — the uncertainty on `expectancy`. */
  standardError: number;
  totalPnl: number;
  /** Sum of wins / sum of |losses|. >1 is profitable. Infinity when there are no losses. */
  profitFactor: number;
  reliability: PnlReliability;
}

export interface PnlReport {
  generatedAt: string;
  window: { days: number; symbol: string | null };
  sample: {
    closedTrades: number;
    withPnl: number;
    /**
     * Rows EXCLUDED because `pnlInvalid = 1`.
     *
     * ⚠️ These are NOT losses — `pnl` is 0 and the underlying exit price was never
     * captured (the bridge wrote one `exitPrice` across a whole batch, pre-2026-09-10).
     * Counting them as trades produced a reported win rate of **8.77%** when the honest
     * figure was **31.3%** (10 wins / 32 valid trades) — a 3.6x understatement, and the
     * difference between "abandon ship" and "within 1 point of break-even".
     *
     * Reported so a reader can always see WHICH population a number came from.
     */
    excludedInvalid: number;
    distinctDays: number;
    firstTrade: string | null;
    lastTrade: string | null;
  };
  /** Where the numbers came from — so no result is read without its provenance. */
  populationNote: string;
  /** Whole book. */
  overall: PnlBucket | null;
  bySide: PnlBucket[];
  /** Attribution — which pipeline produced the trades. */
  bySource: PnlBucket[];
  /** Attribution — which strategy tag. */
  byStrategy: PnlBucket[];
  caveats: string[];
}

@Injectable()
export class PnlStatisticsService {
  private readonly logger = new Logger(PnlStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPnlReport(params: { days?: number; symbol?: string } = {}): Promise<PnlReport> {
    const days = params.days ?? 90;
    const window = { days, symbol: params.symbol ?? null };

    const empty = (reason: string): PnlReport => ({
      generatedAt: new Date().toISOString(),
      window,
      sample: { closedTrades: 0, withPnl: 0, excludedInvalid: 0, distinctDays: 0, firstTrade: null, lastTrade: null },
      populationNote: 'No trades evaluated.',
      overall: null,
      bySide: [],
      bySource: [],
      byStrategy: [],
      caveats: [reason],
    });

    if (!this.prisma.isAvailable) return empty('Database unavailable');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // ⚠️ `closedAt` carries BOTH the not-null and the gte constraint in one key. Writing
    // them as two separate `closedAt` properties silently keeps only the last one, which
    // would drop the not-null filter and let open trades into the expectancy maths.
    const where: any = { closedAt: { not: null, gte: since }, pnl: { not: null } };
    if (params.symbol) where.symbol = params.symbol;

    let trades: Array<{ pnl: number | null; side: string; source: string | null; strategy: string | null; closedAt: Date | null; pnlInvalid: number | null }>;
    try {
      trades = await this.prisma.trade.findMany({
        where,
        select: { pnl: true, side: true, source: true, strategy: true, closedAt: true, pnlInvalid: true },
      });
    } catch (err) {
      return empty(`Trade query failed: ${(err as Error).message}`);
    }

    // ⚠️ EXCLUDE invalid rows BEFORE any statistic is computed.
    //
    // This is the single most important line in this file. `pnlInvalid = 1` means the exit
    // price was never captured, so `pnl` is a placeholder 0 — not a break-even trade. With
    // 82 such rows against 32 real ones, including them states a win rate of 8.77% when the
    // truth is 31.3%, and it deflates `expectancy` for a reason that has nothing to do with
    // the trading logic. A measurement tool that reports a false verdict is worse than no
    // tool, because the verdict is trusted. (#805)
    const invalidRows = trades.filter((t) => Number(t.pnlInvalid) === 1);
    const validTrades = trades.filter((t) => Number(t.pnlInvalid) !== 1);

    const rows = validTrades.filter((t): t is typeof t & { pnl: number } => t.pnl !== null && Number.isFinite(t.pnl));
    if (rows.length === 0) {
      return empty(
        `No closed trades with usable PnL in the last ${days} day(s). ` +
        `${invalidRows.length} row(s) were excluded as pnlInvalid.`,
      );
    }

    const dates = rows.map((r) => r.closedAt?.toISOString().slice(0, 10)).filter(Boolean) as string[];
    const sortedDates = [...dates].sort();

    const distinctDays = new Set(dates).size;

    return {
      generatedAt: new Date().toISOString(),
      window,
      sample: {
        closedTrades: trades.length,
        withPnl: rows.length,
        excludedInvalid: invalidRows.length,
        distinctDays,
        firstTrade: sortedDates[0] ?? null,
        lastTrade: sortedDates[sortedDates.length - 1] ?? null,
      },
      populationNote: invalidRows.length > 0
        ? `${rows.length} valid trade(s) used. ${invalidRows.length} row(s) EXCLUDED as pnlInvalid ` +
          `(exit price never captured — not losses). Any win rate or expectancy below is over the valid set only.`
        : `${rows.length} valid trade(s) used. No invalid rows in this window.`,
      overall: bucket('ALL', rows.map((r) => r.pnl)),
      bySide: groupBy(rows, (r) => r.side).map(([label, list]) => bucket(label, list)),
      bySource: groupBy(rows, (r) => r.source ?? '(unspecified)').map(([label, list]) => bucket(label, list)),
      byStrategy: groupBy(rows, (r) => r.strategy ?? '(untagged)').map(([label, list]) => bucket(label, list)),
      caveats: caveatsFor(rows.length, distinctDays),
    };
  }
}

/**
 * Compute one PnL bucket.
 *
 * ⚠️ `avgLoss` is returned as a NEGATIVE number (the true mean of losing trades), not as an
 * absolute value. Reporting it as positive and negating it at the call site is how sign bugs
 * get introduced into expectancy calculations.
 */
export function bucket(label: string, pnls: number[]): PnlBucket {
  const n = pnls.length;
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);

  const winRate = n > 0 ? wins.length / n : 0;
  const lossRate = n > 0 ? losses.length / n : 0;
  const avgWin = wins.length > 0 ? mean(wins) : 0;
  const avgLoss = losses.length > 0 ? mean(losses) : 0;

  const expectancy = winRate * avgWin + lossRate * avgLoss; // avgLoss is negative
  const sd = n > 1 ? stdev(pnls, mean(pnls)) : 0;
  const standardError = n > 0 ? sd / Math.sqrt(n) : 0;

  const grossProfit = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));

  return {
    label,
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate, 4),
    avgWin: round(avgWin, 4),
    avgLoss: round(avgLoss, 4),
    expectancy: round(expectancy, 4),
    standardError: round(standardError, 4),
    totalPnl: round(pnls.reduce((a, b) => a + b, 0), 4),
    // 'no losses' is genuinely infinite profit factor, but Infinity does not serialise to
    // JSON — it becomes null and reads like a bug. Use a large finite sentinel instead.
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : (grossProfit > 0 ? 999 : 0),
    reliability: reliabilityFor(n, expectancy, standardError),
  };
}

/**
 * Reliability band — can `expectancy` be distinguished from zero?
 *
 * The rule is a signal-to-noise test: |expectancy| / standardError. Below 1 the estimate is
 * inside its own error bars.
 */
export function reliabilityFor(n: number, expectancy: number, standardError: number): PnlReliability {
  if (n < 20) return 'noise';
  if (standardError === 0) return expectancy > 0 ? 'weak' : 'noise';
  const t = Math.abs(expectancy) / standardError;
  if (t < 1) return 'noise';
  if (t < 2 || n < 50) return 'weak';
  if (t < 3 || n < 200) return 'moderate';
  return 'strong';
}

function caveatsFor(withPnl: number, distinctDays: number): string[] {
  const out: string[] = [];
  if (withPnl < 100) {
    out.push(
      `⚠️ Only ${withPnl} closed trade(s) with PnL. Per-strategy expectancy at this size is dominated by ` +
        'individual trades, not by the strategy. Treat every bucket below as provisional.',
    );
  }
  if (distinctDays < 30) {
    out.push(
      `⚠️ Trades span ${distinctDays} calendar day(s). This is one market regime; expectancy measured here ` +
        'does not transfer to a different regime.',
    );
  }
  out.push(
    'Expectancy is the headline, not win rate. A 70% win rate with negative expectancy loses money.',
  );
  out.push(
    'PnL here is broker-reported and should already include spread/commission for closed trades — ' +
      'but slippage on OPEN and partial fills are provider-dependent and are not separately visible.',
  );
  return out;
}

function groupBy<T>(items: T[], key: (t: T) => string): Array<[string, number[]]> {
  const map = new Map<string, number[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push((item as any).pnl);
    map.set(k, list);
  }
  // Largest sample first — the most trustworthy buckets lead.
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[], m: number): number {
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
