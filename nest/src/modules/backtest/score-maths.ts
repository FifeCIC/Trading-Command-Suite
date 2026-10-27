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
