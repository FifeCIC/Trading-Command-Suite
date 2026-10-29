/**
 * score-maths.ts — THE arithmetic of the backtest A/B comparison. One implementation, server-side.
 *
 * WHY IT MOVED HERE (owner direction, 2026-10-27)
 * ----------------------------------------------
 * *"I see huge potential for agentic AI to use it … Agentic AI will be able to make adjustments.
 * Re-test, and keep doing that over and over again for a set period or target a significant level of
 * improvement."*
 *
 * A tuning loop is: adjust → re-test → decide. The decision maths used to live in the BROWSER
 * (`src/core/backtest-totals.js`), which meant an agent could not reach it: it would have had to
 * re-derive dividends, deltas and "did it repeat" from 399 KB of raw payloads — a second
 * implementation, guaranteed to drift from the UI's. So the maths lives here, `POST
 * /api/backtest/repeat-check` serves it, and the UI CALLS THE ENDPOINT instead of computing.
 *
 * ⚠️ THE UNIT IS THE TRAP. `signalPct` / `opportunityPct` are a SHARE of that run's configured
 * capacity, so the SUM across bars is capacity-points earned in the window — not an average and not a
 * score out of 100. Every consumer must say so; `sum` is not a percentage.
 *
 * ⚠️ A BAR THAT STORED NO VALUE IS EXCLUDED, NEVER COUNTED AS ZERO. Runs stored before the dual-score
 * columns existed have no `opportunityPct`; treating that as 0 would lower a total for a reason that
 * has nothing to do with the protocol. `missing` reports the exclusions.
 */

export interface ScoreBar {
  time?: string;
  date: string;
  score: number;
  signalPct?: number;
  opportunityPct?: number;
  opportunityScore?: number;
  opportunityMax?: number;
  signal?: string;
  passedBar?: boolean;
}

export interface ScoreStat {
  /** Bars that contributed a value. */
  n: number;
  /** Bars in the series that stored no value for this score. */
  missing: number;
  sum: number | null;
  max: number | null;
  min: number | null;
  mean: number | null;
}

export interface RunTotals {
  bars: number;
  signalPct: ScoreStat;
  opportunityPct: ScoreStat;
  opportunityScore: ScoreStat;
  /**
   * The configured capacity in force, when it was constant across the run.
   *
   * ⚠️ `value: null` USED TO MEAN TWO DIFFERENT THINGS — "never recorded" and "changed mid-run" — and a
   * reader could not tell which. Measured 2026-10-27: `5b906133` contains BOTH 1395 and 1575, because a
   * `maxScore` override was applied while that run was scoring, so its `signalPct` values were produced
   * against two denominators and its Σ is comparable to neither side of any A/B pair. That is the
   * "raised ceiling dilutes scores" mechanism landing INSIDE a single run. `reason` names which case it
   * is, so the refusal is explainable instead of looking like missing data.
   */
  capacity: { value: number | null; distinct: number; reason?: 'not-recorded' | 'moved-during-run' };
  /** Whether every bar carries an instant. Without it, two runs cannot be aligned bar for bar. */
  hasInstants: boolean;
}

/** Below this many compared bars, a "direction" is noise wearing a result's clothes. */
export const MIN_REPEAT_BARS = 20;

const stat = (values: number[], missing: number): ScoreStat => {
  if (!values.length) return { n: 0, missing, sum: null, max: null, min: null, mean: null };
  const sum = values.reduce((a, b) => a + b, 0);
  // Rounded to 4dp at the source: a machine reading `167.29999999999995` cannot tell a float artefact
  // from a real value, and every client would otherwise round it differently.
  const r4 = (v: number) => Number(v.toFixed(4));
  return {
    n: values.length,
    missing,
    sum: r4(sum),
    max: r4(Math.max(...values)),
    min: r4(Math.min(...values)),
    mean: r4(sum / values.length),
  };
};

export function scoringTotals(series: ScoreBar[] | null | undefined): RunTotals {
  const bars = series ?? [];
  const collect = (pick: (b: ScoreBar) => number | undefined | null) => {
    const values: number[] = [];
    let missing = 0;
    for (const b of bars) {
      const raw = pick(b);
      if (raw == null || Number.isNaN(Number(raw))) missing += 1;
      else values.push(Number(raw));
    }
    return stat(values, missing);
  };
  const capacities = [
    ...new Set(
      bars
        .map((b) => b.opportunityMax)
        .filter((v) => v != null && !Number.isNaN(Number(v)))
        .map(Number),
    ),
  ];
  /**
   * Named, not inferred by the reader: `distinct === 0` is an ABSENCE, `distinct > 1` is a MOVED
   * denominator. Both produce `value: null`, and they call for opposite responses — re-run to capture
   * capacity, versus treat the run as not comparable at all.
   */
  const capacity =
    capacities.length === 1
      ? { value: capacities[0], distinct: 1 }
      : {
          value: null,
          distinct: capacities.length,
          reason: (capacities.length === 0 ? 'not-recorded' : 'moved-during-run') as
            | 'not-recorded'
            | 'moved-during-run',
        };
  return {
    bars: bars.length,
    signalPct: collect((b) => b.signalPct ?? b.score),
    opportunityPct: collect((b) => b.opportunityPct),
    opportunityScore: collect((b) => b.opportunityScore),
    capacity,
    hasInstants: bars.length > 0 && bars.every((b) => Boolean(b.time)),
  };
}

/**
 * tradeTotals — the money, answered once, for every surface.
 *
 * ⚠️ WHY THIS IS SERVER-SIDE. Owner direction 2026-10-29: the run panel *"needs to be more trade
 * based and show us profit loss at least"*. The temptation is twenty lines of `reduce()` in the
 * component — and `src/core/backtest-totals.js` carries a standing instruction against exactly that,
 * because a panel that computes its own win rate will eventually disagree with the endpoint an agent
 * reads. Measured 1,027-trade runs are also large enough that recomputing on every render is real work.
 *
 * ⚠️ `avgPnlPct` EXCLUDES trades with no `pnlPct` RATHER THAN COUNTING THEM AS ZERO. A missing
 * measurement and a break-even trade are different facts; averaging them together understates the
 * magnitude and cannot be undone by the reader. `unmeasured` carries the count so the exclusion is
 * visible instead of silent.
 *
 * ⚠️ `avgPnlPct` IS A SIMPLE AVERAGE, and it is labelled as one wherever it is rendered. Compounding
 * it into a "total return" would be a different (and unasked-for) claim, and `sumPnl` already exists
 * for the currency total.
 */
/** The shape `tradeTotals` reads. Deliberately narrow so it cannot depend on the whole trade object. */
export interface TradeLike {
  pnl?: number | null;
  pnlPct?: number | null;
  entryDate?: string | Date | null;
  exitDate?: string | Date | null;
  exitReason?: string | null;
  /** Bars walked from entry to exit — gap-immune, unlike the wall-clock difference. */
  barsHeld?: number | null;
  /** TRUE when the hold crossed a hole > 1h in the bar series. */
  spansGap?: boolean | null;
}

/**
 * Hold time, grouped by what ended the trade.
 *
 * ⚠️ WHY SPEED OF MOVEMENT IS A RESULT, NOT A CURIOSITY (owner direction, 2026-10-29): *"I want to
 * establish an average time to SL trigger … and an average to TP … Where I'm going with this is to
 * consider the speed of movement."* A losing trade that takes LONGER to resolve than a winning one is
 * a different instrument problem from one that resolves faster: price is grinding to the target and
 * snapping to the stop, which is adverse selection the P&L alone cannot show.
 *
 * MEASURED on the latest VIX 5m run before this existed: SL averaged **1,972 min** to trigger and TP
 * **3,425 min** — winners took 1.7x as long as losers. That is the pattern this field makes visible.
 */
export interface ExitReasonHold {
  reason: string;
  count: number;
  /** Mean hold in minutes; null when no trade of this reason carries both instants. */
  avgHoldMinutes: number | null;
  /** Mean `pnlPct` for this reason — what the reason cost or paid, on average. */
  avgPnlPct: number | null;
}

export interface TradeTotals {
  /** Number of closed trades the run recorded. */
  count: number;
  /** Trades with `pnlPct > 0`. */
  wins: number;
  /** Trades that closed at exactly zero — neither a win nor a loss, and not a missing value. */
  breakEven: number;
  /** `wins / (count - unmeasured)`, as a percentage; null when nothing was measured. */
  winRatePct: number | null;
  /** Σ of the currency P&L over every trade that carries one. */
  sumPnl: number | null;
  /** Simple mean of `pnlPct` over trades that carry one. */
  avgPnlPct: number | null;
  bestPnlPct: number | null;
  worstPnlPct: number | null;
  /** The exit instant of the best / worst trade, so a reader can find the row. */
  bestAt: string | null;
  worstAt: string | null;
  /** Mean hold over every trade with both instants, in minutes. Inflated by any data gap. */
  avgHoldMinutes: number | null;
  /**
   * Mean hold in BARS — the gap-immune version of `avgHoldMinutes`.
   *
   * ⚠️ THE TWO DISAGREE WHEN THE MACHINE WAS ASLEEP, and the bars figure is the one to trust. Measured
   * on the VIX 5m dev window: 37.7 h of wall clock against **24.3 h of trading bars**, because 45.2% of
   * trades crossed a hole in the series. Reporting only the wall-clock number overstates how long the
   * strategy actually held.
   */
  avgBarsHeld: number | null;
  /** Trades whose hold crossed a hole > 1h — their duration and exit reason are contaminated. */
  tradesSpanningGap: number;
  /** Hold time per exit reason, ordered by count descending so the dominant exit comes first. */
  byExitReason: ExitReasonHold[];
  /** Trades carrying a `pnlPct`. */
  measured: number;
  /** Trades with no `pnlPct` — reported, never silently averaged in as zero. */
  unmeasured: number;
}

/** Minutes between two instants, or null when either is missing/unparseable — never a fabricated 0. */
function holdMinutes(entry: string | Date | null | undefined, exit: string | Date | null | undefined): number | null {
  if (entry == null || exit == null) return null;
  const a = new Date(entry).getTime();
  const b = new Date(exit).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  // A negative hold is a data defect, not a measurement — say "unknown" rather than a negative time.
  if (b < a) return null;
  return (b - a) / 60_000;
}

export function tradeTotals(trades: TradeLike[] | null | undefined): TradeTotals {
  const rows = trades ?? [];
  const r4 = (v: number) => Number(v.toFixed(4));

  let wins = 0;
  let breakEven = 0;
  let measured = 0;
  let unmeasured = 0;
  let sumPct = 0;
  let sumPnl: number | null = null;
  let bestPnlPct: number | null = null;
  let worstPnlPct: number | null = null;
  let bestAt: string | null = null;
  let worstAt: string | null = null;
  let holdSum = 0;
  let holdCount = 0;
  let barsSum = 0;
  let barsCount = 0;
  let tradesSpanningGap = 0;

  /** reason → running totals, so per-reason averages are one pass rather than a second filter. */
  const byReason = new Map<string, { count: number; holdSum: number; holdCount: number; pctSum: number; pctCount: number }>();

  for (const t of rows) {
    if (t.pnl != null && !Number.isNaN(Number(t.pnl))) {
      sumPnl = (sumPnl ?? 0) + Number(t.pnl);
    }

    const hold = holdMinutes(t.entryDate, t.exitDate);
    if (hold != null) {
      holdSum += hold;
      holdCount += 1;
    }
    if (t.barsHeld != null && !Number.isNaN(Number(t.barsHeld))) {
      barsSum += Number(t.barsHeld);
      barsCount += 1;
    }
    if (t.spansGap) tradesSpanningGap += 1;

    const reason = t.exitReason ?? 'UNKNOWN';
    const g = byReason.get(reason) ?? { count: 0, holdSum: 0, holdCount: 0, pctSum: 0, pctCount: 0 };
    g.count += 1;
    if (hold != null) {
      g.holdSum += hold;
      g.holdCount += 1;
    }
    if (t.pnlPct != null && !Number.isNaN(Number(t.pnlPct))) {
      g.pctSum += Number(t.pnlPct);
      g.pctCount += 1;
    }
    byReason.set(reason, g);

    if (t.pnlPct == null || Number.isNaN(Number(t.pnlPct))) {
      unmeasured += 1;
      continue;
    }
    const pct = Number(t.pnlPct);
    measured += 1;
    sumPct += pct;
    if (pct > 0) wins += 1;
    else if (pct === 0) breakEven += 1;
    if (bestPnlPct == null || pct > bestPnlPct) {
      bestPnlPct = pct;
      bestAt = t.exitDate ? String(t.exitDate) : null;
    }
    if (worstPnlPct == null || pct < worstPnlPct) {
      worstPnlPct = pct;
      worstAt = t.exitDate ? String(t.exitDate) : null;
    }
  }

  const byExitReason: ExitReasonHold[] = [...byReason.entries()]
    .map(([reason, g]) => ({
      reason,
      count: g.count,
      avgHoldMinutes: g.holdCount ? r4(g.holdSum / g.holdCount) : null,
      avgPnlPct: g.pctCount ? r4(g.pctSum / g.pctCount) : null,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    count: rows.length,
    wins,
    breakEven,
    winRatePct: measured ? r4((wins / measured) * 100) : null,
    sumPnl: sumPnl == null ? null : r4(sumPnl),
    avgPnlPct: measured ? r4(sumPct / measured) : null,
    bestPnlPct: bestPnlPct == null ? null : r4(bestPnlPct),
    worstPnlPct: worstPnlPct == null ? null : r4(worstPnlPct),
    bestAt,
    worstAt,
    avgHoldMinutes: holdCount ? r4(holdSum / holdCount) : null,
    avgBarsHeld: barsCount ? r4(barsSum / barsCount) : null,
    tradesSpanningGap,
    byExitReason,
    measured,
    unmeasured,
  };
}

/**
 * stopSweep — "is the stop too distant?", answered from stored excursions.
 *
 * Owner direction, 2026-10-29: *"if 70% of positions that dropped into the red by X amount then
 * triggered the SL, that would tell us that we're losing money because the SL is too distant. The
 * simulated-stop-loss could be stricter."* That is exactly the question below, made countable.
 *
 * ⚠️ WHAT IT IS, AND WHAT IT IS NOT. This is a FIRST-ORDER SCREEN over trades that have already
 * happened. For each candidate stop distance it asks: **would this trade have been stopped earlier?**
 * (`maxAdversePct >= candidate`), and what would it have realised if it had (−candidate, before costs).
 *
 * It is NOT a re-simulation. It cannot see whether a trade that would NOT have been stopped took a
 * different path, because the price path between the proxy stop and the real one is not stored. So the
 * net figure is an ESTIMATE and must be labelled as one wherever it is rendered — the exact answer is a
 * re-run with `stopPlan` set. Two numbers, and only one of them is a measurement of the same population.
 *
 * ⚠️ IT REPORTS BOTH SIDES. A tighter stop cuts losses AND kills winners that dipped first — a trade
 * whose adverse excursion exceeded the candidate but which went on to hit its target is a WIN the tight
 * stop would have thrown away. `winnersCut` counts those, and a sweep without it would always conclude
 * "tighter is better", which is the answer this repo keeps having to un-learn.
 */
export interface SweepTrade {
  pnlPct?: number | null;
  /** Worst excursion against the position, as a positive % of entry. */
  maxAdversePct?: number | null;
  exitReason?: string | null;
}

export interface SweepRow {
  /** The candidate stop distance, in % of entry. */
  stopPct: number;
  /** Trades whose adverse excursion reached this stop — i.e. it would have fired. */
  stopped: number;
  /** Of those, how many ended as WINNERS on their actual exit — value the tight stop would destroy. */
  winnersCut: number;
  /** Of those, how many ended as losers anyway — the only population a tighter stop genuinely helps. */
  losersSaved: number;
  /** Σ actual `pnlPct` of the trades it would have stopped. */
  replacedPnlPct: number;
  /** Σ what those same trades would have realised at −stopPct (before costs). */
  simulatedPnlPct: number;
  /** Estimated change across the whole run: `simulated − replaced`. Positive = tighter was better. */
  deltaPnlPct: number;
}

/**
 * `candidates` must be ascending. A stop at 0 would exit on the entry bar and is refused rather than
 * silently dropped — a zero stop is a different strategy, not a tighter one.
 */
export function stopSweep(trades: SweepTrade[] | null | undefined, candidates: number[]): SweepRow[] {
  const rows = (trades ?? []).filter(
    (t) => t.maxAdversePct != null && t.pnlPct != null && !Number.isNaN(Number(t.maxAdversePct)),
  );
  const ordered = [...new Set(candidates.filter((c) => Number.isFinite(c) && c > 0))].sort((a, b) => a - b);
  const r4 = (v: number) => Number(v.toFixed(4));

  // ⚠️ NO TRADES MEANS NO ROWS — not rows of zeros. A candidate that "stopped 0 trades" and a
  // population nobody measured would otherwise render identically, and the second is not a result.
  if (!rows.length) return [];

  return ordered.map((stopPct) => {
    let stopped = 0;
    let winnersCut = 0;
    let losersSaved = 0;
    let replacedPnlPct = 0;
    let simulatedPnlPct = 0;
    for (const t of rows) {
      if (Number(t.maxAdversePct) < stopPct) continue;
      const actual = Number(t.pnlPct);
      stopped += 1;
      if (actual > 0) winnersCut += 1;
      else losersSaved += 1;
      replacedPnlPct += actual;
      // The stop is a fixed distance below entry, so a trade it stops realises −stopPct. Costs are
      // deliberately NOT added: they are already inside the recorded `pnlPct` on the replaced side and
      // applying them twice would flatter the tighter stop.
      simulatedPnlPct += -stopPct;
    }
    return {
      stopPct,
      stopped,
      winnersCut,
      losersSaved,
      replacedPnlPct: r4(replacedPnlPct),
      simulatedPnlPct: r4(simulatedPnlPct),
      deltaPnlPct: r4(simulatedPnlPct - replacedPnlPct),
    };
  });
}

/**
 * barGapProfile — how much of the window the bar series actually covers, and where the holes are.
 *
 * ⚠️ THIS EXISTS BECAUSE A BACKTEST TREATS A DATA GAP AS IF THE MARKET STOOD STILL (owner note,
 * 2026-10-29: *"Sometimes the PC is shutdown while positions are open so some of our data could be
 * skewed by the app being asleep."* — he was right, and it is worse than a skew).
 *
 * Measured on the `dev-window-v1` VIX 5m run: **63.9% bar coverage** of a 41.6-day window, **25 holes
 * longer than an hour**, the longest **111.3 hours**, and **464 of 1,027 trades (45.2%) crossed one**.
 * Across such a hole the bracket was never checked: the engine exits at the first bar that comes back,
 * so the recorded `exitReason` and `exitPrice` describe a level that may never have been the one that
 * would have fired. A hold measured in wall-clock minutes is inflated by the hole; the same hold
 * measured in BARS is not.
 *
 * ⚠️ `gapToleranceBars` IS A THRESHOLD, NOT A FACT. One missing bar is noise; an hour of missing bars
 * means the position was unmonitored. The default is deliberately generous so an ordinary weekend or a
 * quiet FX session does not flag half the population.
 */
export interface BarGap {
  /** How many bars are missing at this hole. */
  missingBars: number;
  /** Wall-clock minutes the hole spans. */
  minutes: number;
  from: string;
  to: string;
}

export interface BarGapProfile {
  bars: number;
  /** Bars the window would hold if every slot were present. */
  expectedBars: number;
  coveragePct: number;
  gaps: BarGap[];
  /** Holes longer than an hour — the ones that leave a position unmonitored. */
  gapsOverHour: number;
  longestGapMinutes: number;
  /**
   * Whether the series is clean enough for a hold-time conclusion. FALSE does not invalidate the P&L
   * — a trade still exited at a real price — it invalidates the DURATION and the exit-reason.
   */
  clean: boolean;
}

export function barGapProfile(
  timestamps: Array<string | Date>,
  timeframeMinutes: number,
  gapToleranceBars = 12,
): BarGapProfile {
  const ms = timestamps.map((t) => new Date(t).getTime()).filter((t) => !Number.isNaN(t));
  if (ms.length < 2 || !(timeframeMinutes > 0)) {
    return { bars: ms.length, expectedBars: ms.length, coveragePct: 100, gaps: [], gapsOverHour: 0, longestGapMinutes: 0, clean: true };
  }

  const barMs = timeframeMinutes * 60_000;
  const gaps: BarGap[] = [];
  let longest = 0;
  let gapsOverHour = 0;
  let missingTotal = 0;

  for (let i = 1; i < ms.length; i++) {
    const delta = ms[i] - ms[i - 1];
    const missingBars = Math.round(delta / barMs) - 1;
    if (missingBars < gapToleranceBars) continue;
    const minutes = Math.round(delta / 60_000);
    gaps.push({
      missingBars,
      minutes,
      from: new Date(ms[i - 1]).toISOString(),
      to: new Date(ms[i]).toISOString(),
    });
    missingTotal += missingBars;
    if (minutes > longest) longest = minutes;
    if (minutes > 60) gapsOverHour += 1;
  }

  const expectedBars = ms.length + missingTotal;
  return {
    bars: ms.length,
    expectedBars,
    coveragePct: expectedBars ? Number(((ms.length / expectedBars) * 100).toFixed(2)) : 100,
    gaps,
    gapsOverHour,
    longestGapMinutes: longest,
    clean: gapsOverHour === 0,
  };
}

/**
 * periodHealth — THE STANDARD that decides whether a window may be measured at all.
 *
 * Owner direction, 2026-10-29: *"we should consider some standard requirements to deem a period
 * healthy/complete enough to use at all … until then we should be strict."*
 *
 * ⚠️ THE THRESHOLDS ARE SETTINGS, NOT CONSTANTS (`backtest.periodMinCoveragePct`,
 * `backtest.periodMaxHoleMinutes`), and the standard that was APPLIED is returned in the payload so a
 * reader never has to go looking for the rule that produced the verdict. An argument that lives only in
 * code is the defect this repo keeps paying for.
 *
 * Three verdicts, and the difference matters:
 *   `healthy`   — measure it.
 *   `degraded`  — measurable, but the caveats travel with the number.
 *   `unusable`  — REFUSED. Coverage too low, or one hole longer than the tolerance.
 *
 * ⚠️ `unusable` IS A REFUSAL, NOT A WARNING. A window with a 111-hour hole produces trades whose stops
 * were never monitored; that is not a caveat on a result, it is a result about something else.
 */
export type PeriodStatus = 'healthy' | 'degraded' | 'unusable';

export interface PeriodStandard {
  minCoveragePct: number;
  maxHoleMinutes: number;
}

export interface PeriodHealth {
  status: PeriodStatus;
  coveragePct: number;
  barCount: number;
  expectedBars: number;
  longestHoleMinutes: number;
  holesOverAnHour: number;
  /** Every failed requirement, in words — one line each, so a refusal is explainable. */
  reasons: string[];
  /** The thresholds used, echoed back so the verdict can be re-derived without the source. */
  standard: PeriodStandard;
}

export function periodHealth(
  profile: Pick<BarGapProfile, 'coveragePct' | 'bars' | 'expectedBars' | 'longestGapMinutes' | 'gapsOverHour'>,
  standard: PeriodStandard,
): PeriodHealth {
  const reasons: string[] = [];

  if (profile.coveragePct < standard.minCoveragePct) {
    reasons.push(
      `coverage ${profile.coveragePct.toFixed(1)}% is below the ${standard.minCoveragePct}% minimum `
      + `(${profile.bars} bars present of ${profile.expectedBars} expected)`,
    );
  }
  if (profile.longestGapMinutes > standard.maxHoleMinutes) {
    reasons.push(
      `the longest hole is ${profile.longestGapMinutes} min, over the ${standard.maxHoleMinutes} min limit — `
      + 'a position held across it had its stop and target unmonitored',
    );
  }

  const failsCoverage = profile.coveragePct < standard.minCoveragePct;
  const failsHole = profile.longestGapMinutes > standard.maxHoleMinutes;
  // Any hole at all is worth carrying with the number, even when it passes the tolerance: a trade that
  // crosses one has an unmonitored stretch, and a reader should be told before they trust a duration.
  const status: PeriodStatus = failsCoverage || failsHole
    ? 'unusable'
    : profile.gapsOverHour > 0
      ? 'degraded'
      : 'healthy';

  if (status === 'degraded' && reasons.length === 0) {
    reasons.push(
      `${profile.gapsOverHour} hole(s) longer than an hour — inside tolerance, but any trade crossing one `
      + 'has an unmonitored stretch and its hold time and exit reason are not trustworthy',
    );
  }

  return {
    status,
    coveragePct: profile.coveragePct,
    barCount: profile.bars,
    expectedBars: profile.expectedBars,
    longestHoleMinutes: profile.longestGapMinutes,
    holesOverAnHour: profile.gapsOverHour,
    reasons,
    standard,
  };
}

/**
 * `5m` / `1h` / `1d` → minutes. `0` when it cannot be read — never a guessed 1.
 *
 * ⚠️ SHARED, because two places need the bar length: the gap profile (a hole is measured in bars) and
 * the trade loop's gap guard. A local copy in each is how the two would disagree about what a hole is.
 */
export function timeframeMinutes(tf: string | null | undefined): number {
  const m = /^(\d+)\s*([mhd])$/i.exec(String(tf ?? '').trim());
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === 'm' ? n : unit === 'h' ? n * 60 : n * 60 * 24;
}

/**
 * sessionAwareGaps — the same hole profile, but measuring a hole against the instrument's OWN hours.
 *
 * ⚠️ WHY THE NAIVE VERSION HAD TO BE REPLACED (measured 2026-10-29). `barGapProfile` assumes a
 * continuous grid at the timeframe, so it called **20 of the 21 canonical periods UNUSABLE** — every
 * one of them showing a longest "hole" of ~2,950 minutes (49 h), which is a WEEKEND. The exception was
 * **BTC 1h: 100% coverage, 0 holes**, because crypto trades around the clock and therefore has no
 * closure to be mistaken for an outage. SPY, which trades only US hours, read 28.7%.
 *
 * A rule that condemns 20 of 21 windows for a calendar reason is not strict, it is wrong — and a wrong
 * gate gets ignored, which is worse than no gate.
 *
 * ⚠️ THE RULE IS SELF-CALIBRATING, WITH NO HARDCODED MARKET HOURS. The window's own bars build a
 * presence mask over (weekday, hour, slot-in-hour). A missing slot inside a bucket that is populated
 * ELSEWHERE in the same window is genuinely missing — the instrument was trading then. A missing slot
 * in a bucket that is never populated is a CLOSURE, and a closure is not a hole: no position was
 * unmonitored, because nothing trades.
 *
 * ⚠️ WHAT IT CANNOT SEE, stated rather than implied: a holiday that falls wholly inside the window has
 * no populated counterpart, so it reads as closure — correct for the duration question, and it also
 * means a genuine outage that lasted exactly one whole session would be invisible. Both are acceptable;
 * the alternative is a maintained calendar that would itself need auditing.
 */
export interface SessionAwareProfile extends BarGapProfile {
  /** Bars the naive continuous-grid expectation would have wanted. */
  rawExpectedBars: number;
  /** Missing slots that fall in hours the instrument DOES trade — the only ones that count. */
  unexplainedMissingBars: number;
  /** Holes that survive the session mask, with the missing count that made them count. */
  unexplainedGaps: BarGap[];
  /**
   * FALSE when the window is too short to learn a session pattern from.
   *
   * ⚠️ THE MASK NEEDS EACH WEEKDAY AT LEAST TWICE, or a bucket that appears once — inside the hole —
   * looks like a closure. Under 14 distinct days the mask is not trustworthy, so the NAIVE figure is
   * used and `calibrated: false` says so, rather than a self-referential mask quietly excusing a real
   * outage. Measured: a 4-day synthetic series cannot tell a 6-hour hole from a closure.
   */
  calibrated: boolean;
}

/** `(weekday, hour, slot)` bucket key. 7 × 24 × slotsPerHour, so a 5m bar has 12 slots per hour. */
const bucketKey = (d: Date, slotMinutes: number): string => {
  const slot = Math.floor(d.getUTCMinutes() / slotMinutes);
  return `${d.getUTCDay()}-${d.getUTCHours()}-${slot}`;
};

export function sessionAwareGapProfile(
  timestamps: Array<string | Date>,
  timeframeMinutes: number,
  gapToleranceBars = 12,
): SessionAwareProfile {
  const ms = timestamps.map((t) => new Date(t).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const naive = barGapProfile(ms.map((t) => new Date(t)), timeframeMinutes, gapToleranceBars);
  const distinctDays = new Set(ms.map((t) => new Date(t).toISOString().slice(0, 10))).size;
  const calibrated = distinctDays >= 14;

  if (ms.length < 2 || !(timeframeMinutes > 0) || !calibrated) {
    // ⚠️ NO CALIBRATION, NO MASK. Falling back to the naive profile is deliberate: an uncalibrated mask
    // would excuse a real outage as a closure, which is the failure this repo pays for most often.
    return {
      ...naive,
      rawExpectedBars: naive.expectedBars,
      unexplainedMissingBars: naive.gaps.reduce((a, g) => a + g.missingBars, 0),
      unexplainedGaps: naive.gaps,
      calibrated,
    };
  }

  const barMs = timeframeMinutes * 60_000;
  const populated = new Set<string>();
  for (const t of ms) populated.add(bucketKey(new Date(t), timeframeMinutes));

  const unexplainedGaps: BarGap[] = [];
  let unexplainedMissingBars = 0;
  let longest = 0;

  for (let i = 1; i < ms.length; i++) {
    const delta = ms[i] - ms[i - 1];
    const missingBars = Math.round(delta / barMs) - 1;
    if (missingBars < gapToleranceBars) continue;

    // Walk the missing slots and keep only those in a bucket the instrument populates elsewhere.
    let counted = 0;
    let firstCounted: number | null = null;
    let lastCounted: number | null = null;
    for (let k = 1; k <= missingBars; k++) {
      const ts = ms[i - 1] + k * barMs;
      if (!populated.has(bucketKey(new Date(ts), timeframeMinutes))) continue;
      counted += 1;
      if (firstCounted == null) firstCounted = ts;
      lastCounted = ts;
    }

    if (counted === 0) continue; // a closure — nothing was trading, nothing went unmonitored
    unexplainedMissingBars += counted;
    const minutes = Math.round(((lastCounted as number) - (firstCounted as number)) / 60_000) + timeframeMinutes;
    if (minutes > longest) longest = minutes;
    unexplainedGaps.push({
      missingBars: counted,
      minutes,
      from: new Date(firstCounted as number).toISOString(),
      to: new Date(lastCounted as number).toISOString(),
    });
  }

  const expectedBars = ms.length + unexplainedMissingBars;
  return {
    ...naive,
    rawExpectedBars: naive.expectedBars,
    bars: ms.length,
    expectedBars,
    coveragePct: expectedBars ? Number(((ms.length / expectedBars) * 100).toFixed(2)) : 100,
    gaps: unexplainedGaps,
    gapsOverHour: unexplainedGaps.filter((g) => g.minutes > 60).length,
    longestGapMinutes: longest,
    clean: unexplainedGaps.every((g) => g.minutes <= 60),
    unexplainedMissingBars,
    unexplainedGaps,
    calibrated,
  };
}

export type WindowBlocked =
  | 'loading'
  | 'no-scores'
  | 'no-instants'
  | 'too-few-bars';

export interface RepeatWindowInput {
  aId: string;
  bId: string;
  label?: string;
  aSeries?: ScoreBar[] | null;
  bSeries?: ScoreBar[] | null;
}

export interface ScoreDiff {
  sumA: number | null;
  sumB: number | null;
  delta: number | null;
  direction: { up: number; down: number; same: number; skipped: number };
}

export interface RepeatWindowResult {
  label: string;
  aId: string;
  bId: string;
  /** Present only when the window could be measured. */
  bars?: number;
  /**
   * The POPULATION each side actually scored, and how many bars only one side has (2026-10-27).
   *
   * ⚠️ `bars` ALONE HID THE POPULATION. It is the size of the INTERSECTION, so a run of 2,000 bars
   * compared against a run of 500 that they share reported `bars: 500` and a difference — a number
   * with no error, resting on a quarter of one side. The browser panel prints "only in A / only in B"
   * from the payloads it already holds, so a HUMAN could see it; a caller of this endpoint — an agent
   * driving a tuning loop — could not see it at all. These are facts, never a verdict: there is no
   * threshold here, because any threshold would be invented.
   */
  barsA?: number;
  barsB?: number;
  onlyA?: number;
  onlyB?: number;
  /** Δ of the summed DIRECTIONAL score — the number the verdict rests on. */
  deltaSignalSum?: number;
  /** All three scores, so a client does not have to re-derive them per bar (and drift). */
  scores?: { signal: ScoreDiff; opportunity: ScoreDiff; points: ScoreDiff };
  capacityA?: number | null;
  capacityB?: number | null;
  /**
   * Why a capacity could not be named, when either side recorded none or moved mid-run. Prose because
   * the reader needs the CAUSE ("a config change landed while this run was scoring"), not a code.
   */
  capacityNote?: string;
  /** Present only when it could NOT be measured — the reason, never a silent absence. */
  blocked?: WindowBlocked;
  reason?: string;
}

export interface RepeatVerdict {
  verdict: 'repeated' | 'did-not-repeat' | 'no-change' | 'cannot-judge';
  reason: string;
  counted: {
    total: number;
    usable: number;
    blocked: number;
    moved: number;
    flat: number;
    /**
     * Windows where the two sides scored DIFFERENT bars. Reported so a verdict cannot read as
     * like-for-like when a quarter of one side was never compared.
     */
    partial: number;
  };
}

const keyOf = (b: ScoreBar) => b.time ?? b.date;

/**
 * Measure ONE window: join the two runs bar by bar and difference the directional score.
 *
 * ⚠️ KEYED ON THE BAR INSTANT, not the date. An intraday run has many bars per date, so a date-keyed
 * join collapses them and reports invented changes (measured 2026-10-27: two IDENTICAL 1h runs showed
 * 21 of 40 bars "changed" by date, 0 by instant).
 */
export function measureWindow(w: RepeatWindowInput): RepeatWindowResult {
  const label = w.label ?? `${String(w.aId).slice(0, 8)} → ${String(w.bId).slice(0, 8)}`;
  const base = { label, aId: w.aId, bId: w.bId };
  if (!w.aSeries || !w.bSeries) {
    return { ...base, blocked: 'no-scores', reason: 'a run stored no per-bar scores' };
  }
  if (!w.aSeries.every((b) => b.time) || !w.bSeries.every((b) => b.time)) {
    return { ...base, blocked: 'no-instants', reason: 'a run stored no per-bar instant, so the two cannot be lined up' };
  }
  const mapB = new Map(w.bSeries.map((b) => [keyOf(b), b]));
  const shared: Array<{ a: ScoreBar; b: ScoreBar }> = [];
  for (const a of w.aSeries) {
    const b = mapB.get(keyOf(a));
    if (b) shared.push({ a, b });
  }

  /**
   * ONE JOIN, THREE SCORES. The client used to difference each score itself, which is a second
   * implementation of exactly these rules (and the source of a date-vs-instant bug once already).
   */
  const diffOf = (pick: (b: ScoreBar) => number | undefined): ScoreDiff => {
    let sumA = 0;
    let sumB = 0;
    let up = 0;
    let down = 0;
    let same = 0;
    let skipped = 0;
    for (const { a, b } of shared) {
      const av = Number(pick(a));
      const bv = Number(pick(b));
      if (Number.isNaN(av) || Number.isNaN(bv)) {
        skipped += 1;
        continue;
      }
      sumA += av;
      sumB += bv;
      if (bv > av) up += 1;
      else if (bv < av) down += 1;
      else same += 1;
    }
    return {
      sumA: Number(sumA.toFixed(4)),
      sumB: Number(sumB.toFixed(4)),
      delta: Number((sumB - sumA).toFixed(4)),
      direction: { up, down, same, skipped },
    };
  };

  const scores = {
    signal: diffOf((b) => b.signalPct ?? b.score),
    opportunity: diffOf((b) => b.opportunityPct),
    points: diffOf((b) => b.opportunityScore),
  };
  const capA = scoringTotals(w.aSeries).capacity;
  const capB = scoringTotals(w.bSeries).capacity;
  /**
   * ⚠️ A NULL CAPACITY IS EXPLAINED, NOT LEFT AS A DASH. The pair is still measured (the bars exist and
   * the scores are real), but a caller must be able to see that one side mixes denominators — otherwise
   * "— / 1395.0" in the panel and `capacityA: null` in this payload read as missing data.
   */
  const capNote = (side: string, c: { value: number | null; reason?: string; distinct: number }) => {
    if (c.value != null) return null;
    if (c.reason === 'moved-during-run') {
      return `the ${side} side recorded ${c.distinct} different capacities inside one run, so its scores mix denominators and its sum is comparable to neither side`;
    }
    return `the ${side} side stored no configured capacity, so the two sides cannot be shown to share a denominator`;
  };
  const capacityNote =
    [capNote('A', capA), capNote('B', capB)].filter(Boolean).join('; ') || undefined;
  const bars = shared.length;
  const result: RepeatWindowResult = {
    ...base,
    bars,
    barsA: w.aSeries.length,
    barsB: w.bSeries.length,
    onlyA: w.aSeries.length - bars,
    onlyB: w.bSeries.length - bars,
    deltaSignalSum: scores.signal.delta,
    scores,
    capacityA: capA.value,
    capacityB: capB.value,
    ...(capacityNote ? { capacityNote } : {}),
  };
  if (bars < MIN_REPEAT_BARS) {
    return {
      ...result,
      blocked: 'too-few-bars',
      reason: `${bars} comparable bar(s) — under ${MIN_REPEAT_BARS}, a direction is noise`,
    };
  }
  return result;
}

/**
 * multiWindowVerdict — does the SAME change point the same way across two or more windows?
 *
 * ⚠️ THE COUNTS ARE THE ANSWER, NOT THE BADGE. "repeats on 3 of 3 usable windows" is checkable; a bare
 * "REPEATED" over two windows invites the reader to assume more evidence than exists. Fewer than two
 * usable windows is an anecdote.
 *
 * ⚠️ CAPACITY IS MATCHED PER SIDE ACROSS WINDOWS (A₁=A₂=…, B₁=B₂=…). A ≠ B INSIDE a window is the
 * change under test and must not block anything — an earlier version compared within the window, which
 * would have refused every genuine change.
 */
export function multiWindowVerdict(windows: RepeatWindowResult[]): RepeatVerdict {
  const all = windows ?? [];
  const blocked = all.filter((w) => Boolean(w.blocked));
  const usable = all.filter((w) => !w.blocked && (w.bars ?? 0) >= MIN_REPEAT_BARS);
  /**
   * ⚠️ `partial` IS COUNTED, NEVER THRESHOLDED. A window where the two sides scored different bars
   * overlaps a different population on each side; calling that "not usable" would throw away a real
   * measurement over a one-bar data refresh, and inventing a tolerance would be a fabricated rule.
   * Counting it lets the reason say "2 of 2 usable, 1 of them on partly different bars" — which is
   * checkable — instead of implying the two sides were like-for-like.
   */
  const partialCount = usable.filter((w) => (w.onlyA ?? 0) > 0 || (w.onlyB ?? 0) > 0).length;
  const counted = {
    total: all.length,
    usable: usable.length,
    blocked: blocked.length,
    moved: 0,
    flat: 0,
    partial: partialCount,
  };

  if (usable.length < 2) {
    return {
      verdict: 'cannot-judge',
      counted,
      reason:
        all.length < 2
          ? 'a repeat needs at least two windows'
          : `only ${usable.length} window(s) can be compared — ${blocked
              .map((w) => w.label)
              .slice(0, 3)
              .join(', ')} cannot`,
    };
  }

  const capA = usable.map((w) => w.capacityA ?? null);
  const capB = usable.map((w) => w.capacityB ?? null);
  const allSame = (xs: Array<number | null>) => xs.every((x) => x != null && x === xs[0]);
  if (!allSame(capA) || !allSame(capB)) {
    /** Name the window that could not state a capacity, instead of only saying "some windows differ". */
    const unnamed = usable
      .filter((w) => w.capacityA == null || w.capacityB == null)
      .map((w) => `${w.label}: ${w.capacityNote ?? 'capacity not stated'}`);
    return {
      verdict: 'cannot-judge',
      counted,
      reason:
        'the A side (or the B side) was scored at a different configured capacity on some windows, so these are not the same change measured repeatedly' +
        (unnamed.length ? ` — ${unnamed.join(' · ')}` : ''),
    };
  }

  const moved = usable.filter((w) => (w.deltaSignalSum ?? 0) !== 0);
  const flat = usable.filter((w) => (w.deltaSignalSum ?? 0) === 0);
  counted.moved = moved.length;
  counted.flat = flat.length;
  if (moved.length < 2) {
    return { verdict: 'no-change', counted, reason: 'the change moved no score on most of the windows' };
  }

  const signs = moved.map((w) => Math.sign(w.deltaSignalSum ?? 0));
  const agree = signs.filter((s) => s === signs[0]).length;
  const verdict = agree === moved.length ? 'repeated' : 'did-not-repeat';
  const odd = moved.filter((w) => Math.sign(w.deltaSignalSum ?? 0) !== signs[0]).map((w) => w.label);
  /** Named on the verdict itself, because a direction resting on part of one side is still a claim. */
  const partialNote =
    partialCount > 0
      ? ` · ${partialCount} of those window(s) compared only the bars both runs scored — see onlyA/onlyB`
      : '';
  return {
    verdict,
    counted,
    reason:
      (verdict === 'repeated'
        ? `the change moved the scores the same way on all ${moved.length} windows that moved`
        : `the change moved in OPPOSITE directions — ${odd.join(', ')} disagreed with the rest`) + partialNote,
  };
}
