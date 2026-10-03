/**
 * useHiddenViews — the owner's "hide now" verdicts, as view IDs.
 *
 * ⚠️ WHY THIS EXISTS. The Page Walkthrough (`/development/ui-review`) recorded `hide: true` on five
 * pages on 2026-10-02 and **nothing consumed it**. Traced every reader of
 * `/api/system/settings/ui-review`: the settings service/controller, the walkthrough page itself, and
 * two documentation strings. The verdicts were being STORED and never APPLIED — so "hide now" had no
 * effect on the app at all. This hook is the missing consumer.
 *
 * ⚠️ IT FAILS OPEN, DELIBERATELY. A failed or absent fetch returns an empty set, so nothing is
 * hidden. Hiding is a curation convenience, not a gate: if the store cannot be read, showing a page
 * the owner wanted hidden is recoverable, whereas hiding pages because a request failed is not.
 *
 * Entries are keyed by full route (`/lab/timeline`); the nav filters by view ID (`timeline`), so the
 * last path segment is what goes into the set.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import { hiddenViewIdsFrom } from '../edition-nav.js';

export function useHiddenViews() {
  const { data } = useQuery({
    queryKey: ['ui-review-hidden'],
    queryFn: () => apiGet('/api/system/settings/ui-review').catch(() => null),
    staleTime: 60_000,
  });

  // Memoised: a fresh Set each render would retrigger every consumer's dependency on it.
  return useMemo(() => hiddenViewIdsFrom(data), [data]);
}
