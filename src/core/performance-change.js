/**
 * performance-change.js — shared period-over-period maths.
 * ============================================================================
 *
 * ── WHY THIS IS A MODULE AND NOT COPIED INTO EACH PAGE ───────────────────────────────────────
 * The "performance change" view is used by more than one surface (the Development page and, from
 * 2026-09-28, the single-symbol page). This repo's most-repeated lesson is that a second
 * implementation is the most expensive kind of debt: both copies drift and only one gets the next
 * fix. The window arithmetic below is exactly the kind that would drift silently — a change to how
 * `null` is handled would be made in one copy and not the other, and the two surfaces would then
 * disagree about the same account without either being obviously wrong.
 *
 * ── THE ONE INVARIANT ────────────────────────────────────────────────────────────────────────
 * ⚠️ `previous` is `null` when the prior window holds NO trades, and that must never be treated as
 * a P&L of 0. `0` asserts "the prior period produced nothing" — a claim about the market. `null`
 * says "we could not measure it". Callers must render the two differently; `ChangeStat` does, and
 * is the intended consumer.
 */

export const DAY_MS = 86_400_000;

/** Parse a date that may arrive as an ISO string or a number. Returns null when unreadable. */
export function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

export const money = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}£${Math.abs(v).toFixed(2)}`);
export const pct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`);

/**
 * Split an entity's trades into the recent window and the equal-length window immediately before it.
 *
 * ⚠️ `previous: null` when the prior window has no trades. See the module header — this is the
 * whole reason the module exists.
 */
export function splitWindows(trades, windowMs, nowMs) {
  const recentFrom = nowMs - windowMs;
  const priorFrom = nowMs - windowMs * 2;

  const recent = [];
  const prior = [];
  for (const t of trades) {
    const ts = toMs(t.closedAt);
    if (ts == null) continue;
    if (ts >= recentFrom) recent.push(t);
    else if (ts >= priorFrom) prior.push(t);
  }

  const sum = (arr) => arr.reduce((a, t) => a + (Number(t.pnl) || 0), 0);
  const wins = (arr) => arr.filter((t) => (Number(t.pnl) || 0) > 0).length;

  return {
    recentCount: recent.length,
    priorCount: prior.length,
    // A window with no trades yields null, not 0. Both branches say so explicitly.
    current: recent.length ? sum(recent) : null,
    previous: prior.length ? sum(prior) : null,
    recentWinRate: recent.length ? (wins(recent) / recent.length) * 100 : null,
    priorWinRate: prior.length ? (wins(prior) / prior.length) * 100 : null,
  };
}

/**
 * Weekly P&L buckets, oldest → newest, for a sparkline.
 *
 * ⚠️ A week with NO trades is dropped rather than plotted as 0. Plotting it would draw a false
 * floor — a week the bot was switched off would read as a week of flat performance.
 */
export function weeklySeries(trades, weeks, nowMs) {
  const buckets = new Array(weeks).fill(0);
  const counts = new Array(weeks).fill(0);
  for (const t of trades) {
    const ts = toMs(t.closedAt);
    if (ts == null) continue;
    const weeksAgo = Math.floor((nowMs - ts) / (DAY_MS * 7));
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    const idx = weeks - 1 - weeksAgo;
    buckets[idx] += Number(t.pnl) || 0;
    counts[idx] += 1;
  }
  const out = [];
  for (let i = 0; i < weeks; i++) if (counts[i] > 0) out.push(buckets[i]);
  return out;
}

/** Group trades by a key function, skipping rows whose key is empty. */
export function groupBy(trades, keyFn) {
  const map = new Map();
  for (const t of trades) {
    const k = keyFn(t);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return map;
}

/**
 * Pull the trade array out of whatever shape the history endpoint returned.
 * Accepts a bare array, or `{trades: []}` / `{data: []}`. Always returns an array.
 */
export function asTradeList(raw) {
  const list = Array.isArray(raw) ? raw : (raw?.trades || raw?.data || []);
  return Array.isArray(list) ? list : [];
}
