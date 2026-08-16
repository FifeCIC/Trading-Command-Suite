---
date: 2026-08-16
area: scoring
type: refactor
---

## What Changed

Demoted the mock-first `earnings-proximity` directive `beta → alpha` and removed the mock-first `news-sentiment-positive` directive, so no directive returns a constant mock score inside any active protocol. The readiness gate (#627) now pauses any protocol still referencing `earnings-proximity`.

## Files Changed

- nest/src/modules/directives/implementations/earnings-proximity.directive.ts — `readiness: 'alpha'` (was beta); still mock-first but gated out of scoring
- news-sentiment.directive.ts — deleted (see processed handoff 2026-08-14-delete-news-sentiment-positive.md)

## Capability Map Entry

- **name:** Mock-stub directive elimination
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** No mock stubs score in active protocols
- **procedure:** Confirm no active protocol lists `news-sentiment-positive` or `earnings-proximity` among scoring directives.
- **expected:** `news-sentiment-positive` absent; `earnings-proximity` present only in paused protocols.

## Architecture Framework Entry

- **section:** scoring
- **summary:** Mock-first stubs eliminated from active scoring — `news-sentiment-positive` deleted, `earnings-proximity` demoted to `alpha` (gated out by the readiness gate). Neither contributes a constant score.
