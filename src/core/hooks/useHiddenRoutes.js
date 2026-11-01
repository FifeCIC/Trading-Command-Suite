/**
 * useHiddenRoutes — which routes are withheld from navigation.
 *
 * ⚠️ WHY THIS EXISTS. The Page Walkthrough (`/development/ui-review`) recorded `hide: true` on five
 * pages on 2026-10-02 and **nothing consumed it**. Traced every reader of
 * `/api/system/settings/ui-review`: the settings service/controller, the walkthrough page itself, and
 * two documentation strings. The verdicts were being STORED and never APPLIED — so "hide now" had no
 * effect on the app at all. This hook is the missing consumer.
 *
 * ⚠️ ROUTES, NOT VIEW IDS (renamed 2026-11-01 from `useHiddenViews`). A view id is only the last path
 * segment, so `/settings/settings-education` and `/education/settings-education` share one — hiding
 * either removed both. The store was always keyed by full route; the filter now agrees with it.
 *
 * ⚠️ IT FAILS OPEN, DELIBERATELY. A failed or absent fetch still returns `DEFAULT_HIDDEN_ROUTES`,
 * the curated withheld set — never an empty nav. Hiding is curation, not a gate: showing a withheld
 * page is recoverable, hiding pages because a request failed is not.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../api/client';
import { hiddenRoutesFrom } from '../hidden-views.js';

export function useHiddenRoutes() {
  const { data } = useQuery({
    queryKey: ['ui-review-hidden'],
    queryFn: () => apiGet('/api/system/settings/ui-review').catch(() => null),
    staleTime: 60_000,
  });

  // Memoised: a fresh Set each render would retrigger every consumer's dependency on it.
  return useMemo(() => hiddenRoutesFrom(data), [data]);
}
