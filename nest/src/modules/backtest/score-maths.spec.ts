import {
  scoringTotals,
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
