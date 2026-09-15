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

/**
 * Protocol trading style → default RISK parameters (size and SL/TP only).
 *
 * ⚠️ `minComposite` WAS REMOVED FROM THIS TABLE DELIBERATELY (2026-09-15, #839). Do not add it back.
 *
 * It used to carry a strength bar per style — 70 / 65 / 75 / 60 / 55 — a hand-copied duplicate of
 * the backend table in `nest/src/common/utils/style-thresholds.ts`. When that table was rescaled
 * (old ÷ ~6.3, because ADR-011 changed the percentage denominator), THIS copy was missed. So
 * choosing a style in the Create-Strategy form filled in a bar the new scale (~10-33) can never
 * clear, and the created bot never traded.
 *
 * The bar is NOT a frontend concern. There is one owner (the backend table) and one transport for
 * it (`GET /api/scoring/gated/thresholds` → `preTradeGate.byStyle`). The frontend READS the bar
 * from the API — it does not remember it. Two memory sites is exactly how this drifted.
 *
 * Size and SL/TP stay here: they are not capability thresholds, they were never rescaled, and they
 * have no server-side owner to defer to.
 */
export const STYLE_DEFAULTS = {
  scalp:      { baseSize: 0.01, slPct: 0.3, tpPct: 0.5, timeframe: '5s' },
  'day-trade': { baseSize: 0.02, slPct: 0.5, tpPct: 1.0, timeframe: '5m' },
  speed:      { baseSize: 0.01, slPct: 0.2, tpPct: 0.4, timeframe: '15s' },
  swing:      { baseSize: 0.05, slPct: 1.5, tpPct: 3.0, timeframe: '1h' },
  position:   { baseSize: 0.1, slPct: 3.0, tpPct: 6.0, timeframe: '1d' },
};
