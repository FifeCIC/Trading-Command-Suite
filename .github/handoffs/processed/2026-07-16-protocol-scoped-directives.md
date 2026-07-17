---
date: 2026-07-16
area: scoring
type: bugfix
---

## What Changed

Fixed META.Stack #2: `DirectivesService.runAll()` now accepts an optional `directiveFilter` parameter, allowing protocol-gated scoring to run only the directives in the active protocol instead of all 100+ registered directives. `ProtocolGatingService.scoreWithGating()` now collects directive IDs from the protocol's active groups and passes them as a filter.

## Files Changed

- `nest/src/modules/directives/directives.service.ts` — Added optional `directiveFilter?: Set<string>` parameter to `runAll()`. When provided, the main loop skips directives whose IDs are not in the filter set.
- `nest/src/modules/scoring/protocol-gating.service.ts` — `scoreWithGating()` now builds a `Set<string>` of directive IDs from the active protocol's groups and passes it to `runAll()`, avoiding the run-all-then-filter-later anti-pattern.

## Capability Map Entry

- **name:** Protocol-Scoped Directive Execution
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring
- **name:** Protocol-scoped directive execution
- **procedure:** Start the automation loop. Enable a scoring strategy for `built-in-default` protocol (16 directives). Observe NestJS logs — previously 100 directives ran per symbol; now only ~16 should run. Verify composite scores remain identical (same directives, same inputs, same results).
- **expected:** Same composite scores as before, but fewer directives executed per tick. No regression in scoring output.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Protocol-Scoped Directive Execution — `runAll()` accepts optional `directiveFilter: Set<string>` to skip directives not in the active protocol. `scoreWithGating()` collects directive IDs from protocol groups and passes them. 7 callers of `runAll()` — only `scoreWithGating()` passes filter; others unchanged (e.g., `rankAll()` still needs all directives for cross-protocol ranking). Files: directives.service.ts, protocol-gating.service.ts.
