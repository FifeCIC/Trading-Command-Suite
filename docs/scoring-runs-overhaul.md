# Scoring Runs — Data, UI & Performance Overhaul

Status: discussion
Created: 2026-06-29

## Current State
- Fetches from `/api/scoring/runs` → `scoreHistoryService.getRuns()` → groups Score table rows by 60-second windows
- Shows: timestamp, strategyId (UUID), symbols scored count, expandable score list
- Loads slowly even with just 3 runs displayed
- Symbols scored varies (120–200) — because it counts all scores in that minute window, not a targeted batch
- No search, no symbol filter

## Clear Actions

### 1. Display Strategy Name, Not UUID
The STRATEGY column shows a UUID like `060ed261-4a8c-46a4-aa9c-9de0ba7ddb8d`. This is useless to humans.
- [ ] Join with the strategy/protocol name in the query or controller
- [ ] Show both: human-readable name (primary) + truncated UUID (secondary, for debugging)

### 2. Search & Symbol Filter
- [ ] Add a search input to filter by symbol ticker
- [ ] Allow viewing all scores for a single symbol across all runs
- [ ] Add date range picker (not just preset filters)

### 3. Performance: Page Caching
The page loads slowly. Options to explore:
- [ ] Server-side pagination (the query currently fetches 500+ scores then groups in-memory)
- [ ] Move grouping to SQL level (GROUP BY truncated timestamp)
- [ ] Frontend caching: stale-while-revalidate pattern with short TTL
- [ ] Is there a core page cache system or library we could implement? (e.g., Redis caching layer, TanStack Query persistence)
- [ ] Mechanism for triggering cache invalidation: scoring run completes → invalidate cache

### 4. Unified Scoring Storage
All scoring actions — manual (single symbol), paired (watchlist), automated (scheduler) — should write to the SAME tables. This is critical for:
- Consistent querying
- Reliable signal generation
- Accurate historical analysis

Is this currently the case? The `protocol-runner.service.ts` and `scoring-scheduler.service.ts` both exist — do they write to the same Score table?

## Questions For You

1. **Page cache strategy**: Do you prefer a lightweight frontend cache (TanStack Query `staleTime` + `gcTime`) or a backend Redis cache with invalidation triggers? The frontend approach is simpler but doesn't help other consumers. Redis is more infrastructure.

2. **Scoring Runs vs. Activity Logs**: You mentioned the Activity Logs page feels like a confused duplicate. Should we merge them into one "Scoring History" page, or keep them separate with clear purposes: Runs = structured scoring results, Logs = file-based debug/monitor output?

3. **Single-symbol scoring**: Should the "Run Now" button on this page allow selecting a specific symbol? Currently it runs the full pipeline. A single-symbol option would be useful for testing.

4. **Symbol count variance**: The 120–200 range per run — is this expected behavior (all active symbols scored each run) or should we scope runs to specific watchlists/protocols? What determines which symbols get scored?
