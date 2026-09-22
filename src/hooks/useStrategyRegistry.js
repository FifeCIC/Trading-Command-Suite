/**
 * useStrategyRegistry — the #875 registry overlay, shared by the strategies surfaces.
 * ==================================================================================
 * Extracted 2026-09-22 with the A/B Strategies page: both pages ran the same query + the same
 * byKey/drift overlay memo. One implementation also means ONE cache key (`['strategies',
 * 'registry']`), so the two pages cannot disagree about a strategy's name or drift status.
 *
 * A failure here must NOT blank a page — identities are an OVERLAY, not the data — so the query
 * swallows its error into an empty overlay and cards simply render "Not registered".
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

/** #875 — names/ids/drift. NEVER under `/strategies/` (route collision, per the source page). */
const API_REGISTRY = '/api/scoring/strategy-registry';

export function useStrategyRegistry() {
  const q = useQuery({
    queryKey: ['strategies', 'registry'],
    queryFn: () => apiGet(API_REGISTRY).catch(() => ({ strategies: [] })),
    staleTime: 30_000,
  });

  return useMemo(() => {
    const rows = q.data?.strategies ?? [];
    return {
      rows,
      byKey: new Map(rows.map((r) => [r.strategyKey, r])),
      driftByCurrentKey: new Map(
        rows
          .filter((r) => r.status === 'drifted' && r.current?.strategyKey)
          .map((r) => [r.current.strategyKey, r]),
      ),
      unmaterialised: rows.filter((r) => r.status === 'unmaterialised').length,
    };
  }, [q.data]);
}
