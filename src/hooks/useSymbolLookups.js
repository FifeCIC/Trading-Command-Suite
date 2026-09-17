/**
 * useSymbolLookups() — per-symbol company info and open positions, keyed for lookup.
 * =================================================================================
 * Extracted from `LadderPage.jsx` (2026-09-17) so the META.Stack Cockpit's Scores column
 * can render the same "Details" footer column without a second copy of this indexing.
 *
 * Both results are indexed by UPPERCASE symbol because that is the only key that agrees
 * across sources: a scoring run records `ticker`, the symbol table records `ticker`, and a
 * position records `symbol` — and they are not guaranteed to be the same case. Keying on
 * the raw value would silently miss, and a missing lookup renders as an absent column
 * rather than an error, which is the kind of quiet wrong answer this repo has been bitten
 * by before.
 *
 * ⚠️ Both queries run UNCONDITIONALLY, even when nothing consumes them yet, so the card
 * footer has data on FIRST PAINT instead of filling in a frame later. Do not add `enabled`
 * based on whether cards have rendered — that reintroduces the empty-then-populate flash.
 *
 * ⚠️ Query keys are shared with the Ladder on purpose: visiting both pages costs ONE
 * request each, not two.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';

export function useSymbolLookups() {
  const posQuery = useQuery({
    queryKey: ['symbols-positions'],
    queryFn: () => apiGet('/api/symbols/positions'),
    staleTime: 60_000,
  });
  const positionBySymbol = useMemo(() => {
    const m = {};
    (Array.isArray(posQuery.data?.positions) ? posQuery.data.positions : [])
      .forEach((p) => { if (p?.symbol) m[String(p.symbol).toUpperCase()] = p; });
    return m;
  }, [posQuery.data]);

  const metaQuery = useQuery({
    queryKey: ['all-symbols-meta'],
    queryFn: () => apiGet('/api/symbols').catch(() => ({ symbols: [] })),
    staleTime: 120_000,
  });
  const symbolMeta = useMemo(() => {
    const m = {};
    (Array.isArray(metaQuery.data?.symbols) ? metaQuery.data.symbols : [])
      .forEach((s) => { if (s?.ticker) m[String(s.ticker).toUpperCase()] = s; });
    return m;
  }, [metaQuery.data]);

  return { positionBySymbol, symbolMeta };
}
