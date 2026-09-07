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
 * Keys: 'all' | 'active' | 'trading' | 'scoring' | 'faulty' (unknown → 'all').
 */
export function filterStrategies(list, filter) {
  const arr = Array.isArray(list) ? list : [];
  switch (filter) {
    case 'active': return arr.filter(isActiveStrategy);
    case 'trading': return arr.filter(isTradingStrategy);
    case 'scoring': return arr.filter(isScoringStrategy);
    case 'faulty': return arr.filter(isFaultyStrategy);
    default: return arr;
  }
}
