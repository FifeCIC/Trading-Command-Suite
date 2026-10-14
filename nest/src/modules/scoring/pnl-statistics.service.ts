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
// #1044 — the ONE classifier for "is this closed trade a result". A `pnlInvalid`-only filter
// misses every closed row with no exit price that was never flagged (21 measured 2026-10-01),
// and those carry a placeholder `pnl = 0` that gets averaged in as a break-even trade. Do not
// re-inline this test: the whole defect was two consumers answering differently.
import { classifyPnlRow } from '../../common/trading/pnl-population';

export type PnlReliability = 'noise' | 'weak' | 'moderate' | 'strong';

/**
 * Which trades the report measures (#1120).
 *
 * `all` is the status quo and the default. `live` answers "is the STRATEGY working?" — which is a
 * different question from "did the book make money", because the A/B test accounts are part of the
 * book. Measured 2026-10-14: `all` gives expectancy £−3.48/trade while `live` gives £−0.74 — the
 * same data answering two questions, 4.7× apart.
 */
export type PnlPopulation = 'all' | 'live' | 'ab-test';

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
  window: { days: number; symbol: string | null; population: PnlPopulation };
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
    /**
     * Rows EXCLUDED because they are closed with NO exit price and were never flagged (#1044).
     *
     * ⚠️ These are the SAME physical fault as `pnlInvalid = 1` — a close whose exit price was
     * never captured — but no flag marks them. Measured 2026-10-01: **21** such rows against 113
     * flagged ones, and they are the reason two consumers of this table disagreed about its size
     * (264 rows by a `pnlInvalid`-only filter, 243 by structure) with no error anywhere.
     *
     * They were being counted as BREAK-EVEN TRADES because `pnl` is a placeholder 0. Reported
     * separately rather than merged into `excludedInvalid`, so the two causes stay distinguishable
     * — one is a human declaration, the other is a defect that nothing has flagged.
     */
    excludedExitUnknown: number;
    distinctDays: number;
    firstTrade: string | null;
    lastTrade: string | null;
  };
  /** Where the numbers came from — so no result is read without its provenance. */
  populationNote: string;
  /** Whole book. */
  overall: PnlBucket | null;
  /**
   * ⚠️ **LIVE STRATEGY vs TEST INSTRUMENTATION — read this before reading `overall` (#1120).**
   *
   * Measured 2026-10-14: the A/B arms were **23 trades (7% of the count) and £−929.60 — 80% of
   * the whole book's loss** — while the 301 live-bot trades were **−£0.35 per trade**, i.e.
   * break-even. **`overall` therefore describes the measurement instrument as much as the
   * strategy**, and the owner's own conclusion (*"we're losing money"*) was formed from a figure
   * that is 91% instrumentation.
   *
   * ⚠️ WHY THE SPLIT IS REPORTED RATHER THAN `overall` CHANGED: excluding the A/B rows from
   * `overall` would silently move every surface that reads it (Signals Overview's "past profit"
   * among them). Making the share VISIBLE answers "is this contaminated?" without pre-empting
   * that decision. ⚠️ A reader who sees a large `abTest` share must not read `overall` as the
   * strategy's result.
   *
   * Population test: `trade.abTestId IS NOT NULL OR trade.strategy LIKE 'AB-%'`. Both are used —
   * the id is the real attribution (#1079) and the prefix catches rows written before it.
   */
  byPopulation: { live: PnlBucket; abTest: PnlBucket };
  bySide: PnlBucket[];
  /** Attribution — which pipeline produced the trades. */
  bySource: PnlBucket[];
  /** Attribution — which strategy tag. */
  byStrategy: PnlBucket[];
  /**
   * Attribution — per SYMBOL realised P/L.
   *
   * WHY THIS LIVES HERE AND NOT IN THE FRONTEND: a per-symbol P/L column needs the
   * `pnlInvalid` exclusion and the small-sample `reliability` gate below. Computing it in a
   * component would be a SECOND implementation of the rule that produces the least
   * trustworthy number in the app — and only one copy would get the next fix. (#933 follow-up)
   *
   * ⚠️ Most symbols will come back with `reliability: 'noise'` (n < 20). That is the point:
   * a 1-trade +£0 is not evidence of anything, and the bucket says so.
   */
  bySymbol: PnlBucket[];
  caveats: string[];
}

@Injectable()
export class PnlStatisticsService {
  private readonly logger = new Logger(PnlStatisticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getPnlReport(params: { days?: number; symbol?: string; population?: PnlPopulation } = {}): Promise<PnlReport> {
    const days = params.days ?? 90;
    const population = params.population ?? 'all';
    const window = { days, symbol: params.symbol ?? null, population };

    const empty = (reason: string): PnlReport => ({
      generatedAt: new Date().toISOString(),
      window,
      sample: { closedTrades: 0, withPnl: 0, excludedInvalid: 0, excludedExitUnknown: 0, distinctDays: 0, firstTrade: null, lastTrade: null },
      populationNote: 'No trades evaluated.',
      overall: null,
      byPopulation: { live: bucket('LIVE BOTS', []), abTest: bucket('A/B TEST', []) },
      bySide: [],
      bySource: [],
      byStrategy: [],
      bySymbol: [],
      caveats: [reason],
    });

    if (!this.prisma.isAvailable) return empty('Database unavailable');

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // ⚠️ `closedAt` carries BOTH the not-null and the gte constraint in one key. Writing
    // them as two separate `closedAt` properties silently keeps only the last one, which
    // would drop the not-null filter and let open trades into the expectancy maths.
    const where: any = { closedAt: { not: null, gte: since }, pnl: { not: null } };
    if (params.symbol) where.symbol = params.symbol;

    let trades: Array<{ pnl: number | null; side: string; source: string | null; strategy: string | null; symbol: string; closedAt: Date | null; pnlInvalid: number | null; exitPrice: number | null; abTestId: string | null }>;
    try {
      trades = await this.prisma.trade.findMany({
        where,
        // ⚠️ `exitPrice` is REQUIRED by the classifier and is not a statistic. Omitting it makes
        // every row read as `exit-unknown` (an absent field is indistinguishable from a null one
        // in TypeScript with `strictNullChecks: false`), so the exclusion would be silent, total
        // and wrong — every trade excluded, no error.
        //
        // ⚠️ `abTestId` is REQUIRED by `byPopulation` for the same reason: absent, every A/B row
        // would read as live and the split would report 100% live with no error — #1120's own
        // defect reintroduced in the fix for it.
        select: { pnl: true, side: true, source: true, strategy: true, symbol: true, closedAt: true, pnlInvalid: true, exitPrice: true, abTestId: true },
      });
    } catch (err) {
      return empty(`Trade query failed: ${(err as Error).message}`);
    }

    // ⚠️ EXCLUDE non-results BEFORE any statistic is computed.
    //
    // This is the single most important block in this file. `pnlInvalid = 1` means the exit
    // price was never captured, so `pnl` is a placeholder 0 — not a break-even trade. With
    // 82 such rows against 32 real ones, including them states a win rate of 8.77% when the
    // truth is 31.3%, and it deflates `expectancy` for a reason that has nothing to do with
    // the trading logic. A measurement tool that reports a false verdict is worse than no
    // tool, because the verdict is trusted. (#805)
    //
    // ⚠️ #1044 — THE FLAG ALONE IS NOT ENOUGH. `pnlInvalid` misses every closed row whose exit
    // price is absent WITHOUT a flag: measured 2026-10-01, **21** of them, all carrying a
    // placeholder `pnl = 0` that was being averaged in as a break-even. The classification now
    // lives in ONE pure module (`common/trading/pnl-population.ts`) so this service, the
    // endpoint that already split the three states, and the audit scripts cannot drift apart.
    const invalidRows = trades.filter((t) => classifyPnlRow(t) === 'quarantined');
    const exitUnknownRows = trades.filter((t) => classifyPnlRow(t) === 'exit-unknown');
    const validTrades = trades.filter((t) => classifyPnlRow(t) === 'realised');

    const validRows = validTrades.filter((t): t is typeof t & { pnl: number } => t.pnl !== null && Number.isFinite(t.pnl));

    // ── #1120 — the POPULATION filter, applied AFTER the #1044 classifier ────────────────────────
    //
    // ⚠️ ORDER MATTERS AND IT IS NOT ARBITRARY. `classifyPnlRow` decides whether a row is a RESULT
    // at all; the population decides WHICH RESULT. Filtering first would let a quarantined row's
    // `pnl = 0` placeholder into an expectancy calculation — the defect #1044 closed.
    //
    // ⚠️ THE COUNTS ARE FILTERED TOO. `sample` and the exclusion notes describe the population
    // actually measured, not the raw query. A reader who asks for `live` and sees "5 excluded as
    // pnlInvalid" must be able to trust that number against the live set — quoting the whole
    // table's exclusions beside a filtered result is the same basis error this parameter exists to
    // expose.
    const inPopulation = (t: { abTestId?: string | null; strategy?: string | null }) =>
      population === 'all' ? true : population === 'live' ? !isAbTestRow(t) : isAbTestRow(t);
    const populationNote =
      population === 'all'
        ? null
        : `⚠️ POPULATION FILTER: \`${population}\` — ${population === 'live' ? 'A/B test rows are EXCLUDED' : 'ONLY A/B test rows are included'}. ` +
          `This is a different question from the whole book (#1120): measured 2026-10-14 the whole book was £−3.48/trade against £−0.74/trade for live bots alone.`;

    const rows = validRows.filter(inPopulation);

    if (rows.length === 0) {
      return empty(
        `No closed trades with usable PnL in the last ${days} day(s)` +
        (population === 'all' ? '' : ` in the \`${population}\` population`) +
        '. ' +
        `${invalidRows.filter(inPopulation).length} row(s) were excluded as pnlInvalid, ` +
        `${exitUnknownRows.filter(inPopulation).length} as exit-unknown (no exit price, not flagged).` +
        (populationNote ? ` ${populationNote}` : ''),
      );
    }

    const dates = rows.map((r) => r.closedAt?.toISOString().slice(0, 10)).filter(Boolean) as string[];
    const sortedDates = [...dates].sort();

    const distinctDays = new Set(dates).size;

    return {
      generatedAt: new Date().toISOString(),
      window,
      sample: {
        closedTrades: population === 'all' ? trades.length : validRows.length + invalidRows.filter(inPopulation).length + exitUnknownRows.filter(inPopulation).length,
        withPnl: rows.length,
        // ⚠️ Filtered to the population MEASURED — see the note above `rows`. Quoting the whole
        // table's exclusions beside a filtered result is the basis error this parameter exposes.
        excludedInvalid: invalidRows.filter(inPopulation).length,
        excludedExitUnknown: exitUnknownRows.filter(inPopulation).length,
        distinctDays,
        firstTrade: sortedDates[0] ?? null,
        lastTrade: sortedDates[sortedDates.length - 1] ?? null,
      },
      populationNote: (() => {
        const parts = [`${rows.length} valid trade(s) used.`];
        if (invalidRows.length > 0) {
          parts.push(`${invalidRows.length} row(s) EXCLUDED as pnlInvalid (exit price never captured — not losses).`);
        }
        if (exitUnknownRows.length > 0) {
          parts.push(
            `${exitUnknownRows.length} row(s) EXCLUDED as exit-unknown — closed with no exit price and NOT flagged ` +
            '(#1044). These carry a placeholder `pnl = 0` and were previously averaged in as break-even trades.',
          );
        }
        parts.push('Any win rate or expectancy below is over the valid set only.');
        return parts.join(' ');
      })(),
      overall: bucket('ALL', rows.map((r) => r.pnl)),
      // #1120 — the live/test split. See the interface docblock: `overall` describes the
      // instrument as much as the strategy, so the share is stated beside it.
      byPopulation: {
        live: bucket('LIVE BOTS', rows.filter((r) => !isAbTestRow(r)).map((r) => r.pnl)),
        abTest: bucket('A/B TEST', rows.filter((r) => isAbTestRow(r)).map((r) => r.pnl)),
      },
      bySide: groupBy(rows, (r) => r.side).map(([label, list]) => bucket(label, list)),
      bySource: groupBy(rows, (r) => r.source ?? '(unspecified)').map(([label, list]) => bucket(label, list)),
      byStrategy: groupBy(rows, (r) => r.strategy ?? '(untagged)').map(([label, list]) => bucket(label, list)),
      bySymbol: groupBy(rows, (r) => r.symbol ?? '(unknown)').map(([label, list]) => bucket(label, list)),
      caveats: [...(populationNote ? [populationNote] : []), ...caveatsFor(rows.length, distinctDays)],
    };
  }
}

/**
 * isAbTestRow() — does this closed trade belong to a TEST INSTRUMENT rather than a live bot?
 *
 * WHY IT EXISTS (#1120): measured 2026-10-14, the A/B arms were **23 trades (7% of the count) and
 * **£−929.60 — 80% of the whole book's loss**, while the 301 live-bot trades sat at £−0.35 each.
 * A whole-book figure therefore describes the instrument as much as the strategy, and the split
 * has to be stated rather than inferred.
 *
 * ⚠️ TWO TESTS, DELIBERATELY. `abTestId` is the real attribution (#1079 writes it per arm); the
 * `AB-%` strategy prefix catches rows written before that, and it is the pattern the trade records
 * actually carry today (`strategy = 'AB-A #929 measurable run …'`). Using only the id would
 * under-report; using only the prefix would break the day someone renames a test.
 *
 * Pure and exported so `--self-test`-style canaries can drive it in both directions.
 */
export function isAbTestRow(row: { abTestId?: string | null; strategy?: string | null }): boolean {
  if (row.abTestId != null && String(row.abTestId).length > 0) return true;
  return /^AB-/.test(row.strategy ?? '');
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
