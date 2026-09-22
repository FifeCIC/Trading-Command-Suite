/**
 * symbol-positions.js — the ONE place that turns `/api/symbols/positions` into a lookup.
 *
 * WHY THIS EXISTS
 * ---------------
 * SymbolsBrowserPage and ActiveSymbolsPage both render a per-symbol position/P&L column. Each had
 * its own `Object.fromEntries(rows.map(p => [p.symbol.toUpperCase(), p]))` plus its own null
 * handling, and they were reading from DIFFERENT endpoints:
 *
 *   SymbolsBrowserPage  /api/symbols/positions      → 32 positions, ALL providers (MT5 + Trading212)
 *   ActiveSymbolsPage   /api/portfolio?source=mt5   →  5 positions, MT5 ONLY
 *
 * So the same column, on two pages, silently answered different questions — and the Active Symbols
 * page could not see any of the 24 stock positions. Measured 2026-09-22.
 *
 * Both pages now read `/api/symbols/positions` through this module. If a third page needs per-symbol
 * holdings, it must use this too — a second parser is how the two answers diverge again.
 *
 * ⚠️ `pnl` here is UNREALISED P&L on a currently-held position. It is NOT the same number as
 * historical/realised P&L, which lives in `PnlReport.bySymbol` (`/api/scoring/edge/pnl`) and is
 * quarantine-filtered. Do not present one as the other.
 */

/** React-Query key — shared so both pages hit one cache entry rather than two requests. */
export const POSITIONS_QUERY_KEY = ['symbols-positions'];

/** How often to re-read positions. Positions change on trade events, not on a clock. */
export const POSITIONS_REFETCH_MS = 60_000;

/**
 * Index position rows by upper-cased ticker.
 *
 * Tickers arrive already upper-cased, but sessions were being keyed by `.toUpperCase()` on the
 * symbol side anyway — normalising here means a caller cannot forget and get silent misses.
 */
export function indexPositionsByTicker(rows) {
  if (!Array.isArray(rows)) return {};
  const index = {};
  for (const p of rows) {
    const key = String(p?.symbol ?? '').toUpperCase();
    if (key) index[key] = p;
  }
  return index;
}

/** Look a symbol up by its ticker. Returns `null` when there is no holding. */
export function positionForTicker(index, ticker) {
  if (!index || !ticker) return null;
  return index[String(ticker).toUpperCase()] ?? null;
}

/**
 * Tone for a P&L value.
 *
 * ⚠️ Returns `null` — not 'neutral' — when the value is absent. A caller must render that as
 * "unknown" (`—` or `?`), never as a zero-ish or break-even style. "We have no reading" and
 * "the reading is zero" are different claims and this repo has paid for conflating them twice.
 */
export function pnlTone(pnl) {
  if (pnl == null || !Number.isFinite(Number(pnl))) return null;
  return Number(pnl) >= 0 ? 'pos' : 'neg';
}
