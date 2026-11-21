/**
 * run-depth.ts — ONE SESSION, TAKEN APART: what the engine scored, what it signalled, what it traded.
 *
 * ── WHAT THIS ANSWERS ───────────────────────────────────────────────────────────────────────────
 * A result row said "NXXT moved +430% at the cutoff and the strategy won 36% of its trades". Nothing
 * in the stored output explained the gap, because a run keeps ONE number per bar (the composite) and a
 * trade count. The owner's question — which directive, which decision, which exit — needs the bar, the
 * signal, the trade and the exit on the SAME timeline.
 *
 * ⚠️ WHAT IS DERIVED AND WHAT IS RECORDED. This module does not invent evidence:
 *   · RECORDED by the run — the score, both percentages, the risk multiplier, the signal class, the
 *     bar-gate verdict, the entry/exit instants, prices and P/L.
 *   · DERIVED here — the STATE of each bar (entered / exited / signalled-but-not-traded / gated /
 *     quiet) and the step counts. A derived state is a LABEL over recorded facts, and the label names
 *     which fact produced it.
 *   · NOT AVAILABLE — the engine does not record WHY a bar with an actionable signal produced no
 *     trade. This module therefore says `signal-not-traded` and lists the candidate reasons the run
 *     counts, rather than asserting one per bar. See `decision_log` in issue #1323.
 *
 * Pure: no Prisma, no clock, no Nest. Every rule is exercisable from fixtures.
 */

/**
 * ── DECISION (2026-11-20, primary) ──
 * WHAT:       The per-bar timeline LABELS recorded facts and states plainly where a fact is missing.
 *             It never asserts a reason the engine did not record.
 * WHY:        A bar that cleared both gates and produced no trade is the most interesting bar in a
 *             losing run, and the engine keeps no per-bar reason for it (only the totals
 *             `signalsWithoutTrade` / `tradesRefusedUnaffordable`). The tempting fix — infer
 *             "unaffordable" or "already in position" from the surrounding bars — would produce a
 *             confident wrong answer on the one bar a reader is looking at.
 * INSTEAD OF: Guessing the reason from the next trade's absence, or omitting those bars entirely.
 *             Omitting them is worse: the ladder would then reconcile, and a reader would conclude
 *             every signal became a trade.
 * REVERSE BY: Adding real decision persistence (issue #1323) and reading the stored reason here; the
 *             label becomes a lookup instead of a fallback. Nothing is stored or migrated today.
 * REGISTER:  docs/SETTLED-DECISIONS.md row 232
 * GUARD:     nest/src/modules/backtest/run-depth.spec.ts (the bar-gate precedence canary, the
 *            directional canary, and the "no rung exceeds its denominator" invariant)
 *
 * ⚠️ ROW 246 (2026-11-21) SUPERSEDES ONE DETAIL OF ROW 232 ABOVE: the per-bar STATE used to let an
 * entry outrank an exit, so a bracket that closed inside its own bar was reported as a bare ENTRY. Row
 * 246 changes the LABEL only — "the engine records no per-bar reason" is still true and still stated.
 */
import { decideEntry } from './entry-side';
import { minuteOfDayUtc, parseCutoffUtc } from './selection-ranking';

/** One bar of the run's score series, as recorded. `groups`/`directives` appear only on a detail run. */
export interface DepthSeriesRow {
  time: string;
  price?: number | null;
  changePct?: number | null;
  score: number;
  signalPct: number;
  opportunityPct: number;
  riskMultiplier: number;
  signal: string;
  passedBar: boolean;
  groups?: Record<string, number>;
  directives?: Array<{
    directiveId: string;
    score: number;
    maxScore: number;
    signalClass: string;
    /** The directive's own sentence about this bar — the closest thing to "why" the pipeline records. */
    reason?: string | null;
    /** Did this directive contribute to the DIRECTIONAL score at all? A reading that is not counted
     *  cannot lift the composite, however large the price move. */
    inSignal?: boolean | null;
  }>;
}

/** A trade as the engine returned it, with the selection's verdict attached by the caller. */
export interface DepthTrade {
  entryDate: string;
  exitDate: string;
  entryPrice: number;
  exitPrice: number;
  direction: 'LONG' | 'SHORT';
  pnl: number;
  exitReason: string;
  /** #1242 — the same exit in the LIVE `CLOSE_REASONS` vocabulary; `null` for `EOD`. */
  closeReason?: string | null;
  signal: string;
  /** Did the ranked selection permit this trade? `false` = the engine took it, the strategy could not. */
  kept: boolean;
}

export type BarState =
  | 'entry+exit'
  | 'entry'
  | 'exit'
  | 'signal-not-traded'
  | 'bar-gate'
  | 'no-data'
  | 'quiet';

export interface DepthBarRow extends DepthSeriesRow {
  beforeCutoff: boolean;
  state: BarState;
  /** Trades that OPENED on this bar. More than one only if the engine stacked. */
  entries: Array<{ direction: 'LONG' | 'SHORT'; kept: boolean; pnl: number | null }>;
  /**
   * Trades that CLOSED on this bar — INCLUDING one that closed inside the bar it opened on (a
   * same-bar bracket hit). That case is listed in BOTH `entries` and `exits` on purpose: reporting
   * only the opening leg is what let a TP show as a bare `ENTRY` row.
   */
  exits: Array<{ direction: 'LONG' | 'SHORT'; kept: boolean; pnl: number; exitReason: string }>;
  /**
   * Trades on this bar whose EXIT instant is not a bar in this window — an end-of-data close, a
   * session exit, or a data gap. Counted, never dropped (in `orphanedExits`), so `entry` + `orphanedExits`
   * reconciles with the executions table instead of silently under-reading it.
   */
  orphanedExits: number;
}

export interface DepthStep {
  id: string;
  label: string;
  count: number;
  /** The denominator this count should be read against, for a ratio bar. `null` = standalone count. */
  of: number | null;
  note: string;
}

const sameInstant = (a: string, b: string) => {
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isFinite(ta) && ta === tb;
};

/**
 * Put every bar of ONE session in order, with the state that bar reached.
 *
 * ⚠️ `answerDate` IS REQUIRED AND IS NOT INFERRED. Bars from warm-up sessions are excluded here —
 * they are the reason the directives have history, not part of the result.
 */
export function buildDepthBars(input: {
  series: readonly DepthSeriesRow[];
  trades: readonly DepthTrade[];
  answerDate: string;
  cutoffUtc: string;
  directionMode: 'long' | 'short';
}): DepthBarRow[] {
  const { series, trades, answerDate, cutoffUtc, directionMode } = input;
  const cutoffMinute = parseCutoffUtc(cutoffUtc);

  const dayBars = series.filter((r) => String(r.time).slice(0, 10) === answerDate);
  const barInstant = new Set(dayBars.map((r) => new Date(r.time).getTime()));

  return dayBars.map((row) => {
    /**
     * ── DECISION (2026-11-21, primary) ──
     * WHAT:      `exits` includes the trade that closes INSIDE the bar it opened on, that trade is
     *            listed in `entries` AND `exits` on the same row, and both branches label the row
     *            `entry+exit`. A trade whose exit instant is not a bar here is counted in
     *            `orphanedExits`.
     * WHY:       The old precedence (`entries.length ? 'entry' : …`) reported a same-bar bracket hit as
     *            a bare ENTRY, while a bar that entered AND exited via two DIFFERENT trades said
     *            ENTRY + EXIT — the same words for two different facts, which is what a reader cannot
     *            reconcile. Measured on movers-winners-2026-11-11 / NXXT: 26 of 63 trades closed
     *            within 5 minutes, and 25 more closed at an instant that is not a bar in the window,
     *            so most real exits were invisible on the timeline.
     * INSTEAD OF: Keeping the "an entry outranks an exit" precedence. It is not merely a label: it
     *            reproduced the regression the same test file already pins (a bar that closed and
     *            opened a position must say `entry+exit`). Both facts now give one answer.
     * REVERSE BY: Restoring the `entries.length ? 'entry' :` branch above and removing the
     *            self-exit/`orphanedExits` handling. Nothing is stored — the timeline is recomputed
     *            from recorded trades on every request, so old runs re-derive correctly without backfill.
     * REGISTER:  docs/SETTLED-DECISIONS.md row 246
     * GUARD:     nest/src/modules/backtest/run-depth.spec.ts — the two "CANARY" cases below, canaried
     *            against the pre-fix code (both fail there).
     */
    const opened = trades.filter((t) => sameInstant(t.entryDate, row.time));
    // A trade that closes inside the bar it opened on matches BOTH filters — which is exactly how it
    // ends up listed as an entry AND an exit, instead of being reported as a bare entry.
    const closed = trades.filter((t) => sameInstant(t.exitDate, row.time));

    const entries = opened.map((t) => ({ direction: t.direction, kept: t.kept, pnl: t.kept ? t.pnl : null }));
    const exits = closed.map((t) => ({ direction: t.direction, kept: t.kept, pnl: t.pnl, exitReason: t.exitReason }));
    // An exit that cannot be placed on a bar is NOT an exit on this bar — it is a fact this row has to
    // carry, or the executions table and this timeline disagree with no explanation.
    const orphanedExits = opened.filter((t) => !barInstant.has(new Date(t.exitDate).getTime())).length;

    const beforeCutoff = minuteOfDayUtc(row.time) < cutoffMinute;

    let state: BarState;
    if (entries.length && exits.length) state = 'entry+exit';
    else if (entries.length) state = 'entry';
    else if (exits.length) state = 'exit';
    else if (row.signal === 'NO_DATA') state = 'no-data';
    else if (!row.passedBar) state = 'bar-gate';
    else if (decideEntry(row.signal, directionMode).enter) state = 'signal-not-traded';
    else state = 'quiet';

    return { ...row, beforeCutoff, state, entries, exits, orphanedExits };
  });
}

/**
 * The ladder a symbol climbs from "on today's list" to "closed a trade" — with the count that stopped
 * at each rung. Every rung is counted from recorded facts, and a rung of 0 is the finding.
 */
export function buildStepLadder(input: {
  candidates: number;
  selected: number;
  bars: readonly DepthBarRow[];
  trades: readonly DepthTrade[];
}): DepthStep[] {
  const { candidates, selected, bars, trades } = input;
  const tradable = bars.filter((b) => !b.beforeCutoff);
  const gated = tradable.filter((b) => b.passedBar);
  const signalled = tradable.filter((b) => b.passedBar && b.state === 'signal-not-traded');
  const entriesAll = trades.filter((t) => bars.some((b) => sameInstant(b.time, t.entryDate)));
  const kept = trades.filter((t) => t.kept);
  const keptExits = kept.filter((t) => bars.some((b) => sameInstant(b.time, t.exitDate)));

  return [
    {
      id: 'candidates',
      label: 'On the day’s list',
      count: candidates,
      of: null,
      note: 'Symbols the dataset offers as candidates for this session.',
    },
    {
      id: 'selected',
      label: 'Picked by the ranking',
      count: selected,
      of: candidates,
      note: 'Top N by move at the cutoff, measured from the previous session’s close.',
    },
    {
      id: 'scored',
      label: 'Bars scored',
      count: bars.length,
      of: null,
      note: 'Every bar of the session the engine evaluated, including the ones before the cutoff.',
    },
    {
      id: 'tradable',
      label: 'Bars after the cutoff',
      count: tradable.length,
      of: bars.length,
      note: 'Only these could become a trade: the ranking was not known before the cutoff.',
    },
    {
      id: 'bar-gate',
      label: 'Passed the bot’s bar',
      count: gated.length,
      of: tradable.length,
      note: 'The second, tighter gate (`minComposite`). A bar that fails it cannot trade.',
    },
    {
      id: 'signals',
      label: 'Actionable signals, no trade',
      count: signalled.length,
      of: gated.length,
      note: 'Bars that cleared both gates and still produced no trade. The engine does not record the per-bar reason (#1323).',
    },
    {
      id: 'entries',
      label: 'Entries the engine took',
      count: entriesAll.length,
      // ⚠️ THE DENOMINATOR IS THE SESSION'S BARS, NOT THE BARS AFTER THE CUTOFF. The engine also opens
      // trades on pre-cutoff bars — they are then dropped by the selection. Measured 2026-11-11 on
      // NXXT: 53 entries against 54 bars, which reported "53 of 44" when the denominator was the
      // tradable count. A rung can never exceed its own denominator, so that read as a broken number.
      of: bars.length,
      note: 'Trades opened during the session, including bars before the cutoff — the selection drops those afterwards.',
    },
    {
      id: 'kept',
      label: 'Entries the strategy could take',
      count: entriesAll.filter((t) => t.kept).length,
      of: entriesAll.length,
      note: 'What survives selection: picked that day AND entered at or after the cutoff.',
    },
    {
      id: 'exits',
      label: 'Closed within the session',
      count: keptExits.length,
      of: kept.length,
      note: 'A trade still open at the last bar is not an exit — it is reported, not counted.',
    },
  ];
}
