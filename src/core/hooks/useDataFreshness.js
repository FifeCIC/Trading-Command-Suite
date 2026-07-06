/**
 * useDataFreshness — page-open auto-refresh hook.
 *
 * Calls the freshness API on mount and auto-triggers a price refresh
 * when data is stale. Provides a status object for UI indicators.
 *
 * Usage:
 *   const { checking, stale, lastRefresh } = useDataFreshness({ symbols: ['AAPL','NVDA'] });
 */
import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost } from '../api/client';

const STALE_THRESHOLD_MINUTES = 15;

export function useDataFreshness({ symbols = [], enabled = true } = {}) {
  const [checking, setChecking] = useState(false);
  const [stale, setStale] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [freshnessStatus, setFreshnessStatus] = useState({});
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!enabled || symbols.length === 0) return;

    let cancelled = false;
    const run = async () => {
      setChecking(true);
      try {
        // 1. Check freshness
        const fresh = await apiPost('/api/market-data/freshness/batch', {
          symbols: symbols.slice(0, 50),
          timeframe: '1m',
        }).catch(() => null);

        if (cancelled || !mountedRef.current) return;

        const statusMap = {};
        let hasStale = false;
        if (fresh?.results) {
          for (const r of fresh.results) {
            statusMap[r.symbolId || r.ticker] = r.status;
            if (r.status === 'stale' || r.status === 'missing') hasStale = true;
          }
        }
        setFreshnessStatus(statusMap);
        setStale(hasStale);

        // 2. If stale, trigger refresh
        if (hasStale) {
          const result = await apiPost('/api/market-data/refresh', {
            symbols,
          }).catch(() => null);

          if (cancelled || !mountedRef.current) return;

          if (result?.refreshed?.length > 0) {
            setLastRefresh(new Date().toISOString());
          }
        }
      } catch {
        // Silently fail — freshness is optional
      } finally {
        if (!cancelled && mountedRef.current) setChecking(false);
      }
    };

    // Delay by 500ms to let critical data load first
    const timer = setTimeout(run, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, ...symbols]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    checking,
    stale,
    lastRefresh,
    freshnessStatus,
    /** Manually trigger a refresh */
    refresh: async () => {
      setChecking(true);
      try {
        await apiPost('/api/market-data/refresh', { symbols });
        setLastRefresh(new Date().toISOString());
        setStale(false);
      } finally {
        setChecking(false);
      }
    },
  };
}
