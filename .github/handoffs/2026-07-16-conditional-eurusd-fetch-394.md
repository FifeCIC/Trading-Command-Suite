# Handoff: Conditional EURUSD Fetch (#394)

**Date**: 2026-07-16
**Agent**: DeepSeek V4 Pro (GitHub Copilot)
**Issue**: [#394 — META.Stack #7: scoreWithGating() unconditionally fetches EURUSD for DXY proxy](https://github.com/FifeCIC/Trading-Command-Suite/issues/394)

## Summary

`scoreWithGating()` now checks whether the active protocol's directive groups actually include any DXY-dependent directives before fetching EURUSD from MT5. Protocols that don't use DXY (e.g., pure stock protocols) no longer trigger an unnecessary MT5 call.

## What Changed

### `nest/src/modules/scoring/protocol-gating.service.ts`

1. Added `EURUSD_DEPENDENT_DIRECTIVES` — a Set of directive IDs that read `eurusdValue` from `DirectiveInput`:
   - `dxy-regime`
   - `cad-usd-oil-correlation`
   - `gold-macro-correlation`

2. Added `protocolNeedsEurUsd()` helper — checks if any of the active directive groups includes a EURUSD-dependent directive.

3. Modified `scoreWithGating()` to:
   - Determine `activeGroups` FIRST (before any fetch)
   - Only call `eurusdCache.getValue()` if `protocolNeedsEurUsd(activeGroups)` returns true
   - Skip macro snapshot capture when EURUSD not fetched

### Not changed

- `ScoringService.rankAll()` still fetches EURUSD unconditionally — it runs ALL directives including `dxy-regime`, so the fetch is always needed.
- `EurUsdCacheService` already has 60s tick-level caching, so even before this fix, only the first call per tick actually hit MT5.

## Behavior by protocol type

| Protocol type | Before | After |
|--------------|--------|-------|
| DXY-dependent (forex, gold, oil) | Fetches EURUSD | Fetches EURUSD (unchanged) |
| Stock-only protocols | Fetches EURUSD (wasteful) | Skips fetch |
| Unknown/generic protocols | Fetches EURUSD | Skips fetch (no DXY directives in groups) |

## Build

- ✅ NestJS: clean compile
- ✅ Vite frontend: 93 entries, 6208KB
