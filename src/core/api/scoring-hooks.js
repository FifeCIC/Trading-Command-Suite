import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from './client';

/**
 * useGatedScoring — Shared scoring hook for SEES pages.
 * ======================================================
 * Both SeesAdvancedPage and LiveOrderingStackPage use this hook
 * to ensure identical scoring pipeline usage.
 *
 * @param watchlistId  Selected watchlist ID
 * @param protocolId   Selected protocol ID
 * @param symbols      Array of ticker strings from the watchlist
 * @param autoRefresh  If true, polls every 4s
 * @param refreshMs    Polling interval (default 4000)
 */
export function useGatedScoring({
  watchlistId,
  protocolId,
  symbols = [],
  autoRefresh = false,
  refreshMs = 4000,
  queryKeyPrefix = 'gated-scoring',
}) {
  return useQuery({
    queryKey: [queryKeyPrefix, watchlistId, protocolId],
    queryFn: async () => {
      if (!watchlistId || !protocolId) return [];
      const tickers = symbols.map((s) => s.ticker).filter(Boolean);
      if (tickers.length === 0) return [];
      return apiPost('/api/scoring/gated/batch', {
        tickers,
        protocolId,
      }).catch(() => []);
    },
    refetchInterval: autoRefresh ? refreshMs : false,
    enabled: !!watchlistId && !!protocolId && symbols.length > 0,
    staleTime: refreshMs,
  });
}

/**
 * useWatchlists — Fetch all watchlists for the selector.
 */
export function useWatchlists() {
  return useQuery({
    queryKey: ['shared-watchlists'],
    queryFn: () => apiGet('/api/watchlists').catch(() => ({ watchlists: [] })),
    staleTime: 30_000,
  });
}

/**
 * useProtocols — Fetch gated protocols list.
 */
export function useProtocols() {
  return useQuery({
    queryKey: ['shared-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });
}

/**
 * useWatchlistSymbols — Fetch symbols for a specific watchlist.
 */
export function useWatchlistSymbols(watchlistId) {
  return useQuery({
    queryKey: ['shared-watchlist-symbols', watchlistId],
    queryFn: () => apiGet(`/api/watchlists/${watchlistId}`).catch(() => ({ symbols: [] })),
    enabled: !!watchlistId,
    staleTime: 30_000,
  });
}

/**
 * ScoreComparisonResult — Return type for the comparison utility.
 */
export function compareScoreResults(resultA, resultB) {
  if (!resultA?.length || !resultB?.length) {
    return { match: false, differences: [], sharedSymbols: 0 };
  }

  const mapA = new Map(resultA.map((r) => [r.symbol, r]));
  const mapB = new Map(resultB.map((r) => [r.symbol, r]));
  const allSymbols = new Set([...mapA.keys(), ...mapB.keys()]);
  const differences = [];

  let matchCount = 0;
  for (const sym of allSymbols) {
    const a = mapA.get(sym);
    const b = mapB.get(sym);
    if (!a || !b) {
      differences.push({ symbol: sym, reason: 'missing', scoreA: a?.composite ?? null, scoreB: b?.composite ?? null });
      continue;
    }
    const delta = Math.abs((a.composite ?? 0) - (b.composite ?? 0));
    if (delta > 0.5) {
      differences.push({ symbol: sym, reason: 'divergence', scoreA: a.composite, scoreB: b.composite, delta });
    } else {
      matchCount++;
    }
  }

  return {
    match: differences.length === 0,
    differences,
    sharedSymbols: allSymbols.size,
    matchCount,
    divergenceCount: differences.length,
  };
}
