import {
  scoringTotals,
  tradeTotals,
  stopSweep,
  barGapProfile,
  periodHealth,
  sessionAwareGapProfile,
  measureWindow,
  multiWindowVerdict,
  MIN_REPEAT_BARS,
  ScoreBar,
} from './score-maths';

/**
 * score-maths.spec.ts — the arithmetic of the A/B comparison, and its refusals.
 *
 * ⚠️ THESE NUMBERS ARE THE ANSWER THE READER CAME FOR, so each case asserts a property that would fail
 * SILENTLY in the UI: a missing value must not become zero, an empty series must read as `null` rather
 * than a fabricated 0, the counts must account for every compared bar, and "repeated" must be the
 * hardest verdict to reach. Every refusal path is asserted because "cannot judge" is what stops a
 * lucky window being reported as edge — and a refusal that is never exercised is a refusal that quietly
 * stops firing.
 */

const bar = (over: Partial<ScoreBar> = {}): ScoreBar => ({
  time: '2026-09-05T01:00:00Z',
  date: '2026-09-05',
  score: 0,
  signalPct: 10,
  opportunityPct: 20,
  opportunityScore: 100,
  opportunityMax: 680,
  signal: 'HOLD',
  passedBar: true,
  ...over,
});

describe('scoringTotals', () => {
  it('sums, and reports the highest and lowest bar for each score', () => {
    const t = scoringTotals([
      bar({ signalPct: 10, opportunityPct: 20, opportunityScore: 100 }),
      bar({ signalPct: 30, opportunityPct: 40, opportunityScore: 200 }),
      bar({ signalPct: 20, opportunityPct: 30, opportunityScore: 150 }),
    ]);
    expect(t.bars).toBe(3);
    expect([t.signalPct.sum, t.signalPct.max, t.signalPct.min]).toEqual([60, 30, 10]);
    expect([t.opportunityPct.sum, t.opportunityPct.max, t.opportunityPct.min]).toEqual([90, 40, 20]);
    expect([t.opportunityScore.sum, t.opportunityScore.max, t.opportunityScore.min]).toEqual([450, 200, 100]);
    // The mean is reported separately — a caller must not conflate it with the sum.
    expect(t.signalPct.mean).toBe(20);
  });

  it('EXCLUDES a bar that stored no value, and counts it — never treats it as zero', () => {
    // The second bar is a run stored before the dual-score columns: it has `score` (the signal alias)
    // and nothing else. ⚠️ `signalPct` must be explicitly undefined, or the factory's default (10) would
    // mask the fallback this case exists to prove.
    const t = scoringTotals([
      bar({ signalPct: 10, opportunityPct: 20 }),
      { ...bar(), signalPct: undefined, score: 30, opportunityPct: undefined },
    ]);
    expect(t.signalPct.sum).toBe(40); // the legacy bar contributes through `score`
    expect(t.signalPct.n).toBe(2);
    expect(t.opportunityPct.sum).toBe(20); // contributes NOTHING, not 0
    expect(t.opportunityPct.n).toBe(1);
    expect(t.opportunityPct.missing).toBe(1);
    expect(t.bars).toBe(2);
  });

  it('reads an empty or absent series as null, not as a fabricated zero', () => {
    for (const empty of [[], null, undefined]) {
      const t = scoringTotals(empty as ScoreBar[] | null | undefined);
      expect(t.bars).toBe(0);
      expect(t.signalPct.sum).toBeNull();
      expect(t.signalPct.max).toBeNull();
      expect(t.hasInstants).toBe(false);
    }
  });

  it('reports a CONSTANT capacity, and refuses to name one that moved mid-run', () => {
    expect(scoringTotals([bar(), bar()]).capacity).toEqual({ value: 680, distinct: 1 });
    // ⚠️ `null` alone conflated "never recorded" with "changed mid-run". Measured 2026-10-27: one stored
    // run contains both 1395 and 1575 because an override landed while it was scoring.
    expect(scoringTotals([bar(), bar({ opportunityMax: 700 })]).capacity).toEqual({
      value: null,
      distinct: 2,
      reason: 'moved-during-run',
    });
    expect(scoringTotals([bar({ opportunityMax: undefined })]).capacity).toEqual({
      value: null,
      distinct: 0,
      reason: 'not-recorded',
    });
  });

  it('hasInstants is false when any bar lacks the instant — the alignment precondition', () => {
    expect(scoringTotals([bar(), bar()]).hasInstants).toBe(true);
    expect(scoringTotals([bar(), bar({ time: undefined })]).hasInstants).toBe(false);
  });
});

describe('measureWindow', () => {
  const bars = (n: number, offset = 0): ScoreBar[] =>
    Array.from({ length: n }, (_, i) =>
      bar({ time: `2026-09-05T${String(i).padStart(2, '0')}:00:00Z`, signalPct: 10 + i + offset }),
    );

  it('joins on the bar INSTANT and differences the directional score', () => {
    const w = measureWindow({ aId: 'a', bId: 'b', aSeries: bars(MIN_REPEAT_BARS), bSeries: bars(MIN_REPEAT_BARS, 1) });
    expect(w.blocked).toBeUndefined();
    expect(w.bars).toBe(MIN_REPEAT_BARS);
    // B is 1 higher on every bar.
    expect(w.deltaSignalSum).toBeCloseTo(MIN_REPEAT_BARS * 1, 4);
    expect(w.scores?.signal.direction).toEqual({ up: MIN_REPEAT_BARS, down: 0, same: 0, skipped: 0 });
  });

  it('does NOT collapse intraday bars that share a date', () => {
    // Ten bars, all on the SAME date, all identical between the runs: any date-keyed join would report
    // them as one bar or as changes. Instant-keyed, they are ten unchanged bars.
    const same = Array.from({ length: MIN_REPEAT_BARS }, (_, i) =>
      bar({ date: '2026-09-05', time: `2026-09-05T${String(i).padStart(2, '0')}:00:00Z` }),
    );
    const w = measureWindow({ aId: 'a', bId: 'b', aSeries: same, bSeries: same });
    expect(w.bars).toBe(MIN_REPEAT_BARS);
    expect(w.deltaSignalSum).toBe(0);
    expect(w.scores?.signal.direction).toEqual({ up: 0, down: 0, same: MIN_REPEAT_BARS, skipped: 0 });
  });

  it('reports the POPULATION each side scored, not only the intersection', () => {
    const a = bars(MIN_REPEAT_BARS + 4);
    const b = bars(MIN_REPEAT_BARS);
    const w = measureWindow({ aId: 'a', bId: 'b', aSeries: a, bSeries: b });
    expect(w.bars).toBe(MIN_REPEAT_BARS);
    expect([w.barsA, w.barsB, w.onlyA, w.onlyB]).toEqual([MIN_REPEAT_BARS + 4, MIN_REPEAT_BARS, 4, 0]);

    const full = measureWindow({ aId: 'a', bId: 'b', aSeries: b, bSeries: b });
    expect([full.barsA, full.barsB, full.onlyA, full.onlyB]).toEqual([MIN_REPEAT_BARS, MIN_REPEAT_BARS, 0, 0]);
  });

  it('EXPLAINS a capacity it cannot name, rather than leaving a null to read as missing data', () => {
    const mixed = bars(MIN_REPEAT_BARS).map((b, i) => ({ ...b, opportunityMax: i < 10 ? 1395 : 1575 }));
    const w = measureWindow({ aId: 'a', bId: 'b', aSeries: mixed, bSeries: bars(MIN_REPEAT_BARS) });
    expect(w.capacityA).toBeNull();
    expect(w.capacityB).toBe(680);
    expect(w.capacityNote).toMatch(/A side recorded 2 different capacities inside one run/);

    const clean = measureWindow({ aId: 'a', bId: 'b', aSeries: bars(MIN_REPEAT_BARS), bSeries: bars(MIN_REPEAT_BARS) });
    expect(clean.capacityNote).toBeUndefined();
  });

  it('REFUSES a window it cannot measure, naming why', () => {
    expect(measureWindow({ aId: 'a', bId: 'b', aSeries: bars(30), bSeries: null }).blocked).toBe('no-scores');
    const noInstant = bars(30).map((b) => ({ ...b, time: undefined }));
    expect(measureWindow({ aId: 'a', bId: 'b', aSeries: noInstant, bSeries: bars(30) }).blocked).toBe('no-instants');
    const thin = measureWindow({ aId: 'a', bId: 'b', aSeries: bars(5), bSeries: bars(5, 1) });
    expect(thin.blocked).toBe('too-few-bars');
    expect(thin.bars).toBe(5); // the number is still reported — the refusal is not an absence
  });
});

describe('multiWindowVerdict', () => {
  const win = (over: Partial<ReturnType<typeof measureWindow>>) => ({
    ...measureWindow({ aId: 'a', bId: 'b', aSeries: [], bSeries: [] }),
    bars: MIN_REPEAT_BARS + 5,
    deltaSignalSum: -20,
    capacityA: 1395,
    capacityB: 1575,
    blocked: undefined,
    label: 'w',
    ...over,
  });

  it('repeats only when every moving window agrees, and counts the windows', () => {
    const v = multiWindowVerdict([win({ deltaSignalSum: -20, label: 'a' }), win({ deltaSignalSum: -80, label: 'b' })]);
    expect(v.verdict).toBe('repeated');
    expect(v.counted).toEqual({ total: 2, usable: 2, blocked: 0, moved: 2, flat: 0, partial: 0 });

    const split = multiWindowVerdict([
      win({ deltaSignalSum: -20, label: 'a' }),
      win({ deltaSignalSum: +80, label: 'b' }),
    ]);
    expect(split.verdict).toBe('did-not-repeat');
    expect(split.reason).toContain('b');
  });

  it('counts a blocked window as not usable, and never hides it', () => {
    const v = multiWindowVerdict([
      win({ deltaSignalSum: -20, label: 'a' }),
      win({ deltaSignalSum: -80, label: 'b' }),
      win({ label: 'c', blocked: 'no-scores', bars: undefined }),
    ]);
    expect(v.verdict).toBe('repeated');
    expect(v.counted.usable).toBe(2);
    expect(v.counted.blocked).toBe(1);
  });

  it('COUNTS windows measured on partly different bars, and says so on the verdict', () => {
    // ⚠️ Measured 2026-10-27: `bars` is the INTERSECTION, so a 2,000-bar run against a 500-bar one that
    // they share reported `bars: 500` and a difference — a number resting on a quarter of one side,
    // with nothing in the payload saying so. A human sees "only in A" in the panel; the caller of this
    // endpoint (an agent in a tuning loop) does not.
    const v = multiWindowVerdict([
      win({ deltaSignalSum: -20, label: 'a', onlyA: 0, onlyB: 0 }),
      win({ deltaSignalSum: -80, label: 'b', onlyA: 1500, onlyB: 0 }),
    ]);
    expect(v.counted.partial).toBe(1);
    expect(v.reason).toMatch(/compared only the bars both runs scored/);

    const clean = multiWindowVerdict([
      win({ deltaSignalSum: -20, label: 'a', onlyA: 0, onlyB: 0 }),
      win({ deltaSignalSum: -80, label: 'b', onlyA: 0, onlyB: 0 }),
    ]);
    expect(clean.counted.partial).toBe(0);
    expect(clean.reason).not.toMatch(/only the bars both runs scored/);
  });

  it('names the window whose capacity could not be stated, in the refusal itself', () => {
    const v = multiWindowVerdict([
      win({ deltaSignalSum: -20, label: 'w1' }),
      win({ deltaSignalSum: -80, label: 'w2', capacityA: null, capacityNote: 'the A side recorded 2 different capacities inside one run' }),
    ]);
    expect(v.verdict).toBe('cannot-judge');
    expect(v.reason).toMatch(/w2: the A side recorded 2 different capacities/);
  });

  it('REFUSES rather than guessing', () => {
    expect(multiWindowVerdict([win({})]).verdict).toBe('cannot-judge');
    const oneUsable = multiWindowVerdict([win({ label: 'a' }), win({ label: 'b', blocked: 'no-instants' })]);
    expect(oneUsable.verdict).toBe('cannot-judge');
    expect(oneUsable.reason).toMatch(/only 1 window/);

    // Capacity must match PER SIDE across windows; A ≠ B inside a window is the change under test.
    const crossMismatch = multiWindowVerdict([
      win({ deltaSignalSum: -20, label: 'a' }),
      win({ deltaSignalSum: -80, label: 'b', capacityA: 1400 }),
    ]);
    expect(crossMismatch.verdict).toBe('cannot-judge');

    const flatMostly = multiWindowVerdict([
      win({ deltaSignalSum: 0, label: 'a' }),
      win({ deltaSignalSum: 0, label: 'b' }),
      win({ deltaSignalSum: -5, label: 'c' }),
    ]);
    expect(flatMostly.verdict).toBe('no-change');
  });
});

/**
 * tradeTotals — the money, and the two ways it can be quietly wrong.
 *
 * canary: set `unmeasured += 1` to `0` in the loop (i.e. count a missing `pnlPct` as zero) and the
 * "excludes rather than zeroes" case fails, because the average drops from 2.5 to 1.6667.
 */
describe('tradeTotals', () => {
  it('a run with no trades reports zeros and no average — not a division by zero', () => {
    const t = tradeTotals([]);
    expect(t.count).toBe(0);
    expect(t.avgPnlPct).toBeNull();
    expect(t.winRatePct).toBeNull();
    expect(t.sumPnl).toBeNull();
  });

  it('wins, break-even and losses are three separate counts', () => {
    const t = tradeTotals([
      { pnl: 100, pnlPct: 3, exitDate: '2026-10-01T10:00:00Z' },
      { pnl: 0, pnlPct: 0, exitDate: '2026-10-02T10:00:00Z' },
      { pnl: -100, pnlPct: -1, exitDate: '2026-10-03T10:00:00Z' },
    ]);
    expect(t.count).toBe(3);
    expect(t.wins).toBe(1);
    expect(t.breakEven).toBe(1);
    expect(t.measured).toBe(3);
    expect(t.unmeasured).toBe(0);
    // A break-even trade is measured but not a win: 1 of 3, not 2 of 3.
    expect(t.winRatePct).toBeCloseTo(33.3333, 3);
    expect(t.sumPnl).toBe(0);
    expect(t.avgPnlPct).toBeCloseTo(0.6667, 3);
  });

  it('excludes an unmeasured trade from the average instead of counting it as zero', () => {
    const t = tradeTotals([
      { pnl: 10, pnlPct: 5, exitDate: '2026-10-01T10:00:00Z' },
      { pnl: null, pnlPct: null, exitDate: '2026-10-02T10:00:00Z' },
    ]);
    expect(t.measured).toBe(1);
    expect(t.unmeasured).toBe(1);
    expect(t.avgPnlPct).toBe(5); // NOT 2.5, and NOT 0
    expect(t.sumPnl).toBe(10);
    expect(t.winRatePct).toBe(100); // judged only over what was measured
  });

  it('names the exit instant of the best and worst trade so the row can be found', () => {
    const t = tradeTotals([
      { pnl: 30, pnlPct: 3, exitDate: '2026-09-10T14:10:00Z' },
      { pnl: -30, pnlPct: -3, exitDate: '2026-09-11T15:25:00Z' },
      { pnl: 1, pnlPct: 0.1, exitDate: '2026-09-12T09:00:00Z' },
    ]);
    expect(t.bestPnlPct).toBe(3);
    expect(t.bestAt).toBe('2026-09-10T14:10:00Z');
    expect(t.worstPnlPct).toBe(-3);
    expect(t.worstAt).toBe('2026-09-11T15:25:00Z');
  });

  it('a trade with pnl but no pnlPct still contributes to the currency total', () => {
    const t = tradeTotals([{ pnl: 12.5, pnlPct: null }]);
    expect(t.sumPnl).toBe(12.5);
    expect(t.avgPnlPct).toBeNull();
    expect(t.unmeasured).toBe(1);
  });
});

/**
 * Hold time by exit reason — the speed-of-movement measurement.
 *
 * canary: replace `holdMinutes(entry, exit)` with `0` and the SL-vs-TP case fails, because both
 * averages become equal. Values are the ones MEASURED on the latest VIX 5m run (749 SL / 235 TP).
 */
describe('tradeTotals — hold time', () => {
  const at = (min) => new Date(Date.UTC(2026, 8, 9, 12, 0, 0) + min * 60_000).toISOString();

  it('averages hold per exit reason and overall, in MINUTES', () => {
    const t = tradeTotals([
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: at(60) },
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: at(180) },
      { pnlPct: 3, exitReason: 'TP', entryDate: at(0), exitDate: at(600) },
    ]);
    const sl = t.byExitReason.find((r) => r.reason === 'SL');
    const tp = t.byExitReason.find((r) => r.reason === 'TP');
    expect(sl.count).toBe(2);
    expect(sl.avgHoldMinutes).toBe(120);
    expect(sl.avgPnlPct).toBe(-3);
    expect(tp.count).toBe(1);
    expect(tp.avgHoldMinutes).toBe(600);
    // Overall is the mean over all three, not the mean of the two reason averages.
    expect(t.avgHoldMinutes).toBeCloseTo((60 + 180 + 600) / 3, 3);
  });

  it('orders exit reasons by count, so the dominant exit is first', () => {
    const t = tradeTotals([
      { pnlPct: 3, exitReason: 'TP', entryDate: at(0), exitDate: at(10) },
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: at(10) },
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: at(10) },
    ]);
    expect(t.byExitReason[0].reason).toBe('SL');
  });

  it('a trade with no exit instant is EXCLUDED from the hold average, not counted as zero minutes', () => {
    const t = tradeTotals([
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: at(120) },
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: null },
    ]);
    const sl = t.byExitReason.find((r) => r.reason === 'SL');
    expect(sl.avgHoldMinutes).toBe(120); // NOT 60
    expect(t.avgHoldMinutes).toBe(120);
  });

  it('a negative hold is a data defect, not a measurement — it yields null rather than a negative time', () => {
    const t = tradeTotals([{ pnlPct: 1, exitReason: 'TP', entryDate: at(600), exitDate: at(0) }]);
    expect(t.avgHoldMinutes).toBeNull();
  });

  it('reports an unknown reason rather than dropping the trade', () => {
    const t = tradeTotals([{ pnlPct: 1, entryDate: at(0), exitDate: at(5) }]);
    expect(t.byExitReason).toHaveLength(1);
    expect(t.byExitReason[0].reason).toBe('UNKNOWN');
    expect(t.byExitReason[0].count).toBe(1);
  });
});

/**
 * stopSweep — the "is the stop too distant?" screen.
 *
 * canary: drop `winnersCut` (count every stopped trade as a saving) and the "a tighter stop also kills
 * winners" case fails, which is the failure mode that makes a sweep say "tighter is always better".
 */
describe('stopSweep', () => {
  const trades = [
    // dipped 5% then lost → a 3% stop saves 2 points on it
    { maxAdversePct: 5, pnlPct: -3, exitReason: 'SL' },
    // dipped 4% then WON → a 3% stop would destroy this winner
    { maxAdversePct: 4, pnlPct: 3, exitReason: 'TP' },
    // never dipped beyond 1% → untouched by any candidate here
    { maxAdversePct: 1, pnlPct: 3, exitReason: 'TP' },
  ];

  it('counts what a candidate stop would have fired on, and separates cuts from saved', () => {
    const [row] = stopSweep(trades, [3]);
    expect(row.stopped).toBe(2);
    expect(row.winnersCut).toBe(1);
    expect(row.losersSaved).toBe(1);
    expect(row.replacedPnlPct).toBe(0); // −3 + 3
    expect(row.simulatedPnlPct).toBe(-6); // both exit at −3
    expect(row.deltaPnlPct).toBe(-6); // tighter would have been WORSE here
  });

  it('a looser candidate fires on fewer trades', () => {
    const rows = stopSweep(trades, [2, 3, 5]);
    expect(rows.map((r) => r.stopped)).toEqual([2, 2, 1]);
    expect(rows.map((r) => r.stopPct)).toEqual([2, 3, 5]);
  });

  it('excludes a trade with no excursion — not measured is not a zero', () => {
    const rows = stopSweep([...trades, { maxAdversePct: null, pnlPct: -3 }], [3]);
    expect(rows[0].stopped).toBe(2); // NOT 3
  });

  it('refuses a zero or negative stop instead of silently including it', () => {
    expect(stopSweep(trades, [0, -1, 3]).map((r) => r.stopPct)).toEqual([3]);
  });

  it('deduplicates and sorts candidates ascending', () => {
    expect(stopSweep(trades, [5, 3, 5, 2]).map((r) => r.stopPct)).toEqual([2, 3, 5]);
  });

  it('an empty population yields no rows rather than a zeroed verdict', () => {
    expect(stopSweep([], [3])).toEqual([]);
  });
});

/**
 * barGapProfile — the "the PC was asleep" guard.
 *
 * canary: raise `gapToleranceBars` to 1e9 and the hole case fails, because the 111-hour hole stops
 * being reported. Values are the ones measured on the VIX 5m dev window (45.2% of trades crossed one).
 */
describe('barGapProfile', () => {
  const t0 = Date.UTC(2026, 8, 9, 12, 0, 0);
  const at = (min) => new Date(t0 + min * 60_000).toISOString();
  const every5 = (count, from = 0) => Array.from({ length: count }, (_, i) => at(from + i * 5));

  it('a contiguous series reports 100% coverage and no gaps', () => {
    const p = barGapProfile(every5(100), 5);
    expect(p.coveragePct).toBe(100);
    expect(p.gaps).toHaveLength(0);
    expect(p.clean).toBe(true);
  });

  it('an hour-long hole is reported, counted against coverage, and marks the series unclean', () => {
    // 10 bars, then a 2-hour hole, then 10 more.
    const stamps = [...every5(10, 0), ...every5(10, 10 * 5 + 120)];
    const p = barGapProfile(stamps, 5);
    expect(p.gaps.length).toBe(1);
    expect(p.gaps[0].minutes).toBe(125); // the 2h hole plus the bar slot itself
    expect(p.gaps[0].missingBars).toBe(24);
    expect(p.gapsOverHour).toBe(1);
    expect(p.clean).toBe(false);
    expect(p.coveragePct).toBeCloseTo((20 / 44) * 100, 1);
  });

  it('a single missing bar is below tolerance and is NOT a gap', () => {
    const stamps = [at(0), at(5), at(15), at(20)]; // one slot missing at 10
    const p = barGapProfile(stamps, 5);
    expect(p.gaps).toHaveLength(0);
    expect(p.clean).toBe(true);
  });

  it('the longest hole is named in minutes, not bars', () => {
    const stamps = [
      ...every5(5, 0),
      ...every5(5, 5 * 5 + 60),      // 1h hole
      ...every5(5, 5 * 5 + 60 + 10 * 5 + 6 * 60), // 6h hole
    ];
    const p = barGapProfile(stamps, 5);
    expect(p.gaps.length).toBe(2);
    expect(p.gapsOverHour).toBe(2);
    expect(p.longestGapMinutes).toBeGreaterThan(360);
  });

  it('fewer than two bars cannot be judged and reports clean rather than failing', () => {
    expect(barGapProfile([], 5).clean).toBe(true);
    expect(barGapProfile([at(0)], 5).gaps).toHaveLength(0);
  });

  it('a zero timeframe refuses to divide rather than inventing infinite gaps', () => {
    const p = barGapProfile(every5(10), 0);
    expect(p.gaps).toHaveLength(0);
    expect(p.coveragePct).toBe(100);
  });
});

describe('tradeTotals — the gap-immune hold', () => {
  const at = (min) => new Date(Date.UTC(2026, 8, 9, 12, 0, 0) + min * 60_000).toISOString();

  it('reports a bars-based hold that ignores wall-clock downtime', () => {
    // 3 days of wall clock, but only 40 bars of trading time: the machine was off.
    const t = tradeTotals([
      { pnlPct: -3, exitReason: 'SL', entryDate: at(0), exitDate: at(3 * 1440), barsHeld: 40, spansGap: true },
    ]);
    expect(t.avgHoldMinutes).toBe(3 * 1440);
    expect(t.avgBarsHeld).toBe(40);
    expect(t.tradesSpanningGap).toBe(1);
  });

  it('counts trades whose hold crossed a gap, and only those', () => {
    const t = tradeTotals([
      { pnlPct: 1, entryDate: at(0), exitDate: at(10), barsHeld: 2, spansGap: false },
      { pnlPct: 1, entryDate: at(0), exitDate: at(500), barsHeld: 20, spansGap: true },
    ]);
    expect(t.tradesSpanningGap).toBe(1);
    expect(t.avgBarsHeld).toBe(11);
  });

  it('a trade with no barsHeld is excluded from the bars average, not counted as zero', () => {
    const t = tradeTotals([
      { pnlPct: 1, entryDate: at(0), exitDate: at(30), barsHeld: 6 },
      { pnlPct: 1, entryDate: at(0), exitDate: at(30) }, // no barsHeld — an older trade
    ]);
    expect(t.avgBarsHeld).toBe(6);
  });
});

/**
 * periodHealth — the standard that decides whether a window may be measured.
 *
 * canary: make `status` always 'healthy' and the refusal cases fail; drop the hole test and a 111-hour
 * hole passes on coverage alone. Both are the ways this could silently stop refusing.
 */
describe('periodHealth', () => {
  const std = { minCoveragePct: 90, maxHoleMinutes: 120 };
  const prof = (over = {}) => ({
    coveragePct: 100, bars: 1000, expectedBars: 1000, longestGapMinutes: 0, gapsOverHour: 0, ...over,
  });

  it('a contiguous series is healthy and carries the standard it was judged by', () => {
    const h = periodHealth(prof(), std);
    expect(h.status).toBe('healthy');
    expect(h.reasons).toHaveLength(0);
    expect(h.standard).toEqual(std);
  });

  it('coverage below the minimum is UNUSABLE and says the numbers', () => {
    const h = periodHealth(prof({ coveragePct: 63.9, bars: 7662, expectedBars: 11988 }), std);
    expect(h.status).toBe('unusable');
    expect(h.reasons[0]).toContain('63.9%');
    expect(h.reasons[0]).toContain('90%');
  });

  it('ONE hole over the tolerance is UNUSABLE even at high coverage', () => {
    const h = periodHealth(prof({ coveragePct: 95, longestGapMinutes: 6680 }), std);
    expect(h.status).toBe('unusable');
    expect(h.reasons.join(' ')).toContain('6680 min');
  });

  it('a hole inside tolerance degrades rather than refusing, and states the caveat', () => {
    const h = periodHealth(prof({ coveragePct: 97, longestGapMinutes: 61, gapsOverHour: 2 }), std);
    expect(h.status).toBe('degraded');
    expect(h.reasons[0]).toContain('2 hole(s)');
  });

  it('a stricter standard flips a healthy window to unusable — the thresholds are the rule', () => {
    const p = prof({ coveragePct: 92 });
    expect(periodHealth(p, std).status).toBe('healthy');
    expect(periodHealth(p, { minCoveragePct: 95, maxHoleMinutes: 120 }).status).toBe('unusable');
  });
});

/**
 * sessionAwareGapProfile — a hole is only a hole if the instrument trades in that hour.
 *
 * canary: treat every missing slot as unexplained (`if (!populated.has(...)) continue;` removed) and the
 * weekend case fails — it goes back to being a 49-hour "hole". Measured on the canonical periods: 20 of
 * 21 read unusable under the naive rule, with BTC 1h (24/7) the sole healthy one.
 */
describe('sessionAwareGapProfile', () => {
  const MIN = 60_000;
  const at = (iso) => new Date(iso).toISOString();

  /** A Mon–Fri 08:00–16:00 UTC instrument: 5m bars, every weekday for THREE weeks (the mask needs 14+ days). */
  const weekdayBars = () => {
    const out = [];
    for (let day = 5; day <= 25; day++) {
      const d = new Date(Date.UTC(2026, 9, day, 8, 0, 0));
      const wd = d.getUTCDay();
      if (wd === 0 || wd === 6) continue;
      for (let m = 0; m < 8 * 60; m += 5) out.push(new Date(d.getTime() + m * MIN).toISOString());
    }
    return out;
  };

  it('a weekend is a CLOSURE, not a hole — the instrument never trades then', () => {
    const p = sessionAwareGapProfile(weekdayBars(), 5);
    expect(p.coveragePct).toBe(100);
    expect(p.unexplainedGaps).toHaveLength(0);
    expect(p.clean).toBe(true);
    // The naive profile still sees the weekend, which is exactly why it condemned 20 of 21 periods.
    expect(p.rawExpectedBars).toBeGreaterThan(p.expectedBars);
  });

  it('a hole INSIDE trading hours is still a hole', () => {
    const bars = weekdayBars().filter((b) => {
      // drop a 3-hour stretch on the first trading day
      const t = new Date(b).getTime();
      return !(t >= Date.UTC(2026, 9, 5, 10, 0, 0) && t < Date.UTC(2026, 9, 5, 13, 0, 0));
    });
    const p = sessionAwareGapProfile(bars, 5);
    expect(p.unexplainedGaps.length).toBe(1);
    expect(p.unexplainedGaps[0].missingBars).toBe(36);
    expect(p.coveragePct).toBeLessThan(100);
    expect(p.clean).toBe(false);
  });

  it('a 24/7 instrument reports every hole — there is no closure to hide behind', () => {
    // Three full weeks of 5m bars, with a 6-hour hole in the middle one.
    const out = [];
    const start = Date.UTC(2026, 9, 5, 0, 0, 0);
    const holeFrom = 7 * 1440;
    for (let m = 0; m < 21 * 1440; m += 5) {
      if (m >= holeFrom && m < holeFrom + 360) continue;
      out.push(new Date(start + m * MIN).toISOString());
    }
    const p = sessionAwareGapProfile(out, 5);
    expect(p.calibrated).toBe(true);
    expect(p.unexplainedGaps.length).toBe(1);
    expect(p.unexplainedGaps[0].minutes).toBeGreaterThan(330);
  });

  it('too short a window CANNOT calibrate and falls back to the naive profile, saying so', () => {
    const out = [];
    const start = Date.UTC(2026, 9, 5, 0, 0, 0);
    for (let m = 0; m < 2 * 1440; m += 5) out.push(new Date(start + m * MIN).toISOString());
    for (let m = 2 * 1440 + 360; m < 4 * 1440; m += 5) out.push(new Date(start + m * MIN).toISOString());
    const p = sessionAwareGapProfile(out, 5);
    expect(p.calibrated).toBe(false);
    // The hole is still reported — an uncalibrated mask must not excuse a real outage as a closure.
    expect(p.unexplainedGaps.length).toBe(1);
  });

  it('an empty or single-bar series is not judged', () => {
    expect(sessionAwareGapProfile([], 5).clean).toBe(true);
    expect(sessionAwareGapProfile([at('2026-10-05T08:00:00Z')], 5).unexplainedGaps).toHaveLength(0);
  });
});
