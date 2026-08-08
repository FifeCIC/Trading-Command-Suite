/**
 * useProtocolData — Shared hook for protocol ladder/performance pages.
 * =====================================================================
 * Fetches and merges protocols + scoring runs into a consistent shape.
 * Uses protocolId (not legacy strategyName) for grouping.
 *
 * Returns:
 *   { protocols, runs, protocolMap, isLoading }
 *
 * protocolMap: { [protocolId]: { name, active, tradingStyle, ... } }
 *
 * @created 2026-08-08 — extracted from SymbolsLadderPage + ProtocolsLadderPage
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet } from './api/client';

export function useProtocolData() {
  const protocolsQuery = useQuery({
    queryKey: ['protocol-data-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols').catch(() => ({ protocols: [] })),
    staleTime: 60_000,
  });

  const runsQuery = useQuery({
    queryKey: ['protocol-data-runs'],
    queryFn: () => apiGet('/api/scoring/runs?limit=200&groupBy=protocol').catch(() => ({ runs: [] })),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const protocols = useMemo(() => {
    const raw = protocolsQuery.data?.protocols || [];
    const seen = new Set();
    return raw.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });
  }, [protocolsQuery.data]);

  const runs = useMemo(() => runsQuery.data?.runs || [], [runsQuery.data]);

  /** Map protocolId → proper protocol name + metadata */
  const protocolMap = useMemo(() => {
    const map = {};
    for (const p of protocols) {
      map[p.id] = {
        name: p.name || p.id,
        active: p.active !== false,
        tradingStyle: p.tradingStyle,
        directiveCount: p.directiveCount,
      };
    }
    return map;
  }, [protocols]);

  /** Get a display name: prefer protocol name from registry, fall back to protocolId */
  function protoName(protocolId) {
    if (!protocolId) return '—';
    return protocolMap[protocolId]?.name || protocolId;
  }

  const isLoading = protocolsQuery.isLoading || runsQuery.isLoading;

  return { protocols, runs, protocolMap, protoName, isLoading };
}
