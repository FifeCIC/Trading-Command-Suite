/**
 * Strategy classification — single source of truth.
 * ==================================================
 * These predicates decide what "an active / trading / scoring / faulty
 * strategy" means. `StrategiesListPage` and `StrategyMonitorPage` (and any
 * future view) MUST import from here rather than re-implementing inline
 * filters — a strategy's classification must not drift between pages.
 */

/** Active = not explicitly disabled. */
export function isActiveStrategy(s) {
  return s?.active !== false;
}

/**
 * Disabled = explicitly switched off (`active === false`).
 *
 * ⚠️ THE EXACT INVERSE OF `isActiveStrategy`, and deliberately written as such rather than as its
 * own rule. `active` is the column the kill-switch writes (POST /api/trading/strategies/:id/toggle),
 * so "disabled" must be the complement of "active" or the two filters could both miss or both show
 * a bot. Do not add a second condition here (e.g. ALSO requiring `dataStatus`), or the filter
 * chips stop partitioning the fleet.
 */
export function isDisabledStrategy(s) {
  return s?.active === false;
}

/** Trading = explicitly mode 'trade', or has an assigned symbol. */
export function isTradingStrategy(s) {
  return s?.mode === 'trade' || Boolean(s?.symbol);
}

/** Scoring = explicitly mode 'score', or has a linked watchlist. */
export function isScoringStrategy(s) {
  return s?.mode === 'score' || Boolean(s?.watchlistName);
}

/** Faulty = has a dataStatus that isn't 'ready' (e.g. pending_bars / blocked). */
export function isFaultyStrategy(s) {
  return Boolean(s?.dataStatus) && s?.dataStatus !== 'ready';
}

/**
 * Apply a filter key to a strategy list.
 * Keys: 'all' | 'active' | 'disabled' | 'trading' | 'scoring' | 'faulty' (unknown → 'all').
 */
export function filterStrategies(list, filter) {
  const arr = Array.isArray(list) ? list : [];
  switch (filter) {
    case 'active': return arr.filter(isActiveStrategy);
    case 'disabled': return arr.filter(isDisabledStrategy);
    case 'trading': return arr.filter(isTradingStrategy);
    case 'scoring': return arr.filter(isScoringStrategy);
    case 'faulty': return arr.filter(isFaultyStrategy);
    default: return arr;
  }
}

/**
 * matchesBotSearch(strategy, query) — free-text match for the bot registry.
 *
 * ⚠️ IT MATCHES WHAT THE ROW RENDERS, not a fixed list of API fields. A search that cannot find a
 * word the user can SEE on screen reads as broken, and that is the defect this guards. Watchlists
 * are matched from `watchlists[].name` because `watchlistName` does not exist on this payload —
 * the column was rendering `—` on every row (measured 2026-11-04) and searching it would have
 * found nothing at all.
 *
 * `active` / `disabled` are included as WORDS so "disabled" narrows to the switched-off fleet,
 * which is the same partition the filter chips offer. Space-separated terms are ANDed, so
 * "gold disabled" narrows rather than widening.
 *
 * Pure — no React, no DOM — so it is trivially testable and safe to call per keystroke.
 */
export function matchesBotSearch(s, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const subs = Array.isArray(s?.protocols) ? s.protocols : [];
  const watchlists = Array.isArray(s?.watchlists) ? s.watchlists : [];
  const haystack = [
    s?.name,
    s?.symbol,
    s?.mode,
    s?.brokerId,
    s?.protocolId,
    s?.watchlistName,
    ...subs.map((x) => x?.protocolId),
    ...watchlists.map((w) => (typeof w === 'string' ? w : w?.name)),
    s?.active === false ? 'disabled' : 'active',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}
