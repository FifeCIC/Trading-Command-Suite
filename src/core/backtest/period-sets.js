/**
 * period-sets.js — group captured backtest periods into NAMED SETS for the library view.
 *
 * ── WHY A SET IS NOT A ROW ──
 * `backtest_period` is ONE SYMBOL PER ROW. That is right for the engine, which loads a window for a
 * symbol. It is wrong for a library: measured 2026-11-16, `dev-window-v1` holds **27 rows** and the
 * two extreme-mover sets hold **10 each** — so a flat list shows **20 identical names with the same
 * paragraph of reasoning repeated 20 times**. The requirement is for a library of "data sets of a
 * specific period", and a set is the thing they name, note and reason about.
 *
 * A set is therefore identified by what makes it one piece of stored evidence:
 *
 *     name + timeframe + from + to
 *
 * ⚠️ TIMEFRAME IS PART OF THE KEY, DELIBERATELY. `dev-window-v1` exists at 5m, 15m, 1h and 1d for the
 * same calendar window — and those are different data, not the same set stored four times. Merging
 * them would let a 5m capture's bar count be read as if it described the 1d window.
 *
 * ⚠️ AND `from`/`to` ARE IN THE KEY. Two captures can share a name by accident ("test", "nvda") over
 * different windows; calling those one set would attach one window's note to another window's bars.
 * Grouping is therefore conservative: it merges only rows that agree on all four facts.
 *
 * ⚠️ NOTHING HERE DECIDES WHETHER A SET IS GOOD. It counts what is stored and flags the two states
 * that are NOT "fine": a member never imported, and a member whose import found an empty window.
 * Those are separate from a set with zero runs, which is simply unstudied.
 */

/** The four facts that make two rows the same set. `\u0000` cannot occur in any of them. */
const keyOf = (p) => `${p.name}\u0000${p.timeframe}\u0000${p.from}\u0000${p.to}`;

/**
 * groupPeriods() — flat period rows → named sets, newest window first.
 *
 * Returns an array of:
 *   { key, name, note, noteVariants, timeframe, from, to, periods[], symbols,
 *     totalBars, totalRuns, neverImported, emptyWindows }
 */
export function groupPeriods(periods) {
  if (!Array.isArray(periods)) return [];
  const sets = new Map();

  for (const p of periods) {
    const key = keyOf(p);
    let set = sets.get(key);
    if (!set) {
      set = {
        key,
        name: p.name,
        note: p.note ?? null,
        timeframe: p.timeframe,
        from: p.from,
        to: p.to,
        periods: [],
      };
      sets.set(key, set);
    }
    set.periods.push(p);
    // ⚠️ The FIRST non-empty note wins rather than the last, so a set whose first row was captured
    // with the reasoning does not lose it because a later row was captured blank.
    if (!set.note && p.note) set.note = p.note;
  }

  for (const set of sets.values()) {
    set.periods.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)));
    set.symbols = set.periods.length;
    // `null` is "never imported" and contributes 0 bars without pretending the window is empty.
    set.totalBars = set.periods.reduce((a, p) => a + (p.barCount ?? 0), 0);
    set.totalRuns = set.periods.reduce((a, p) => a + (p.runs ?? 0), 0);
    set.neverImported = set.periods.filter((p) => p.barCount == null).length;
    set.emptyWindows = set.periods.filter((p) => p.barCount === 0).length;
    /**
     * ⚠️ HOW MANY DISTINCT NOTES THE MEMBERS CARRY. A set is one piece of reasoning, so >1 means the
     * rows drifted apart — usually because a note was edited on one row and not the others. The UI
     * shows this instead of silently displaying one member's note as if it were the set's.
     */
    set.noteVariants = new Set(set.periods.map((p) => p.note ?? '')).size;
  }

  return [...sets.values()].sort(
    (a, b) => String(b.from).localeCompare(String(a.from)) || String(a.name).localeCompare(String(b.name)),
  );
}

/**
 * setHealth() — one word for a set, and the four states are genuinely different.
 *
 *   empty      every member's import found no bars (the window holds nothing)
 *   partial    some members imported, some never did (an interrupted capture)
 *   ready      every member has bars and nothing has studied it yet
 *   studied    every member has bars and at least one run has measured it
 *
 * ⚠️ `partial` is NOT rendered as `ready`. A set where 6 of 10 symbols were captured looks complete
 * from its name and its bar count, and would quietly produce a backtest over a smaller universe than
 * the name implies.
 */
export function setHealth(set) {
  if (!set || !set.symbols) return 'empty';
  if (set.emptyWindows === set.symbols) return 'empty';
  if (set.neverImported > 0 || set.emptyWindows > 0) return 'partial';
  return set.totalRuns > 0 ? 'studied' : 'ready';
}
