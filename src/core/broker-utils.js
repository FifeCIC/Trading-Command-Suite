/**
 * Broker utilities — Single source of truth for broker capability data.
 * =====================================================================
 * All broker metadata comes from GET /api/brokers (DB-backed).
 * No hardcoded broker maps in individual pages.
 *
 * @see src/pages/StrategyCreatePage.jsx
 * @see src/pages/StrategyCreatePage.jsx
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet } from './api/client';

/** Shared TanStack Query hook for broker capabilities */
export function useBrokers() {
  const query = useQuery({
    queryKey: ['shared-brokers'],
    queryFn: () => apiGet('/api/brokers').catch(() => ({ brokers: [] })),
    staleTime: 300_000, // 5 min — broker config rarely changes
  });
  const brokers = useMemo(() => query.data?.brokers || [], [query.data]);
  const brokerMap = useMemo(() => {
    const map = {};
    for (const b of brokers) map[b.id] = b;
    return map;
  }, [brokers]);
  return { brokers, brokerMap, ...query };
}

/** Protocol trading style → default risk parameters */
export const STYLE_DEFAULTS = {
  scalp:      { baseSize: 0.01, slPct: 0.3, tpPct: 0.5, minComposite: 70, timeframe: '5s' },
  'day-trade': { baseSize: 0.02, slPct: 0.5, tpPct: 1.0, minComposite: 65, timeframe: '5m' },
  speed:      { baseSize: 0.01, slPct: 0.2, tpPct: 0.4, minComposite: 75, timeframe: '15s' },
  swing:      { baseSize: 0.05, slPct: 1.5, tpPct: 3.0, minComposite: 60, timeframe: '1h' },
  position:   { baseSize: 0.1, slPct: 3.0, tpPct: 6.0, minComposite: 55, timeframe: '1d' },
};
