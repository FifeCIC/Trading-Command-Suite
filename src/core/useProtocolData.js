/**
 * useProtocolData — Shared hook for protocol ladder/performance pages.
 * =====================================================================
 * Fetches and merges protocols + scoring runs into a consistent shape.
 * Uses protocolId (not legacy strategyName) for grouping.
 *
 * Returns:
 *   { protocols, runs, protocolMap, protoName, isLoading, isError, error, loaded, retry }
 *
 * protocolMap: { [protocolId]: { name, active, tradingStyle, ... } }
 *
 * ── ⚠️ A FAILED FETCH MUST NOT RESOLVE TO AN EMPTY LIST (#782) ──────────────────────────────────
 * Both queryFns used to end `.catch(() => ({ protocols: [] }))`, which threw away the status and the
 * server's message that `apiGet` had carefully attached. Three things followed, all measured:
 *
 *   1. the page rendered **"No active protocols."** — a confident factual claim about the registry —
 *      when the truth was "I could not ask";
 *   2. react-query recorded a **SUCCESS**, so `isError`, `error` and the retry policy never engaged;
 *   3. the empty list **destroyed the saved selection**, because `LadderPage` pruned the stored ids
 *      against it (defect 2 in the same issue). One transient 502 during an API restart was enough.
 *
 * `loaded` and `isError` are exposed for exactly that reason: a caller that prunes user data must be
 * able to tell "there are none" from "I have no answer yet".
 *
 * @created 2026-08-08 — extracted from SymbolsLadderPage + ProtocolsLadderPage
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet } from './api/client';

export function useProtocolData() {
  const protocolsQuery = useQuery({
    queryKey: ['protocol-data-protocols'],
    queryFn: () => apiGet('/api/scoring/gated/protocols'),
    staleTime: 60_000,
  });

  const runsQuery = useQuery({
    queryKey: ['protocol-data-runs'],
    queryFn: () => apiGet('/api/scoring/runs?limit=200&groupBy=protocol'),
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

  /**
   * ⚠️ `loaded` IS THE ONE A CALLER MUST USE BEFORE PRUNING (#782 defect 2). It is true only when the
   * protocol list has actually arrived; `isLoading === false` is NOT the same thing, because a failed
   * query is also not loading. An empty `protocols` with `loaded: false` means "no answer", and a
   * caller that treats that as "none exist" deletes the user's stored selection.
   */
  const loaded = protocolsQuery.isSuccess;
  const isError = protocolsQuery.isError || runsQuery.isError;
  const error = protocolsQuery.error ?? runsQuery.error ?? null;

  return {
    protocols,
    runs,
    protocolMap,
    protoName,
    isLoading,
    loaded,
    isError,
    error,
    /** Retry the failed query — the honest alternative to a fabricated empty list. */
    retry: () => {
      if (protocolsQuery.isError) protocolsQuery.refetch();
      if (runsQuery.isError) runsQuery.refetch();
    },
  };
}
