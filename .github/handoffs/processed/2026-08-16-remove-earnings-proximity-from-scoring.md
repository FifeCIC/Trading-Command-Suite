---
date: 2026-08-16
area: scoring
type: refactor
---

## What Changed

Closed out the second half of issue #626 (mock directives returning constant scores). The `news-sentiment-positive` half was already deleted on 2026-08-14; this change removes `earnings-proximity` from every scoring protocol and strategy definition.

`earnings-proximity` reads `input.earningsDate`, which no producer writes, so it always returned a constant 45/100 "mock-neutral" score. It is kept at `readiness: 'alpha'` (excluded from scoring by `directive-inclusion.ts` rule 1) and removed from all protocol/strategy directive lists so it can never re-enter a composite until a real feed is wired (tracked in #648, which rehomes it as a catalyst directive in the screener).

## Files Changed

- nest/src/modules/directives/directive-groups.ts — removed `earnings-proximity` from the LONG `sentiment` group and the SHORT `bearish-sentiment` group; added NOTE comments explaining why.
- nest/src/modules/scoring/protocols-seed-data.ts — removed `earnings-proximity` from 5 protocols: `qqq-day-v1`, `tsla-speed-v1`, `momentum-stock-v1`, `earnings-momentum-v1`, `mt5-technical-short`.
- nest/src/modules/strategies/data/built-in-strategies.seed.json — removed the `earnings-proximity` weight from `ai-titans`.
- nest/src/modules/strategies/strategy-prerequisites.ts — removed `earnings-proximity` from `earnings-catalyst` requiredDirectives.
- nest/src/modules/strategies/strategy-seeds.ts — removed `earnings-proximity` from `Earnings Momentum Play` and `Tech Titans`.
- nest/src/modules/directives/implementations/earnings-proximity.directive.ts — expanded header doc comment documenting the #626 design decision and the #648 rehoming plan.

## Result

No directive returns a constant mock score inside any active protocol. `earnings-proximity` is alpha + removed from all protocol/strategy lists (belt-and-braces on top of the `classifyDirectiveInclusion` alpha exclusion). Build passes.

## Capability Map Entry

- **name:** earnings-proximity removed from scoring
- **persistence:** ephemeral
- **uiSurfaces:** 0
- **pipeline:** scoring
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** No constant mock scores in protocols
- **procedure:** Grep `protocols-seed-data.ts` + `directive-groups.ts` for `earnings-proximity`; confirm absent from `directiveIds`. Run `node nest/scripts/directive-guard.cjs --static-only`.
- **expected:** No `earnings-proximity` in any protocol directive list; no constant-mock directive inside an active protocol.

## Architecture Framework Entry

- **section:** scoring
- **summary:** `earnings-proximity` (mock-first, no wired feed) removed from all scoring protocols and strategy definitions; kept alpha for later rehoming as a screener catalyst directive (#648). `news-sentiment-positive` was already deleted 2026-08-14, completing #626.
