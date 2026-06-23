import { useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Fetch all starred items (optionally filtered by type).
 */
async function fetchStars(types) {
  const params = new URLSearchParams();
  if (types?.length) {
    types.forEach((t) => params.append('type', t));
  }
  const url = `/api/stars${params.toString() ? '?' + params : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch stars');
  return res.json();
}

/**
 * Toggle a star on/off. Returns { starred: true/false }.
 */
async function toggleStar({ itemType, itemId }) {
  const res = await fetch('/api/stars/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemType, itemId }),
  });
  if (!res.ok) throw new Error('Toggle failed');
  return res.json();
}

/**
 * Hook: get all stars, optionally filtered.
 */
export function useStars(types) {
  return useQuery({
    queryKey: ['stars', types],
    queryFn: () => fetchStars(types),
    staleTime: 30_000,
  });
}

/**
 * Hook: get starred IDs for a single item type.
 * Returns a Set<string> of itemIds.
 */
export function useStarredIds(itemType) {
  const { data } = useStars([itemType]);
  const ids = data?.byType?.[itemType] || [];
  return new Set(ids);
}

/**
 * Hook: toggle mutation with optimistic cache update.
 */
export function useToggleStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleStar,
    onMutate: async ({ itemType, itemId }) => {
      // Cancel in-flight queries so they don't overwrite optimistic update
      await queryClient.cancelQueries({ queryKey: ['stars'] });

      const prev = queryClient.getQueryData(['stars']);

      queryClient.setQueryData(['stars'], (old) => {
        const byType = { ...(old?.byType || {}) };
        const current = byType[itemType] || [];
        const isStarred = current.includes(itemId);

        if (isStarred) {
          byType[itemType] = current.filter((id) => id !== itemId);
        } else {
          byType[itemType] = [...current, itemId];
        }

        return { ...old, byType };
      });

      return { prev };
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.prev) {
        queryClient.setQueryData(['stars'], context.prev);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['stars'] });
    },
  });
}

/**
 * Hook: check if a single item is starred.
 */
export function useIsStarred(itemType, itemId) {
  const { data } = useStars([itemType]);
  const ids = data?.byType?.[itemType] || [];
  return ids.includes(itemId);
}

/**
 * Hook: sort an array by starred status (starred first).
 */
export function useSortByStars(items, itemType, idAccessor = 'id') {
  const starredIds = useStarredIds(itemType);

  return useCallback(
    (list) => {
      if (!list) return [];
      return [...list].sort((a, b) => {
        const aId = typeof idAccessor === 'function' ? idAccessor(a) : a[idAccessor];
        const bId = typeof idAccessor === 'function' ? idAccessor(b) : b[idAccessor];
        const aStar = starredIds.has(aId) ? 1 : 0;
        const bStar = starredIds.has(bId) ? 1 : 0;
        return bStar - aStar; // starred first
      });
    },
    [starredIds, itemType, idAccessor],
  );
}
