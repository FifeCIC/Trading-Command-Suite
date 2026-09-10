---
date: 2026-09-10
area: scoring
type: bugfix
---

## What Changed

Epic #731 batch 2 — guard run #2 (199 → 82 warnings, 0 errors) plus four fixes.

1. **Session instants were wrong for every zone but the machine's** (the significant
   one). `new Date(onDay.toLocaleString('en-US', { timeZone: iana }))` + `setHours()`
   parses the ZONE's wall clock in the MACHINE's timezone. On a Europe/London box the
   New York open resolved 5 hours early and the Tokyo open 8 hours late, so
   `session-open-effect` — `ready`, in 10 active protocols — scored **6,308 times
   without ever leaving its no-signal branch**. Replaced with a shared DST-correct
   helper (`common/utils/session-time.ts`) in the directive and in
   `market-sessions.service.ts` (which was scheduling session calendar events at the
   same wrong instants).
2. **`cad-usd-oil-correlation` v2.1.0** — removed the unreachable `WTI +25` tier
   (`wtiValue` has no producer) so `maxScore` 125 → 100, dropped `'oil'` from
   `requiredDataFeeds`, and turned two constant floors (out-of-scope symbol, no macro
   data) from a flat `50` into `0`.
3. **`earnings-proximity` v2.0.2** — the mock branch no longer returns a constant 45;
   it returns 0 until an earnings feed is wired (stays `alpha`/excluded).
4. **Guard mode 7 is exposure- and persistence-aware** — 115 → 1 finding.

## Files Changed

- nest/src/common/utils/session-time.ts — NEW (zonedWallClockInstant, zoneOffsetMs, minutesInZone, minutesFromOpen)
- nest/src/common/utils/session-time.spec.ts — NEW (absolute-UTC expectations, DST both sides)
- nest/src/modules/directives/implementations/session-open-effect.directive.ts — uses the helper
- nest/src/modules/directives/implementations/session-open-effect.directive.spec.ts — NEW (fires at real opens)
- nest/src/modules/calendar/market-sessions.service.ts — uses the helper
- nest/src/modules/directives/implementations/cad-usd-oil-correlation.directive.ts — tier/floors/weights
- nest/src/modules/directives/implementations/earnings-proximity.directive.ts — phantom 45 → 0
- nest/src/modules/directives/implementations/directive-floor-contracts.spec.ts — NEW (7 cases)
- nest/scripts/directive-guard.cjs — mode 7 admission + persistence + sample-size filters
- nest/src/app.controller.spec.ts — version assertion reads package.json
- docs/directive-restructure-reconciliation.md — §6

## Why (theory)

Three principles, each already established elsewhere in this codebase:

- **A wall clock is not an instant.** "08:00 Europe/London" only becomes a UTC moment by
  resolving the zone's offset AT that moment. Formatting a zone's wall clock and then
  parsing it as machine-local silently substitutes the server's own timezone — a bug that
  hides on the developer's machine when both zones agree. Every session comparison now
  works in the zone's own wall clock or converts properly.
- **No earnable-without-evidence points.** A `maxScore` that counts a tier reading an
  unwritten input inflates the denominator for every symbol: it dilutes the composite
  rather than adding information (the same reason `gold-macro-correlation` lost its
  unreachable yield/VIX tiers). Likewise, "no evidence" must score 0, not a midpoint.
- **An audit tool must not invent work.** Mode 7's 115 warnings were mostly an artefact
  of what the evidence table happens to cover. Checking admission, persistence and
  sample size turns it into a tool that reports the one real production constant — the
  same discipline as `classifyDirectiveInclusion()` being the single source of truth.

## Capability Map Entry

- **name:** Session-open directional bias + DST-correct session timing
- **persistence:** session definitions in `market-sessions.service.ts`; scores in `Score`
- **uiSurfaces:** Protocol Trail / Ladder (score breakdown), Timeline (session open events)
- **pipeline:** scoring + calendar
- **completion:** complete

## QA Test Entry

- **area:** Scoring / Directives
- **name:** Session instants and directive floors
- **procedure:** `npm --prefix nest test -- --testPathPatterns="session-time|session-open-effect|directive-floor-contracts"`
- **expected:** 16 tests pass; session opens resolve to absolute UTC instants on any machine; `session-open-effect` leaves the outside-window branch at the real NY/Tokyo opens; out-of-scope and no-data directive branches score 0

## Architecture Framework Entry

- **section:** scoring / calendar
- **summary:** Session-local wall clocks convert to instants through one tested helper (`common/utils/session-time.ts`), fixing NY/Tokyo windows that were hours off on non-matching machines. `cad-usd-oil-correlation` no longer counts an unreachable oil tier. The directive guard's readiness-evidence check filters by protocol admission and breakdown persistence, so its warning count reflects real defects.
