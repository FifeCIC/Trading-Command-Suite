/**
 * useFreshness — triggers data refresh on page-open for a symbol.
 *
 * Usage:
 *   const { status, refresh } = useFreshness('AAPL');
 *
 * Returns:
 *   - status: 'fresh' | 'stale' | 'missing' | 'loading'
 *   - details: per-type freshness breakdown
 *   - refresh(): manually trigger a refresh
 *   - isStale: boolean convenience flag
 */

import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPost } from '../core/api/client';

interface FreshnessType {
  symbolId: string;
  ticker?: string;
  timeframe: string;
  status: 'fresh' | 'stale' | 'missing';
  latestTimestamp: string | null;
  ageMinutes: number | null;
}

interface OverallFreshness {
  symbolId: string;
  ticker?: string;
  status: 'fresh' | 'stale' | 'missing';
  types: Record<string, FreshnessType>;
  recommendation: string;
}

export function useFreshness(symbolId: string | null) {
  const [status, setStatus] = useState<'fresh' | 'stale' | 'missing' | 'loading'>('loading');
  const [details, setDetails] = useState<OverallFreshness | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = useCallback(async () => {
    if (!symbolId) {
      setStatus('missing');
      return;
    }
    setStatus('loading');
    try {
      const data: OverallFreshness = await apiGet(`/api/market-data/freshness/${symbolId}/overall`);
      setStatus(data.status);
      setDetails(data);
      setLastChecked(new Date());
    } catch {
      setStatus('missing');
      setDetails(null);
    }
  }, [symbolId]);

  // Auto-check on mount and when symbolId changes
  useEffect(() => {
    check();
  }, [check]);

  // Manual refresh triggers
  const refreshPrices = useCallback(async () => {
    if (!symbolId) return;
    try {
      await apiPost('/api/market-data/prices/refresh');
      await check();
    } catch { /* ignore */ }
  }, [symbolId, check]);

  return {
    status,
    details,
    lastChecked,
    isStale: status === 'stale' || status === 'missing',
    refresh: check,
    refreshPrices,
  };
}
