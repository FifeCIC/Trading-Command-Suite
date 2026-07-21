## Summary

The Create Protocols page at `/scoring/create-protocols` is unusable:
1. **Directive Palette shows no directives** — the page loads but the directive palette section is empty
2. **Page takes 30s+ to load or times out** — the `GET /api/directives` endpoint hangs due to slow Score table queries

## Root Cause

The `GET /api/directives` endpoint in `directives.controller.ts` does three sequential DB calls:
1. `getDbStatuses()` — queries `Directive` table for active-status flags
2. `getRecentScores(200)` — queries `Score` table for recent breakdown JSON (with 8s internal timeout)
3. `getDirectiveRunCounts()` — queries `Score` table for 2000 rows of breakdown JSON (NO timeout)

The Score table is heavily loaded (scoring runs produce many directive outcomes). The `getDirectiveRunCounts` query pulls 2000 rows of JSON breakdown data which can hang indefinitely when the Score table is locked by concurrent writes.

## Partial Fix Applied (deployed)

Added deadline wrappers (`Promise.race` with `setTimeout`) in `directives.controller.ts` and `directives.service.ts`:

| Call | Before | After |
|------|--------|-------|
| `getDbStatuses()` | No timeout | 3s deadline |
| `getRecentScores()` | 8s internal timeout | 2s internal timeout |
| `getDirectiveRunCounts()` | No timeout | 3s deadline |
| Stats enrichment wrapper | Sequential, blocking | 3s `Promise.race` deadline |

**Result:** `GET /api/directives` now returns 102 directives in ~3 seconds (stats fields return null when Score queries time out). Stats are still available via `GET /api/directives/stats`.

## Remaining Issue

The frontend still shows empty directive palette. Investigation found:
- Frontend calls `apiGet('/api/directives')` which resolves to `http://localhost:3201/api/directives` (direct cross-origin, not via Vite proxy)
- CORS is configured to allow localhost origins
- Playwright `page.evaluate` with direct fetch to port 3201 returns data successfully
- But the React component stays in loading state
- Additionally, the `useNetworkStatus` hook does a HEAD request to `/api/health` via Vite proxy which fails with `net::ERR_ABORTED`, causing the health bar to show "API: Offline" even when the backend is running

## Files Changed

- `nest/src/modules/directives/directives.controller.ts` — Wrapped stats enrichment + getDbStatuses with deadline `Promise.race`
- `nest/src/modules/directives/directives.service.ts` — Reduced `getRecentScores` timeout 8s->2s, added 3s deadline to `getDirectiveRunCounts`

## Next Steps

- [ ] Fix Create Protocols page to accept 3s response time (check `apiGet` client or React rendering)
- [ ] Fix `net::ERR_ABORTED` on HEAD health check (possibly React Strict Mode double-mount)
- [ ] Investigate Score table performance — consider caching or moving stats to a separate endpoint
- [ ] Consider removing stats from the main `GET /api/directives` and only serving via `GET /api/directives/stats`
