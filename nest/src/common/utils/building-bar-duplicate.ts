/**
 * building-bar-duplicate.ts — a FORMING bar that repeats the last closed bar is not a session (#1049).
 * =======================================================================================================
 *
 * THE DEFECT
 * ----------
 * MT5's `copy_rates_from_pos(symbol, TIMEFRAME_D1, 0, N)` returns N bars **ending with the one that is
 * still forming**. While the next session has not opened, the broker has no data for it — and MT5
 * answers with a bar stamped at the NEXT session's start carrying the LAST CLOSED session's OHLCV,
 * volume included. It is not a flat market; it is a copy.
 *
 * Measured 2026-10-01 on the live database — 205 daily bars byte-identical to the bar before them:
 *
 *   | weekday   | duplicates |
 *   |-----------|------------|
 *   | **Friday**|   **166**  |
 *   | Wednesday |         9  |
 *   | Tuesday   |         7  |
 *   | Monday    |         7  |
 *   | Thursday  |         6  |
 *   | Sunday    |         5  |
 *
 * The Friday shape is a signature, not noise: the daily series here is stamped at the session START,
 * so five sessions land Sun–Thu and there is **no Friday session at all**. A `Friday 21:00` bar is the
 * bucket for a session that has not begun, holding the previous session's values.
 *
 * ⚠️ WHY THE TIMESTAMPS ARE NOT THE BUG — DO NOT "FIX" THEM
 * #880 suspected a mislabelled weekend and was settled by measurement: the 72-hour gap sits between
 * **Thu 21:00 and Sun 21:00**, so stamping at the session start is correct and Sun–Thu labelling is
 * correct. The stray Friday row is a WRITE defect, not a mislabelled day.
 *
 * THE RULE
 * --------
 * **The NEWEST bar of a fetch is dropped when it is byte-identical to the one before it.**
 *
 * Only the newest, and only on exact equality of open, high, low, close AND volume. Three reasons
 * this is safe where a general "drop duplicates anywhere" rule would not be:
 *
 *   1. A forming bar is ALWAYS the newest, so restricting to it cannot delete a historical row.
 *   2. Exact equality on all FIVE fields is required, so a genuinely quiet session (which still has
 *      its own tick volume) is never mistaken for one.
 *   3. When the market is OPEN the forming bar moves, so the rule cannot fire — it only ever applies
 *      to the one condition it is meant to describe.
 *
 * ⚠️ It returns the bar it dropped rather than filtering silently. The caller must LOG it: a
 * silently-discarded bar is indistinguishable from a fetch that returned one fewer bar.
 */

/** The minimum a bar must expose. Structural, so a provider's own bar type can be passed. */
export interface OhlcvBar {
  timestamp: Date | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

/** Do two bars describe exactly the same period with exactly the same numbers? */
export function isSameOhlcv(a: OhlcvBar, b: OhlcvBar): boolean {
  return (
    Number(a.open) === Number(b.open) &&
    Number(a.high) === Number(b.high) &&
    Number(a.low) === Number(b.low) &&
    Number(a.close) === Number(b.close) &&
    Number(a.volume ?? 0) === Number(b.volume ?? 0)
  );
}

/**
 * Drop EVERY bar that repeats the one before it — the READ-TIME variant (#1049, register row 56).
 *
 * ⚠️ Why this is separate from `dropFormingDuplicate()`, which drops only the newest.
 *
 * The write-side rule is deliberately narrow: a forming bar is always the NEWEST, so restricting to
 * it means a refresh can never remove a settled row. That is right for a WRITER.
 *
 * A READER has the opposite requirement. The 205 duplicates already in the store are **historical**,
 * and a backtest walking a daily series will happily trade a **Friday that never existed** — 166 of
 * the 205 are Friday, on a series stamped by session OPEN where there is no Friday session at all.
 * Restricting to the newest would leave every one of them in the replay.
 *
 * ⚠️ It is NOT wired into live scoring, and must not be. Removing a bar from a directive's window
 * changes what a tradeable symbol scores — a maths change. The exclusion belongs on the
 * backtest/replay read path only.
 *
 * @returns `{ bars, dropped }` — the dropped count is returned so a caller can surface it rather
 *          than a replay silently running on a different series than the store holds.
 */
export function dropConsecutiveDuplicates<T extends OhlcvBar>(bars: T[]): { bars: T[]; dropped: T[] } {
  if (!Array.isArray(bars) || bars.length < 2) return { bars: bars ?? [], dropped: [] };
  const out: T[] = [bars[0]];
  const dropped: T[] = [];
  for (let i = 1; i < bars.length; i += 1) {
    const prev = out[out.length - 1];
    const cur = bars[i];
    // Same timestamp is a different fault — keep both, exactly as the write-side rule does.
    if (String(cur.timestamp) !== String(prev.timestamp) && isSameOhlcv(cur, prev)) {
      dropped.push(cur);
      continue;
    }
    out.push(cur);
  }
  return { bars: out, dropped };
}

/**
 * The same rule as a predicate over an ALREADY-SORTED series — for a caller that wants to report
 * how many it would remove without building a second array.
 */
export function countConsecutiveDuplicates(bars: OhlcvBar[]): number {
  return dropConsecutiveDuplicates(bars).dropped.length;
}

/**
 * Drop the newest bar when it merely repeats the previous one — the WRITE-SIDE rule (#1049).
 *
 * Only the newest, and only on exact equality of open, high, low, close AND volume. Three reasons
 * this is safe where a general "drop duplicates anywhere" rule would not be:
 *
 *   1. A forming bar is ALWAYS the newest, so restricting to it cannot delete a historical row.
 *   2. Exact equality on all FIVE fields is required, so a genuinely quiet session (which still has
 *      its own tick volume) is never mistaken for one.
 *   3. When the market is OPEN the forming bar moves, so the rule cannot fire — it only ever applies
 *      to the one condition it is meant to describe.
 *
 * ⚠️ For a READER wanting the historical duplicates gone, use `dropConsecutiveDuplicates()` instead.
 *
 * @returns `{ bars, dropped }` — `dropped` is the rejected bar (or `null`), so the caller can name it
 *          in a log line instead of the rejection being invisible.
 */
export function dropFormingDuplicate<T extends OhlcvBar>(bars: T[]): { bars: T[]; dropped: T | null } {
  if (!Array.isArray(bars) || bars.length < 2) return { bars: bars ?? [], dropped: null };
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  // ⚠️ The timestamps must DIFFER. Two rows at the SAME timestamp are a different fault (a provider
  // repeating an entry), and dropping one of them would change the set's cardinality for a reason
  // this rule does not describe.
  if (String(last.timestamp) === String(prev.timestamp)) return { bars, dropped: null };
  if (!isSameOhlcv(last, prev)) return { bars, dropped: null };
  return { bars: bars.slice(0, -1), dropped: last };
}
