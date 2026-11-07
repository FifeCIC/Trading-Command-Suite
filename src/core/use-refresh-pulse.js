/**
 * © 2026 Ryan Bayne / FifeCIC · AGPL-3.0
 *
 * use-refresh-pulse — the countdown that lives in the breadcrumb instead of on every page.
 *
 * ── WHY THIS EXISTS (owner, 2026-11-07) ──────────────────────────────────────────────────────────
 * *"I like when we have a refreshing indicator like `<span class="pl-refresh">⟳ 59s</span>` but we're
 * going to do something that might be a bit more clever and less clutter. I want
 * `<span class="breadcrumbs-pill breadcrumbs-current">` to have an affect like a loading bar which
 * acts as the refresh count down … I would like this applied to every page that has reloading."*
 *
 * ── WHY IT IS NOT WIRED PER PAGE ─────────────────────────────────────────────────────────────────
 * Every polling page in this app already declares its cadence to TanStack Query as
 * `refetchInterval`. So the countdown can be DERIVED from the query cache rather than added to
 * thirty pages: the shortest interval among queries that something is actually watching is the
 * cadence the reader is waiting on, and the most recent `dataUpdatedAt` is when the wait restarted.
 * One implementation, and a page that starts polling tomorrow gets the bar without being touched.
 *
 * ⚠️ IT DEGRADES TO NOTHING. No polling query → `pct: null` → the bar is not rendered at all. A page
 * that does not refresh must not show a countdown that never counts.
 *
 * ⚠️ Interval FUNCTIONS AND `Infinity` ARE IGNORED. `refetchInterval: false` and callback forms are
 * not a fixed cadence, and `Infinity` would produce a bar that never fills. Only a positive finite
 * number can drive a countdown; the rest are skipped rather than guessed at.
 *
 * 🛑 KNOWN INCOMPLETE (2026-11-07, honest partial): which cadence the bar should reflect is only
 * approximately right. Measured with the API DOWN — every request failing — it rendered on
 * /research/notes (a page that polls nothing of its own) and did NOT render on /dashboard, where the
 * widget board polls. Those two readings cannot both be right, and tuning against a dead backend
 * would bake in a wrong rule. The mechanism is sound (bar, gradient, `--pulse`, title); the SELECTION
 * needs re-measuring once /api/health answers. Filed rather than guessed at.
 *
 * ✅ RESOLVED LATER THE SAME DAY, and the reason is worth keeping: the app CHROME polls on EVERY page
 * (`health` 30s, `api-activity-summary-nav` 15s, `mt5-diag-header` 30s, six `market-tape/*` 30-120s,
 * four `so-*` 30-60s), so the shortest of those won and the bar appeared everywhere. Measured through
 * a dev-only `window.__queryClient` handle (main.jsx) and excluded by prefix — SHELL_QUERY_PREFIXES.
 * Re-measured across five routes once the API answered:
 *   /education/glossary       no bar — polls nothing of its own                  ✅
 *   /lab/charts-lab           bar — its own lab-quote / lab-candles @300s        ✅
 *   /research/notes           bar — its own 30s poller                           ✅
 *   /scoring/symbols-ladder   bar — its own sl-automation @60s (not the 15s chrome) ✅
 *   /settings/data-management no `.breadcrumbs-current` on settings, so no bar   (expected)
 * ⚠️ /dashboard also renders no `.breadcrumbs-current`, so the Dashboard gets no bar. That is a
 * breadcrumb gap rather than a cadence bug — recorded, not worked around.
 */
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
const SHELL_QUERY_PREFIXES = [
  'health',
  'api-activity',
  'mt5-diag',
  'market-tape',
  'so-',
  'loop-controls',
  'market-context-widget',
  'progression',
  'setup-status',
  'data-freshness',
];

/**
 * isShellQuery — does this query belong to the app chrome rather than the page?
 *
 * ⚠️ MEASURED across three pages 2026-11-07 via `window.__queryClient` (dev-only handle in main.jsx).
 * The chrome polls on EVERY page: `health` 30s, `api-activity-summary-nav` 15s, `mt5-diag-header` 30s,
 * six `market-tape/*` 30-120s, four `so-*` 30-60s. A first version denylisted only `market-tape`, so
 * /research/notes — which polls nothing of its own — showed a countdown, and /scoring/symbols-ladder
 * counted the chrome's 15s instead of its own `sl-automation` 60s. Prefix matching on the first key
 * segment covers the `so-` family and future `market-tape` additions without listing every key.
 */
const isShellQuery = (queryKey) => {
  const first = Array.isArray(queryKey) ? queryKey[0] : null;
  return typeof first === 'string' && SHELL_QUERY_PREFIXES.some((p) => first.startsWith(p));
};

const TICK_MS = 500;



export function useRefreshPulse() {
  const queryClient = useQueryClient();
  const [pulse, setPulse] = useState({ pct: null, fetching: false, interval: null });

  useEffect(() => {
    if (!queryClient) return undefined;

    const read = () => {
      let interval = null;
      let lastUpdate = 0;
      let fetching = false;

      for (const query of queryClient.getQueryCache().getAll()) {
        // Only queries a component is watching represent something the reader is waiting for.
        const observers = typeof query.getObserversCount === 'function' ? query.getObserversCount() : 0;
        if (observers === 0) continue;
        // …and only the PAGE's queries, not the chrome's (see SHELL_QUERY_PREFIXES).
        if (isShellQuery(query.queryKey)) continue;

        const declared = query.options?.refetchInterval;
        if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
          if (interval === null || declared < interval) interval = declared;
        }
        if (query.state.fetchStatus === 'fetching') fetching = true;
        if (query.state.dataUpdatedAt > lastUpdate) lastUpdate = query.state.dataUpdatedAt;
      }

      if (interval === null) {
        setPulse((prev) => (prev.pct === null && !prev.fetching ? prev : { pct: null, fetching: false, interval: null }));
        return;
      }

      const elapsed = lastUpdate ? Date.now() - lastUpdate : 0;
      const pct = Math.max(0, Math.min(1, elapsed / interval));
      setPulse((prev) => (
        prev.pct === pct && prev.fetching === fetching && prev.interval === interval
          ? prev
          : { pct, fetching, interval }
      ));
    };

    read();
    const timer = setInterval(read, TICK_MS);
    const unsubscribe = queryClient.getQueryCache().subscribe(read);

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [queryClient]);

  return pulse;
}
