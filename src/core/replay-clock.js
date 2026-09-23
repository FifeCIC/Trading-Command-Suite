/**
 * replay-clock.js — the deterministic half of the backtest replay view (#819).
 * ============================================================================
 *
 * WHY THIS IS A SEPARATE PURE MODULE
 * ----------------------------------
 * "Watch the pipeline trade, bar by bar" is a claim about ORDER and TIME, and both are easy to
 * get subtly wrong in a component: an entry shown before its exit, a win counted while the trade
 * is still open, a win rate of 0% when nothing has closed yet. Keeping the clock pure means those
 * questions are answered by a test rather than by watching the screen.
 *
 * ⚠️ THE TWO THINGS THIS REFUSES TO PRETEND
 * -----------------------------------------
 * 1. **An open trade is not a result.** A trade whose entry is visible but whose exit is not yet
 *    visible counts in `open`, never in `wins`, `losses` or `winRatePct`. A running summary that
 *    counted it would show a win rate that moves for reasons unrelated to performance.
 * 2. **"No closed trades yet" is not 0%.** `winRatePct` is `null` until at least one trade has
 *    closed — absence of information, not a bad score. (Repo doctrine: an empty list and a failed
 *    query must never render the same.)
 *
 * The only data this needs is what `GET /api/backtest/replay/:runId` returns; it never invents a
 * row that the run did not record.
 */

/** Playback speeds. `instant` shows the whole run without scheduling. */
export const REPLAY_SPEEDS = [1, 10, 100, 'instant'];

/** Base tick: at 1×, one event is revealed per this many milliseconds. */
export const BASE_STEP_MS = 900;

export function stepMsFor(speed) {
  if (speed === 'instant') return 0;
  return Math.max(20, Math.round(BASE_STEP_MS / speed));
}

/**
 * buildReplayEvents(trades) → one ENTRY and one EXIT event per trade, in time order.
 *
 * ⚠️ A trade whose exit precedes its entry (or which has no usable timestamps) is dropped rather
 * than reordered: the view would otherwise draw a shape the run never had. The count is reported
 * by `summarise` as `unusable` so it cannot vanish silently.
 */
export function buildReplayEvents(trades = []) {
  const events = [];
  const unusable = [];
  for (const t of trades) {
    const entry = Date.parse(t.entryTime);
    const exit = Date.parse(t.exitTime);
    if (!Number.isFinite(entry) || !Number.isFinite(exit) || exit < entry) {
      unusable.push(t.id);
      continue;
    }
    events.push({ kind: 'entry', at: entry, time: t.entryTime, trade: t });
    events.push({ kind: 'exit', at: exit, time: t.exitTime, trade: t });
  }
  events.sort((a, b) => a.at - b.at || (a.kind === 'entry' ? -1 : 1));
  return { events, unusable };
}

/** The number of events revealed at `cursor` (clamped to the run). */
export function clampCursor(cursor, eventCount) {
  if (cursor === 'instant') return eventCount;
  return Math.max(0, Math.min(cursor, eventCount));
}

/**
 * summarise({events, unusable}, cursor) — the running summary AS AT this cursor.
 * Closed trades contribute realised P&L; open trades contribute only to `open`.
 */
export function summarise({ events = [], unusable = [] }, cursor) {
  const shown = clampCursor(cursor, events.length);
  const openIds = new Set();
  let wins = 0;
  let losses = 0;
  let flat = 0;
  let realisedPnl = 0;

  for (let i = 0; i < shown; i++) {
    const e = events[i];
    if (e.kind === 'entry') {
      openIds.add(e.trade.id);
      continue;
    }
    openIds.delete(e.trade.id);
    const pnl = Number(e.trade.pnl);
    if (!Number.isFinite(pnl)) continue;
    realisedPnl += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
    else flat++;
  }

  const closed = wins + losses + flat;
  return {
    eventsShown: shown,
    eventsTotal: events.length,
    taken: new Set(events.slice(0, shown).filter((e) => e.kind === 'entry').map((e) => e.trade.id)).size,
    open: openIds.size,
    closed,
    wins,
    losses,
    flat,
    realisedPnl: Number(realisedPnl.toFixed(4)),
    // null, never 0 — nothing has closed yet (see the module header).
    winRatePct: closed === 0 ? null : Number(((wins / closed) * 100).toFixed(1)),
    unusable: unusable.length,
  };
}

/** The rows for the list: revealed trades, newest first so the eye stays at the top. */
export function visibleRows(replay, cursor) {
  const { events } = buildReplayEvents(replay?.trades ?? []);
  const shown = clampCursor(cursor, events.length);
  const byId = new Map();
  for (let i = 0; i < shown; i++) {
    const e = events[i];
    const row = byId.get(e.trade.id) ?? { trade: e.trade, entered: false, exited: false };
    if (e.kind === 'entry') row.entered = true;
    else row.exited = true;
    byId.set(e.trade.id, row);
  }
  return [...byId.values()].reverse();
}

/** Filters the spec asks for. An unset filter is not a filter (never "match nothing"). */
export function filterTrades(trades = [], { direction, signal, exitReason } = {}) {
  return trades.filter((t) => {
    if (direction && t.direction !== direction) return false;
    if (signal && t.signal !== signal) return false;
    if (exitReason && t.exitReason !== exitReason) return false;
    return true;
  });
}
