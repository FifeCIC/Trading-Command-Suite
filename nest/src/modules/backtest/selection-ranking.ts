/**
 * selection-ranking.ts — the GENERIC half of a ranked-selection backtest.
 *
 * A "selection" strategy does not own an instrument: it picks from a candidate set each day and
 * trades only what it picked. That shape is not unique to movers — any ranked strategy (top gainers,
 * biggest losers, highest conviction score, most active) needs the same three operations, so they
 * live here once rather than inside the movers feature:
 *
 *   1. `rankCandidates()`    — turn per-candidate metrics into an ordered list with a selected set.
 *   2. `buildDayRanks()`     — derive each candidate's metric per day **with no look-ahead**.
 *   3. `applySelection()`    — keep only the trades the selection would actually have taken.
 *
 * ⚠️ RULE 2 IS THE ONE THAT DECIDES WHETHER A RESULT IS REAL. Ranking by a day's FULL move and then
 * counting trades from the open scores the strategy against the answer key: it produces a beautiful
 * number and teaches a strategy that cannot exist live. Every metric here is computed from bars at or
 * before `cutoffUtc` ONLY.
 *
 * Pure module: no Prisma, no Nest, no clock. Every rule below is exercisable without a database.
 */

/** One candidate's metric on one day. `null` means "could not be measured", never zero. */
export interface DayCandidate {
  symbol: string;
  /** Move from the previous close to the price at the cutoff, as a percentage. */
  movePct: number | null;
  /** Why the metric is null. Reported, never swallowed — a candidate silently absent from a ranking
   *  looks like a candidate that did not exist. */
  reason?: string;
}

export type SelectionSide = 'winners' | 'losers';

export interface RankedCandidate extends DayCandidate {
  /** 1-based. `null` for a candidate that could not be measured, which sorts last but stays visible. */
  rank: number | null;
  selected: boolean;
}

export interface RankResult {
  /** Ordered best-first for the side asked for; unmeasured candidates last, in input order. */
  ranked: RankedCandidate[];
  /** The chosen symbols, best-first. Length <= `topN`. */
  selected: string[];
}

/** A bar, reduced to what ranking needs. */
export interface RankBar {
  /** ISO timestamp. */
  timestamp: string;
  close: number;
}

export interface DayRank {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  /** False when no candidate could be measured that day. Reported, not skipped. */
  rankable: boolean;
  reason?: string;
  ranked: RankedCandidate[];
  selected: string[];
}

/** Midnight-to-cutoff comparison on the UTC wall clock, so no timezone library is needed. */
function minuteOfDayUtc(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** `'15:30'` → 930. Throws on anything unparseable: a cutoff silently read as 00:00 would rank on
 *  the first bar of the day and look like it worked. */
export function parseCutoffUtc(cutoff: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(cutoff.trim());
  if (!m) throw new Error(`cutoffUtc '${cutoff}' is not HH:MM`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`cutoffUtc '${cutoff}' is out of range`);
  return h * 60 + min;
}

/**
 * The metric: `(price at/before the cutoff) / (previous session close) - 1`, as a percentage.
 *
 * ⚠️ The denominator is the PREVIOUS session's close, because that is what every movers feed means by
 * "% change today". Using the day's own first bar instead would report the move since the open and
 * quietly disagree with the list the strategy is modelled on.
 *
 * Returns null with a reason rather than 0 — "no previous close" and "no move" are different states,
 * and collapsing them puts an unmeasurable candidate in the middle of the ranking.
 */
export function moveSoFarPct(
  bars: readonly RankBar[],
  previousClose: number | null,
  cutoffMinute: number,
): { movePct: number | null; reason?: string } {
  if (previousClose === null || !Number.isFinite(previousClose) || previousClose <= 0) {
    return { movePct: null, reason: 'no previous session close to measure from' };
  }
  let lastAtOrBefore: RankBar | null = null;
  for (const b of bars) {
    if (minuteOfDayUtc(b.timestamp) <= cutoffMinute) {
      if (!lastAtOrBefore || new Date(b.timestamp) > new Date(lastAtOrBefore.timestamp)) lastAtOrBefore = b;
    }
  }
  if (!lastAtOrBefore) {
    return { movePct: null, reason: 'no bar at or before the cutoff' };
  }
  if (!Number.isFinite(lastAtOrBefore.close) || lastAtOrBefore.close <= 0) {
    return { movePct: null, reason: 'price at the cutoff is not usable' };
  }
  return { movePct: (lastAtOrBefore.close / previousClose - 1) * 100 };
}

/**
 * Order candidates for a side and take the top `topN`.
 *
 * `winners` takes the largest positive moves; `losers` takes the most negative. Unmeasured candidates
 * are kept at the END with `rank: null` — they are not silently dropped, because "the ranking had 18
 * entries not 20" is exactly the kind of gap a reader cannot see and will assume is fine.
 */
export function rankCandidates(
  candidates: readonly DayCandidate[],
  side: SelectionSide,
  topN: number,
): RankResult {
  const measured = candidates.filter((c): c is DayCandidate & { movePct: number } => c.movePct !== null);
  const unmeasured = candidates.filter((c) => c.movePct === null);

  measured.sort((a, b) => (side === 'winners' ? b.movePct - a.movePct : a.movePct - b.movePct));

  const limit = Math.max(0, Math.floor(topN));
  const ranked: RankedCandidate[] = [
    ...measured.map((c, i) => ({ ...c, rank: i + 1, selected: i < limit })),
    ...unmeasured.map((c) => ({ ...c, rank: null, selected: false })),
  ];

  return { ranked, selected: measured.slice(0, limit).map((c) => c.symbol) };
}

/**
 * Build one rank per trading day across a set of candidates.
 *
 * `barsBySymbol` holds each candidate's bars for the whole window, ascending. The previous close is
 * the last close of the most recent EARLIER day present in the window.
 *
 * ⚠️ The FIRST day is unrankable and says so: there is no earlier session in the window to measure
 * from. Looking one day further back would need bars outside the caller's window, and inventing a
 * denominator is how a ranking becomes fiction.
 */
export function buildDayRanks(
  barsBySymbol: ReadonlyMap<string, readonly RankBar[]>,
  side: SelectionSide,
  topN: number,
  cutoffUtc: string,
): DayRank[] {
  const cutoffMinute = parseCutoffUtc(cutoffUtc);

  // date → symbol → bars
  const byDate = new Map<string, Map<string, RankBar[]>>();
  const dates = new Set<string>();
  for (const [symbol, bars] of barsBySymbol) {
    for (const b of bars) {
      const date = b.timestamp.slice(0, 10);
      dates.add(date);
      if (!byDate.has(date)) byDate.set(date, new Map());
      const perSymbol = byDate.get(date)!;
      if (!perSymbol.has(symbol)) perSymbol.set(symbol, []);
      perSymbol.get(symbol)!.push(b);
    }
  }

  const sortedDates = [...dates].sort();
  const out: DayRank[] = [];

  for (let i = 0; i < sortedDates.length; i++) {
    const date = sortedDates[i];
    const today = byDate.get(date)!;
    const prevDate = i > 0 ? sortedDates[i - 1] : null;

    const candidates: DayCandidate[] = [];
    for (const [symbol] of barsBySymbol) {
      const todayBars = today.get(symbol) ?? [];
      let previousClose: number | null = null;
      if (prevDate) {
        const prevBars = byDate.get(prevDate)?.get(symbol) ?? [];
        if (prevBars.length) previousClose = prevBars[prevBars.length - 1].close;
      }
      const { movePct, reason } = moveSoFarPct(todayBars, previousClose, cutoffMinute);
      candidates.push({ symbol, movePct, reason });
    }

    const { ranked, selected } = rankCandidates(candidates, side, topN);
    const measured = ranked.filter((r) => r.rank !== null).length;
    out.push({
      date,
      rankable: measured > 0,
      reason:
        measured > 0
          ? undefined
          : prevDate === null
            ? 'first day in the window — no previous session close to measure from'
            : 'no candidate had a usable price at or before the cutoff',
      ranked,
      selected,
    });
  }

  return out;
}

/** Trades, reduced to what the selection filter needs. */
export interface SelectionTrade {
  /** ISO timestamp of the entry bar. */
  entryDate: string;
  [key: string]: unknown;
}

/**
 * Keep only the trades the selection would actually have taken.
 *
 * A trade survives when its symbol was SELECTED on the UTC date it was entered AND it entered at or
 * after the cutoff — the two conditions that make the ranking information available before the entry.
 *
 * ⚠️ WHY A POST-FILTER AND NOT A CHANGE TO THE ENGINE: the engine already decides per bar whether the
 * protocol would act, and that decision is what we want to keep. Wrapping it in a new entry-window
 * parameter would duplicate the engine's own clock handling. Filtering afterwards keeps ONE source of
 * truth for "would the protocol have entered?" and applies the selection on top, where it belongs.
 */
export function applySelection<T extends SelectionTrade>(
  trades: readonly T[],
  days: readonly DayRank[],
  cutoffUtc: string,
): { kept: T[]; dropped: Array<{ trade: T; code: 'not-selected' | 'before-cutoff' }> } {
  const cutoffMinute = parseCutoffUtc(cutoffUtc);
  const selectedByDate = new Map<string, Set<string>>();
  for (const d of days) selectedByDate.set(d.date, new Set(d.selected));

  const kept: T[] = [];
  const dropped: Array<{ trade: T; code: 'not-selected' | 'before-cutoff' }> = [];

  for (const t of trades) {
    const date = t.entryDate.slice(0, 10);
    if (!selectedByDate.get(date)?.has((t as unknown as { symbol?: string }).symbol ?? '')) {
      dropped.push({ trade: t, code: 'not-selected' });
      continue;
    }
    if (minuteOfDayUtc(t.entryDate) < cutoffMinute) {
      dropped.push({ trade: t, code: 'before-cutoff' });
      continue;
    }
    kept.push(t);
  }

  return { kept, dropped };
}
